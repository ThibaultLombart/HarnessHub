import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { PiRpcClient } from "../src/infrastructure/pi/rpc-client.js";
import { PiSession } from "../src/infrastructure/pi/pi-adapter.js";

it.skipIf(process.platform !== "linux")(
  "production Stop waits for forced termination of a SIGTERM-resistant process group",
  async () => {
    const client = new PiRpcClient({
      command: process.execPath,
      arguments: [path.resolve("tests/fixtures/uncooperative-pi.mjs")],
      cwd: process.cwd(),
    });
    const session = new PiSession(
      "one",
      client,
      "persisted",
      null,
      () => undefined,
      () => undefined,
    );
    let parentPid = 0;
    try {
      const state = await client.command("get_state");
      const data = state.data as { parentPid: number; childPid: number };
      parentPid = data.parentPid;
      expect(() => process.kill(data.childPid, 0)).not.toThrow();
      const started = Date.now();
      await Promise.all([session.stop(), session.stop(), session.close()]);
      expect(Date.now() - started).toBeLessThan(4_000);
      expect(() => process.kill(parentPid, 0)).toThrow();
      // A killed descendant can briefly remain an init-owned zombie; it cannot execute.
      const stat = `/proc/${String(data.childPid)}/stat`;
      if (fs.existsSync(stat)) expect(fs.readFileSync(stat, "utf8").split(") ")[1]?.[0]).toBe("Z");
    } finally {
      if (parentPid) {
        try {
          process.kill(-parentPid, "SIGKILL");
        } catch {
          /* Already gone. */
        }
      }
      await session.close();
    }
  },
  8_000,
);
