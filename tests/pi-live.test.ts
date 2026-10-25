import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HarnessEvent } from "../src/domain/harness.js";
import { PiAdapter } from "../src/infrastructure/pi/pi-adapter.js";
import { projectSubagents } from "../src/infrastructure/pi/subagent-widget.js";
import { publicText } from "../src/domain/live-interface.js";

const roots: string[] = [];
const adapters: PiAdapter[] = [];
afterEach(async () => {
  await Promise.all(adapters.splice(0).map(async (adapter) => adapter.dispose()));
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function setup(startup = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-live-"));
  roots.push(root);
  const adapter = new PiAdapter({
    command: process.execPath,
    commandArguments: [path.resolve("tests/fixtures/live-pi.mjs"), ...(startup ? ["startup"] : [])],
    sessionRoot: root,
    maxSessions: 3,
  });
  adapters.push(adapter);
  return { adapter, root };
}

describe("Pi live RPC dialogs", () => {
  it("rejects initialization dialogs without exposing approval controls", async () => {
    const { adapter, root } = setup(true);
    const events: HarnessEvent[] = [];
    await expect(
      adapter.startSession({
        projectId: "one",
        cwd: root,
        name: "one",
        onEvent: (event) => events.push(event),
      }),
    ).rejects.toThrow(/initialization dialogs are unsupported/);
    expect(events.some((event) => event.type === "ui-request")).toBe(false);
    expect(adapter.getSession("one")).toBeUndefined();
  });

  it("rejects foreign, duplicate, stale and invalid answers; stop clears waiting requests", async () => {
    const { adapter, root } = setup();
    let request: Extract<HarnessEvent, { type: "ui-request" }> | undefined;
    const session = await adapter.startSession({
      projectId: "one",
      cwd: root,
      name: "one",
      onEvent: (event) => {
        if (event.type === "ui-request") request = event;
      },
    });
    const prompt = session.sendPrompt("ask");
    await vi.waitFor(() => expect(request).toBeDefined());
    if (request === undefined) throw new Error("No question");
    await expect(session.respondUi("foreign", request.request.id, { value: "B" })).rejects.toThrow();
    await expect(
      session.respondUi(request.sessionId, request.request.id, { value: "not an option" }),
    ).rejects.toThrow();
    await session.respondUi(request.sessionId, request.request.id, { value: "B" });
    await expect(session.respondUi(request.sessionId, request.request.id, { value: "B" })).rejects.toThrow();
    await expect(prompt).resolves.toBe("Correlated B");
    request = undefined;
    const pending = session.sendPrompt("ask");
    const stopped = expect(pending).rejects.toThrow(/stopped/iu);
    await vi.waitFor(() => expect(request).toBeDefined());
    await session.stop();
    await stopped;
  });

  it("marks stop before cancelling dialogs and does not expose new questions during abort", async () => {
    const { adapter, root } = setup();
    const events: HarnessEvent[] = [];
    const session = await adapter.startSession({
      projectId: "one",
      cwd: root,
      name: "one",
      onEvent: (event) => events.push(event),
    });
    const prompt = session.sendPrompt("stoprace");
    const stopped = expect(prompt).rejects.toThrow(/stopped/i);
    await vi.waitFor(() => expect(events.filter((event) => event.type === "ui-request")).toHaveLength(1));
    await session.stop();
    await stopped;
    expect(events.filter((event) => event.type === "ui-request")).toHaveLength(1);
  });

  it("expires questions and closes active prompts on shutdown", async () => {
    const { adapter, root } = setup();
    const events: HarnessEvent[] = [];
    const session = await adapter.startSession({
      projectId: "one",
      cwd: root,
      name: "one",
      onEvent: (event) => events.push(event),
    });
    await expect(session.sendPrompt("expiry")).resolves.toBe("Cancelled");
    expect(events.some((event) => event.type === "ui-closed")).toBe(true);
    const pending = session.sendPrompt("ask");
    const closed = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(events.filter((event) => event.type === "ui-request")).toHaveLength(2));
    await adapter.dispose();
    await closed;
  });
});

describe("safe live projection", () => {
  it("suppresses secrets, signed URLs, commands, mentions and embedded reasoning", () => {
    for (const text of [
      "token=abcdef",
      "https://example.com/?signature=foo",
      "@everyone",
      "<think>private</think>",
      "Authorization: Bearer abc",
      "sk-test12345678901234567890",
      "-----BEGIN PRIVATE KEY-----",
    ])
      expect(publicText(text)).toBe("[suppressed for privacy]");
    expect(publicText("Public **explanation**")).toBe("Public **explanation**");
    expect(publicText("x".repeat(4000)).length).toBeLessThan(1100);
  });
  it("projects only documented scoped subagent status, preserves attention and unknown", () => {
    const result = projectSubagents({
      kind: "pi-subagents.async-status-snapshot",
      version: 1,
      runs: [
        {
          id: "one",
          kind: "subagent",
          label: "reviewer",
          state: "running",
          startedAt: 100,
          activity: { state: "needs_attention" },
          output: "<think>private</think>",
          children: [{ id: "two", kind: "subagent", label: "worker", state: "new-state" }],
        },
      ],
    });
    expect(result).toEqual([
      { role: "reviewer", status: "needs_attention", startedAt: 100 },
      { role: "worker", status: "unknown" },
    ]);
    expect(projectSubagents({ version: 2, runs: [] })).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("private");
  });
});
