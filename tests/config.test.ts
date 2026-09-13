import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.js";

const validEnvironment = {
  DISCORD_TOKEN: "not-a-real-token",
  DISCORD_GUILD_ID: "123456789012345678",
  DISCORD_ADMIN_USER_ID: "234567890123456789",
  HARNESSHUB_WORKSPACE_ROOT: path.resolve("workspaces"),
  HARNESSHUB_DATABASE_PATH: path.resolve("state", "harnesshub.sqlite"),
};

describe("loadConfig", () => {
  it("parses valid configuration and applies safe defaults", () => {
    const config = loadConfig(validEnvironment);

    expect(config.logLevel).toBe("info");
    expect(config.maxConcurrentSessions).toBe(2);
    expect(config.piCommand).toBe("pi");
  });

  it("rejects relative persistent paths", () => {
    expect(() => loadConfig({ ...validEnvironment, HARNESSHUB_WORKSPACE_ROOT: "./relative" })).toThrow(
      ConfigError,
    );
  });

  it("does not include secret values in configuration errors", () => {
    const secret = "a-very-sensitive-discord-token";

    try {
      loadConfig({ ...validEnvironment, DISCORD_TOKEN: secret, DISCORD_GUILD_ID: "bad" });
      expect.unreachable("expected invalid configuration");
    } catch (error) {
      expect(String(error)).not.toContain(secret);
      expect(String(error)).toContain("DISCORD_GUILD_ID");
    }
  });
});
