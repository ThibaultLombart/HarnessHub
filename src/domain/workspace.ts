export type GuildWorkspace = Readonly<{
  id: string;
  discordGuildId: string;
  categoryId: string;
  managementChannelId: string;
  workspaceRoot: string;
  createdAt: string;
}>;
