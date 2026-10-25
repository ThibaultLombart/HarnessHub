import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";

const source = "/var/lib/harnesshub/pi-agent/extensions/ask-user-question.ts";
type Tool = {
  name: string;
  execute(
    id: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: Record<string, unknown>,
  ): Promise<{ details: { status: string; answers: { value: string }[] } }>;
};

describe("installed question tool RPC branch (no credentials or provider)", () => {
  it.skipIf(!fs.existsSync(source))(
    "loads through the actual Pi loader and executes both RPC aliases without TUI/bridge",
    async () => {
      // Pi's own loader supports legacy package names; plain Node import does not.
      const loaderPath =
        "/var/lib/harnesshub/tools/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";
      const module: unknown = await import(loaderPath);
      const loader = module as {
        loadExtensions(
          paths: string[],
          cwd: string,
        ): Promise<{ errors: unknown[]; extensions: { tools: Map<string, { definition: Tool }> }[] }>;
      };
      const loaded = await loader.loadExtensions([source], process.cwd());
      expect(loaded.errors).toEqual([]);
      const tools = loaded.extensions.flatMap((extension) =>
        [...extension.tools.values()].map((tool) => tool.definition),
      );
      expect(tools.map((tool) => tool.name)).toEqual(["ask_user_question", "ask_question"]);
      for (const tool of tools) {
        const select = vi.fn(async () => "Other");
        const input = vi.fn(async () => "Custom answer");
        const custom = vi.fn(() => {
          throw new Error("TUI/bridge path must not execute");
        });
        const signal = new AbortController().signal;
        const ctx = { mode: "rpc", hasUI: true, ui: { select, input, custom } };
        const result = await tool.execute(
          "test",
          { question: "Update src/main.ts?", options: [{ label: "Keep", value: "keep" }] },
          signal,
          undefined,
          ctx,
        );
        expect(result.details).toMatchObject({ status: "answered", answers: [{ value: "Custom answer" }] });
        expect(select).toHaveBeenCalledWith("Update src/main.ts?", ["Keep", "Other"], { signal });
        expect(input).toHaveBeenCalledWith("Update src/main.ts?\n\nCustom answer", "Enter your answer", {
          signal,
        });
        expect(custom).not.toHaveBeenCalled();
        const cancelled = await tool.execute("cancel", { question: "Answer?" }, undefined, undefined, {
          ...ctx,
          ui: { ...ctx.ui, input: async () => undefined },
        });
        expect(cancelled.details.status).toBe("cancelled");
      }
    },
  );
});
