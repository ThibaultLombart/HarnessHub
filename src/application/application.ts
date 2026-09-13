import fs from "node:fs/promises";
import path from "node:path";
import packageJson from "../../package.json" with { type: "json" };
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Config } from "../config.js";
import type { HarnessAdapter, HarnessEvent } from "../domain/harness.js";
import {
  modelPattern,
  parseModelPattern,
  type ModelDescriptor,
  type ModelPreference,
} from "../domain/model.js";
import type { Project } from "../domain/project.js";
import type { HarnessResource, ResourceScope } from "../domain/resource.js";
import type { GuildWorkspace } from "../domain/workspace.js";
import { CreateProject } from "./create-project.js";
import { GitOperations, type GitProjectStatus } from "./git-operations.js";
import { HarnessHub, UnmappedChannelError, type Actor } from "./harness-hub.js";
import { ManageResources, type ResourceHarnessPort } from "./manage-resources.js";
import { SetupWorkspace } from "./setup-workspace.js";
import { checkHealth } from "../health.js";
import type { Database, Job } from "../infrastructure/database.js";
import type { ProjectFiles } from "../infrastructure/project-files.js";

const executeFile = promisify(execFile);

export type DiscordResources = {
  ensureWorkspace(guildId: string): Promise<{ categoryId: string; managementChannelId: string }>;
  workspaceExists(workspace: GuildWorkspace): Promise<boolean>;
  createProjectChannel(workspace: GuildWorkspace, slug: string): Promise<string>;
  deleteProjectChannel(channelId: string): Promise<void>;
  projectChannelMatches(channelId: string, expectedSlug: string, categoryId: string): Promise<boolean>;
};

export class ProjectDegradedError extends Error {
  public constructor() {
    super("The project directory mapping is degraded; explicit repair is required");
    this.name = "ProjectDegradedError";
  }
}

export class ProjectDeletionBlockedError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ProjectDeletionBlockedError";
  }
}

const maximumUploadBytes = 5 * 1024 * 1024;

export class ModelManagementUnsupportedError extends Error {
  public constructor() {
    super("The configured harness does not support model management");
    this.name = "ModelManagementUnsupportedError";
  }
}

export class ManagementChannelRequiredError extends Error {
  public constructor() {
    super("This command must be used in #workspace-management");
    this.name = "ManagementChannelRequiredError";
  }
}

export class HarnessHubApplication {
  private readonly harness: HarnessHub;
  private readonly setupWorkspace: SetupWorkspace;
  private readonly createProjectUseCase: CreateProject;
  private readonly manageResources: ManageResources;
  private readonly git = new GitOperations();

  public constructor(
    private readonly config: Config,
    private readonly database: Database,
    discord: DiscordResources,
    private readonly files: ProjectFiles,
    private readonly adapter: HarnessAdapter,
  ) {
    this.harness = new HarnessHub(
      { guildId: config.discordGuildId, administratorId: config.discordAdminUserId },
      {
        projects: database.projects,
        modelPreferences: database.modelPreferences,
        sessions: database.sessions,
      },
      adapter,
    );
    this.setupWorkspace = new SetupWorkspace(database.workspaces, discord);
    this.createProjectUseCase = new CreateProject(database.projects, files, discord);
    this.manageResources = new ManageResources(database.resources, resourceHarnessPort(adapter));
    this.discord = discord;
  }

  private readonly discord: DiscordResources;

  public async setup(actor: Actor): Promise<GuildWorkspace> {
    this.harness.authorize(actor);
    return this.runJob("setup", async () =>
      this.setupWorkspace.execute({ guildId: actor.guildId, workspaceRoot: this.config.workspaceRoot }),
    );
  }

  public async createProject(
    actor: Actor & { channelId: string },
    input: { name: string; repositoryUrl?: string },
  ): Promise<Project> {
    this.harness.authorize(actor);
    const workspace = this.requireWorkspace(actor.guildId);
    if (actor.channelId !== workspace.managementChannelId) throw new ManagementChannelRequiredError();
    return this.runJob("create-project", async () =>
      this.createProjectUseCase.execute({ workspace, ...input }),
    );
  }

  public async archiveProject(
    actor: Actor & { channelId: string },
    input: { confirm: string },
  ): Promise<Project> {
    const project = this.projectForChannel(actor);
    if (input.confirm !== project.slug)
      throw new ProjectDeletionBlockedError("Type the project slug to confirm archival");
    await this.harness.stop(actor, project.id);
    return this.runJob("archive-project", () => this.database.projects.archive(project.id), project.id);
  }

