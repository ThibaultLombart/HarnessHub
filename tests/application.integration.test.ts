import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HarnessHubApplication, type DiscordResources } from "../src/application/application.js";
import type { Config } from "../src/config.js";
import type { HarnessAdapter } from "../src/domain/harness.js";
import { Database } from "../src/infrastructure/database.js";
import { ProjectFiles } from "../src/infrastructure/project-files.js";

const roots: string[] = [];
function temporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harnesshub-app-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("HarnessHubApplication", () => {
  it("persists a complete local setup and project across database restart", async () => {
    const root = temporaryRoot();
    const workspaceRoot = path.join(root, "workspaces");
    fs.mkdirSync(workspaceRoot);
    const databasePath = path.join(root, "state.sqlite");
    const config: Config = {
      discordToken: "not-real",
      discordGuildId: "123456789012345678",
      discordAdminUserId: "234567890123456789",
      workspaceRoot,
      databasePath,
      piCommand: "pi",
      maxConcurrentSessions: 2,
      updateCheckout: root,
      logLevel: "silent",
    };
    const discord: DiscordResources = {
      ensureWorkspace: vi.fn(async () => ({ categoryId: "category", managementChannelId: "management" })),
      workspaceExists: vi.fn(async () => true),
      createProjectChannel: vi.fn(async () => "project-channel"),
      deleteProjectChannel: vi.fn(async () => undefined),
      projectChannelMatches: vi.fn(async () => true),
    };
    const detect = vi.fn(async () => ({ installed: true, version: "test" }));
    const installPackageResource = vi.fn(async () => undefined);
    const removePackageResource = vi.fn(async () => undefined);
    const listModels = vi.fn(async () => [{ provider: "fake", id: "model", label: "fake/model" }]);
    const startSession = vi.fn(async () => ({
      externalSessionId: "session",
      isBusy: false,
      sendPrompt: async () => "answer",
      stop: async () => undefined,
      close: async () => undefined,
    }));
    const adapter: HarnessAdapter = {
      getCapabilities: () => new Set(),
      detect,
      install: async () => undefined,
      getAuthStatus: async () => ({ authenticated: true, providers: ["test"] }),
      listModels,
      setSessionModel: async () => undefined,
      startSession,
      getSession: () => undefined,
      stopSession: async () => undefined,
      installPackageResource,
      removePackageResource,
      dispose: async () => undefined,
    };
    const first = Database.open(databasePath);
    const app = new HarnessHubApplication(
      config,
      first,
      discord,
      await ProjectFiles.create(workspaceRoot),
      adapter,
    );
    const actor = { guildId: config.discordGuildId, userId: config.discordAdminUserId };

    await app.setup(actor);
    await expect(app.detectHarness({ ...actor, channelId: "other" })).rejects.toThrow(
      /workspace-management/i,
    );
    expect(detect).not.toHaveBeenCalled();
    const project = await app.createProject(
      { ...actor, channelId: "management" },
      { name: "Persistent Demo" },
    );
    const resource = await app.installResource(
      { ...actor, channelId: project.channelId },
      { scope: "project", source: "npm:demo-pi-pack" },
    );
    expect(installPackageResource).toHaveBeenCalledWith({
      scope: "project",
      cwd: path.join(workspaceRoot, "persistent-demo"),
      source: "npm:demo-pi-pack",
    });
    await app.setProjectModel({ ...actor, channelId: project.channelId }, { model: "fake/model" });
    await app.prompt({ ...actor, channelId: project.channelId, content: "work" }, () => undefined);
    expect(startSession).toHaveBeenCalledWith(expect.objectContaining({ modelPattern: "fake/model" }));
    await expect(app.systemStatus({ ...actor, channelId: "management" })).resolves.toContain("Version:");
    expect(app.mcpStatus({ ...actor, channelId: "management" })).toContain("Pi: no native MCP");
    expect(app.backupStatus({ ...actor, channelId: "management" })).toContain(
      "Restore must replace both state",
    );
    const repair = await app.repairStatus({ ...actor, channelId: project.channelId });
    expect(repair).toContain("No repair needed.");
    const status = await app.projectStatus({ ...actor, channelId: project.channelId });
    expect(status).toContain("Model: fake/model");
    expect(status).toContain("Resources: project:npm:demo-pi-pack [installed]");
    expect(status).toContain("Recent jobs: install-resource [succeeded]");
    first.close();

    const second = Database.open(databasePath);
    expect(second.workspaces.findByGuildId(config.discordGuildId)?.managementChannelId).toBe("management");
    expect(second.projects.findByChannelId(project.channelId)?.slug).toBe("persistent-demo");
    expect(fs.existsSync(path.join(workspaceRoot, "persistent-demo", ".git"))).toBe(true);
    expect(second.resources.findById(resource.id)).toMatchObject({
      scope: "project",
      projectId: project.id,
      source: "npm:demo-pi-pack",
      status: "installed",
    });
    expect(second.modelPreferences.findByProject(project.id)).toMatchObject({
      provider: "fake",
      modelId: "model",
    });
    second.close();
  });
});
