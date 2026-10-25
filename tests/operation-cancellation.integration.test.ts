import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HarnessHubApplication, type DiscordResources } from "../src/application/application.js";
import type { Config } from "../src/config.js";
import { Database } from "../src/infrastructure/database.js";
import { PiAdapter } from "../src/infrastructure/pi/pi-adapter.js";
import { ProjectFiles } from "../src/infrastructure/project-files.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
  vi.restoreAllMocks();
});
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
async function subject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-cancel-"));
  const workspaceRoot = path.join(root, "workspace");
  fs.mkdirSync(workspaceRoot);
  const config: Config = {
    discordToken: "unused",
    discordGuildId: "guild",
    discordAdminUserId: "admin",
    workspaceRoot,
    databasePath: ":memory:",
    piCommand: "pi",
    piAgentDirectory: path.join(root, "agent"),
    maxConcurrentSessions: 2,
    updateCheckout: root,
    logLevel: "silent",
  };
  const database = Database.open(":memory:");
  const discord: DiscordResources = {
    ensureWorkspace: async () => ({ categoryId: "category", managementChannelId: "management" }),
    workspaceExists: vi.fn(async () => true),
    createProjectChannel: async () => "project-channel",
    updateProjectChannelStatus: async () => undefined,
    deleteProjectChannel: async () => undefined,
    projectChannelMatches: async () => true,
  };
  const adapter = new PiAdapter({
    command: process.execPath,
    commandArguments: [path.resolve("tests/fixtures/fake-pi.mjs")],
    sessionRoot: path.join(root, "sessions"),
    maxSessions: 2,
  });
  const start = vi.spyOn(adapter, "startSession");
  const statuses = { update: vi.fn<() => Promise<void>>(async () => undefined) };
  const app = new HarnessHubApplication(
    config,
    database,
    discord,
    await ProjectFiles.create(workspaceRoot),
    adapter,
    statuses,
  );
  const actor = { guildId: "guild", userId: "admin" };
  await app.setup(actor);
  const project = await app.createProject({ ...actor, channelId: "management" }, { name: "demo" });
  cleanup.push(async () => {
    await adapter.dispose();
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { app, adapter, actor, project, discord, statuses, start, database };
}

describe("application operation cancellation before Pi registration", () => {
  for (const phase of ["resources", "status"] as const) {
    it(`reserves before ${phase} preflight; stop prevents late spawn/prompt and concurrent resume`, async () => {
      const env = await subject();
      const blocked = gate();
      if (phase === "resources")
        vi.mocked(env.discord.workspaceExists).mockImplementationOnce(async () => {
          await blocked.promise;
          return true;
        });
      else env.statuses.update.mockImplementationOnce(async () => blocked.promise);
      const pending = env.app.prompt(
        { ...env.actor, channelId: env.project.channelId, content: "work" },
        () => undefined,
      );
      const stopped = expect(pending).rejects.toThrow(/stopped/i);
      if (phase === "status") await vi.waitFor(() => expect(env.statuses.update).toHaveBeenCalled());
      await expect(env.app.resume(env.actor, env.project.id, () => undefined)).rejects.toThrow(
        /active prompt/i,
      );
      await env.app.stop(env.actor, env.project.id);
      blocked.release();
      await stopped;
      expect(env.start).not.toHaveBeenCalled();
      expect(env.adapter.getSession(env.project.id)).toBeUndefined();
      expect(env.database.sessions.findLatestByProject(env.project.id)?.status).not.toBe("working");
    });
  }
  it("reserves resume before preflight and rejects a competing prompt", async () => {
    const env = await subject();
    const blocked = gate();
    vi.mocked(env.discord.workspaceExists).mockImplementationOnce(async () => {
      await blocked.promise;
      return true;
    });
    const pending = env.app.resume(env.actor, env.project.id, () => undefined);
    const stopped = expect(pending).rejects.toThrow(/stopped/i);
    await expect(
      env.app.prompt({ ...env.actor, channelId: env.project.channelId, content: "late" }, () => undefined),
    ).rejects.toThrow(/active prompt/i);
    await env.app.stop(env.actor, env.project.id);
    blocked.release();
    await stopped;
    expect(env.start).not.toHaveBeenCalled();
  });
  it("rechecks after session acquisition before sending the prompt", async () => {
    const env = await subject();
    const acquired = gate();
    const release = gate();
    const original = env.adapter.startSession.bind(env.adapter);
    env.start.mockImplementationOnce(async (input) => {
      const session = await original(input);
      acquired.release();
      await release.promise;
      return session;
    });
    const pending = env.app.prompt(
      { ...env.actor, channelId: env.project.channelId, content: "work" },
      () => undefined,
    );
    const stopped = expect(pending).rejects.toThrow(/stopped/i);
    await acquired.promise;
    const session = env.adapter.getSession(env.project.id);
    if (!session) throw new Error("No session");
    const send = vi.spyOn(session, "sendPrompt");
    await env.app.stop(env.actor, env.project.id);
    release.release();
    await stopped;
    expect(send).not.toHaveBeenCalled();
  });
});