  public async deleteProject(
    actor: Actor & { channelId: string },
    input: { confirm: string },
  ): Promise<Project> {
    const project = this.projectForChannel(actor);
    if (input.confirm !== project.slug)
      throw new ProjectDeletionBlockedError("Type the project slug to confirm deletion");
    const latest = this.database.sessions.findLatestByProject(project.id);
    if (latest !== undefined && ["starting", "working", "stopping"].includes(latest.status)) {
      throw new ProjectDeletionBlockedError("Stop the active session before deleting this project");
    }
    if (await isGitDirty(project.path)) {
      throw new ProjectDeletionBlockedError("Refusing to delete a project with uncommitted Git changes");
    }
    await this.harness.stop(actor, project.id);
    return this.runJob(
      "delete-project",
      async () => {
        const deleted = this.database.projects.archive(project.id);
        await this.discord.deleteProjectChannel(project.channelId);
        await this.files.removeProject(project.path);
        this.database.projects.delete(project.id);
        return deleted;
      },
      project.id,
    );
  }

  public async systemStatus(actor: Actor & { channelId: string }): Promise<string> {
    this.requireManagementChannel(actor);
    const health = await checkHealth(this.database, this.config.workspaceRoot);
    return [
      "HarnessHub system status",
      `Version: ${packageJson.version}`,
      `Health: ${health.status}`,
      `Database schema: ${String(this.database.schemaVersion)}`,
      `Workspace root: ${this.config.workspaceRoot}`,
      "Permissions: single configured administrator; project-user roles are not enabled yet.",
      "Updates: run git pull + sudo ./scripts/install.sh --no-pi-login from a trusted checkout.",
    ].join("\n");
  }

  public mcpStatus(actor: Actor & { channelId: string }): string {
    this.harness.authorize(actor);
    return [
      "MCP status",
      "Pi: no native MCP capability detected in the pinned Pi documentation.",
      "Use /resource add to install Pi packages or extensions that provide equivalent integrations.",
      "Future harnesses can expose native MCP as a declared capability without changing project state semantics.",
    ].join("\n");
  }

  public backupStatus(actor: Actor & { channelId: string }): string {
    this.requireManagementChannel(actor);
    return [
      "HarnessHub backup status",
      `Database: ${this.config.databasePath}`,
      `State directory: ${path.dirname(this.config.databasePath)}`,
      `Workspace root: ${this.config.workspaceRoot}`,
      "Recommended procedure:",
      "1. sudo systemctl stop harnesshub",
      "2. back up the state directory and workspace root together",
      "3. sudo systemctl start harnesshub",
      "Restore must replace both state and workspaces from the same backup point.",
    ].join("\n");
  }

  public async repairStatus(actor: Actor & { channelId: string }): Promise<string> {
    this.harness.authorize(actor);
    const workspace = this.requireWorkspace(actor.guildId);
    if (actor.channelId === workspace.managementChannelId) {
      return [
        "HarnessHub repair status",
        `Workspace: ${(await this.discord.workspaceExists(workspace)) ? "ok" : "degraded"}`,
        `Workspace root: ${(await isDirectory(this.config.workspaceRoot)) ? "ok" : "missing"}`,
      ].join("\n");
    }
    const project = this.projectForChannel(actor);
    const directory = await isSafeProjectDirectory(project.path, this.config.workspaceRoot);
    const channel = await this.discord.projectChannelMatches(
      project.channelId,
      project.slug,
      workspace.categoryId,
    );
    const workspaceValid = await this.discord.workspaceExists(workspace);
    return [
      `HarnessHub repair status / ${project.slug}`,
      `Workspace: ${workspaceValid ? "ok" : "degraded"}`,
      `Project directory: ${directory ? "ok" : "missing or unsafe"}`,
      `Discord channel: ${channel ? "ok" : "missing or remapped"}`,
      directory && channel && workspaceValid
        ? "No repair needed."
        : "Explicit operator repair is required; HarnessHub will not recreate or remap automatically.",
    ].join("\n");
  }

  public async uploadProjectFile(
    actor: Actor & { channelId: string },
    input: { relativePath: string; content: Uint8Array },
  ): Promise<string> {
    const project = this.projectForChannel(actor);
    if (!(await this.projectResourcesMatch(project))) throw new ProjectDegradedError();
    return this.runJob(
      "upload-file",
      () =>
        this.files.writeProjectFile({
          projectPath: project.path,
          relativePath: input.relativePath,
          content: input.content,
          maximumBytes: maximumUploadBytes,
        }),
      project.id,
    );
  }

