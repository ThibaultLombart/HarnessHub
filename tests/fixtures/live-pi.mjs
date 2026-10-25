let buffer = "";
let answer = "";
let initialization;
let awaiting;
let sequence = 0;
let mode;
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
function ask(timeout, method = "select") {
  awaiting = `original-pi-id-${++sequence}`;
  send({
    type: "extension_ui_request",
    id: awaiting,
    method,
    title: "Choose",
    options: mode === "other" ? ["A", "B", "Other"] : ["A", "B"],
    ...(timeout ? { timeout } : {}),
  });
}
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const command = JSON.parse(buffer.slice(0, index));
    buffer = buffer.slice(index + 1);
    if (command.type === "get_state") {
      initialization = command.id;
      if (process.argv.includes("startup")) ask();
      else if (process.argv.includes("hold-init")) send({ type: "initializing" });
      else state();
    } else if (command.type === "extension_ui_response") {
      if (command.id !== awaiting) process.exit(12);
      awaiting = undefined;
      if (mode === "other" && command.value === "Other") {
        ask(undefined, "input");
        continue;
      }
      answer = command.cancelled
        ? "Cancelled"
        : command.confirmed === undefined
          ? `Correlated ${command.value}`
          : command.confirmed
            ? "Confirmed"
            : "Declined";
      if (initialization) state();
      else {
        if (mode === "stoprace" && command.cancelled && sequence === 1) ask();
        send({ type: "agent_settled" });
      }
    } else if (command.type === "prompt") {
      send({ type: "response", id: command.id, success: true });
      mode = command.message;
      if (["ask", "expiry", "other", "confirm", "editor", "input", "stoprace"].includes(mode))
        ask(
          mode === "expiry" ? 30 : undefined,
          ["confirm", "editor", "input"].includes(mode) ? mode : "select",
        );
      else {
        if (mode === "paths") answer = "Updated **src/main.ts** and C:\\work\\app.ts; tests pass.";
        if (mode === "malicious") {
          for (let i = 0; i < 2000; i++)
            send({
              type: "tool_execution_update",
              toolName: "bash",
              args: { command: "raw-prompt" },
              partialResult: { content: [{ type: "text", text: "secret-canary" }] },
            });
          send({
            type: "message_update",
            assistantMessageEvent: { type: "thinking_delta", delta: "private-canary" },
          });
          send({
            type: "message_end",
            message: { role: "toolResult", content: [{ type: "text", text: "stack-canary" }] },
          });
          answer = "token=secret-canary";
        }
        send({ type: "agent_settled" });
      }
    } else if (command.type === "get_last_assistant_text") {
      send({ type: "response", id: command.id, success: true, data: { text: answer } });
    } else if (command.type === "clear_queue") {
      send({ type: "response", id: command.id, success: true, data: { steering: [], followUp: [] } });
    } else if (command.type === "abort") {
      send({ type: "response", id: command.id, success: true });
    }
  }
});
function state() {
  send({
    type: "response",
    id: initialization,
    success: true,
    data: {
      sessionId: "same-external-session",
      model: process.argv.includes("no-model") ? null : { provider: "fake", id: "model" },
    },
  });
  initialization = undefined;
}
