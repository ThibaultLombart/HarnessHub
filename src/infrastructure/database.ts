import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync as SqliteDatabase } from "node:sqlite";
import { jobStatuses, transitionJob, type JobStatus } from "../domain/job.js";
import type { ModelPreference } from "../domain/model.js";
import type { Project } from "../domain/project.js";
import {
  resourceScopes,
  resourceStatuses,
  resourceTypes,
  type HarnessResource,
  type ResourceScope,
  type ResourceStatus,
  type ResourceType,
} from "../domain/resource.js";
import type { GuildWorkspace } from "../domain/workspace.js";

const migrations = [
  `
  CREATE TABLE guild_workspaces (
    id TEXT PRIMARY KEY,
    discord_guild_id TEXT NOT NULL UNIQUE,
    category_id TEXT NOT NULL,
    management_channel_id TEXT NOT NULL,
    workspace_root TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES guild_workspaces(id),
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    channel_id TEXT NOT NULL UNIQUE,
    path TEXT NOT NULL UNIQUE,
    harness_id TEXT,
    git_remote TEXT,
    created_at TEXT NOT NULL,
    archived_at TEXT,
    UNIQUE(workspace_id, slug)
  );
  CREATE TABLE harness_installations (
    id TEXT PRIMARY KEY,
    harness_id TEXT NOT NULL UNIQUE,
    version TEXT,
    status TEXT NOT NULL,
    last_checked_at TEXT NOT NULL
  );
  CREATE TABLE harness_sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    harness_id TEXT NOT NULL,
    external_session_id TEXT,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    last_activity_at TEXT NOT NULL
  );
  CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id),
    type TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled')),
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    safe_error TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX jobs_status_idx ON jobs(status);
  CREATE INDEX sessions_project_idx ON harness_sessions(project_id);
  `,
  `
  CREATE TABLE harness_resources (
    id TEXT PRIMARY KEY,
    harness_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('package')),
    scope TEXT NOT NULL CHECK(scope IN ('global','project')),
    project_id TEXT REFERENCES projects(id),
    source TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('installed','removed','failed')),
    safe_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK((scope = 'global' AND project_id IS NULL) OR (scope = 'project' AND project_id IS NOT NULL))
  );
  CREATE UNIQUE INDEX harness_resources_global_unique_idx
    ON harness_resources(harness_id, source) WHERE scope = 'global';
  CREATE UNIQUE INDEX harness_resources_project_unique_idx
    ON harness_resources(harness_id, project_id, source) WHERE scope = 'project';
  CREATE INDEX harness_resources_scope_idx ON harness_resources(harness_id, scope, project_id, status);
  `,
  `
  CREATE TABLE project_model_preferences (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    model_id TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  `,
] as const;

type JobRow = {
  id: string;
  project_id: string | null;
  type: string;
  status: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  safe_error: string | null;
  metadata_json: string;
};

export type Job = Readonly<{
  id: string;
  projectId: string | null;
  type: string;
  status: JobStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  safeError: string | null;
  metadata: Readonly<Record<string, unknown>>;
}>;

export class JobRepository {
  public constructor(private readonly database: SqliteDatabase) {}

