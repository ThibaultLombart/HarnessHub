import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HarnessHubApplication,
  ProjectDeletionBlockedError,
  type DiscordResources,
} from "../src/application/application.js";
import type { Config } from "../src/config.js";
import type { HarnessAdapter } from "../src/domain/harness.js";
import type { Project } from "../src/domain/project.js";
import { Database } from "../src/infrastructure/database.js";
import { ProjectFiles } from "../src/infrastructure/project-files.js";

const roots: string[] = [];

function temporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harnesshub-deletion-safety-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("project deletion Git safety", () => {
  it.each([
    ["missing project directory", prepareMissingProjectDirectory, false],
    ["non-Git project directory", prepareNonGitProjectDirectory, true],
    ["corrupt Git metadata", prepareCorruptGitProjectDirectory, true],
  ])("blocks deletion when Git status cannot verify safety: %s", async (_name, prepare, expectedExists) => {
    const fixture = await createDeletionFixture("blocked-project");
    try {
      await prepare(fixture.project.path);

      await expect(
        fixture.app.deleteProject(fixture.actorForProject(), { confirm: fixture.project.slug }),
      ).rejects.toThrow(ProjectDeletionBlockedError);

      expect(fixture.discord.deleteProjectChannel).not.toHaveBeenCalled();
      expect(fixture.adapter.stopSession).not.toHaveBeenCalled();
      expect(fixture.files.removeProject).not.toHaveBeenCalled();
      expect(fixture.database.projects.findById(fixture.project.id)).toMatchObject({
        id: fixture.project.id,
        archivedAt: null,
      });
      expect(fs.existsSync(fixture.project.path)).toBe(expectedExists);
    } finally {
      fixture.database.close();
    }
  });

  it("blocks deletion and preserves channel, files, and database row for a dirty Git repo", async () => {
    const fixture = await createDeletionFixture("dirty-project");
    try {
      prepareCleanGitProjectDirectory(fixture.project.path);
      fs.writeFileSync(path.join(fixture.project.path, "uncommitted.txt"), "keep me");

      await expect(
        fixture.app.deleteProject(fixture.actorForProject(), { confirm: fixture.project.slug }),
      ).rejects.toThrow(ProjectDeletionBlockedError);

      expect(fixture.discord.deleteProjectChannel).not.toHaveBeenCalled();
      expect(fixture.adapter.stopSession).not.toHaveBeenCalled();
      expect(fixture.files.removeProject).not.toHaveBeenCalled();
      expect(fs.existsSync(path.join(fixture.project.path, "uncommitted.txt"))).toBe(true);
      expect(fixture.database.projects.findById(fixture.project.id)).toMatchObject({
        id: fixture.project.id,
        archivedAt: null,
      });
    } finally {
      fixture.database.close();
    }
  });

  it("deletes channel, files, and database row after slug confirmation for a clean Git repo", async () => {
    const fixture = await createDeletionFixture("clean-project");
    try {
      prepareCleanGitProjectDirectory(fixture.project.path);

      await expect(
        fixture.app.deleteProject(fixture.actorForProject(), { confirm: fixture.project.slug }),
      ).resolves.toMatchObject({ id: fixture.project.id, slug: fixture.project.slug });

      expect(fixture.discord.deleteProjectChannel).toHaveBeenCalledWith(fixture.project.channelId);
      expect(fixture.adapter.stopSession).toHaveBeenCalledWith(fixture.project.id);
      expect(fixture.files.removeProject).toHaveBeenCalledWith(fixture.project.path);
      expect(fs.existsSync(fixture.project.path)).toBe(false);
      expect(fixture.database.projects.findById(fixture.project.id)).toBeUndefined();
    } finally {
      fixture.database.close();
    }
  });
});

async function createDeletionFixture(slug: string) {
  const root = temporaryRoot();
  const rawWorkspaceRoot = path.join(root, "workspaces");
  fs.mkdirSync(rawWorkspaceRoot, { recursive: true });
  const workspaceRoot = fs.realpathSync(rawWorkspaceRoot);
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
  const files = await ProjectFiles.create(workspaceRoot);
  vi.spyOn(files, "removeProject").mockImplementation(async (destination) => {
    await fs.promises.rm(destination, { recursive: true, force: true });
  });
  const now = new Date().toISOString();
  const workspace = {
    id: "workspace-id",
    discordGuildId: config.discordGuildId,
    categoryId: "category",
    managementChannelId: "management",
    workspaceRoot,
    createdAt: now,
  };
  database.workspaces.save(workspace);
  const project: Project = {
    id: `${slug}-id`,
    workspaceId: workspace.id,
    name: slug,
    slug,
    channelId: `${slug}-channel`,
    path: path.join(workspaceRoot, slug),
    harnessId: null,
    gitRemote: null,
    createdAt: now,
    archivedAt: null,
  };
  database.projects.save(project);
  const app = new HarnessHubApplication(config, database, discord, files, adapter);
  return {
    app,
    config,
    database,
    discord,
    adapter,
    files,
    project,
    actorForProject: () => ({
      guildId: config.discordGuildId,
      userId: config.discordAdminUserId,
      channelId: project.channelId,
    }),
  };
}

function prepareMissingProjectDirectory(): Promise<void> {
  return Promise.resolve();
}

function prepareNonGitProjectDirectory(projectPath: string): Promise<void> {
  fs.mkdirSync(projectPath);
  return Promise.resolve();
}

function prepareCorruptGitProjectDirectory(projectPath: string): Promise<void> {
  fs.mkdirSync(path.join(projectPath, ".git"), { recursive: true });
  return Promise.resolve();
}

function prepareCleanGitProjectDirectory(projectPath: string): void {
  execFileSync("git", ["init", "--", projectPath], { stdio: "ignore" });
}
