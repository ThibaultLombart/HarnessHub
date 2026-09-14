import { ChannelType, Client, Collection } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import type { Project } from "../src/domain/project.js";
import type { GuildWorkspace } from "../src/domain/workspace.js";
import { ProjectStatusIndicators, projectStatusFromSession } from "../src/application/project-status.js";
import {
  DiscordResourceGateway,
  projectChannelName,
} from "../src/infrastructure/discord/discord-resources.js";

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
  workspaceId: "workspace",
  name: "Demo",
  slug: "demo",
  channelId: "channel",
  path: "/srv/workspaces/demo",
  harnessId: "pi",
  gitRemote: null,
  createdAt: new Date().toISOString(),
  archivedAt: null,
};

describe("project status indicators", () => {
  it("maps channel names and persisted session states", () => {
    expect(projectChannelName("demo", "idle")).toBe("demo-🟢");
    expect(projectChannelName("demo", "working")).toBe("demo-🟡");
    expect(projectChannelName("demo", "blocked")).toBe("demo-🔴");
    expect(projectStatusFromSession(undefined)).toBe("idle");
    expect(projectStatusFromSession("idle")).toBe("idle");
    expect(projectStatusFromSession("working")).toBe("working");
    expect(projectStatusFromSession("stopped")).toBe("blocked");
    expect(projectStatusFromSession("failed")).toBe("blocked");
  });

  it("creates green channels and accepts status suffixes in integrity checks", async () => {
    const create = vi.fn(async () => ({ id: "created" }));
    const projectChannel = {
      type: ChannelType.GuildText,
      name: "demo-🟡",
      parentId: "category",
      permissionsLocked: true,
    };
    const client = {
      guilds: {
        fetch: vi.fn(async () => ({
          channels: { fetch: vi.fn(async () => new Collection()), create },
        })),
      },
      channels: { fetch: vi.fn(async () => projectChannel) },
    } as unknown as Client;
    const gateway = new DiscordResourceGateway(client, "admin");

    await gateway.createProjectChannel(workspace, "demo");
    await expect(gateway.projectChannelMatches("channel", "demo", "category")).resolves.toBe(true);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: "demo-🟢" }));
  });

  it("does not let a Discord rename failure block project work", async () => {
    const warn = vi.fn();
    const indicators = new ProjectStatusIndicators(
      { updateProjectChannelStatus: vi.fn(async () => Promise.reject(new Error("Discord unavailable"))) },
      { warn },
    );

    await expect(indicators.update(project, "working")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project", status: "working" }),
      "Could not update project status indicator",
    );
  });
});
