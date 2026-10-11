import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HarnessHubApplication,
  ProjectArchivedError,
  type DiscordResources,
} from "../src/application/application.js";
import type { ProjectWorkStatus } from "../src/application/project-status.js";
import type { Config } from "../src/config.js";
import type { HarnessAdapter } from "../src/domain/harness.js";
import type { Project } from "../src/domain/project.js";
import { Database } from "../src/infrastructure/database.js";
import { ProjectFiles } from "../src/infrastructure/project-files.js";

const roots: string[] = [];

function temporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(process.cwd()), ".tmp-harnesshub-archive-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("archived project inactive boundary", () => {
  it("blocks every project mutating or running operation before status changes, jobs, and harness calls", async () => {
    const fixture = await createArchivedFixture();
    const { app, actor, project, adapter, database, updateProjectStatus, resourceId } = fixture;
    const archivedActor = { ...actor, channelId: project.channelId };
    const jobsBefore = database.jobs.listRecent(100).length;
    const statusUpdatesBefore = updateProjectStatus.mock.calls.length;

    await expect(app.prompt({ ...archivedActor, content: "do work" }, () => undefined)).rejects.toThrow(
      ProjectArchivedError,
    );
    await expect(app.resume(actor, project.id, () => undefined)).rejects.toThrow(ProjectArchivedError);
    await expect(
      app.restartProjectSession(archivedActor, { confirm: "RESTART" }, () => undefined),
    ).rejects.toThrow(ProjectArchivedError);
    await expect(
      app.uploadProjectFile(archivedActor, {
        relativePath: "notes.txt",
        content: new TextEncoder().encode("blocked"),
      }),
    ).rejects.toThrow(ProjectArchivedError);
    await expect(
      app.installResource(archivedActor, { scope: "project", source: "npm:after-archive" }),
    ).rejects.toThrow(ProjectArchivedError);
    await expect(app.removeResource(archivedActor, { id: resourceId, scope: "project" })).rejects.toThrow(
      ProjectArchivedError,
    );
    await expect(app.setProjectModel(archivedActor, { model: "fake/model" })).rejects.toThrow(
      ProjectArchivedError,
    );
    expect(() => app.resetProjectModel(archivedActor)).toThrow(ProjectArchivedError);
    await expect(app.linkGitRemote(archivedActor, "https://example.com/repo.git")).rejects.toThrow(
      ProjectArchivedError,
    );

    expect(updateProjectStatus).toHaveBeenCalledTimes(statusUpdatesBefore);
    expect(database.jobs.listRecent(100)).toHaveLength(jobsBefore);
    expect(adapter.startSession).toHaveBeenCalledTimes(0);
    expect(adapter.restartSession).toHaveBeenCalledTimes(0);
    expect(adapter.installPackageResource).toHaveBeenCalledTimes(0);
    expect(adapter.removePackageResource).toHaveBeenCalledTimes(0);
    expect(adapter.setSessionModel).toHaveBeenCalledTimes(0);
    expect(adapter.listModels).toHaveBeenCalledTimes(0);
    expect(fs.existsSync(path.join(project.path, "notes.txt"))).toBe(false);

    database.close();
  });

  it("preserves archived project inspection, stopping, and confirmed deletion", async () => {
    const fixture = await createArchivedFixture();
    const { app, actor, project, adapter, database } = fixture;
    const archivedActor = { ...actor, channelId: project.channelId };

    expect(app.projectForChannel(archivedActor).archivedAt).not.toBeNull();
    await expect(app.projectStatus(archivedActor)).resolves.toContain("HarnessHub / Archive Me");
    await expect(app.gitStatus(archivedActor)).resolves.toMatchObject({ clean: true });
    expect(app.listResources(archivedActor).map((resource) => resource.source)).toContain(
      "npm:before-archive",
    );
    expect(app.modelStatus(archivedActor)).toMatchObject({ provider: "fake", modelId: "model" });
    expect(app.projectModelLabel(archivedActor)).toBe("fake/model");
    await expect(app.listModels(archivedActor)).resolves.toEqual([
      { provider: "fake", id: "model", label: "fake/model" },
    ]);

    await expect(app.stop(actor, project.id)).resolves.toBeUndefined();
    expect(adapter.stopSession).toHaveBeenCalledWith(project.id);
    const deletedProject = await app.deleteProject(archivedActor, { confirm: project.slug });
    expect(deletedProject.id).toBe(project.id);
    expect(deletedProject.archivedAt).not.toBeNull();
    expect(database.projects.findById(project.id)).toBeUndefined();
    expect(fs.existsSync(project.path)).toBe(false);

    database.close();
  });
});

async function createArchivedFixture(): Promise<{
  app: HarnessHubApplication;
  actor: { guildId: string; userId: string };
  project: Project;
  adapter: HarnessAdapter;
  database: Database;
  updateProjectStatus: ReturnType<
    typeof vi.fn<(project: Project, status: ProjectWorkStatus) => Promise<void>>
  >;
  resourceId: string;
}> {
  const root = temporaryRoot();
  const workspaceRootPath = path.join(root, "workspaces");
  fs.mkdirSync(workspaceRootPath, { recursive: true });
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
    projectChannelMatches: vi.fn(async () => true),
  };
  const adapter: HarnessAdapter = {
    getCapabilities: () => new Set(),
    detect: vi.fn(async () => ({ installed: true, version: "test" })),
    install: vi.fn(async () => undefined),
    getAuthStatus: vi.fn(async () => ({ authenticated: true, providers: ["test"] })),
    startSession: vi.fn(async () => ({
      externalSessionId: "session",
      isBusy: false,
      model: { provider: "fake", id: "model" },
      sendPrompt: vi.fn(async () => "answer"),
      stop: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    })),
    getSession: vi.fn(() => undefined),
    stopSession: vi.fn(async () => undefined),
    restartSession: vi.fn(async () => undefined),
    installPackageResource: vi.fn(async () => undefined),
    removePackageResource: vi.fn(async () => undefined),
    listModels: vi.fn(async () => [{ provider: "fake", id: "model", label: "fake/model" }]),
    setSessionModel: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  };
  const database = Database.open(config.databasePath);
  const updateProjectStatus = vi.fn<(project: Project, status: ProjectWorkStatus) => Promise<void>>(() =>
    Promise.resolve(),
  );
  const app = new HarnessHubApplication(
    config,
    database,
    discord,
    await ProjectFiles.create(workspaceRoot),
    adapter,
    { update: updateProjectStatus },
  );
  const actor = { guildId: config.discordGuildId, userId: config.discordAdminUserId };

  await app.setup(actor);
  const createdProject = await app.createProject(
    { ...actor, channelId: "management" },
    { name: "Archive Me" },
  );
  const resource = await app.installResource(
    { ...actor, channelId: createdProject.channelId },
    { scope: "project", source: "npm:before-archive" },
  );
  await app.setProjectModel({ ...actor, channelId: createdProject.channelId }, { model: "fake/model" });
  const archivedProject = await app.archiveProject(
    { ...actor, channelId: createdProject.channelId },
    { confirm: createdProject.slug },
  );
  vi.clearAllMocks();

  return {
    app,
    actor,
    project: archivedProject,
    adapter,
    database,
    updateProjectStatus,
    resourceId: resource.id,
  };
}
