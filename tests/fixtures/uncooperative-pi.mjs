import { spawn } from "node:child_process";
import readline from "node:readline";
process.on("SIGTERM", () => undefined);
const child = spawn(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    `
  process.on("SIGTERM", () => undefined);
  process.send("ready");
  setInterval(() => {}, 1000);
`,
  ],
  { stdio: ["ignore", "ignore", "ignore", "ipc"] },
);
await new Promise((resolve) => child.once("message", resolve));
for await (const line of readline.createInterface({ input: process.stdin })) {
  const command = JSON.parse(line);
  process.stdout.write(
    `${JSON.stringify({ type: "response", id: command.id, success: true, data: { sessionId: "uncooperative", parentPid: process.pid, childPid: child.pid } })}\n`,
  );
}
// Closed stdin is not cooperation: keep the process alive until force-killed.
setInterval(() => {}, 1000);
