import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config.js";
import { createLogger } from "./logging.js";
import { Database } from "./infrastructure/database.js";
import { ProjectFiles } from "./infrastructure/project-files.js";
import { PiAdapter } from "./infrastructure/pi/pi-adapter.js";
import { createDiscordClient, DiscordBot } from "./infrastructure/discord/discord-bot.js";
import { DiscordResourceGateway } from "./infrastructure/discord/discord-resources.js";
import { CodexUsageClient } from "./infrastructure/provider-usage/codex-usage.js";
import { ProviderUsageMonitor } from "./infrastructure/provider-usage/provider-usage-monitor.js";
import { HarnessHubApplication } from "./application/application.js";
import { ProjectStatusIndicators, projectStatusFromSession } from "./application/project-status.js";
import { checkHealth } from "./health.js";

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const logger = createLogger(config.logLevel);
  await fs.mkdir(config.workspaceRoot, { recursive: true, mode: 0o700 });
  const canonicalWorkspaceRoot = await fs.realpath(config.workspaceRoot);
  const runtimeConfig = { ...config, workspaceRoot: canonicalWorkspaceRoot };
  const database = Database.open(config.databasePath);
  const interruptedJobs = database.reconcileInterruptedWork();
  const files = await ProjectFiles.create(runtimeConfig.workspaceRoot);
  const adapter = new PiAdapter({
    command: config.piCommand,
    sessionRoot: path.join(path.dirname(config.databasePath), "pi-sessions"),
    maxSessions: config.maxConcurrentSessions,
  });
  const client = createDiscordClient();
  const discord = new DiscordResourceGateway(client, config.discordAdminUserId);
  const projectStatuses = new ProjectStatusIndicators(discord, logger);
  const application = new HarnessHubApplication(
    runtimeConfig,
    database,
    discord,
    files,
    adapter,
    projectStatuses,
  );
  const usageMonitor = new ProviderUsageMonitor(
    database.workspaces,
    config.discordGuildId,
    new CodexUsageClient(config.piAgentDirectory),
    discord,
    logger,
  );
  const bot = new DiscordBot(client, config.discordGuildId, config.discordToken, application, logger, () =>
    usageMonitor.refresh(),
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "HarnessHub shutting down");
    usageMonitor.stop();
    await bot.stop();
    await adapter.dispose();
    database.close();
  };
  const handleSignal = (signal: string): void => {
    void shutdown(signal).catch((error: unknown) => {
      logger.error({ error }, "HarnessHub shutdown failed");
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", () => handleSignal("SIGINT"));
  process.once("SIGTERM", () => handleSignal("SIGTERM"));

  try {
    const health = await checkHealth(database, runtimeConfig.workspaceRoot);
    if (health.status !== "healthy") throw new Error("HarnessHub startup health check failed");
    logger.info({ interruptedJobs, health }, "HarnessHub starting");
    await bot.start();
    await Promise.all(
      database.projects
        .listActive()
        .map((project) =>
          projectStatuses.update(
            project,
            projectStatusFromSession(database.sessions.findLatestByProject(project.id)?.status),
          ),
        ),
    );
    usageMonitor.start();
  } catch (error) {
    await shutdown("startup-failure");
    throw error;
  }
}

main().catch((error: unknown) => {
  const logger = createLogger("error");
  logger.error({ error }, "HarnessHub could not start");
  process.exitCode = 1;
});
