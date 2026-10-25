import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decodeSubagentWidget, projectSubagents } from "../src/infrastructure/pi/subagent-widget.js";

const extension = "/var/lib/harnesshub/pi-agent/npm/node_modules/pi-subagents";
const source = path.join(extension, "src/runs/background/async-status-snapshot.ts");

describe("installed pi-subagents widget contract (no agent/provider execution)", () => {
  it.skipIf(!fs.existsSync(source))(
    "decodes the actual encoder's session-scoped snapshot and preserves attention/unknown",
    async () => {
      const module: unknown = await import(source);
      const encoder = module as {
        encodeAsyncStatusSnapshotWidget(jobs: Iterable<Record<string, unknown>>): string[];
        buildAsyncStatusSnapshotForState(state: Record<string, unknown>, sessionId: string): unknown;
      };
      const job = {
        asyncId: "private-id",
        sessionId: "session",
        agents: ["reviewer"],
        status: "running",
        startedAt: 100,
        activityState: "needs_attention",
        output: "private-canary",
        task: "private-task",
      };
      const state = {
        currentSessionId: "session",
        asyncJobs: new Map([["private-id", job]]),
        fleetJobs: new Map(),
      };
      expect(projectSubagents(encoder.buildAsyncStatusSnapshotForState(state, "other"))).toEqual([]);
      const scoped = encoder.buildAsyncStatusSnapshotForState(state, "session");
      expect(projectSubagents(scoped)).toEqual([
        { role: "reviewer", status: "needs_attention", startedAt: 100 },
      ]);
      const line = encoder.encodeAsyncStatusSnapshotWidget([job])[0];
      expect(line?.startsWith("PI_SUBAGENT_ASYNC_JSON:")).toBe(true);
      const decoded: unknown = JSON.parse((line ?? "").slice("PI_SUBAGENT_ASYNC_JSON:".length));
      expect(projectSubagents(decoded)).toEqual(projectSubagents(scoped));
      expect(
        decodeSubagentWidget({ method: "setWidget", widgetKey: "subagent-async", widgetLines: [line] }),
      ).toEqual(projectSubagents(scoped));
      expect(JSON.stringify(projectSubagents(decoded))).not.toMatch(/private-/);
      expect(fs.readFileSync(path.join(extension, "src/tui/render.ts"), "utf8")).toContain(
        "ctx.ui.setWidget(WIDGET_KEY, encodeAsyncStatusSnapshotWidget(jobs))",
      );
      expect(fs.readFileSync(path.join(extension, "src/shared/types.ts"), "utf8")).toContain(
        'WIDGET_KEY = "subagent-async"',
      );
    },
  );
});
