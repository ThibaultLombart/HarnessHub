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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harnesshub-lifecycle-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("project lifecycle", () => {
  it("deletes a project only after slug confirmation", async () => {
    const root = temporaryRoot();
    const workspaceRoot = path.join(root, "workspaces");
    fs.mkdirSync(workspaceRoot);
    const config: Config = {
      discordToken: "not-real",
      discordGuildId: "123456789012345678",
      discordAdminUserId: "234567890123456789",
      workspaceRoot,
      databasePath: path.join(root, "state.sqlite"),
      piCommand: "pi",
      piAgentDirectory: path.join(root, "pi-agent"),
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
    const adapter: HarnessAdapter = {
      getCapabilities: () => new Set(),
      detect: async () => ({ installed: true, version: "test" }),
      install: async () => undefined,
      getAuthStatus: async () => ({ authenticated: true, providers: ["test"] }),
      startSession: async () => {
        throw new Error("not used");
      },
      getSession: () => undefined,
      stopSession: vi.fn(async () => undefined),
      installPackageResource: async () => undefined,
      removePackageResource: async () => undefined,
      listModels: async () => [],
      dispose: async () => undefined,
    };
    const database = Database.open(config.databasePath);
    const app = new HarnessHubApplication(
      config,
      database,
      discord,
      await ProjectFiles.create(workspaceRoot),
      adapter,
    );
    const actor = { guildId: config.discordGuildId, userId: config.discordAdminUserId };
    await app.setup(actor);
    const project = await app.createProject({ ...actor, channelId: "management" }, { name: "Delete Me" });

    await expect(
      app.deleteProject({ ...actor, channelId: project.channelId }, { confirm: "wrong" }),
    ).rejects.toThrow(/confirm deletion/i);
    await expect(
      app.deleteProject({ ...actor, channelId: project.channelId }, { confirm: project.slug }),
    ).resolves.toMatchObject({ id: project.id, slug: "delete-me" });

    expect(discord.deleteProjectChannel).toHaveBeenCalledWith(project.channelId);
    expect(fs.existsSync(project.path)).toBe(false);
    expect(database.projects.findById(project.id)).toBeUndefined();
    database.close();
  });
});
