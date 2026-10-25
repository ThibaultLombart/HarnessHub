import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  Client,
  Events,
  type MessageCreateOptions,
  type MessageEditOptions,
  type ModalBuilder,
} from "discord.js";
import type { Logger } from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HarnessHubApplication } from "../src/application/application.js";
import { HarnessHub } from "../src/application/harness-hub.js";
import type { Project } from "../src/domain/project.js";
import { DiscordBot } from "../src/infrastructure/discord/discord-bot.js";
import { PiAdapter, PiPromptLifecycleUnsupportedError } from "../src/infrastructure/pi/pi-adapter.js";

const actor = { guildId: "guild", userId: "admin", channelId: "channel" };
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

async function setup(startup = false, noModel = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-discord-live-"));
  const adapter = new PiAdapter({
    command: process.execPath,
    commandArguments: [
      path.resolve("tests/fixtures/live-pi.mjs"),
      ...(startup ? ["startup"] : []),
      ...(noModel ? ["no-model"] : []),
    ],
    sessionRoot: root,
    maxSessions: 3,
  });
  const project: Project = {
    id: "project",
    workspaceId: "w",
    name: "one",
    slug: "one",
    channelId: actor.channelId,
    path: root,
    harnessId: "pi",
    gitRemote: null,
    createdAt: "",
    archivedAt: null,
  };
  let mapped = project;
  const hub = new HarnessHub(
    { guildId: actor.guildId, administratorId: actor.userId },
    {
      projects: {
        findByChannelId: (id) => (id === actor.channelId ? mapped : undefined),
        findById: (id) => (id === project.id ? project : undefined),
      },
      modelPreferences: { findByProject: () => undefined },
      sessions: {
        findLatestByProject: () => undefined,
        recordStarted: () => undefined,
        updateStatus: () => undefined,
      },
    },
    adapter,
  );
  const application = {
    projectForChannel: (input: typeof actor) => {
      hub.authorize(input);
      if (input.channelId !== actor.channelId) throw new Error("Unmapped");
      return mapped;
    },
    projectModelLabel: () => "stale/preference",
    getAuthStatus: vi.fn(async () => ({ authenticated: false, providers: [] })),
    listModels: vi.fn(async () => []),
    prompt: vi.fn(hub.prompt.bind(hub)),
    respondUi: vi.fn(hub.respondUi.bind(hub)),
    stop: vi.fn(hub.stop.bind(hub)),
    resume: vi.fn(hub.resume.bind(hub)),
  };
  const client = Object.assign(new EventEmitter(), {
    application: { commands: { set: vi.fn(async () => undefined) } },
    login: async () => "token",
    isReady: () => true,
    destroy: async () => undefined,
  });
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const bot = new DiscordBot(
    client as unknown as Client,
    actor.guildId,
    "unused",
    application as unknown as HarnessHubApplication,
    logger as unknown as Logger,
  );
  const edits: MessageEditOptions[] = [];
  const progress = {
    edit: vi.fn(async (payload: MessageEditOptions) => {
      edits.push(payload);
    }),
  };
  const questionEdit = vi.fn<(payload: MessageEditOptions) => Promise<void>>().mockResolvedValue(undefined);
  const send = vi
    .fn<(payload: MessageCreateOptions) => Promise<{ edit: typeof questionEdit }>>()
    .mockResolvedValue({ edit: questionEdit });
  const channel = { isSendable: () => true, send };
  const reply = vi
    .fn<(payload: MessageCreateOptions) => Promise<typeof progress>>()
    .mockResolvedValue(progress);
  await bot.start();
  cleanup.push(async () => {
    await bot.stop();
    await adapter.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const prompt = (content: string) =>
    client.emit(Events.MessageCreate, {
      author: { bot: false, id: actor.userId },
      guildId: actor.guildId,
      channelId: actor.channelId,
      content,
      reply,
      channel,
    });
  const click = (customId: string, kind = "button", overrides: Record<string, unknown> = {}) => {
    const interaction = {
      customId,
      guildId: actor.guildId,
      user: { id: actor.userId },
      channelId: actor.channelId,
      isChatInputCommand: () => false,
      isButton: () => kind === "button",
      isStringSelectMenu: () => kind === "select",
      isModalSubmit: () => kind === "modal",
      values: ["1"],
      fields: { getTextInputValue: () => "Custom answer" },
      reply: vi.fn<(payload: unknown) => Promise<void>>().mockResolvedValue(undefined),
      deferUpdate: vi.fn(async () => undefined),
      showModal: vi.fn<(modal: ModalBuilder) => Promise<void>>().mockResolvedValue(undefined),
      update: vi.fn<(payload: unknown) => Promise<void>>().mockResolvedValue(undefined),
      ...overrides,
    };
    client.emit(Events.InteractionCreate, interaction);
    return interaction;
  };
  return {
    adapter,
    bot,
    application,
    prompt,
    click,
    send,
    edits,
    questionEdit,
    reply,
    progress,
    logger,
    remap: () => {
      mapped = { ...project, id: "replacement" };
    },
  };
}
function control(payload: MessageCreateOptions | undefined, action: string): string {
  if (!payload) throw new Error("No payload");
  const json = JSON.stringify(payload);
  const ids = [...json.matchAll(/"custom_id":"([^"]+)"/g)].map((match) => match[1]);
  const id = ids.find((value) => value?.includes(`:${action}`));
  if (!id) throw new Error(`No ${action} control`);
  return id;
}

describe("DiscordBot with actual Pi adapter and local RPC transport", () => {
  it("delivers bounded escaped progress with its model and controls, then waits for the edit chain before completion", async () => {
    const env = await setup();
    let complete!: () => void;
    let releaseEdit!: () => void;
    const completion = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const editing = new Promise<void>((resolve) => {
      releaseEdit = resolve;
    });
    const model = `${"_".repeat(38)}:`.repeat(4);
    env.application.prompt.mockImplementationOnce(async (_input, onEvent) => {
      onEvent({ type: "model-selected", provider: "p", modelId: model });
      onEvent({ type: "turn-start" });
      for (let i = 0; i < 5; i++) onEvent({ type: "tool-end", toolName: "bash", failed: true });
      onEvent({ type: "retry-start" });
      onEvent({ type: "compaction-start" });
      onEvent({ type: "tool-start", toolName: "bash" });
      onEvent({ type: "public-explanation", text: "*".repeat(500) });
      onEvent({
        type: "subagents",
        agents: Array.from({ length: 8 }, () => ({
          role: "reviewer",
          status: "needs_attention",
          startedAt: 0,
        })),
      });
      await completion;
      return "Final verified answer";
    });
    env.progress.edit.mockImplementationOnce(async (payload) => {
      if ((payload.content?.length ?? 0) > 2000) throw new Error("Discord content too long");
      await editing;
      env.edits.push(payload);
    });
    vi.useFakeTimers();
    try {
      env.prompt("ordinary");
      await vi.advanceTimersByTimeAsync(15_000);
      expect(env.progress.edit).toHaveBeenCalledTimes(1);
      const progress = env.progress.edit.mock.calls[0]?.[0];
      expect(progress?.content?.length).toBeLessThanOrEqual(2000);
      expect(progress?.content).toContain("omitted");
      expect(progress?.content).toContain("Model used: p/");
      expect(progress?.content).toContain("1 turn · 5 actions completed");
      expect(JSON.stringify(progress?.components)).toContain("Stop");
      complete();
      await vi.advanceTimersByTimeAsync(0);
      expect(env.progress.edit).toHaveBeenCalledTimes(1);
      releaseEdit();
      await vi.advanceTimersByTimeAsync(0);
      expect(env.progress.edit).toHaveBeenCalledTimes(2);
      expect(env.edits.at(-1)?.content).toContain("Final verified answer");
      expect(env.edits.at(-1)?.components).toEqual([]);
      expect(env.logger.warn).not.toHaveBeenCalled();
    } finally {
      complete();
      releaseEdit();
      vi.useRealTimers();
    }
  });
  for (const noModel of [false, true]) {
    const model = noModel ? "unknown" : String.raw`fake/actual\_model`;
    const notice =
      "Pi had no persisted first-session history; a new empty conversation was started. No prompt was replayed.";
    it(`retains missing-history disclosure once across fast long completion chunks (unknown: ${String(noModel)})`, async () => {
      const env = await setup();
      env.application.prompt.mockImplementationOnce(async (_input, onEvent) => {
        onEvent({ type: "history-unavailable" });
        onEvent({ type: "history-unavailable" });
        if (!noModel) onEvent({ type: "model-selected", provider: "fake", modelId: "actual_model" });
        return "*".repeat(3500);
      });
      vi.useFakeTimers();
      try {
        env.prompt("ordinary");
        await vi.advanceTimersByTimeAsync(0);
        expect(env.progress.edit).toHaveBeenCalledTimes(1);
        const chunks = [env.edits[0]?.content, ...env.send.mock.calls.map(([payload]) => payload.content)];
        expect(chunks.length).toBeGreaterThan(1);
        expect(chunks[0]).toContain(notice);
        expect(chunks.join("").split(notice)).toHaveLength(2);
        for (const chunk of chunks) {
          expect(chunk?.length).toBeLessThanOrEqual(2000);
          expect(chunk?.endsWith(`Model used: ${model}`)).toBe(true);
        }
        const body = chunks
          .map((chunk) => chunk?.replace(`\n\nModel used: ${model}`, ""))
          .join("")
          .replace(`${notice}\n\n`, "");
        expect(body).toBe(String.raw`\*`.repeat(3500));
        expect(env.edits[0]?.components).toEqual([]);
        expect(env.edits[0]?.allowedMentions).toEqual({ parse: [] });
        for (const [payload] of env.send.mock.calls) expect(payload.allowedMentions).toEqual({ parse: [] });

        env.application.prompt.mockResolvedValueOnce("Next answer");
        env.prompt("next ordinary prompt");
        await vi.advanceTimersByTimeAsync(0);
        expect(env.edits.at(-1)?.content).toBe("Next answer\n\nModel used: unknown");
      } finally {
        vi.useRealTimers();
      }
    });
    it(`retains missing-history disclosure on fast failure without promising saved history (unknown: ${String(noModel)})`, async () => {
      const env = await setup();
      env.application.prompt.mockImplementationOnce(async (_input, onEvent) => {
        onEvent({ type: "history-unavailable" });
        onEvent({ type: "history-unavailable" });
        if (!noModel) onEvent({ type: "model-selected", provider: "fake", modelId: "actual_model" });
        throw new PiPromptLifecycleUnsupportedError();
      });
      vi.useFakeTimers();
      try {
        env.prompt("ordinary");
        await vi.advanceTimersByTimeAsync(0);
        expect(env.progress.edit).toHaveBeenCalledTimes(1);
        const final = env.edits[0]?.content;
        expect(final).toContain(notice);
        expect(final?.split(notice)).toHaveLength(2);
        expect(final).toContain("completion was not verified");
        expect(final).not.toMatch(/resume the saved conversation/i);
        expect(final?.endsWith(`Model used: ${model}`)).toBe(true);
        expect(final?.length).toBeLessThanOrEqual(2000);
        expect(env.edits[0]?.components).toEqual([]);
        expect(env.edits[0]?.allowedMentions).toEqual({ parse: [] });
        expect(env.send).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  }
  it("reports explicitly when resume starts empty because first-session history was never persisted", async () => {
    const env = await setup();
    env.application.resume.mockImplementationOnce(async (_actor, _project, onEvent) => {
      onEvent({ type: "history-unavailable" });
    });
    const editReply = vi.fn(async () => undefined);
    env.click("unused", "command", {
      isChatInputCommand: () => true,
      commandName: "session",
      options: { getSubcommand: () => "resume" },
      deferReply: vi.fn(async () => undefined),
      editReply,
    });
    await vi.waitFor(() =>
      expect(editReply).toHaveBeenCalledWith(
        expect.stringMatching(
          /no persisted first-session history.*new empty conversation.*No prompt was replayed/,
        ),
      ),
    );
  });
  for (const action of ["stop", "shutdown"] as const) {
    it(`${action} during initial progress delivery cannot dispatch late work`, async () => {
      const env = await setup();
      let release!: () => void;
      const blocked = new Promise<typeof env.progress>((resolve) => {
        release = () => resolve(env.progress);
      });
      env.reply.mockReturnValueOnce(blocked);
      env.prompt("ask");
      await vi.waitFor(() => expect(env.reply).toHaveBeenCalledTimes(1));
      if (action === "shutdown") await env.bot.stop();
      else {
        const editReply = vi.fn(async () => undefined);
        env.click("unused", "command", {
          isChatInputCommand: () => true,
          commandName: "session",
          options: { getSubcommand: () => "stop" },
          deferReply: vi.fn(async () => undefined),
          editReply,
        });
        await vi.waitFor(() => expect(editReply).toHaveBeenCalledWith("Session stopped."));
        env.prompt("must not replace the pending send");
        await vi.waitFor(() => expect(env.reply).toHaveBeenCalledTimes(2));
      }
      release();
      await vi.waitFor(() =>
        expect(env.edits.some((edit) => edit.content?.includes("Session stopped."))).toBe(true),
      );
      expect(env.application.prompt).not.toHaveBeenCalled();
      expect(env.adapter.getSession("project")).toBeUndefined();
      if (action === "stop") {
        env.prompt("ask");
        await vi.waitFor(() => expect(env.send).toHaveBeenCalledTimes(1));
        env.click(control(env.send.mock.calls[0]?.[0], "select"), "select");
        await vi.waitFor(() =>
          expect(env.edits.some((edit) => edit.content?.includes("Correlated B"))).toBe(true),
        );
        expect(env.application.prompt).toHaveBeenCalledTimes(1);
      } else {
        env.prompt("must not start after shutdown");
        expect(env.application.prompt).not.toHaveBeenCalled();
      }
    });
  }
  it("does not cancel a pending progress send when another project is stopped", async () => {
    const env = await setup();
    let release!: () => void;
    env.reply.mockReturnValueOnce(
      new Promise((resolve) => {
        release = () => resolve(env.progress);
      }),
    );
    env.prompt("ask");
    await vi.waitFor(() => expect(env.reply).toHaveBeenCalled());
    const original = env.application.projectForChannel(actor);
    vi.spyOn(env.application, "projectForChannel").mockReturnValueOnce({ ...original, id: "other" });
    env.application.stop.mockResolvedValueOnce(undefined);
    const editReply = vi.fn(async () => undefined);
    env.click("unused", "command", {
      isChatInputCommand: () => true,
      commandName: "session",
      options: { getSubcommand: () => "stop" },
      deferReply: vi.fn(async () => undefined),
      editReply,
    });
    await vi.waitFor(() => expect(editReply).toHaveBeenCalledWith("Session stopped."));
    release();
    await vi.waitFor(() => expect(env.send).toHaveBeenCalledTimes(1));
    env.click(control(env.send.mock.calls[0]?.[0], "select"), "select");
    await vi.waitFor(() =>
      expect(env.edits.some((edit) => edit.content?.includes("Correlated B"))).toBe(true),
    );
  });
  it("explains that empty observational discovery excludes executable providers", async () => {
    const env = await setup();
    for (const [commandName, subcommand] of [
      ["harness", "auth"],
      ["model", "list"],
    ]) {
      const editReply = vi.fn(async () => undefined);
      env.click("unused", "command", {
        isChatInputCommand: () => true,
        commandName,
        options: { getSubcommand: () => subcommand },
        deferReply: vi.fn(async () => undefined),
        editReply,
      });
      await vi.waitFor(() => expect(editReply).toHaveBeenCalled());
      expect(editReply.mock.calls[0]).toEqual([
        expect.stringMatching(/extension.*disabled.*extension-only providers.*not assessed/i),
      ]);
    }
  });
  for (const noModel of [false, true]) {
    it(`uses only the actual model evidence for questions and completion (unknown: ${String(noModel)})`, async () => {
      const env = await setup(false, noModel);
      env.prompt("ask");
      await vi.waitFor(() => expect(env.send).toHaveBeenCalledTimes(1));
      const expectedModel = noModel ? "unknown" : "fake/model";
      expect(env.reply.mock.calls[0]?.[0].content).toContain("Model used: unknown");
      expect(env.send.mock.calls[0]?.[0].content).toContain(`Model used: ${expectedModel}`);
      env.click(control(env.send.mock.calls[0]?.[0], "select"), "select");
      await vi.waitFor(() =>
        expect(env.edits.some((edit) => edit.content?.includes("Correlated B"))).toBe(true),
      );
      expect(env.edits.at(-1)?.content).toContain(`Model used: ${expectedModel}`);
      expect(JSON.stringify([...env.reply.mock.calls, ...env.send.mock.calls, env.edits])).not.toContain(
        "stale/preference",
      );
    });
  }
  it("reports the startup version limitation rather than sending opaque controls", async () => {
    const env = await setup(true);
    env.prompt("ask");
    await vi.waitFor(() =>
      expect(env.edits.some((edit) => edit.content?.includes("initialization dialogs are unsupported"))).toBe(
        true,
      ),
    );
    expect(env.send).not.toHaveBeenCalled();
  });
  it("routes ordinary prompt questions through Discord and returns correlated completion", async () => {
    const env = await setup();
    env.prompt("ask");
    await vi.waitFor(() => expect(env.send).toHaveBeenCalledTimes(1));
    const id = control(env.send.mock.calls[0]?.[0], "select");
    const foreign = env.click(id, "select", { user: { id: "intruder" } });
    await vi.waitFor(() => expect(foreign.reply).toHaveBeenCalled());
    env.click(id, "select");
    await vi.waitFor(() =>
      expect(env.edits.some((edit) => edit.content?.includes("Correlated B"))).toBe(true),
    );
    env.click(id, "select");
    await vi.waitFor(() => expect(env.application.respondUi).toHaveBeenCalledTimes(1));
    expect(env.logger.error).not.toHaveBeenCalled();
  });
  it("preserves ordinary final path narratives and formatting without duplicate escaping", async () => {
    const env = await setup();
    env.prompt("paths");
    await vi.waitFor(() =>
      expect(env.edits.some((edit) => edit.content?.includes("src/main.ts"))).toBe(true),
    );
    const visible = env.edits.map((edit) => edit.content).join(" ");
    expect(visible).toContain(String.raw`Updated \*\*src/main.ts\*\* and C:\\work\\app.ts`);
    expect(visible).not.toContain("suppressed");
  });
  it("handles Other followed by free text, confirm and editor through real callbacks", async () => {
    const env = await setup();
    for (const mode of ["other", "confirm", "editor"]) {
      const before = env.send.mock.calls.length;
      env.prompt(mode);
      await vi.waitFor(() => expect(env.send.mock.calls.length).toBe(before + 1));
      if (mode === "other") {
        env.click(control(env.send.mock.calls[before]?.[0], "select"), "select", { values: ["2"] });
        await vi.waitFor(() => expect(env.send.mock.calls.length).toBe(before + 2));
      }
      if (mode === "confirm") env.click(control(env.send.mock.calls[before]?.[0], "yes"));
      else {
        const index = mode === "other" ? before + 1 : before;
        const button = env.click(control(env.send.mock.calls[index]?.[0], "respond"));
        await vi.waitFor(() => expect(button.showModal).toHaveBeenCalled());
        const modal = button.showModal.mock.calls[0]?.[0];
        if (!modal) throw new Error("No modal");
        env.click(modal.toJSON().custom_id, "modal");
      }
      await vi.waitFor(() =>
        expect(
          env.edits.some((edit) =>
            edit.content?.includes(mode === "confirm" ? "Confirmed" : "Correlated Custom answer"),
          ),
        ).toBe(true),
      );
      await vi.waitFor(() => expect(env.adapter.getSession("project")?.isBusy).toBe(false));
    }
  });
  it("cancels delivery failures and rejects remapped controls and forged cross-channel stop buttons", async () => {
    const env = await setup();
    env.send.mockRejectedValueOnce(new Error("offline"));
    env.prompt("ask");
    await vi.waitFor(() => expect(env.edits.some((edit) => edit.content?.includes("Cancelled"))).toBe(true));
    env.prompt("ask");
    await vi.waitFor(() => expect(env.send).toHaveBeenCalledTimes(2));
    env.remap();
    const rejected = env.click(control(env.send.mock.calls[1]?.[0], "select"), "select");
    await vi.waitFor(() => expect(rejected.reply).toHaveBeenCalled());
    expect(env.application.respondUi).toHaveBeenCalledTimes(1);
    env.click("hh:stop:project", "button", {
      channelId: "foreign",
      deferReply: vi.fn(async () => undefined),
      editReply: vi.fn(async () => undefined),
    });
    await vi.waitFor(() => expect(env.logger.warn).toHaveBeenCalled());
    expect(env.application.stop).not.toHaveBeenCalled();
  });
  it("coalesces event floods and never sends reasoning, arguments, raw results or unsafe final text", async () => {
    const env = await setup();
    env.prompt("malicious");
    await vi.waitFor(() =>
      expect(env.edits.some((edit) => edit.content?.includes("Model used:"))).toBe(true),
    );
    expect(env.progress.edit.mock.calls.length).toBeLessThanOrEqual(2);
    const visible = JSON.stringify([...env.send.mock.calls, env.edits]);
    expect(visible).not.toMatch(/private-canary|raw-prompt|secret-canary|stack-canary/);
    expect(visible).toContain("suppressed for privacy");
    for (const edit of env.edits) expect(edit.allowedMentions).toEqual({ parse: [] });
  });
});
