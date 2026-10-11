import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HarnessHubApplication,
  ProjectArchivedError,
  ProjectDegradedError,
  type DiscordResources,
} from "../src/application/application.js";
import type { Config } from "../src/config.js";
import type { HarnessAdapter } from "../src/domain/harness.js";
import type { Project } from "../src/domain/project.js";
import { Database } from "../src/infrastructure/database.js";
import { handleDiscordFileUpload } from "../src/infrastructure/discord/discord-bot.js";
import { ProjectFiles } from "../src/infrastructure/project-files.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Discord file upload command", () => {
  it("rejects unauthorized, unmapped, archived, and degraded uploads before downloading", async () => {
    const fixture = await createUploadFixture();
    const contentDownload = vi.fn(async () => new TextEncoder().encode("network"));

    await expect(
      handleDiscordFileUpload({
        application: fixture.app,
        actor: { guildId: fixture.actor.guildId, userId: "not-admin" },
        channelId: fixture.project.channelId,
        attachment: { url: "https://cdn.discordapp.test/file.txt", size: 7 },
        relativePath: "unauthorized.txt",
        download: contentDownload,
      }),
    ).rejects.toThrow(/not authorized/i);

    await expect(
      handleDiscordFileUpload({
        application: fixture.app,
        actor: fixture.actor,
        channelId: "unmapped-channel",
        attachment: { url: "https://cdn.discordapp.test/file.txt", size: 7 },
        relativePath: "unmapped.txt",
        download: contentDownload,
      }),
    ).rejects.toThrow(/not mapped/i);

    const archived = await fixture.app.archiveProject(
      { ...fixture.actor, channelId: fixture.project.channelId },
      { confirm: fixture.project.slug },
    );
    await expect(
      handleDiscordFileUpload({
        application: fixture.app,
        actor: fixture.actor,
        channelId: archived.channelId,
        attachment: { url: "https://cdn.discordapp.test/file.txt", size: 7 },
        relativePath: "archived.txt",
        download: contentDownload,
      }),
    ).rejects.toThrow(ProjectArchivedError);

    const degraded = await createUploadFixture({ projectChannelMatches: false });
    await expect(
      handleDiscordFileUpload({
        application: degraded.app,
        actor: degraded.actor,
        channelId: degraded.project.channelId,
        attachment: { url: "https://cdn.discordapp.test/file.txt", size: 7 },
        relativePath: "degraded.txt",
        download: contentDownload,
      }),
    ).rejects.toThrow(ProjectDegradedError);

    expect(contentDownload).not.toHaveBeenCalled();
    fixture.database.close();
    degraded.database.close();
  });

  it("rejects declared oversize attachments before downloading and uploads valid content after preflight", async () => {
    const fixture = await createUploadFixture();
    const download = vi.fn(async () => new TextEncoder().encode("saved"));

    await expect(
      handleDiscordFileUpload({
        application: fixture.app,
        actor: fixture.actor,
        channelId: fixture.project.channelId,
        attachment: {
          url: "https://cdn.discordapp.test/large.bin",
          size: fixture.app.maximumUploadBytes + 1,
        },
        relativePath: "too-large.bin",
        download,
      }),
    ).rejects.toThrow("Uploaded file is too large");
    expect(download).not.toHaveBeenCalled();

    await expect(
      handleDiscordFileUpload({
        application: fixture.app,
        actor: fixture.actor,
        channelId: fixture.project.channelId,
        attachment: { url: "https://cdn.discordapp.test/file.txt", size: 5 },
        relativePath: "ok.txt",
        download,
      }),
    ).resolves.toBe("ok.txt");

    expect(download).toHaveBeenCalledWith("https://cdn.discordapp.test/file.txt", {
      maximumBytes: fixture.app.maximumUploadBytes,
    });
    expect(fs.readFileSync(path.join(fixture.project.path, "ok.txt"), "utf8")).toBe("saved");
    fixture.database.close();
  });
});

async function createUploadFixture(options: { projectChannelMatches?: boolean } = {}): Promise<{
  app: HarnessHubApplication;
  actor: { guildId: string; userId: string };
  project: Project;
  database: Database;
}> {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(process.cwd()), ".tmp-harnesshub-discord-upload-"));
  roots.push(root);
  const workspaceRootPath = path.join(root, "workspaces");
  fs.mkdirSync(workspaceRootPath);
  const workspaceRoot = fs.realpathSync(workspaceRootPath);
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
    updateProjectChannelStatus: vi.fn(async () => undefined),
    deleteProjectChannel: vi.fn(async () => undefined),
    projectChannelMatches: vi.fn(async () => options.projectChannelMatches ?? true),
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
    stopSession: async () => undefined,
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
  const project = await app.createProject({ ...actor, channelId: "management" }, { name: "Upload Me" });
  return { app, actor, project, database };
}