  public create(input: {
    type: string;
    projectId?: string;
    metadata?: Readonly<Record<string, unknown>>;
  }): Job {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO jobs (id, project_id, type, status, created_at, metadata_json)
         VALUES (?, ?, ?, 'queued', ?, ?)`,
      )
      .run(id, input.projectId ?? null, input.type, now, JSON.stringify(input.metadata ?? {}));
    return this.requireById(id);
  }

  public findById(id: string): Job | undefined {
    const row = this.database.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | undefined;
    return row === undefined ? undefined : mapJob(row);
  }

  public listRecent(limit = 10): Job[] {
    const safeLimit = Math.max(1, Math.min(25, Math.floor(limit)));
    return (
      this.database
        .prepare("SELECT * FROM jobs ORDER BY created_at DESC, rowid DESC LIMIT ?")
        .all(safeLimit) as JobRow[]
    ).map(mapJob);
  }

  public transition(id: string, target: JobStatus, safeError?: string): Job {
    const current = this.requireById(id);
    transitionJob(current.status, target);
    const now = new Date().toISOString();
    const startedAt = target === "running" ? now : current.startedAt;
    const finishedAt = ["succeeded", "failed", "cancelled"].includes(target) ? now : null;
    this.database
      .prepare(`UPDATE jobs SET status = ?, started_at = ?, finished_at = ?, safe_error = ? WHERE id = ?`)
      .run(target, startedAt, finishedAt, safeError ?? null, id);
    return this.requireById(id);
  }

  private requireById(id: string): Job {
    const job = this.findById(id);
    if (job === undefined) throw new Error(`Job not found: ${id}`);
    return job;
  }
}

export class WorkspaceRepository {
  public constructor(private readonly database: SqliteDatabase) {}

  public findByGuildId(guildId: string): GuildWorkspace | undefined {
    const row = this.database
      .prepare("SELECT * FROM guild_workspaces WHERE discord_guild_id = ?")
      .get(guildId) as Record<string, unknown> | undefined;
    return row === undefined ? undefined : mapWorkspace(row);
  }

  public findById(id: string): GuildWorkspace | undefined {
    const row = this.database.prepare("SELECT * FROM guild_workspaces WHERE id = ?").get(id) as
      Record<string, unknown> | undefined;
    return row === undefined ? undefined : mapWorkspace(row);
  }

  public save(workspace: GuildWorkspace): void {
    this.database
      .prepare(
        `INSERT INTO guild_workspaces
         (id, discord_guild_id, category_id, management_channel_id, workspace_root, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        workspace.id,
        workspace.discordGuildId,
        workspace.categoryId,
        workspace.managementChannelId,
        workspace.workspaceRoot,
        workspace.createdAt,
      );
  }
}

export class ProjectRepository {
  public constructor(private readonly database: SqliteDatabase) {}

  public findBySlug(workspaceId: string, slug: string): Project | undefined {
    const row = this.database
      .prepare("SELECT * FROM projects WHERE workspace_id = ? AND slug = ? AND archived_at IS NULL")
      .get(workspaceId, slug) as Record<string, unknown> | undefined;
    return row === undefined ? undefined : mapProject(row);
  }

  public findByChannelId(channelId: string): Project | undefined {
    const row = this.database.prepare("SELECT * FROM projects WHERE channel_id = ?").get(channelId) as
      Record<string, unknown> | undefined;
    return row === undefined ? undefined : mapProject(row);
  }

  public findById(id: string): Project | undefined {
    const row = this.database.prepare("SELECT * FROM projects WHERE id = ?").get(id) as
      Record<string, unknown> | undefined;
    return row === undefined ? undefined : mapProject(row);
  }

  public save(project: Project): void {
    this.database
      .prepare(
        `INSERT INTO projects
         (id, workspace_id, name, slug, channel_id, path, harness_id, git_remote, created_at, archived_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        project.id,
        project.workspaceId,
        project.name,
        project.slug,
        project.channelId,
        project.path,
        project.harnessId,
        project.gitRemote,
        project.createdAt,
        project.archivedAt,
      );
  }

  public archive(id: string): Project {
    const now = new Date().toISOString();
    this.database
      .prepare("UPDATE projects SET archived_at = ? WHERE id = ? AND archived_at IS NULL")
      .run(now, id);
    const project = this.findById(id);
    if (project === undefined) throw new Error(`Project not found: ${id}`);
    return project;
  }

  public delete(id: string): void {
    this.database.prepare("DELETE FROM project_model_preferences WHERE project_id = ?").run(id);
    this.database.prepare("DELETE FROM harness_resources WHERE project_id = ?").run(id);
    this.database.prepare("DELETE FROM harness_sessions WHERE project_id = ?").run(id);
    this.database.prepare("DELETE FROM jobs WHERE project_id = ?").run(id);
    this.database.prepare("DELETE FROM projects WHERE id = ?").run(id);
  }
}

export class HarnessInstallationRepository {
  public constructor(private readonly database: SqliteDatabase) {}

  public record(harnessId: string, installed: boolean, version: string | null): void {
    const status = installed ? "installed" : "missing";
    this.database
      .prepare(
        `INSERT INTO harness_installations (id, harness_id, version, status, last_checked_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(harness_id) DO UPDATE SET
           version = excluded.version,
           status = excluded.status,
           last_checked_at = excluded.last_checked_at`,
      )
      .run(randomUUID(), harnessId, version, status, new Date().toISOString());
  }
}

type ResourceRow = {
  id: string;
  harness_id: string;
  type: string;
  scope: string;
  project_id: string | null;
  source: string;
  status: string;
  safe_error: string | null;
  created_at: string;
  updated_at: string;
};

type ModelPreferenceRow = {
  project_id: string;
  provider: string;
  model_id: string;
  updated_at: string;
};

export class ModelPreferenceRepository {
  public constructor(private readonly database: SqliteDatabase) {}

  public findByProject(projectId: string): ModelPreference | undefined {
    const row = this.database
      .prepare("SELECT * FROM project_model_preferences WHERE project_id = ?")
      .get(projectId) as ModelPreferenceRow | undefined;
    return row === undefined ? undefined : mapModelPreference(row);
  }

  public save(input: { projectId: string; provider: string; modelId: string }): ModelPreference {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO project_model_preferences (project_id, provider, model_id, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET
           provider = excluded.provider,
           model_id = excluded.model_id,
           updated_at = excluded.updated_at`,
      )
      .run(input.projectId, input.provider, input.modelId, now);
    const preference = this.findByProject(input.projectId);
    if (preference === undefined) throw new Error("Model preference was not persisted");
    return preference;
  }

  public remove(projectId: string): void {
    this.database.prepare("DELETE FROM project_model_preferences WHERE project_id = ?").run(projectId);
  }
}

export class ResourceRepository {
  public constructor(private readonly database: SqliteDatabase) {}

