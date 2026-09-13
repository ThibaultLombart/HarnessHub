import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  HarnessHub,
  UnauthorizedError,
  type HarnessHubRepositories,
} from "../src/application/harness-hub.js";
import type { HarnessAdapter, HarnessSession } from "../src/domain/harness.js";
import type { Project } from "../src/domain/project.js";

const project: Project = {
  id: "project",
  workspaceId: "workspace",
  name: "Demo",
  slug: "demo",
  channelId: "channel",
  path: path.resolve("demo"),
  harnessId: "pi",
  gitRemote: null,
  createdAt: new Date().toISOString(),
  archivedAt: null,
};

function subject(busy = false) {
  const session: HarnessSession = {
    externalSessionId: "session",
    isBusy: busy,
    sendPrompt: vi.fn(async () => "answer"),
    stop: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
  const adapter: HarnessAdapter = {
    getCapabilities: vi.fn(() => new Set<"install">(["install"])),
    detect: vi.fn(async () => ({ installed: true, version: "1.0.0" })),
    install: vi.fn(async () => undefined),
    getAuthStatus: vi.fn(async () => ({ authenticated: true, providers: ["fake"] })),
    startSession: vi.fn(async () => session),
    getSession: vi.fn(() => undefined),
    stopSession: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  };
  const repositories: HarnessHubRepositories = {
    projects: { findByChannelId: vi.fn(() => project), findById: vi.fn(() => project) },
    modelPreferences: { findByProject: vi.fn(() => undefined) },
    sessions: { findLatestByProject: vi.fn(() => undefined), recordStarted: vi.fn(), updateStatus: vi.fn() },
  };
  return {
    hub: new HarnessHub({ guildId: "guild", administratorId: "admin" }, repositories, adapter),
    adapter,
    session,
    repositories,
  };
}

describe("HarnessHub application authorization and prompting", () => {
  it("rejects users and guilds outside the configured boundary", async () => {
    const { hub, adapter } = subject();
    await expect(
      hub.prompt({ guildId: "guild", userId: "other", channelId: "channel", content: "work" }, vi.fn()),
    ).rejects.toThrow(UnauthorizedError);
    await expect(hub.detectHarness({ guildId: "other", userId: "admin" })).rejects.toThrow(UnauthorizedError);
    expect(adapter.startSession).not.toHaveBeenCalled();
  });

  it("routes a project-channel prompt to a session in that exact project", async () => {
    const { hub, adapter, session, repositories } = subject();
    const onEvent = vi.fn();

    await expect(
      hub.prompt({ guildId: "guild", userId: "admin", channelId: "channel", content: "work" }, onEvent),
    ).resolves.toBe("answer");

    expect(adapter.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project", cwd: project.path, onEvent }),
    );
    expect(session.sendPrompt).toHaveBeenCalledWith("work");
    expect(repositories.sessions.recordStarted).toHaveBeenCalledWith("project", "pi", "session");
  });

  it("rejects a concurrent prompt before mutating persisted session state", async () => {
    const { hub, adapter, session, repositories } = subject(true);

    await expect(
      hub.prompt({ guildId: "guild", userId: "admin", channelId: "channel", content: "work" }, vi.fn()),
    ).rejects.toThrow(/active prompt/i);

    expect(session.sendPrompt).not.toHaveBeenCalled();
    expect(repositories.sessions.recordStarted).not.toHaveBeenCalled();
    expect(adapter.startSession).toHaveBeenCalledOnce();
  });

  it("records a failed prompt without exposing adapter concerns to the caller", async () => {
    const { hub, session, repositories } = subject();
    vi.mocked(session.sendPrompt).mockRejectedValue(new Error("provider failed"));

    await expect(
      hub.prompt({ guildId: "guild", userId: "admin", channelId: "channel", content: "work" }, vi.fn()),
    ).rejects.toThrow("provider failed");
    expect(repositories.sessions.updateStatus).toHaveBeenLastCalledWith("project", "failed");
  });

  it("detects, checks authentication, and stops only after authorization", async () => {
    const { hub, adapter, repositories } = subject();
    const actor = { guildId: "guild", userId: "admin" };

    await expect(hub.detectHarness(actor)).resolves.toMatchObject({ installed: true });
    await expect(hub.getAuthStatus(actor, project.path)).resolves.toMatchObject({ authenticated: true });
    await hub.stop(actor, project.id);

    expect(adapter.stopSession).toHaveBeenCalledWith(project.id);
    expect(repositories.sessions.updateStatus).toHaveBeenCalledWith(project.id, "stopped");
  });

  it("ignores unmapped channels explicitly", async () => {
    const { hub, repositories } = subject();
    vi.mocked(repositories.projects.findByChannelId).mockReturnValue(undefined);
    await expect(
      hub.prompt({ guildId: "guild", userId: "admin", channelId: "other", content: "work" }, vi.fn()),
    ).rejects.toThrow(/not mapped/i);
  });
});
