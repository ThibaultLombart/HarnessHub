import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Config } from "../config.js";
import type { HarnessAdapter, HarnessEvent } from "../domain/harness.js";
import type { Project } from "../domain/project.js";
import type { HarnessResource, ResourceScope } from "../domain/resource.js";
import type { GuildWorkspace } from "../domain/workspace.js";
import { CreateProject } from "./create-project.js";
import { HarnessHub, UnmappedChannelError, type Actor } from "./harness-hub.js";
import { ManageResources, type ResourceHarnessPort } from "./manage-resources.js";
import { SetupWorkspace } from "./setup-workspace.js";
import type { Database } from "../infrastructure/database.js";
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

  public constructor(
    private readonly config: Config,
    private readonly database: Database,
    discord: DiscordResources,
    files: ProjectFiles,
    adapter: HarnessAdapter,
  ) {
    this.harness = new HarnessHub(
      { guildId: config.discordGuildId, administratorId: config.discordAdminUserId },
      { projects: database.projects, sessions: database.sessions },
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
    return this.runJob("install-resource", async () =>
      this.manageResources.install({
        scope: input.scope,
        project,
        workspaceRoot: this.config.workspaceRoot,
        source: input.source,
      }),
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
    return this.runJob("remove-resource", async () =>
      this.manageResources.remove({
        id: input.id,
        scope: input.scope,
        project,
        workspaceRoot: this.config.workspaceRoot,
      }),
    );
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
    return [
      `HarnessHub / ${project.name}`,
      `State: ${state}`,
      `Harness: ${project.harnessId ?? "not selected"}`,
      `Session: ${session?.status ?? "not started"}`,
      `Git: ${git}`,
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

  private async runJob<T>(type: string, operation: () => Promise<T>): Promise<T> {
    const job = this.database.jobs.create({ type });
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
  return "Operation failed; inspect the redacted service logs";
}