  public saveInstalled(input: {
    harnessId: string;
    type: ResourceType;
    scope: ResourceScope;
    projectId: string | null;
    source: string;
  }): HarnessResource {
    const existing = this.findByIdentity(input.harnessId, input.scope, input.projectId, input.source);
    const now = new Date().toISOString();
    if (existing !== undefined) {
      this.database
        .prepare(
          `UPDATE harness_resources
           SET type = ?, status = 'installed', safe_error = NULL, updated_at = ?
           WHERE id = ?`,
        )
        .run(input.type, now, existing.id);
      return this.requireById(existing.id);
    }
    this.database
      .prepare(
        `INSERT INTO harness_resources
         (id, harness_id, type, scope, project_id, source, status, safe_error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'installed', NULL, ?, ?)`,
      )
      .run(randomUUID(), input.harnessId, input.type, input.scope, input.projectId, input.source, now, now);
    return this.requireByIdentity(input.harnessId, input.scope, input.projectId, input.source);
  }

  public markFailed(input: {
    harnessId: string;
    type: ResourceType;
    scope: ResourceScope;
    projectId: string | null;
    source: string;
    safeError: string;
  }): HarnessResource {
    const existing = this.findByIdentity(input.harnessId, input.scope, input.projectId, input.source);
    const now = new Date().toISOString();
    if (existing !== undefined) {
      this.database
        .prepare(
          `UPDATE harness_resources
           SET type = ?, status = 'failed', safe_error = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(input.type, input.safeError, now, existing.id);
      return this.requireById(existing.id);
    }
    this.database
      .prepare(
        `INSERT INTO harness_resources
         (id, harness_id, type, scope, project_id, source, status, safe_error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'failed', ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        input.harnessId,
        input.type,
        input.scope,
        input.projectId,
        input.source,
        input.safeError,
        now,
        now,
      );
    return this.requireByIdentity(input.harnessId, input.scope, input.projectId, input.source);
  }

  public list(input: {
    harnessId: string;
    scope?: ResourceScope;
    projectId?: string | null;
  }): HarnessResource[] {
    if (input.scope !== undefined && input.projectId !== undefined) {
      return (
        this.database
          .prepare(
            `SELECT * FROM harness_resources
           WHERE harness_id = ? AND scope = ? AND project_id IS ?
           ORDER BY scope, source`,
          )
          .all(input.harnessId, input.scope, input.projectId) as ResourceRow[]
      ).map(mapResource);
    }
    if (input.scope !== undefined) {
      return (
        this.database
          .prepare(
            `SELECT * FROM harness_resources
           WHERE harness_id = ? AND scope = ?
           ORDER BY scope, source`,
          )
          .all(input.harnessId, input.scope) as ResourceRow[]
      ).map(mapResource);
    }
    return (
      this.database
        .prepare(
          `SELECT * FROM harness_resources
         WHERE harness_id = ?
         ORDER BY scope, source`,
        )
        .all(input.harnessId) as ResourceRow[]
    ).map(mapResource);
  }

  public findById(id: string): HarnessResource | undefined {
    const row = this.database.prepare("SELECT * FROM harness_resources WHERE id = ?").get(id) as
      ResourceRow | undefined;
    return row === undefined ? undefined : mapResource(row);
  }

  public findByIdentity(
    harnessId: string,
    scope: ResourceScope,
    projectId: string | null,
    source: string,
  ): HarnessResource | undefined {
    const row = this.database
      .prepare(
        `SELECT * FROM harness_resources
         WHERE harness_id = ? AND scope = ? AND project_id IS ? AND source = ?`,
      )
      .get(harnessId, scope, projectId, source) as ResourceRow | undefined;
    return row === undefined ? undefined : mapResource(row);
  }

  public markRemoved(id: string): HarnessResource {
    const now = new Date().toISOString();
    this.database
      .prepare(
        "UPDATE harness_resources SET status = 'removed', safe_error = NULL, updated_at = ? WHERE id = ?",
      )
      .run(now, id);
    return this.requireById(id);
  }

  private requireById(id: string): HarnessResource {
    const resource = this.findById(id);
    if (resource === undefined) throw new Error(`Resource not found: ${id}`);
    return resource;
  }

  private requireByIdentity(
    harnessId: string,
    scope: ResourceScope,
    projectId: string | null,
    source: string,
  ): HarnessResource {
    const resource = this.findByIdentity(harnessId, scope, projectId, source);
    if (resource === undefined) throw new Error("Resource was not persisted");
    return resource;
  }
}

export class SessionRepository {
  public constructor(private readonly database: SqliteDatabase) {}

  public findLatestByProject(
    projectId: string,
  ): { externalSessionId: string | null; status: string } | undefined {
    const row = this.database
      .prepare(
        `SELECT external_session_id, status FROM harness_sessions
         WHERE project_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1`,
      )
      .get(projectId) as { external_session_id: string | null; status: string } | undefined;
    return row === undefined ? undefined : { externalSessionId: row.external_session_id, status: row.status };
  }

  public recordStarted(projectId: string, harnessId: string, externalSessionId: string): void {
    const latest = this.findLatestByProject(projectId);
    const now = new Date().toISOString();
    if (latest?.externalSessionId === externalSessionId) {
      this.database
        .prepare(
          `UPDATE harness_sessions SET status = 'idle', last_activity_at = ?
           WHERE rowid = (SELECT rowid FROM harness_sessions WHERE project_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1)`,
        )
        .run(now, projectId);
      return;
    }
    this.database
      .prepare(
        `INSERT INTO harness_sessions
         (id, project_id, harness_id, external_session_id, status, started_at, last_activity_at)
         VALUES (?, ?, ?, ?, 'idle', ?, ?)`,
      )
      .run(randomUUID(), projectId, harnessId, externalSessionId, now, now);
  }

  public updateStatus(projectId: string, status: string): void {
    this.database
      .prepare(
        `UPDATE harness_sessions SET status = ?, last_activity_at = ?
         WHERE rowid = (SELECT rowid FROM harness_sessions WHERE project_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1)`,
      )
      .run(status, new Date().toISOString(), projectId);
  }
}

export class Database {
  public readonly jobs: JobRepository;
  public readonly workspaces: WorkspaceRepository;
  public readonly projects: ProjectRepository;
  public readonly sessions: SessionRepository;
  public readonly installations: HarnessInstallationRepository;
  public readonly resources: ResourceRepository;
  public readonly modelPreferences: ModelPreferenceRepository;

  private constructor(private readonly sqlite: SqliteDatabase) {
    this.jobs = new JobRepository(sqlite);
    this.workspaces = new WorkspaceRepository(sqlite);
    this.projects = new ProjectRepository(sqlite);
    this.sessions = new SessionRepository(sqlite);
    this.installations = new HarnessInstallationRepository(sqlite);
    this.resources = new ResourceRepository(sqlite);
    this.modelPreferences = new ModelPreferenceRepository(sqlite);
  }

  public static open(databasePath: string): Database {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
    const sqlite = new SqliteDatabase(databasePath);
    try {
      sqlite.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
      migrate(sqlite);
      return new Database(sqlite);
    } catch (error) {
      sqlite.close();
      throw error;
    }
  }

  public get schemaVersion(): number {
    return schemaVersion(this.sqlite);
  }

  public transaction<T>(operation: () => T): T {
    return runTransaction(this.sqlite, operation);
  }

  public reconcileInterruptedWork(): number {
    const now = new Date().toISOString();
    const jobs = Number(
      this.sqlite
        .prepare(
          `UPDATE jobs SET status = 'failed', finished_at = ?, safe_error = ? WHERE status = 'running'`,
        )
        .run(now, "HarnessHub restarted while this job was running").changes,
    );
    this.sqlite
      .prepare(
        `UPDATE harness_sessions SET status = 'stopped', last_activity_at = ? WHERE status IN ('starting','working','stopping')`,
      )
      .run(now);
    return jobs;
  }

  public raw(): SqliteDatabase {
    return this.sqlite;
  }

  public close(): void {
    this.sqlite.close();
  }
}

function migrate(database: SqliteDatabase): void {
  const currentVersion = schemaVersion(database);
  if (currentVersion > migrations.length) {
    throw new Error(
      `Database schema version ${String(currentVersion)} is newer than supported ${String(migrations.length)}`,
    );
  }

  for (let index = currentVersion; index < migrations.length; index += 1) {
    const sql = migrations[index];
    if (sql === undefined) throw new Error(`Missing migration ${String(index + 1)}`);
    runTransaction(database, () => {
      database.exec(sql);
      database.exec(`PRAGMA user_version = ${String(index + 1)}`);
    });
  }
}

function schemaVersion(database: SqliteDatabase): number {
  const row = database.prepare("PRAGMA user_version").get() as Record<string, unknown> | undefined;
  const version = row?.user_version;
  if (typeof version !== "number" && typeof version !== "bigint") {
    throw new Error("Could not read the database schema version");
  }
  return Number(version);
}

function runTransaction<T>(database: SqliteDatabase, operation: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Preserve the transaction's primary failure.
    }
    throw error;
  }
}

function mapWorkspace(row: Record<string, unknown>): GuildWorkspace {
  return {
    id: requiredDatabaseString(row.id),
    discordGuildId: requiredDatabaseString(row.discord_guild_id),
    categoryId: requiredDatabaseString(row.category_id),
    managementChannelId: requiredDatabaseString(row.management_channel_id),
    workspaceRoot: requiredDatabaseString(row.workspace_root),
    createdAt: requiredDatabaseString(row.created_at),
  };
}

function mapProject(row: Record<string, unknown>): Project {
  return {
    id: requiredDatabaseString(row.id),
    workspaceId: requiredDatabaseString(row.workspace_id),
    name: requiredDatabaseString(row.name),
    slug: requiredDatabaseString(row.slug),
    channelId: requiredDatabaseString(row.channel_id),
    path: requiredDatabaseString(row.path),
    harnessId: nullableDatabaseString(row.harness_id),
    gitRemote: nullableDatabaseString(row.git_remote),
    createdAt: requiredDatabaseString(row.created_at),
    archivedAt: nullableDatabaseString(row.archived_at),
  };
}

function requiredDatabaseString(value: unknown): string {
  if (typeof value !== "string") throw new Error("Database contains an invalid string value");
  return value;
}

function nullableDatabaseString(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("Database contains an invalid string value");
  return value;
}

function mapModelPreference(row: ModelPreferenceRow): ModelPreference {
  return {
    projectId: row.project_id,
    provider: row.provider,
    modelId: row.model_id,
    updatedAt: row.updated_at,
  };
}

function mapResource(row: ResourceRow): HarnessResource {
  if (!resourceTypes.includes(row.type as ResourceType))
    throw new Error("Database contains invalid resource type");
  if (!resourceScopes.includes(row.scope as ResourceScope))
    throw new Error("Database contains invalid resource scope");
  if (!resourceStatuses.includes(row.status as ResourceStatus)) {
    throw new Error("Database contains invalid resource status");
  }
  return {
    id: row.id,
    harnessId: row.harness_id,
    type: row.type as ResourceType,
    scope: row.scope as ResourceScope,
    projectId: row.project_id,
    source: row.source,
    status: row.status as ResourceStatus,
    safeError: row.safe_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapJob(row: JobRow): Job {
  if (!jobStatuses.includes(row.status as JobStatus))
    throw new Error("Database contains an invalid job status");
  const metadata: unknown = JSON.parse(row.metadata_json);
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("Database contains invalid job metadata");
  }
  return {
    id: row.id,
    projectId: row.project_id,
    type: row.type,
    status: row.status as JobStatus,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    safeError: row.safe_error,
    metadata: metadata as Record<string, unknown>,
  };
}
