const versionMode = process.argv.includes("--version");
if (versionMode) {
  process.stdout.write("9.9.9\n");
  process.exit(0);
}

const installIndex = process.argv.indexOf("install");
const removeIndex = process.argv.indexOf("remove");
if (installIndex >= 0 || removeIndex >= 0) {
  const operationIndex = installIndex >= 0 ? installIndex : removeIndex;
  const operation = process.argv[operationIndex];
  const source = process.argv.at(-1);
  if (source?.includes("fail") === true) process.exit(3);
  process.stdout.write(
    `${JSON.stringify({ operation, args: process.argv.slice(operationIndex + 1), cwd: process.cwd() })}\n`,
  );
  process.exit(0);
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).replace(/\r$/, "");
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    const command = JSON.parse(line);
    if (command.type === "get_state") {
      send({
        id: command.id,
        type: "response",
        command: "get_state",
        success: true,
        data: {
          sessionId: "fake-session",
          sessionFile: "/tmp/fake.jsonl",
          model: { provider: "fake", id: "model" },
          isStreaming: false,
        },
      });
    } else if (command.type === "prompt") {
      send({ id: command.id, type: "response", command: "prompt", success: true });
      send({ type: "agent_start" });
      send({ type: "turn_start" });
      send({ type: "message_start", message: { role: "assistant" } });
      send({ type: "tool_execution_start", toolName: "read", toolCallId: "tool-1", args: {} });
      send({ type: "tool_execution_update", toolName: "read", toolCallId: "tool-1", partialResult: {} });
      if (command.message === "crash") {
        process.exit(2);
      } else if (command.message !== "slow") {
        send({
          type: "tool_execution_end",
          toolName: "read",
          toolCallId: "tool-1",
          result: {},
          isError: false,
        });
        send({ type: "message_end", message: { role: "assistant" } });
        send({ type: "agent_settled" });
      }
    } else if (command.type === "get_last_assistant_text") {
      send({
        id: command.id,
        type: "response",
        command: "get_last_assistant_text",
        success: true,
        data: { text: "Fake answer" },
      });
    } else if (command.type === "abort") {
      send({ id: command.id, type: "response", command: "abort", success: true });
    } else if (command.type === "set_model") {
      send({
        id: command.id,
        type: "response",
        command: "set_model",
        success: command.provider === "fake" && command.modelId === "model",
        data: { provider: command.provider, id: command.modelId },
      });
    } else if (command.type === "get_available_models") {
      send({
        id: command.id,
        type: "response",
        command: "get_available_models",
        success: true,
        data: {
          models: [
            { provider: "fake", id: "model", name: "Fake Model" },
            { provider: "other", id: "small" },
          ],
        },
      });
    }
  }
});

function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
