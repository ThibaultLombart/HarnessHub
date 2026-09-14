import { ChannelType, Client, Collection, PermissionFlagsBits } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import type { GuildWorkspace } from "../src/domain/workspace.js";
import { DiscordResourceGateway } from "../src/infrastructure/discord/discord-resources.js";

const workspace: GuildWorkspace = {
  id: "workspace",
  discordGuildId: "guild",
  categoryId: "category",
  managementChannelId: "management",
  workspaceRoot: "/srv/workspaces",
  createdAt: new Date().toISOString(),
};

describe("Discord provider usage indicator", () => {
  it("creates one locked voice counter, renames it in place, and removes the legacy text indicator", async () => {
    const channels = new Collection<string, unknown>();
    const deleteLegacy = vi.fn(async () => undefined);
    channels.set("legacy", {
      id: "legacy",
      type: ChannelType.GuildText,
      name: "codex-5h-89pct-week-85pct",
      parentId: "category",
      topic: "HarnessHub provider usage:codex",
      delete: deleteLegacy,
    });
    const overwrites = new Collection<string, { deny: { has(permission: bigint): boolean } }>();
    const editPermissions = vi.fn(async (id: string) => {
      overwrites.set(id, { deny: { has: () => true } });
    });
    const indicator = {
      id: "indicator",
      type: ChannelType.GuildVoice,
      name: "Codex : usage unavailable",
      parentId: "category",
      permissionOverwrites: { cache: overwrites, edit: editPermissions },
      setName: vi.fn(async (name: string) => {
        indicator.name = name;
      }),
    };
    const create = vi.fn(async () => {
      channels.set(indicator.id, indicator);
      return indicator;
    });
    const guild = { channels: { fetch: vi.fn(async () => channels), create } };
    const client = { guilds: { fetch: vi.fn(async () => guild) } } as unknown as Client;
    const gateway = new DiscordResourceGateway(client, "admin");

    await gateway.updateProviderUsageIndicator(workspace, "codex", "Codex : usage unavailable");
    channels.delete("legacy");
    await gateway.updateProviderUsageIndicator(
      workspace,
      "codex",
      "Codex : 11% free (5h) - 15% free (weekly)",
    );

    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Codex : usage unavailable",
        type: ChannelType.GuildVoice,
        parent: "category",
      }),
    );
    expect(editPermissions).toHaveBeenCalledOnce();
    expect(indicator.setName).toHaveBeenCalledWith(
      "Codex : 11% free (5h) - 15% free (weekly)",
      "Refresh HarnessHub provider usage indicator",
    );
    expect(overwrites.get("admin")?.deny.has(PermissionFlagsBits.Connect)).toBe(true);
    expect(deleteLegacy).toHaveBeenCalledOnce();
  });
});
