import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Database } from "../src/infrastructure/database.js";
import type { Project } from "../src/domain/project.js";
import type { GuildWorkspace } from "../src/domain/workspace.js";

const temporaryDirectories: string[] = [];

function temporaryDatabasePath(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "harnesshub-db-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "state.sqlite");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("Database", () => {
  it("migrates idempotently and persists jobs across restart", () => {
    const databasePath = temporaryDatabasePath();
    const first = Database.open(databasePath);
    const job = first.jobs.create({ type: "bootstrap", metadata: { safe: true } });
    first.jobs.transition(job.id, "running");
    first.close();

    const second = Database.open(databasePath);
    expect(second.schemaVersion).toBeGreaterThan(0);
    expect(second.jobs.findById(job.id)).toMatchObject({ status: "running", type: "bootstrap" });
    second.close();
  });

  it("persists global and project resources independently", () => {
    const database = Database.open(temporaryDatabasePath());
    const workspace: GuildWorkspace = {
      id: "workspace",
      discordGuildId: "guild",
      categoryId: "category",
      managementChannelId: "management",
      workspaceRoot: "/srv/workspaces",
      createdAt: new Date().toISOString(),
    };
    const project: Project = {
      id: "project",
      workspaceId: workspace.id,
      name: "Demo",
      slug: "demo",
      channelId: "channel",
      path: "/srv/workspaces/demo",
      harnessId: "pi",
      gitRemote: null,
      createdAt: new Date().toISOString(),
      archivedAt: null,
    };
    database.workspaces.save(workspace);
    database.projects.save(project);

    const global = database.resources.saveInstalled({
      harnessId: "pi",
      type: "package",
      scope: "global",
      projectId: null,
      source: "npm:demo",
    });
    const local = database.resources.saveInstalled({
      harnessId: "pi",
      type: "package",
      scope: "project",
      projectId: project.id,
      source: "npm:demo",
    });

    expect(global.id).not.toBe(local.id);
    expect(database.resources.list({ harnessId: "pi", scope: "global" })).toHaveLength(1);
    expect(
      database.resources.list({ harnessId: "pi", scope: "project", projectId: project.id }),
    ).toHaveLength(1);
    expect(database.resources.markRemoved(local.id).status).toBe("removed");
    database.close();
  });

  it("deletes a project and its dependent state", () => {
    const database = Database.open(temporaryDatabasePath());
    const workspace: GuildWorkspace = {
      id: "workspace",
      discordGuildId: "guild",
      categoryId: "category",
      managementChannelId: "management",
      workspaceRoot: "/srv/workspaces",
      createdAt: new Date().toISOString(),
    };
    const project: Project = {
      id: "project",
      workspaceId: workspace.id,
      name: "Demo",
      slug: "demo",
      channelId: "channel-delete",
      path: "/srv/workspaces/demo-delete",
      harnessId: "pi",
      gitRemote: null,
      createdAt: new Date().toISOString(),
      archivedAt: null,
    };
    database.workspaces.save(workspace);
    database.projects.save(project);
    database.sessions.recordStarted(project.id, "pi", "session");
    database.modelPreferences.save({ projectId: project.id, provider: "fake", modelId: "model" });
    database.resources.saveInstalled({
      harnessId: "pi",
      type: "package",
      scope: "project",
      projectId: project.id,
      source: "npm:demo",
    });

    database.projects.delete(project.id);

    expect(database.projects.findById(project.id)).toBeUndefined();
    expect(database.modelPreferences.findByProject(project.id)).toBeUndefined();
    expect(database.resources.list({ harnessId: "pi", scope: "project", projectId: project.id })).toEqual([]);
    database.close();
  });

  it("persists and clears per-project model preferences", () => {
    const database = Database.open(temporaryDatabasePath());
    const workspace: GuildWorkspace = {
      id: "workspace",
      discordGuildId: "guild",
      categoryId: "category",
      managementChannelId: "management",
      workspaceRoot: "/srv/workspaces",
      createdAt: new Date().toISOString(),
    };
    const project: Project = {
      id: "project",
      workspaceId: workspace.id,
      name: "Demo",
      slug: "demo",
      channelId: "channel",
      path: "/srv/workspaces/demo",
      harnessId: "pi",
      gitRemote: null,
      createdAt: new Date().toISOString(),
      archivedAt: null,
    };
    database.workspaces.save(workspace);
    database.projects.save(project);

    database.modelPreferences.save({ projectId: project.id, provider: "fake", modelId: "model" });
    expect(database.modelPreferences.findByProject(project.id)).toMatchObject({
      provider: "fake",
      modelId: "model",
    });
    database.modelPreferences.remove(project.id);
    expect(database.modelPreferences.findByProject(project.id)).toBeUndefined();
    database.close();
  });

  it("reconciles interrupted jobs without touching terminal jobs", () => {
    const database = Database.open(temporaryDatabasePath());
    const running = database.jobs.create({ type: "clone" });
    const done = database.jobs.create({ type: "setup" });
    database.jobs.transition(running.id, "running");
    database.jobs.transition(done.id, "running");
    database.jobs.transition(done.id, "succeeded");

    expect(database.reconcileInterruptedWork()).toBe(1);
    expect(database.jobs.findById(running.id)?.status).toBe("failed");
    expect(database.jobs.findById(done.id)?.status).toBe("succeeded");
    database.close();
  });
});
