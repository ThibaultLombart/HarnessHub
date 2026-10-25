import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { HarnessHub } from "../src/application/harness-hub.js";
import type { HarnessEvent } from "../src/domain/harness.js";
import type { Project } from "../src/domain/project.js";
import { PiAdapter } from "../src/infrastructure/pi/pi-adapter.js";

const base = "/var/lib/harnesshub/tools/node_modules/@earendil-works/pi-coding-agent/dist";
it.skipIf(!fs.existsSync(path.join(base, "core/agent-session.js")))(
  "Stop kills installed prompt preflight before delayed cleanup can dispatch; history and replacements survive",
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-preflight-stop-"));
    const adapter = new PiAdapter({
      command: process.execPath,
      commandArguments: [path.resolve("tests/fixtures/installed-preflight-pi.mjs"), base],
      sessionRoot: root,
      maxSessions: 1,
    });
    const actor = { guildId: "g", userId: "a" };
    const project = { id: "one", path: root, slug: "one", archivedAt: null } as Project;
    let persisted: { externalSessionId: string; status: string } | undefined;
    const hub = new HarnessHub(
      { guildId: "g", administratorId: "a" },
      {
        projects: { findById: () => project, findByChannelId: () => project },
        modelPreferences: { findByProject: () => undefined },
        sessions: {
          findLatestByProject: () => persisted,
          recordStarted: (_project, _harness, externalSessionId) => {
            persisted = { externalSessionId, status: "idle" };
          },
          updateStatus: (_project, status) => {
            if (persisted) persisted.status = status;
          },
        },
      },
      adapter,
    );
    let question: Extract<HarnessEvent, { type: "ui-request" }> | undefined;
    const events: HarnessEvent[] = [];
    try {
      const pending = hub.prompt({ ...actor, channelId: "c", content: "ordinary prompt" }, (event) => {
        events.push(event);
        if (event.type === "ui-request") question = event;
      });
      const stopped = expect(pending).rejects.toMatchObject({ name: "SessionStoppedError" });
      await vi.waitFor(() => expect(question).toBeDefined(), { timeout: 3_000 });
      if (!question) throw new Error("No preflight question");
      const first = adapter.getSession("one");
      if (!first) throw new Error("No session");
      const pid = Number(fs.readFileSync(path.join(root, "preflight-pid"), "utf8"));
      const historyPath = fs.readFileSync(path.join(root, "saved-session-path"), "utf8");
      const history = fs.readFileSync(historyPath, "utf8");
      await first.respondUi(question.sessionId, question.request.id, { cancelled: true });
      await vi.waitFor(() => {
        expect(fs.existsSync(path.join(root, "cleanup-entered"))).toBe(true);
        expect(fs.existsSync(path.join(root, "installed-abort-returned"))).toBe(true);
      });
      await hub.stop(actor, "one");
      fs.writeFileSync(path.join(root, "release-cleanup"), "release only AFTER Stop returned");
      expect(() => process.kill(pid, 0)).toThrow();
      expect(fs.existsSync(path.join(root, "agent-dispatched"))).toBe(false);
      await stopped;
      expect(persisted?.status).toBe("stopped");
      expect(fs.readFileSync(historyPath, "utf8")).toBe(history);
      expect(adapter.getSession("one")).toBeUndefined();
      await hub.resume(actor, "one", () => undefined);
      const second = adapter.getSession("one");
      expect(second).toBeDefined();
      expect(second).not.toBe(first);
      expect(second?.externalSessionId).toBe(first.externalSessionId);
      expect(fs.readFileSync(historyPath, "utf8")).toBe(history);
      await expect(
        first.respondUi(question.sessionId, question.request.id, { confirmed: true }),
      ).rejects.toThrow(/stale/);
      await expect(
        second?.respondUi(question.sessionId, question.request.id, { confirmed: true }),
      ).rejects.toThrow(/stale/);
      await first.stop();
      await first.close();
      expect(adapter.getSession("one")).toBe(second);
      expect(events.filter((event) => event.type === "agent-start")).toHaveLength(0);
    } finally {
      await adapter.dispose();
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
  10_000,
);
