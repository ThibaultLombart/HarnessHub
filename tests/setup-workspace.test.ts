import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  SetupWorkspace,
  WorkspaceDegradedError,
  type WorkspaceDiscordPort,
  type WorkspaceStore,
} from "../src/application/setup-workspace.js";
import type { GuildWorkspace } from "../src/domain/workspace.js";

const root = path.resolve("workspace-root");

function stores(existing?: GuildWorkspace): { store: WorkspaceStore; save: ReturnType<typeof vi.fn> } {
  const save = vi.fn<(workspace: GuildWorkspace) => void>();
  return { store: { findByGuildId: vi.fn(() => existing), save }, save };
}

describe("SetupWorkspace", () => {
  it("creates and persists the Discord workspace on first setup", async () => {
    const { store, save } = stores();
    const discord: WorkspaceDiscordPort = {
      ensureWorkspace: vi.fn(async () => ({ categoryId: "category", managementChannelId: "management" })),
      workspaceExists: vi.fn(async () => true),
    };

    const workspace = await new SetupWorkspace(store, discord).execute({
      guildId: "guild",
      workspaceRoot: root,
    });

    expect(workspace).toMatchObject({ discordGuildId: "guild", categoryId: "category" });
    expect(save).toHaveBeenCalledOnce();
  });

  it("reuses a valid persisted mapping without creating Discord resources", async () => {
    const existing: GuildWorkspace = {
      id: "workspace",
      discordGuildId: "guild",
      categoryId: "category",
      managementChannelId: "management",
      workspaceRoot: root,
      createdAt: new Date().toISOString(),
    };
    const { store } = stores(existing);
    const discord: WorkspaceDiscordPort = {
      ensureWorkspace: vi.fn(),
      workspaceExists: vi.fn(async () => true),
    };

    expect(await new SetupWorkspace(store, discord).execute({ guildId: "guild", workspaceRoot: root })).toBe(
      existing,
    );
    expect(discord.ensureWorkspace).not.toHaveBeenCalled();
  });

  it("reports degraded state instead of silently recreating missing mapped resources", async () => {
    const existing: GuildWorkspace = {
      id: "workspace",
      discordGuildId: "guild",
      categoryId: "missing",
      managementChannelId: "management",
      workspaceRoot: root,
      createdAt: new Date().toISOString(),
    };
    const { store } = stores(existing);
    const discord: WorkspaceDiscordPort = {
      ensureWorkspace: vi.fn(),
      workspaceExists: vi.fn(async () => false),
    };

    await expect(
      new SetupWorkspace(store, discord).execute({ guildId: "guild", workspaceRoot: root }),
    ).rejects.toThrow(WorkspaceDegradedError);
    expect(discord.ensureWorkspace).not.toHaveBeenCalled();
  });
});