  public async gitStatus(actor: Actor & { channelId: string }): Promise<GitProjectStatus> {
    const project = this.projectForChannel(actor);
    if (!(await this.projectResourcesMatch(project))) throw new ProjectDegradedError();
    return this.git.status(project);
  }

  public async linkGitRemote(actor: Actor & { channelId: string }, repositoryUrl: string): Promise<string> {
    const project = this.projectForChannel(actor);
    if (!(await this.projectResourcesMatch(project))) throw new ProjectDegradedError();
    return this.runJob("link-git-remote", () => this.git.linkRemote(project, repositoryUrl), project.id);
  }

  public listJobs(actor: Actor & { channelId: string }, limit = 10): Job[] {
    this.requireManagementChannel(actor);
    return this.database.jobs.listRecent(limit);
  }

  public jobStatus(actor: Actor & { channelId: string }, id: string): Job {
    this.requireManagementChannel(actor);
    const job = this.database.jobs.findById(id);
    if (job === undefined) throw new Error("Job not found");
    return job;
  }

  public async installResource(
    actor: Actor & { channelId: string },
    input: { scope: ResourceScope; source: string },
  ): Promise<HarnessResource> {
    this.harness.authorize(actor);
    const workspace = this.requireWorkspace(actor.guildId);
    const project = input.scope === "project" ? this.projectForChannel(actor) : null;
    if (input.scope === "global" && actor.channelId !== workspace.managementChannelId) {
      throw new ManagementChannelRequiredError();
    }
    if (project !== null && !(await this.projectResourcesMatch(project))) throw new ProjectDegradedError();
    return this.runJob(
      "install-resource",
      async () =>
        this.manageResources.install({
          scope: input.scope,
          project,
          workspaceRoot: this.config.workspaceRoot,
          source: input.source,
        }),
      project?.id,
    );
  }

  public listResources(actor: Actor & { channelId: string }, scope?: ResourceScope): HarnessResource[] {
    this.harness.authorize(actor);
    const workspace = this.requireWorkspace(actor.guildId);
    if (actor.channelId === workspace.managementChannelId) {
      return scope === undefined ? this.manageResources.list({}) : this.manageResources.list({ scope });
    }
    if (scope === "global") return this.manageResources.list({ scope: "global" });
    const project = this.projectForChannel(actor);
    return scope === undefined
      ? this.manageResources.list({ project })
      : this.manageResources.list({ scope, project });
  }

  public async removeResource(
    actor: Actor & { channelId: string },
    input: { id: string; scope: ResourceScope },
  ): Promise<HarnessResource> {
    this.harness.authorize(actor);
    const workspace = this.requireWorkspace(actor.guildId);
    const project = input.scope === "project" ? this.projectForChannel(actor) : null;
    if (input.scope === "global" && actor.channelId !== workspace.managementChannelId) {
      throw new ManagementChannelRequiredError();
    }
    if (project !== null && !(await this.projectResourcesMatch(project))) throw new ProjectDegradedError();
    return this.runJob(
      "remove-resource",
      async () =>
        this.manageResources.remove({
          id: input.id,
          scope: input.scope,
          project,
          workspaceRoot: this.config.workspaceRoot,
        }),
      project?.id,
    );
  }

  public async listModels(actor: Actor & { channelId: string }): Promise<readonly ModelDescriptor[]> {
    this.harness.authorize(actor);
    const workspace = this.requireWorkspace(actor.guildId);
    const project = this.database.projects.findByChannelId(actor.channelId);
    const cwd = project === undefined ? workspace.workspaceRoot : project.path;
    if (project !== undefined && !(await this.projectResourcesMatch(project)))
      throw new ProjectDegradedError();
    const listModels = this.adapterSupportsModels().listModels;
    if (listModels === undefined) throw new ModelManagementUnsupportedError();
    return listModels.bind(this.adapter)(cwd);
  }

  public modelStatus(actor: Actor & { channelId: string }): ModelPreference | null {
    const project = this.projectForChannel(actor);
    return this.database.modelPreferences.findByProject(project.id) ?? null;
  }

