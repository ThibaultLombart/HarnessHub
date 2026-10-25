import { describe, expect, it, vi } from "vitest";
import { PiUiRequests } from "../src/infrastructure/pi/ui-requests.js";
import type { PiRpcClient } from "../src/infrastructure/pi/rpc-client.js";

describe("PiUiRequests decision visibility", () => {
  for (const method of ["confirm", "select", "input", "editor"]) {
    for (const material of [
      { title: "token=private-canary" },
      { message: "https://user:private-canary@example.com" },
      { title: "Very long context. ".repeat(100) },
      { options: ["Safe", "password=private-canary"] },
    ]) {
      it(`cancels ${method} with unsafe or truncated decision material instead of opaque controls: ${Object.keys(material)[0] ?? "material"}`, async () => {
        const respondUi = vi.fn(async () => undefined);
        const emit = vi.fn();
        const requests = new PiUiRequests({ respondUi } as unknown as PiRpcClient, emit, () => undefined);
        requests.receive({
          type: "extension_ui_request",
          id: "rpc-id",
          method,
          title: "Update src/main.ts?",
          message: "Use **reviewed** changes?",
          options: ["Yes", "No"],
          ...material,
        });
        expect(emit).not.toHaveBeenCalled();
        expect(respondUi).toHaveBeenCalledWith("rpc-id", { cancelled: true });
        await requests.clear(true);
      });
    }
  }
  it("preserves visible paths/format and maps selected labels back without presentation escaping", async () => {
    const respondUi = vi.fn(async () => undefined);
    const emit = vi.fn();
    const requests = new PiUiRequests({ respondUi } as unknown as PiRpcClient, emit, () => undefined);
    requests.receive({
      id: "rpc-id",
      method: "select",
      title: "Update src/main.ts?",
      message: "Use **reviewed** changes?",
      options: ["Keep C:\\work\\main.ts", "Use `src/main.ts`"],
    });
    const event = emit.mock.calls[0]?.[0] as {
      sessionId: string;
      request: { id: string; title: string; message: string; options: string[] };
    };
    expect(event.request.title).toBe("Update src/main.ts?");
    expect(event.request.message).toBe("Use **reviewed** changes?");
    await requests.select(event.sessionId, event.request.id, 1);
    expect(respondUi).toHaveBeenCalledWith("rpc-id", { value: "Use `src/main.ts`" });
  });
});
