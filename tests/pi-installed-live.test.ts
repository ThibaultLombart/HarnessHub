import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PiAdapter, PiSession } from "../src/infrastructure/pi/pi-adapter.js";
import type { HarnessEvent } from "../src/domain/harness.js";
import { safeDiscordError } from "../src/infrastructure/discord/discord-bot.js";
import { PiRpcClient } from "../src/infrastructure/pi/rpc-client.js";

const cli =
  process.env.HARNESSHUB_TEST_PI_CLI ??
  "/var/lib/harnesshub/tools/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js";
describe("installed Pi RPC protocol (isolated, command-only, no provider)", () => {
  for (const startup of [true, false]) {
    it.skipIf(!fs.existsSync(cli))(
      `production adapter ${startup ? "rejects initialization dialogs promptly" : "rejects native inline commands before dispatch"}`,
      async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-real-adapter-"));
        const adapter = new PiAdapter({
          command: process.execPath,
          commandArguments: [
            path.resolve("tests/fixtures/isolated-real-pi.mjs"),
            cli,
            ...(startup ? ["--hh-startup"] : []),
          ],
          sessionRoot: root,
          maxSessions: 1,
        });
        const events: string[] = [];
        const deadline = setTimeout(() => {
          void adapter.dispose();
        }, 5_000);
        try {
          if (startup) {
            let failure: unknown;
            try {
              await adapter.startSession({
                projectId: "test",
                cwd: root,
                name: "test",
                onEvent: (event) => events.push(event.type),
              });
            } catch (error) {
              failure = error;
            }
            expect(fs.existsSync(path.join(root, "extension-started"))).toBe(true);
            expect(failure).toMatchObject({ name: "PiInitializationUiUnsupportedError" });
            expect(safeDiscordError(failure)).toMatch(/initialization.*unsupported.*0\.85\.1/i);
            expect(events).not.toContain("ui-request");
            expect(adapter.getSession("test")).toBeUndefined();
          } else {
            const session = await adapter.startSession({
              projectId: "test",
              cwd: root,
              name: "test",
              onEvent: () => undefined,
            });
            await expect(session.sendPrompt("/hh-dialog-test")).rejects.toThrow(
              /native Pi slash commands.*unsupported/i,
            );
            expect(fs.existsSync(path.join(root, "inline-executed"))).toBe(false);
            expect(session.isBusy).toBe(false);
          }
        } finally {
          clearTimeout(deadline);
          await adapter.dispose();
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
      10_000,
    );
  }

  it.skipIf(!fs.existsSync(cli))(
    "bounds ordinary handled input without claiming completion, invalidates the process and recovers",
    async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-real-handled-"));
      const adapter = new PiAdapter({
        command: process.execPath,
        commandArguments: [path.resolve("tests/fixtures/isolated-real-pi.mjs"), cli],
        sessionRoot: root,
        maxSessions: 1,
      });
      try {
        const events: string[] = [];
        const input = {
          projectId: "test",
          cwd: root,
          name: "test",
          onEvent: (event: HarnessEvent) => {
            events.push(event.type);
          },
        };
        const first = await adapter.startSession(input);
        const pid = Number(fs.readFileSync(path.join(root, "runtime-pid"), "utf8"));
        const prompt = first.sendPrompt("hh ordinary handled");
        const result = await Promise.race([
          prompt.catch((error: unknown) => error),
          new Promise((resolve) => {
            const timer = setTimeout(() => resolve("still busy"), 7_000);
            timer.unref();
          }),
        ]);
        expect(fs.existsSync(path.join(root, "input-handled"))).toBe(true);
        expect(result).toMatchObject({ name: "PiPromptLifecycleUnsupportedError" });
        expect(first.isBusy).toBe(false);
        expect(() => process.kill(pid, 0)).toThrow();
        expect(adapter.getSession("test")).toBeUndefined();
        await expect(first.sendPrompt("must not execute")).rejects.toThrow(/closed/);
        const second = await adapter.startSession({ ...input, externalSessionId: first.externalSessionId });
        expect(second).not.toBe(first);
        expect(second.externalSessionId).not.toBe(first.externalSessionId);
        expect(events).toContain("history-unavailable");
        await first.close();
        await first.stop();
        expect(adapter.getSession("test")).toBe(second);
      } finally {
        await adapter.dispose();
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
    12_000,
  );

  it.skipIf(!fs.existsSync(cli))(
    "resumes exact persisted history through the actual installed binary after Stop",
    async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-real-history-"));
      const id = "12345678-abcd-4321-abcd-123456789012";
      const directory = path.join(root, "test");
      fs.mkdirSync(directory);
      const file = path.join(directory, `2026-01-01T00-00-00-000Z_${id}.jsonl`);
      const history =
        [
          { type: "session", version: 3, id, cwd: root, timestamp: "2026-01-01T00:00:00.000Z" },
          {
            type: "message",
            id: "entry1",
            parentId: null,
            timestamp: "2026-01-01T00:00:01.000Z",
            message: { role: "user", content: "Previous conversation", timestamp: 1 },
          },
          {
            type: "message",
            id: "entry2",
            parentId: "entry1",
            timestamp: "2026-01-01T00:00:02.000Z",
            message: { role: "assistant", content: [{ type: "text", text: "Prior answer" }], timestamp: 2 },
          },
        ]
          .map((record) => JSON.stringify(record))
          .join("\n") + "\n";
      fs.writeFileSync(file, history);
      const adapter = new PiAdapter({
        command: process.execPath,
        commandArguments: [path.resolve("tests/fixtures/isolated-real-pi.mjs"), cli],
        sessionRoot: root,
        maxSessions: 1,
      });
      try {
        const input = {
          projectId: "test",
          cwd: root,
          name: "test",
          externalSessionId: id,
          onEvent: () => undefined,
        };
        const first = await adapter.startSession(input);
        expect(first.externalSessionId).toBe(id);
        await first.stop();
        const second = await adapter.startSession(input);
        expect(second).not.toBe(first);
        expect(second.externalSessionId).toBe(id);
        // Pi appends session-name/thinking-level metadata during initialization;
        // the existing conversation entries must remain byte-for-byte intact.
        expect(fs.readFileSync(file, "utf8").startsWith(history)).toBe(true);
      } finally {
        await adapter.dispose();
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
    10_000,
  );

  it.skipIf(!fs.existsSync(cli))(
    "discovery cannot run extension startup hooks",
    async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-real-discovery-"));
      const adapter = new PiAdapter({
        command: process.execPath,
        commandArguments: [path.resolve("tests/fixtures/isolated-real-pi.mjs"), cli, "--hh-startup"],
        sessionRoot: root,
        maxSessions: 1,
      });
      const deadline = setTimeout(() => {
        void adapter.dispose();
      }, 5_000);
      try {
        await expect(adapter.getAuthStatus(root)).resolves.toEqual({ authenticated: false, providers: [] });
        await expect(adapter.listModels(root)).resolves.toEqual([]);
        expect(fs.existsSync(path.join(root, "extension-started"))).toBe(false);
      } finally {
        clearTimeout(deadline);
        await adapter.dispose();
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
    12_000,
  );

  it.skipIf(!fs.existsSync(cli))(
    "accepts actual correlated select, input, confirm and editor responses",
    async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-real-rpc-"));
      const client = new PiRpcClient({
        command: process.execPath,
        arguments: [
          path.resolve("tests/fixtures/isolated-real-pi.mjs"),
          cli,
          "--mode",
          "rpc",
          "--no-session",
          "--no-approve",
        ],
        cwd: root,
      });
      const methods: string[] = [];
      const failures: unknown[] = [];
      const session = new PiSession(
        "test",
        client,
        "fixture",
        null,
        (event) => {
          if (event.type !== "ui-request") return;
          methods.push(event.request.method);
          const response =
            event.request.method === "select"
              ? { choice: 1 }
              : event.request.method === "confirm"
                ? { confirmed: true }
                : { value: event.request.method === "editor" ? "Edited answer" : "Custom answer" };
          void session.respondUi(event.sessionId, event.request.id, response).catch((error: unknown) => {
            failures.push(error);
          });
        },
        () => undefined,
      );
      try {
        await client.command("get_state", {}, 15_000);
        // Extension commands complete inline: their command response, not agent_settled, is the completion signal.
        await expect(client.command("prompt", { message: "/hh-dialog-test" }, 15_000)).resolves.toMatchObject(
          { success: true },
        );
        expect(methods).toEqual(["select", "input", "confirm", "editor"]);
        expect(failures).toEqual([]);
      } finally {
        await session.close();
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
    25_000,
  );
});