  public async setProjectModel(
    actor: Actor & { channelId: string },
    input: { model: string },
  ): Promise<ModelPreference> {
    const project = this.projectForChannel(actor);
    const parsed = parseModelPattern(input.model);
    if (!(await this.projectResourcesMatch(project))) throw new ProjectDegradedError();
    const adapter = this.adapterSupportsModels();
    if (adapter.listModels === undefined) throw new ModelManagementUnsupportedError();
    const models = await adapter.listModels(project.path);
    if (!models.some((model) => model.provider === parsed.provider && model.id === parsed.modelId)) {
      throw new Error("Selected model is not available to Pi");
    }
    const preference = this.database.modelPreferences.save({
      projectId: project.id,
      provider: parsed.provider,
      modelId: parsed.modelId,
    });
    if (adapter.setSessionModel !== undefined)
      await adapter.setSessionModel(project.id, parsed.provider, parsed.modelId);
    return preference;
  }

  public resetProjectModel(actor: Actor & { channelId: string }): void {
    const project = this.projectForChannel(actor);
    this.database.modelPreferences.remove(project.id);
  }

  public async projectStatus(actor: Actor & { channelId: string }): Promise<string> {
    this.harness.authorize(actor);
    const project = this.database.projects.findByChannelId(actor.channelId);
    if (project === undefined) throw new UnmappedChannelError();
    const directoryExists = await isSafeProjectDirectory(project.path, this.config.workspaceRoot);
    const workspace = this.database.workspaces.findById(project.workspaceId);
    const channelExists =
      workspace !== undefined &&
      (await this.discord.workspaceExists(workspace)) &&
      (await this.discord.projectChannelMatches(project.channelId, project.slug, workspace.categoryId));
    const git = directoryExists ? await gitStatus(project.path) : "unavailable";
    const session = this.database.sessions.findLatestByProject(project.id);
    const state = directoryExists && channelExists ? "ready" : "degraded — explicit repair required";
    const resources = this.manageResources
      .list({ project })
      .filter((resource) => resource.status !== "removed");
    const jobs = this.database.jobs.listRecentByProject(project.id, 3);
    return [
      `HarnessHub / ${project.name}`,
      `State: ${state}`,
      `Harness: ${project.harnessId ?? "not selected"}`,
      `Model: ${modelPreferenceText(this.database.modelPreferences.findByProject(project.id))}`,
      `Session: ${session?.status ?? "not started"}`,
      `Git: ${git}`,
      `Remote: ${project.gitRemote ?? "none"}`,
      `Resources: ${resources.length === 0 ? "none" : resources.map((resource) => `${resource.scope}:${resource.source} [${resource.status}]`).join(", ")}`,
      `Recent jobs: ${jobs.length === 0 ? "none" : jobs.map((job) => `${job.type} [${job.status}]`).join(", ")}`,
    ].join("\n");
  }

  public async detectHarness(
    actor: Actor & { channelId: string },
  ): Promise<{ installed: boolean; version: string | null }> {
    this.requireManagementChannel(actor);
    const detection = await this.harness.detectHarness(actor);
    this.database.installations.record("pi", detection.installed, detection.version);
    return detection;
  }

  public async installHarness(actor: Actor & { channelId: string }): Promise<void> {
    this.requireManagementChannel(actor);
    await this.runJob("install-pi", async () => {
      await this.harness.installHarness(actor);
      const detection = await this.harness.detectHarness(actor);
      this.database.installations.record("pi", detection.installed, detection.version);
      if (!detection.installed) throw new Error("Pi installation could not be verified");
    });
  }

  public async getAuthStatus(
    actor: Actor & { channelId: string },
  ): Promise<{ authenticated: boolean; providers: readonly string[] }> {
    this.requireManagementChannel(actor);
    return this.harness.getAuthStatus(actor, this.config.workspaceRoot);
  }

  public async prompt(
    actor: Actor & { channelId: string; content: string },
    onEvent: (event: HarnessEvent) => void,
  ): Promise<string> {
    const project = this.projectForChannel(actor);
    if (!(await this.projectResourcesMatch(project))) throw new ProjectDegradedError();
    const answer = await this.harness.prompt(actor, onEvent);
    if (!(await this.projectResourcesMatch(project))) throw new ProjectDegradedError();
    return answer;
  }

  public async stop(actor: Actor, projectId: string): Promise<void> {
    await this.harness.stop(actor, projectId);
  }

  public async resume(
    actor: Actor,
    projectId: string,
    onEvent: (event: HarnessEvent) => void,
  ): Promise<void> {
    this.harness.authorize(actor);
    const project = this.database.projects.findById(projectId);
    if (project === undefined) throw new Error("Project not found");
    if (!(await this.projectResourcesMatch(project))) throw new ProjectDegradedError();
    await this.harness.resume(actor, projectId, onEvent);
  }

