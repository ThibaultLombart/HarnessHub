import type { HarnessEvent } from "./harness.js";

export type Clock = () => number;

export type ProgressTool = Readonly<{
  name: string;
  failed: boolean;
}>;

export class SessionProgress {
  private readonly startedAt: number;
  private lastActivityAt: number;
  private phase = "starting";
  private activeTool: string | undefined;
  private activeToolStartedAt: number | undefined;
  private readonly recentTools: ProgressTool[] = [];
  private toolUpdateCount = 0;
  private turnCount = 0;
  private completedToolCount = 0;
  private failedToolCount = 0;
  private retryCount = 0;
  private compactionCount = 0;

  public constructor(private readonly clock: Clock = () => Date.now()) {
    this.startedAt = this.clock();
    this.lastActivityAt = this.startedAt;
  }

  public record(event: HarnessEvent): void {
    this.lastActivityAt = this.clock();
    if (event.type === "working" || event.type === "agent-start") {
      this.phase = "working";
      return;
    }
    if (event.type === "model-selected") return;
    if (event.type === "turn-start") {
      this.turnCount += 1;
      this.phase = this.completedToolCount === 0 ? "analyzing the request" : "planning the next step";
      this.activeTool = undefined;
      this.activeToolStartedAt = undefined;
      return;
    }
    if (event.type === "message-start") {
      this.phase = this.completedToolCount === 0 ? "analyzing the request" : "reviewing the work so far";
      return;
    }
    if (event.type === "message-end") {
      this.phase = "deciding the next action";
      return;
    }
    if (event.type === "tool-start") {
      this.activeTool = sanitizeLabel(event.toolName);
      this.activeToolStartedAt = this.clock();
      this.phase = describeTool(this.activeTool);
      this.toolUpdateCount = 0;
      return;
    }
    if (event.type === "tool-update") {
      this.activeTool = sanitizeLabel(event.toolName);
      this.activeToolStartedAt ??= this.clock();
      this.phase = describeTool(this.activeTool);
      this.toolUpdateCount += 1;
      return;
    }
    if (event.type === "tool-end") {
      const name = sanitizeLabel(event.toolName);
      this.completedToolCount += 1;
      if (event.failed) this.failedToolCount += 1;
      this.phase = event.failed ? "recovering from a failed action" : "checking the result";
      this.activeTool = undefined;
      this.activeToolStartedAt = undefined;
      this.toolUpdateCount = 0;
      this.recentTools.unshift({ name, failed: event.failed });
      this.recentTools.splice(5);
      return;
    }
    if (event.type === "compaction-start") {
      this.compactionCount += 1;
      this.phase = "compacting context to continue safely";
      this.activeTool = undefined;
      this.activeToolStartedAt = undefined;
      return;
    }
    if (event.type === "compaction-end") {
      this.phase = "context compacted";
      return;
    }
    if (event.type === "retry-start") {
      this.retryCount += 1;
      this.phase = "retrying after a temporary provider error";
      this.activeTool = undefined;
      this.activeToolStartedAt = undefined;
      return;
    }
    if (event.type === "retry-end") {
      this.phase = event.failed ? "retry failed" : "retry completed";
      return;
    }
    if (event.type === "settled") {
      this.phase = "finalizing the response";
      this.activeTool = undefined;
      this.activeToolStartedAt = undefined;
      return;
    }
    this.phase = "failed";
    this.activeTool = undefined;
  }

  public render(options: { stalledAfterMs: number; now?: number } = { stalledAfterMs: 120_000 }): string {
    const now = options.now ?? this.clock();
    const idleFor = Math.max(0, now - this.lastActivityAt);
    const failed = this.failedToolCount === 0 ? "" : ` · ${String(this.failedToolCount)} failed`;
    const retries = this.retryCount === 0 ? "" : ` · ${countLabel(this.retryCount, "retry", "retries")}`;
    const compactions =
      this.compactionCount === 0 ? "" : ` · ${countLabel(this.compactionCount, "compaction")}`;
    const lines = [
      "Pi is working…",
      `Stage: ${this.phase}`,
      `Progress: ${countLabel(this.turnCount, "turn")} · ${countLabel(this.completedToolCount, "action")} completed${failed}${retries}${compactions}`,
    ];
    if (this.activeTool !== undefined) {
      const runningFor = Math.max(0, now - (this.activeToolStartedAt ?? now));
      lines.push(
        `Now: ${describeTool(this.activeTool)} (${this.activeTool}) · running ${formatDuration(runningFor)}${this.toolUpdateCount > 0 ? ` · ${String(this.toolUpdateCount)} progress updates` : ""}`,
      );
    }
    lines.push(
      `Timing: ${formatDuration(now - this.startedAt)} elapsed · last activity ${formatDuration(idleFor)} ago`,
    );
    if (this.recentTools.length > 0) {
      lines.push(
        `Recent actions: ${this.recentTools
          .map((tool) => `${tool.name} ${tool.failed ? "✗" : "✓"}`)
          .join(", ")}`,
      );
    }
    if (idleFor >= options.stalledAfterMs) {
      lines.push("⚠️ No Pi event recently; it may be stalled or running a long operation.");
    }
    return lines.join("\n");
  }
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${String(count)} ${count === 1 ? singular : plural}`;
}

function describeTool(toolName: string): string {
  const normalized = toolName.toLowerCase();
  if (["read", "ls", "glob"].some((name) => normalized.includes(name))) return "inspecting project files";
  if (["grep", "search", "find", "rg"].some((name) => normalized.includes(name)))
    return "searching the codebase";
  if (["edit", "write", "patch"].some((name) => normalized.includes(name))) return "modifying project files";
  if (["test", "check", "lint"].some((name) => normalized.includes(name))) return "running validation checks";
  if (["web", "fetch", "browser"].some((name) => normalized.includes(name)))
    return "consulting external documentation";
  if (normalized.includes("bash") || normalized.includes("shell")) return "running a project command";
  return "performing a project action";
}

function sanitizeLabel(value: string): string {
  return (
    value
      .replace(/[\r\n\0]/g, " ")
      .trim()
      .slice(0, 80) || "unknown"
  );
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60)
    return remainingSeconds === 0
      ? `${String(minutes)}m`
      : `${String(minutes)}m ${String(remainingSeconds)}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0 ? `${String(hours)}h` : `${String(hours)}h ${String(remainingMinutes)}m`;
}
