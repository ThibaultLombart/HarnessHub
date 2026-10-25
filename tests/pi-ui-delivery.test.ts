import path from "node:path";
import { describe, expect, it } from "vitest";
import { PiRpcClient } from "../src/infrastructure/pi/rpc-client.js";

describe("Pi UI transport delivery", () => {
  it("fails closed on a broken input pipe without an unhandled stream error", async () => {
    const client = new PiRpcClient({
      command: process.execPath,
      arguments: [path.resolve("tests/fixtures/broken-input-pi.mjs")],
      cwd: process.cwd(),
    });
    try {
      await new Promise<void>((resolve) =>
        client.onEvent((event) => {
          if (event.type === "ready") resolve();
        }),
      );
      await expect(client.respondUi("question", { value: "answer" })).rejects.toThrow(/delivery failed/);
      await expect(client.respondUi("question", { confirmed: true })).rejects.toThrow(/closed/);
    } finally {
      await client.close();
    }
  });
});
