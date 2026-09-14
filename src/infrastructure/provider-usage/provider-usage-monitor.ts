import type { Logger } from "pino";
import type { GuildWorkspace } from "../../domain/workspace.js";
import type { ProviderUsage, UsageWindow } from "./codex-usage.js";

export type ProviderUsageSource = {
  getUsage(): Promise<ProviderUsage>;
};

export type ProviderUsageDiscordPort = {
  updateProviderUsageIndicator(
    workspace: GuildWorkspace,
    provider: string,
    channelName: string,
  ): Promise<void>;
};

export class ProviderUsageMonitor {
  private timer: NodeJS.Timeout | undefined;
  private refreshPromise: Promise<void> | undefined;

  public constructor(
    private readonly workspaceStore: { findByGuildId(guildId: string): GuildWorkspace | undefined },
    private readonly guildId: string,
    private readonly source: ProviderUsageSource,
    private readonly discord: ProviderUsageDiscordPort,
    private readonly logger: Logger,
    private readonly intervalMs = 15 * 60_000,
  ) {}

  public start(): void {
    if (this.timer !== undefined) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.intervalMs);
    this.timer.unref();
  }

  public stop(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  public async refresh(): Promise<void> {
    if (this.refreshPromise !== undefined) return this.refreshPromise;
    this.refreshPromise = this.performRefresh();
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = undefined;
    }
  }

  private async performRefresh(): Promise<void> {
    let workspace: GuildWorkspace | undefined;
    try {
      workspace = this.workspaceStore.findByGuildId(this.guildId);
      if (workspace === undefined) return;
      const usage = await this.source.getUsage();
      await this.discord.updateProviderUsageIndicator(
        workspace,
        usage.provider,
        providerUsageChannelName(usage),
      );
    } catch (error) {
      this.logger.warn({ error }, "Could not refresh provider usage indicator");
      if (workspace === undefined) return;
      try {
        await this.discord.updateProviderUsageIndicator(workspace, "codex", "codex-usage-unknown");
      } catch (discordError) {
        this.logger.warn({ error: discordError }, "Could not mark provider usage indicator unknown");
      }
    }
  }
}

export function providerUsageChannelName(usage: ProviderUsage): string {
  if (usage.windows.length === 0) return `${usage.provider}-usage-unknown`;
  const windows = usage.windows.map((window) => `${windowLabel(window)}-${String(window.usedPercent)}pct`);
  return `${usage.provider}-${windows.join("-")}`.slice(0, 100);
}

function windowLabel(window: UsageWindow): string {
  if (window.windowSeconds === 7 * 24 * 60 * 60) return "week";
  if (window.windowSeconds % (60 * 60) === 0) return `${String(window.windowSeconds / 3600)}h`;
  if (window.windowSeconds % 60 === 0) return `${String(window.windowSeconds / 60)}m`;
  return `${String(window.windowSeconds)}s`;
}
