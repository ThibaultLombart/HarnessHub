import {
  ChannelType,
  Client,
  PermissionFlagsBits,
  OverwriteType,
  type CategoryChannel,
  type Guild,
  type TextChannel,
} from "discord.js";
import type { DiscordResources } from "../../application/application.js";
import type { GuildWorkspace } from "../../domain/workspace.js";

const categoryName = "HARNESSHUB";
const managementName = "workspace-management";

export class DiscordResourceGateway implements DiscordResources {
  public constructor(
    private readonly client: Client,
    private readonly administratorId: string,
  ) {}

  public async ensureWorkspace(
    guildId: string,
  ): Promise<{ categoryId: string; managementChannelId: string }> {
    const guild = await this.client.guilds.fetch(guildId);
    const channels = await guild.channels.fetch();
    let category = channels.find(
      (channel): channel is CategoryChannel =>
        channel?.type === ChannelType.GuildCategory && channel.name === categoryName,
    );
    category ??= await guild.channels.create({
      name: categoryName,
      type: ChannelType.GuildCategory,
      permissionOverwrites: this.permissions(guild),
      reason: "HarnessHub workspace setup",
    });
    await category.permissionOverwrites.set(this.permissions(guild), "Enforce HarnessHub workspace boundary");

    let management = channels.find(
      (channel): channel is TextChannel =>
        channel?.type === ChannelType.GuildText &&
        channel.name === managementName &&
        channel.parentId === category.id,
    );
    management ??= await guild.channels.create({
      name: managementName,
      type: ChannelType.GuildText,
      parent: category,
      reason: "HarnessHub workspace setup",
    });
    if (management.permissionsLocked !== true) await management.lockPermissions();
    return { categoryId: category.id, managementChannelId: management.id };
  }

  public async workspaceExists(workspace: GuildWorkspace): Promise<boolean> {
    try {
      const guild = await this.client.guilds.fetch(workspace.discordGuildId);
      const [category, management] = await Promise.all([
        guild.channels.fetch(workspace.categoryId),
        guild.channels.fetch(workspace.managementChannelId),
      ]);
      return (
        category?.type === ChannelType.GuildCategory &&
        category.name === categoryName &&
        management?.type === ChannelType.GuildText &&
        management.name === managementName &&
        management.parentId === category.id &&
        management.permissionsLocked === true &&
        this.hasPrivateBoundary(category, guild)
      );
    } catch {
      return false;
    }
  }

  public async createProjectChannel(workspace: GuildWorkspace, slug: string): Promise<string> {
    const guild = await this.client.guilds.fetch(workspace.discordGuildId);
    const channels = await guild.channels.fetch();
    const collision = channels.some(
      (channel) =>
        channel?.type === ChannelType.GuildText &&
        channel.parentId === workspace.categoryId &&
        channel.name === slug,
    );
    if (collision) throw new Error("A Discord project channel with this name already exists");
    const channel = await guild.channels.create({
      name: slug,
      type: ChannelType.GuildText,
      parent: workspace.categoryId,
      reason: "HarnessHub project creation",
    });
    return channel.id;
  }

  public async deleteProjectChannel(channelId: string): Promise<void> {
    const channel = await this.client.channels.fetch(channelId);
    if (channel !== null && "delete" in channel)
      await channel.delete("Rollback failed HarnessHub project creation");
  }

  public async projectChannelMatches(
    channelId: string,
    expectedSlug: string,
    categoryId: string,
  ): Promise<boolean> {
    try {
      const channel = await this.client.channels.fetch(channelId);
      return (
        channel?.type === ChannelType.GuildText &&
        channel.name === expectedSlug &&
        channel.parentId === categoryId &&
        channel.permissionsLocked === true
      );
    } catch {
      return false;
    }
  }

  private hasPrivateBoundary(category: CategoryChannel, guild: Guild): boolean {
    const everyone = category.permissionOverwrites.cache.get(guild.roles.everyone.id);
    const administrator = category.permissionOverwrites.cache.get(this.administratorId);
    const bot =
      this.client.user === null ? undefined : category.permissionOverwrites.cache.get(this.client.user.id);
    return (
      everyone?.deny.has(PermissionFlagsBits.ViewChannel) === true &&
      administrator?.allow.has(PermissionFlagsBits.ViewChannel) === true &&
      bot?.allow.has(PermissionFlagsBits.ViewChannel) === true
    );
  }

  private permissions(guild: Guild): readonly {
    id: string;
    type: OverwriteType;
    allow?: readonly bigint[];
    deny?: readonly bigint[];
  }[] {
    const botId = this.client.user?.id;
    const entries: {
      id: string;
      type: OverwriteType;
      allow?: readonly bigint[];
      deny?: readonly bigint[];
    }[] = [
      { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: this.administratorId,
        type: OverwriteType.Member,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
    ];
    if (botId !== undefined) {
      entries.push({
        id: botId,
        type: OverwriteType.Member,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageChannels,
        ],
      });
    }
    return entries;
  }
}
