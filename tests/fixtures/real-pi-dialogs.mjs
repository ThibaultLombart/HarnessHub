import fs from "node:fs";
import path from "node:path";
export default function (pi) {
  pi.on("session_start", async (_event, ctx) => {
    fs.writeFileSync(path.join(process.cwd(), "extension-started"), "started");
    fs.writeFileSync(path.join(process.cwd(), "runtime-pid"), String(process.pid));
    if (process.env.HH_STARTUP_DIALOG === "1")
      await ctx.ui.confirm("Startup approval", "Do not expose unsupported controls");
  });
  pi.on("input", async (event) => {
    if (event.text === "hh ordinary handled") {
      fs.writeFileSync(path.join(process.cwd(), "input-handled"), "handled");
      return { action: "handled" };
    }
  });
  pi.registerCommand("hh-dialog-test", {
    handler: async (_args, ctx) => {
      fs.writeFileSync(path.join(process.cwd(), "inline-executed"), "executed");
      const selected = await ctx.ui.select("Choose", ["First", "Other"], { timeout: 5000 });
      const input = await ctx.ui.input("Custom answer", "unused", { timeout: 5000 });
      const confirmed = await ctx.ui.confirm("Confirm", "Use this answer?", { timeout: 5000 });
      const edited = await ctx.ui.editor("Edit", "private prefill not to display");
      if (selected !== "Other" || input !== "Custom answer" || !confirmed || edited !== "Edited answer")
        throw new Error("Dialog correlation failed");
      ctx.ui.notify("Fixture completed", "info");
    },
  });
}
