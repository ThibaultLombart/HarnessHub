import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PiAdapter, SessionBusyError } from "../src/infrastructure/pi/pi-adapter.js";

const roots: string[] = [];
function temporaryDirectory(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harnesshub-pi-"));
  roots.push(root);
  return root;
}
const fixture = path.resolve("tests", "fixtures", "fake-pi.mjs");

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("PiAdapter", () => {
  it("detects Pi without a shell", async () => {
    const adapter = new PiAdapter({
      command: process.execPath,
      commandArguments: [fixture],
      sessionRoot: temporaryDirectory(),
      maxSessions: 2,
    });
    await expect(adapter.detect()).resolves.toEqual({ installed: true, version: "9.9.9" });
    await adapter.dispose();
  });

  it("reports native authentication without exposing credentials", async () => {
    const cwd = temporaryDirectory();
    const adapter = new PiAdapter({
      command: process.execPath,
      commandArguments: [fixture],
      sessionRoot: temporaryDirectory(),
      maxSessions: 2,
    });

    await expect(adapter.getAuthStatus(cwd)).resolves.toEqual({ authenticated: true, providers: ["fake"] });
    await adapter.dispose();
  });

  it("starts in the exact project directory and maps useful events", async () => {
    const cwd = temporaryDirectory();
    const adapter = new PiAdapter({
      command: process.execPath,
      commandArguments: [fixture],
      sessionRoot: temporaryDirectory(),
      maxSessions: 2,
    });
    const onEvent = vi.fn();
    const session = await adapter.startSession({ projectId: "project", cwd, name: "demo", onEvent });

    await expect(session.sendPrompt("Do work")).resolves.toBe("Fake answer");
    expect(session.externalSessionId).toBe("fake-session");
    expect(onEvent).toHaveBeenCalledWith({ type: "agent-start" });
    expect(onEvent).toHaveBeenCalledWith({ type: "turn-start" });
    expect(onEvent).toHaveBeenCalledWith({ type: "message-start" });
    expect(onEvent).toHaveBeenCalledWith({ type: "tool-start", toolName: "read" });
    expect(onEvent).toHaveBeenCalledWith({ type: "tool-update", toolName: "read" });
    expect(onEvent).toHaveBeenCalledWith({ type: "tool-end", toolName: "read", failed: false });
    expect(onEvent).toHaveBeenCalledWith({ type: "message-end" });
    await adapter.dispose();
  });

  it("routes each sequential prompt's events to its current caller", async () => {
    const adapter = new PiAdapter({
      command: process.execPath,
      commandArguments: [fixture],
      sessionRoot: temporaryDirectory(),
      maxSessions: 2,
    });
    const firstEvents = vi.fn();
    const secondEvents = vi.fn();
    const input = { projectId: "events", cwd: temporaryDirectory(), name: "events" };
    const first = await adapter.startSession({ ...input, onEvent: firstEvents });
    await first.sendPrompt("first");
    firstEvents.mockClear();

    const second = await adapter.startSession({ ...input, onEvent: secondEvents });
    await second.sendPrompt("second");

    expect(first).toBe(second);
    expect(firstEvents).not.toHaveBeenCalled();
    expect(secondEvents).toHaveBeenCalled();
    await adapter.dispose();
  });

  it("rejects overlapping prompts", async () => {
    const adapter = new PiAdapter({
      command: process.execPath,
      commandArguments: [fixture],
      sessionRoot: temporaryDirectory(),
      maxSessions: 2,
    });
    const session = await adapter.startSession({
      projectId: "project",
      cwd: temporaryDirectory(),
      name: "demo",
      onEvent: vi.fn(),
    });
    const first = session.sendPrompt("first");
    await expect(session.sendPrompt("second")).rejects.toThrow(SessionBusyError);
    await first;
    await adapter.dispose();
  });

  it("detects a process crash and permits a clean restart", async () => {
    const adapter = new PiAdapter({
      command: process.execPath,
      commandArguments: [fixture],
      sessionRoot: temporaryDirectory(),
      maxSessions: 1,
    });
    const input = { projectId: "crash", cwd: temporaryDirectory(), name: "crash", onEvent: vi.fn() };
    const session = await adapter.startSession(input);

    await expect(session.sendPrompt("crash")).rejects.toThrow(/exited unexpectedly/i);
    const restarted = await adapter.startSession(input);
    expect(restarted).not.toBe(session);
    await adapter.dispose();
  });

  it("stops an active operation idempotently", async () => {
    const adapter = new PiAdapter({
      command: process.execPath,
      commandArguments: [fixture],
      sessionRoot: temporaryDirectory(),
      maxSessions: 2,
    });
    const session = await adapter.startSession({
      projectId: "stop",
      cwd: temporaryDirectory(),
      name: "stop",
      onEvent: vi.fn(),
    });
    const prompt = session.sendPrompt("slow");
    const stopped = expect(prompt).rejects.toThrow(/stopped/i);
    await new Promise((resolve) => setTimeout(resolve, 25));

    await session.stop();
    await session.stop();
    await stopped;
    await adapter.dispose();
  });

  it("coalesces concurrent starts for the same project", async () => {
    const adapter = new PiAdapter({
      command: process.execPath,
      commandArguments: [fixture],
      sessionRoot: temporaryDirectory(),
      maxSessions: 2,
    });
    const input = { projectId: "same", cwd: temporaryDirectory(), name: "same", onEvent: vi.fn() };

    const [first, second] = await Promise.all([adapter.startSession(input), adapter.startSession(input)]);
    expect(first).toBe(second);
    await adapter.dispose();
  });

  it("enforces the configured process limit", async () => {
    const adapter = new PiAdapter({
      command: process.execPath,
      commandArguments: [fixture],
      sessionRoot: temporaryDirectory(),
      maxSessions: 1,
    });
    await adapter.startSession({
      projectId: "one",
      cwd: temporaryDirectory(),
      name: "one",
      onEvent: vi.fn(),
    });
    await expect(
      adapter.startSession({ projectId: "two", cwd: temporaryDirectory(), name: "two", onEvent: vi.fn() }),
    ).rejects.toThrow(/limit/i);
    await adapter.dispose();
  });
});
