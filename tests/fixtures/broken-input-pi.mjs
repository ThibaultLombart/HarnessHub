import fs from "node:fs";
fs.closeSync(0);
process.stdout.write(`${JSON.stringify({ type: "ready" })}\n`);
setInterval(() => undefined, 1000);
