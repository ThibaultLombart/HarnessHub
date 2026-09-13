import path from "node:path";
import { z } from "zod";

const snowflake = z.string().regex(/^\d{17,20}$/, "must be a Discord snowflake");
const absolutePath = z
  .string()
  .min(1)
  .refine((value) => path.isAbsolute(value), "must be an absolute path");

const environmentSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_GUILD_ID: snowflake,
  DISCORD_ADMIN_USER_ID: snowflake,
  HARNESSHUB_WORKSPACE_ROOT: absolutePath,
  HARNESSHUB_DATABASE_PATH: absolutePath,
  HARNESSHUB_PI_COMMAND: z.string().min(1).default("pi"),
  HARNESSHUB_MAX_CONCURRENT_SESSIONS: z.coerce.number().int().min(1).max(16).default(2),
  HARNESSHUB_UPDATE_CHECKOUT: absolutePath.optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type Config = Readonly<{
  discordToken: string;
  discordGuildId: string;
  discordAdminUserId: string;
  workspaceRoot: string;
  databasePath: string;
  piCommand: string;
  maxConcurrentSessions: number;
  updateCheckout: string;
  logLevel: z.infer<typeof environmentSchema>["LOG_LEVEL"];
}>;

export class ConfigError extends Error {
  public constructor(fields: readonly string[]) {
    super(`Invalid configuration: ${fields.join(", ")}`);
    this.name = "ConfigError";
  }
}

export function loadConfig(environment: NodeJS.ProcessEnv | Record<string, string | undefined>): Config {
  const result = environmentSchema.safeParse(environment);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join(".") || "environment"))];
    throw new ConfigError(fields);
  }

  return {
    discordToken: result.data.DISCORD_TOKEN,
    discordGuildId: result.data.DISCORD_GUILD_ID,
    discordAdminUserId: result.data.DISCORD_ADMIN_USER_ID,
    workspaceRoot: path.resolve(result.data.HARNESSHUB_WORKSPACE_ROOT),
    databasePath: path.resolve(result.data.HARNESSHUB_DATABASE_PATH),
    piCommand: result.data.HARNESSHUB_PI_COMMAND,
    maxConcurrentSessions: result.data.HARNESSHUB_MAX_CONCURRENT_SESSIONS,
    updateCheckout: path.resolve(result.data.HARNESSHUB_UPDATE_CHECKOUT ?? process.cwd()),
    logLevel: result.data.LOG_LEVEL,
  };
}
