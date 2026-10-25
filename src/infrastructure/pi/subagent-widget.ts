import { type SubagentStatus } from "../../domain/live-interface.js";

/** Pi 0.85.1 RPC setWidget envelope, including content=undefined to clear. */
export function decodeSubagentWidget(event: Readonly<Record<string, unknown>>): SubagentStatus[] | undefined {
  if (event.method !== "setWidget" || event.widgetKey !== "subagent-async") return undefined;
  if (event.widgetLines === undefined) return [];
  if (!Array.isArray(event.widgetLines)) return undefined;
  const line: unknown = event.widgetLines[0];
  const prefix = "PI_SUBAGENT_ASYNC_JSON:";
  if (typeof line !== "string" || line.length > 40_000 || !line.startsWith(prefix)) return undefined;
  try {
    const snapshot: unknown = JSON.parse(line.slice(prefix.length));
    return projectSubagents(snapshot);
  } catch {
    return undefined;
  }
}

/** Only the documented current-process/session widget; no artifact discovery. */
export function projectSubagents(value: unknown): SubagentStatus[] {
  const snapshot = record(value);
  if (snapshot.kind !== "pi-subagents.async-status-snapshot" || snapshot.version !== 1) return [];
  const result: SubagentStatus[] = [];
  const visit = (nodes: unknown, depth: number): void => {
    if (!Array.isArray(nodes) || depth > 3) return;
    for (const raw of nodes.slice(0, 20)) {
      if (result.length >= 20) return;
      const node = record(raw);
      if (["subagent", "workflow", "step"].includes(String(node.kind))) {
        const label = typeof node.label === "string" ? node.label : "";
        // Labels can be workflow task text. Only known role identifiers are public.
        const role = [
          "scout",
          "researcher",
          "worker",
          "reviewer",
          "oracle",
          "delegate",
          "evidence-auditor",
        ].includes(label)
          ? label
          : "subagent";
        const status =
          record(node.activity).state === "needs_attention"
            ? "needs_attention"
            : typeof node.state === "string" &&
                [
                  "queued",
                  "running",
                  "complete",
                  "failed",
                  "partial",
                  "paused",
                  "stopped",
                  "rejected",
                ].includes(node.state)
              ? node.state
              : "unknown";
        result.push({
          role,
          status,
          ...(validTime(node.startedAt) ? { startedAt: node.startedAt } : {}),
          ...(validTime(node.endedAt) ? { endedAt: node.endedAt } : {}),
        });
      }
      visit(node.children, depth + 1);
    }
  };
  visit(snapshot.runs, 0);
  return result;
}
function validTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Date.now() + 60_000;
}

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
