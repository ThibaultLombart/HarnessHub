import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const cli = process.argv[2];
const args = process.argv.slice(3);
const searchPath = process.env.PATH;
for (const name of Object.keys(process.env)) delete process.env[name];
process.env.PATH = searchPath;
process.env.HOME = process.cwd();
process.env.PI_CODING_AGENT_DIR = path.join(process.cwd(), "isolated-agent");
process.env.PI_SKIP_VERSION_CHECK = "1";
if (args.includes("--hh-startup")) process.env.HH_STARTUP_DIALOG = "1";
const extensions = path.join(process.env.PI_CODING_AGENT_DIR, "extensions");
fs.mkdirSync(extensions, { recursive: true });
fs.copyFileSync(path.join(import.meta.dirname, "real-pi-dialogs.mjs"), path.join(extensions, "dialogs.ts"));
process.argv = [
  process.execPath,
  cli,
  "--no-skills",
  "--no-prompt-templates",
  "--no-themes",
  "--no-context-files",
  "--no-tools",
  ...args.filter((arg) => arg !== "--hh-startup"),
];
await import(pathToFileURL(cli).href);
