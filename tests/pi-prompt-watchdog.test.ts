import { afterEach, expect, it, vi } from "vitest";
import { PiSession } from "../src/infrastructure/pi/pi-adapter.js";
import type { PiRpcClient, RpcRecord } from "../src/infrastructure/pi/rpc-client.js";

afterEach(() => vi.useRealTimers());
function setup(acknowledged = true) {
  vi.useFakeTimers();
  let event!: (record: RpcRecord) => void;
  const client = {
    onEvent: (listener: typeof event) => {
      event = listener;
    },
    command: vi.fn(async (type: string) => {
      if (type === "prompt" && !acknowledged) return new Promise<RpcRecord>(() => undefined);
      return { success: true, data: { text: "Genuine completion" } };
    }),
    respondUi: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
  const invalidated = vi.fn();
  let handle: { sessionId: string; id: string } | undefined;
  const session = new PiSession(
    "one",
    client as unknown as PiRpcClient,
    "saved",
    null,
    (value) => {
      if (value.type === "ui-request") handle = { sessionId: value.sessionId, id: value.request.id };
    },
    invalidated,
  );
  return { session, client, invalidated, emit: (value: RpcRecord) => event(value), handle: () => handle };
}
for (const acknowledged of [true, false]) {
  it(`bounds no-lifecycle input (ACK: ${String(acknowledged)}) and terminates before returning failure`, async () => {
    const env = setup(acknowledged);
    const result = env.session.sendPrompt("ordinary").catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(5_001);
    expect(await result).toMatchObject({ name: "PiPromptLifecycleUnsupportedError" });
    expect(env.client.close).toHaveBeenCalledTimes(1);
    expect(env.invalidated).toHaveBeenCalledTimes(1);
    expect(env.session.isBusy).toBe(false);
    await expect(env.session.sendPrompt("late")).rejects.toThrow(/closed/);
  });
}
it("does not truncate healthy model work even without periodic events", async () => {
  const env = setup();
  const result = env.session.sendPrompt("ordinary");
  env.emit({ type: "agent_start" });
  await vi.advanceTimersByTimeAsync(3_600_000);
  expect(env.session.isBusy).toBe(true);
  expect(env.client.close).not.toHaveBeenCalled();
  env.emit({ type: "agent_settled" });
  await expect(result).resolves.toBe("Genuine completion");
  await env.session.close();
});
it("rearms the start watchdog for the next prompt after genuine model work completed", async () => {
  const env = setup();
  const first = env.session.sendPrompt("first");
  env.emit({ type: "agent_start" });
  env.emit({ type: "agent_settled" });
  await expect(first).resolves.toBe("Genuine completion");
  const second = env.session.sendPrompt("handled").catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(5_001);
  expect(await second).toMatchObject({ name: "PiPromptLifecycleUnsupportedError" });
});
it("suspends the watchdog for pending human dialogs and compaction, then bounds silent preflight cleanup", async () => {
  const env = setup(false);
  const result = env.session.sendPrompt("ordinary").catch((error: unknown) => error);
  env.emit({ type: "compaction_start" });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(env.client.close).not.toHaveBeenCalled();
  env.emit({ type: "compaction_end" });
  env.emit({ type: "extension_ui_request", method: "confirm", id: "rpc", title: "Proceed?" });
  await vi.advanceTimersByTimeAsync(240_000);
  expect(env.client.close).not.toHaveBeenCalled();
  let handle = env.handle();
  if (!handle) throw new Error("No question");
  await env.session.respondUi(handle.sessionId, handle.id, { cancelled: true });
  env.emit({ type: "extension_ui_request", method: "confirm", id: "rpc-2", title: "Another decision?" });
  // Multiple healthy dialogs may exceed the former 330-second prompt command cap.
  await vi.advanceTimersByTimeAsync(240_000);
  expect(env.client.close).not.toHaveBeenCalled();
  expect(env.client.command).toHaveBeenCalledWith("prompt", { message: "ordinary" }, 0);
  handle = env.handle();
  if (!handle) throw new Error("No second question");
  await env.session.respondUi(handle.sessionId, handle.id, { cancelled: true });
  await vi.advanceTimersByTimeAsync(4_000);
  expect(env.client.close).not.toHaveBeenCalled();
  // Notifications/widgets are not evidence of active agent work.
  env.emit({ type: "extension_ui_request", method: "notify", message: "unrelated" });
  await vi.advanceTimersByTimeAsync(1_001);
  expect(await result).toMatchObject({ name: "PiPromptLifecycleUnsupportedError" });
});
