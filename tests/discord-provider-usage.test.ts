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
  it("creates one identified read-only channel and renames it in place", async () => {
    const channels = new Collection<string, unknown>();
    const overwrites = new Collection<string, { deny: { has(permission: bigint): boolean } }>();
    const editPermissions = vi.fn(async (id: string) => {
      overwrites.set(id, { deny: { has: () => true } });
    });
    const indicator = {
      id: "indicator",
      type: ChannelType.GuildText,
      name: "codex-usage-unknown",
      parentId: "category",
      topic: "HarnessHub provider usage:codex",
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

    await gateway.updateProviderUsageIndicator(workspace, "codex", "codex-usage-unknown");
    await gateway.updateProviderUsageIndicator(workspace, "codex", "codex-5h-18pct-week-42pct");

    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "codex-usage-unknown",
        parent: "category",
        topic: "HarnessHub provider usage:codex",
      }),
    );
    expect(editPermissions).toHaveBeenCalledOnce();
    expect(indicator.setName).toHaveBeenCalledWith(
      "codex-5h-18pct-week-42pct",
      "Refresh HarnessHub provider usage indicator",
    );
    expect(overwrites.get("admin")?.deny.has(PermissionFlagsBits.SendMessages)).toBe(true);
  });
});
