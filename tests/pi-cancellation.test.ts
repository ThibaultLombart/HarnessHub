import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PiAdapter } from "../src/infrastructure/pi/pi-adapter.js";

const roots: string[] = [];
const adapters: PiAdapter[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(adapters.splice(0).map(async (adapter) => adapter.dispose()));
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function setup(hold = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-pi-cancel-"));
  roots.push(root);
  const adapter = new PiAdapter({
    command: process.execPath,
    commandArguments: [path.resolve("tests/fixtures/live-pi.mjs"), ...(hold ? ["hold-init"] : [])],
    sessionRoot: root,
    maxSessions: 1,
  });
  adapters.push(adapter);
  return { adapter, root, input: { projectId: "one", cwd: root, name: "one", onEvent: vi.fn() } };
}
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe("Pi initialization cancellation", () => {
  for (const action of ["stop", "shutdown"] as const) {
    it(`${action} invalidates a start blocked in the filesystem before process registration`, async () => {
      const { adapter, input } = setup();
      const blocked = gate();
      const entered = gate();
      const original = fsp.realpath.bind(fsp);
      vi.spyOn(fsp, "realpath").mockImplementationOnce(async (target) => {
        entered.release();
        await blocked.promise;
        return original(target);
      });
      const pending = adapter.startSession(input);
      const stopped = expect(pending).rejects.toThrow(/stopped/i);
      await entered.promise;
      const cancelled = action === "stop" ? adapter.stopSession("one") : adapter.dispose();
      blocked.release();
      await cancelled;
      await stopped;
      expect(adapter.getSession("one")).toBeUndefined();
      expect(input.onEvent).not.toHaveBeenCalled();
      expect(fs.existsSync(path.join(input.cwd, "one"))).toBe(false);
    });
    it(`${action} closes a registered initializing process promptly`, async () => {
      const { adapter, input } = setup(true);
      const pending = adapter.startSession(input);
      const stopped = expect(pending).rejects.toThrow(/stopped/i);
      await vi.waitFor(() => expect(adapter.getSession("one")).toBeDefined());
      await (action === "stop" ? adapter.stopSession("one") : adapter.dispose());
      await stopped;
      expect(adapter.getSession("one")).toBeUndefined();
    });
  }
  it("stop invalidates a start already waiting for process restart", async () => {
    const { adapter, input } = setup();
    const first = await adapter.startSession(input);
    const blocked = gate();
    const entered = gate();
    const originalClose = first.close.bind(first);
    vi.spyOn(first, "close").mockImplementationOnce(async () => {
      entered.release();
      await blocked.promise;
      await originalClose();
    });
    const restarting = adapter.restartSession("one");
    await entered.promise;
    const pending = adapter.startSession(input);
    const stopped = expect(pending).rejects.toThrow(/stopped/i);
    await adapter.stopSession("one");
    blocked.release();
    await restarting;
    await stopped;
    expect(adapter.getSession("one")).toBeUndefined();
  });

  it("old closed session and question handles cannot affect a replacement", async () => {
    const { adapter, input } = setup();
    let handle: { sessionId: string; requestId: string } | undefined;
    const first = await adapter.startSession({
      ...input,
      onEvent: (event) => {
        if (event.type === "ui-request") handle = { sessionId: event.sessionId, requestId: event.request.id };
      },
    });
    const prompt = first.sendPrompt("ask");
    const stopped = expect(prompt).rejects.toThrow(/stopped/i);
    await vi.waitFor(() => expect(handle).toBeDefined());
    await adapter.stopSession("one");
    await stopped;
    await adapter.restartSession("one");
    const second = await adapter.startSession(input);
    if (!handle) throw new Error("No question");
    await expect(second.respondUi(handle.sessionId, handle.requestId, { confirmed: true })).rejects.toThrow(
      /stale/,
    );
    await expect(first.stop()).resolves.toBeUndefined();
    await first.close();
    expect(adapter.getSession("one")).toBe(second);
    await expect(second.sendPrompt("done")).resolves.toBe("Pi completed without a text response.");
  });
});
