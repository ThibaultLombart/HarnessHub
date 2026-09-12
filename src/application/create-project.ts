import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseRepositoryUrl, projectSlug, type Project } from "../domain/project.js";
import type { GuildWorkspace } from "../domain/workspace.js";

export type ProjectStore = {
  findBySlug(workspaceId: string, slug: string): Project | undefined;
  save(project: Project): void;
};

export type ProjectFilesPort = {
  createEmptyGitProject(destination: string): Promise<void>;
  cloneProject(repositoryUrl: string, destination: string): Promise<void>;
  removeProject(destination: string): Promise<void>;
};

export type ProjectDiscordPort = {
  createProjectChannel(workspace: GuildWorkspace, slug: string): Promise<string>;
  deleteProjectChannel(channelId: string): Promise<void>;
};

export class ProjectAlreadyExistsError extends Error {
  public constructor() {
    super("A project with this name already exists");
    this.name = "ProjectAlreadyExistsError";
  }
}

export class CreateProject {
  public constructor(
    private readonly store: ProjectStore,
    private readonly files: ProjectFilesPort,
    private readonly discord: ProjectDiscordPort,
  ) {}

  public async execute(input: {
    workspace: GuildWorkspace;
    name: string;
    repositoryUrl?: string;
  }): Promise<Project> {
    const slug = projectSlug(input.name);
    if (this.store.findBySlug(input.workspace.id, slug) !== undefined) throw new ProjectAlreadyExistsError();
    const repositoryUrl =
      input.repositoryUrl === undefined ? undefined : parseRepositoryUrl(input.repositoryUrl);
    const destination = path.join(input.workspace.workspaceRoot, slug);

    if (repositoryUrl === undefined) await this.files.createEmptyGitProject(destination);
    else await this.files.cloneProject(repositoryUrl, destination);

    let channelId: string | undefined;
    try {
      channelId = await this.discord.createProjectChannel(input.workspace, slug);
      const project: Project = {
        id: randomUUID(),
        workspaceId: input.workspace.id,
        name: input.name.trim(),
        slug,
        channelId,
        path: destination,
        harnessId: "pi",
        gitRemote: repositoryUrl ?? null,
        createdAt: new Date().toISOString(),
        archivedAt: null,
      };
      this.store.save(project);
      return project;
    } catch (error) {
      if (channelId !== undefined) {
        try {
          await this.discord.deleteProjectChannel(channelId);
        } catch {
          // Preserve the primary error; reconciliation can detect an orphaned channel.
        }
      }
      try {
        await this.files.removeProject(destination);
      } catch {
        // Preserve the primary error; the failed job records the need for operator cleanup.
      }
      throw error;
    }
  }
}
