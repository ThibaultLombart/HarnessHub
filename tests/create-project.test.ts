import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  CreateProject,
  type ProjectDiscordPort,
  type ProjectFilesPort,
  type ProjectStore,
} from "../src/application/create-project.js";
import type { GuildWorkspace } from "../src/domain/workspace.js";

const workspace: GuildWorkspace = {
  id: "workspace",
  discordGuildId: "guild",
  categoryId: "category",
  managementChannelId: "management",
  workspaceRoot: path.resolve("workspaces"),
  createdAt: new Date().toISOString(),
};

function dependencies() {
  const store: ProjectStore = {
    findBySlug: vi.fn(() => undefined),
    save: vi.fn(),
  };
  const files: ProjectFilesPort = {
    createEmptyGitProject: vi.fn(async () => undefined),
    cloneProject: vi.fn(async () => undefined),
    removeProject: vi.fn(async () => undefined),
  };
  const discord: ProjectDiscordPort = {
    createProjectChannel: vi.fn(async () => "channel"),
    deleteProjectChannel: vi.fn(async () => undefined),
  };
  return { store, files, discord };
}

describe("CreateProject", () => {
  it("creates an empty Git project, channel, and persisted mapping", async () => {
    const { store, files, discord } = dependencies();

    const project = await new CreateProject(store, files, discord).execute({
      workspace,
      name: "Demo Project",
    });

    expect(files.createEmptyGitProject).toHaveBeenCalledWith(
      path.join(workspace.workspaceRoot, "demo-project"),
    );
    expect(discord.createProjectChannel).toHaveBeenCalledWith(workspace, "demo-project");
    expect(store.save).toHaveBeenCalledWith(project);
    expect(project.gitRemote).toBeNull();
  });

  it("clones a supported repository instead of initializing an empty one", async () => {
    const { store, files, discord } = dependencies();
    const repositoryUrl = "https://github.com/example/repo.git";

    await new CreateProject(store, files, discord).execute({ workspace, name: "Repo", repositoryUrl });

    expect(files.cloneProject).toHaveBeenCalledWith(
      repositoryUrl,
      path.join(workspace.workspaceRoot, "repo"),
    );
    expect(files.createEmptyGitProject).not.toHaveBeenCalled();
  });

  it("rolls back the directory and channel when persistence fails", async () => {
    const { store, files, discord } = dependencies();
    vi.mocked(store.save).mockImplementation(() => {
      throw new Error("database unavailable");
    });

    await expect(
      new CreateProject(store, files, discord).execute({ workspace, name: "Demo" }),
    ).rejects.toThrow("database unavailable");

    expect(files.removeProject).toHaveBeenCalledWith(path.join(workspace.workspaceRoot, "demo"));
    expect(discord.deleteProjectChannel).toHaveBeenCalledWith("channel");
  });

  it("does not touch external systems when the slug already exists", async () => {
    const { store, files, discord } = dependencies();
    vi.mocked(store.findBySlug).mockReturnValue({} as never);

    await expect(
      new CreateProject(store, files, discord).execute({ workspace, name: "Demo" }),
    ).rejects.toThrow(/already exists/i);
    expect(files.createEmptyGitProject).not.toHaveBeenCalled();
    expect(discord.createProjectChannel).not.toHaveBeenCalled();
  });
});
