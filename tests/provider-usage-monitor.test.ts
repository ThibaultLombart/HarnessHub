import { describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";
import type { GuildWorkspace } from "../src/domain/workspace.js";
import {
  ProviderUsageMonitor,
  providerUsageChannelName,
} from "../src/infrastructure/provider-usage/provider-usage-monitor.js";

const workspace: GuildWorkspace = {
  id: "workspace",
  discordGuildId: "guild",
  categoryId: "category",
  managementChannelId: "management",
  workspaceRoot: "/srv/workspaces",
  createdAt: new Date().toISOString(),
};

describe("ProviderUsageMonitor", () => {
  it("formats Codex short and weekly usage windows", () => {
    expect(
      providerUsageChannelName({
        provider: "codex",
        windows: [
          { usedPercent: 18, windowSeconds: 18_000, resetAt: null },
          { usedPercent: 42, windowSeconds: 604_800, resetAt: null },
        ],
      }),
    ).toBe("Codex : 82% free (5h) - 58% free (weekly)");
  });

  it("updates the Discord indicator and coalesces concurrent refreshes", async () => {
    let release: (() => void) | undefined;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const getUsage = vi.fn(async () => {
      await wait;
      return {
        provider: "codex" as const,
        windows: [{ usedPercent: 20, windowSeconds: 18_000, resetAt: null }],
      };
    });
    const updateProviderUsageIndicator = vi.fn(async () => undefined);
    const monitor = new ProviderUsageMonitor(
      { findByGuildId: () => workspace },
      "guild",
      { getUsage },
      { updateProviderUsageIndicator },
      { warn: vi.fn() } as unknown as Logger,
    );

    const first = monitor.refresh();
    const second = monitor.refresh();
    release?.();
    await Promise.all([first, second]);

    expect(getUsage).toHaveBeenCalledOnce();
    expect(updateProviderUsageIndicator).toHaveBeenCalledWith(workspace, "codex", "Codex : 80% free (5h)");
  });

  it("marks usage unknown without throwing when the provider request fails", async () => {
    const updateProviderUsageIndicator = vi.fn(async () => undefined);
    const monitor = new ProviderUsageMonitor(
      { findByGuildId: () => workspace },
      "guild",
      { getUsage: vi.fn(async () => Promise.reject(new Error("provider unavailable"))) },
      { updateProviderUsageIndicator },
      { warn: vi.fn() } as unknown as Logger,
    );

    await expect(monitor.refresh()).resolves.toBeUndefined();
    expect(updateProviderUsageIndicator).toHaveBeenCalledWith(
      workspace,
      "codex",
      "Codex : usage unavailable",
    );
  });
});