  public projectForChannel(actor: Actor & { channelId: string }): Project {
    this.harness.authorize(actor);
    const project = this.database.projects.findByChannelId(actor.channelId);
    if (project === undefined) throw new UnmappedChannelError();
    return project;
  }

  private async projectResourcesMatch(project: Project): Promise<boolean> {
    const workspace = this.database.workspaces.findById(project.workspaceId);
    if (workspace === undefined) return false;
    const [directory, channel, workspaceValid] = await Promise.all([
      isSafeProjectDirectory(project.path, this.config.workspaceRoot),
      this.discord.projectChannelMatches(project.channelId, project.slug, workspace.categoryId),
      this.discord.workspaceExists(workspace),
    ]);
    return directory && channel && workspaceValid;
  }

  private adapterSupportsModels(): Pick<HarnessAdapter, "listModels" | "setSessionModel"> {
    return this.adapter;
  }

  private requireManagementChannel(actor: Actor & { channelId: string }): void {
    this.harness.authorize(actor);
    const workspace = this.requireWorkspace(actor.guildId);
    if (actor.channelId !== workspace.managementChannelId) throw new ManagementChannelRequiredError();
  }

  private requireWorkspace(guildId: string): GuildWorkspace {
    const workspace = this.database.workspaces.findByGuildId(guildId);
    if (workspace === undefined) throw new Error("Run /setup before creating a project");
    return workspace;
  }

  private async runJob<T>(type: string, operation: () => T | Promise<T>, projectId?: string): Promise<T> {
    const job = this.database.jobs.create({ type, ...(projectId === undefined ? {} : { projectId }) });
    this.database.jobs.transition(job.id, "running");
    try {
      const result = await operation();
      this.database.jobs.transition(job.id, "succeeded");
      return result;
    } catch (error) {
      this.database.jobs.transition(job.id, "failed", safeJobError(error));
      throw error;
    }
  }
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fs.lstat(target)).isDirectory();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function isSafeProjectDirectory(target: string, canonicalRoot: string): Promise<boolean> {
  try {
    const statistics = await fs.lstat(target);
    if (!statistics.isDirectory() || statistics.isSymbolicLink()) return false;
    const canonicalTarget = await fs.realpath(target);
    const relative = path.relative(canonicalRoot, canonicalTarget);
    return (
      relative !== "" &&
      !relative.startsWith("..") &&
      !path.isAbsolute(relative) &&
      path.dirname(canonicalTarget) === canonicalRoot
    );
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function isGitDirty(cwd: string): Promise<boolean> {
  try {
    const result = await executeFile("git", ["-C", cwd, "status", "--porcelain"], { timeout: 10_000 });
    return result.stdout !== "";
  } catch {
    return false;
  }
}

async function gitStatus(cwd: string): Promise<string> {
  try {
    const branch = (
      await executeFile("git", ["-C", cwd, "branch", "--show-current"], { timeout: 10_000 })
    ).stdout.trim();
    const changes = (await executeFile("git", ["-C", cwd, "status", "--porcelain"], { timeout: 10_000 }))
      .stdout;
    return `${branch || "detached"} / ${changes === "" ? "clean" : "dirty"}`;
  } catch {
    return "not a Git repository";
  }
}

function modelPreferenceText(preference: ModelPreference | undefined): string {
  return preference === undefined ? "Pi default" : modelPattern(preference);
}

function resourceHarnessPort(adapter: HarnessAdapter): ResourceHarnessPort {
  if (adapter.installPackageResource === undefined || adapter.removePackageResource === undefined) {
    throw new Error("The configured harness does not support package resource management");
  }
  return {
    installPackageResource: async (input) => adapter.installPackageResource?.(input),
    removePackageResource: async (input) => adapter.removePackageResource?.(input),
  };
}

function safeJobError(error: unknown): string {
  if (error instanceof ManagementChannelRequiredError || error instanceof UnmappedChannelError)
    return error.message;
  if (error instanceof Error && error.name === "InvalidResourceInputError") return error.message;
  if (error instanceof Error && error.name === "ProjectDeletionBlockedError") return error.message;
  if (
    error instanceof Error &&
    [
      "Uploaded file is too large",
      "Upload path is invalid",
      "Upload path must stay inside the project",
      "Upload path escapes the project through a symlink",
      "Upload destination already exists",
    ].includes(error.message)
  ) {
    return error.message;
  }
  return "Operation failed; inspect the redacted service logs";
}
