import { randomUUID } from "node:crypto";
import type { GuildWorkspace } from "../domain/workspace.js";

export type WorkspaceStore = {
  findByGuildId(guildId: string): GuildWorkspace | undefined;
  save(workspace: GuildWorkspace): void;
};

export type WorkspaceDiscordPort = {
  ensureWorkspace(guildId: string): Promise<{ categoryId: string; managementChannelId: string }>;
  workspaceExists(workspace: GuildWorkspace): Promise<boolean>;
};

export class WorkspaceDegradedError extends Error {
  public constructor() {
    super("The persisted Discord workspace mapping is degraded; explicit repair is required");
    this.name = "WorkspaceDegradedError";
  }
}

export class SetupWorkspace {
  public constructor(
    private readonly store: WorkspaceStore,
    private readonly discord: WorkspaceDiscordPort,
  ) {}

  public async execute(input: { guildId: string; workspaceRoot: string }): Promise<GuildWorkspace> {
    const existing = this.store.findByGuildId(input.guildId);
    if (existing !== undefined) {
      if (existing.workspaceRoot !== input.workspaceRoot || !(await this.discord.workspaceExists(existing))) {
        throw new WorkspaceDegradedError();
      }
      return existing;
    }

    const resources = await this.discord.ensureWorkspace(input.guildId);
    const workspace: GuildWorkspace = {
      id: randomUUID(),
      discordGuildId: input.guildId,
      categoryId: resources.categoryId,
      managementChannelId: resources.managementChannelId,
      workspaceRoot: input.workspaceRoot,
      createdAt: new Date().toISOString(),
    };
    this.store.save(workspace);
    return workspace;
  }
}
