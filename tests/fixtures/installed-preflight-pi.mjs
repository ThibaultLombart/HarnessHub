// Exercise the installed AgentSession.prompt/abort implementations with controlled
// dependencies. Dispatch is a tripwire, never an agent/provider invocation.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { pathToFileURL } from "node:url";
const base = process.argv[2];
const { AgentSession } = await import(pathToFileURL(path.join(base, "core/agent-session.js")).href);
const { SessionManager } = await import(pathToFileURL(path.join(base, "core/session-manager.js")).href);
const root = process.cwd();
const savedPath = path.join(root, "saved-session-path");
const manager = fs.existsSync(savedPath)
  ? SessionManager.open(fs.readFileSync(savedPath, "utf8"))
  : SessionManager.create(root, process.argv[process.argv.indexOf("--session-dir") + 1]);
if (!fs.existsSync(savedPath)) {
  manager.appendMessage({ role: "user", content: "Persisted history", timestamp: 1 });
  // Pi defers persistence until the first assistant message.
  manager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "Prior answer" }],
    timestamp: 2,
  });
  fs.writeFileSync(savedPath, manager.getSessionFile());
}
fs.writeFileSync(path.join(root, "preflight-pid"), String(process.pid));
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
let answer;
const session = Object.assign(Object.create(AgentSession.prototype), {
  agent: { state: { model: { provider: "controlled", id: "no-provider" }, messages: [] }, abort() {} },
  _pendingBashMessages: [],
  _pendingCustomMessages: [],
  _pendingNextTurnMessages: [],
  _resourceLoader: { getPrompts: () => ({ prompts: [] }) },
  _modelRuntime: { hasConfiguredAuth: () => true },
  _extensionRunner: {
    hasHandlers: () => false,
    async emitBeforeAgentStart() {
      send({ type: "extension_ui_request", id: "preflight-question", method: "confirm", title: "Proceed?" });
      await new Promise((resolve) => {
        answer = resolve;
      });
      fs.writeFileSync(path.join(root, "cleanup-entered"), "waiting");
      await new Promise((resolve) => {
        const watcher = fs.watch(root, () => {
          if (fs.existsSync(path.join(root, "release-cleanup"))) {
            watcher.close();
            resolve();
          }
        });
      });
    },
  },
  async _runAgentPrompt() {
    fs.writeFileSync(path.join(root, "agent-dispatched"), "unsafe dispatch");
    send({ type: "agent_settled" });
  },
});
for await (const line of readline.createInterface({ input: process.stdin })) {
  const command = JSON.parse(line);
  const ok = (data) => send({ type: "response", id: command.id, success: true, data });
  if (command.type === "get_state") ok({ sessionId: manager.getSessionId(), model: session.model });
  else if (command.type === "prompt") {
    void session
      .prompt(command.message, {
        preflightResult: (success) => {
          if (success) ok();
        },
      })
      .catch(() =>
        send({ type: "response", id: command.id, success: false, error: "Controlled preflight failed" }),
      );
  } else if (command.type === "extension_ui_response") {
    answer?.();
    // Installed abort reports idle even while before_agent_start cleanup is blocked.
    await session.abort();
    fs.writeFileSync(path.join(root, "installed-abort-returned"), "still in preflight");
  } else if (command.type === "clear_queue") ok({});
  else if (command.type === "abort") {
    await session.abort();
    ok();
  } else if (command.type === "get_last_assistant_text") ok({ text: "tripwire" });
}
