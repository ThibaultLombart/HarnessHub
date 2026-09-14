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
  private readonly recentTools: ProgressTool[] = [];
  private toolUpdateCount = 0;

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
      this.phase = "planning next step";
      this.activeTool = undefined;
      return;
    }
    if (event.type === "message-start") {
      this.phase = "thinking";
      return;
    }
    if (event.type === "message-end") {
      this.phase = "message ready";
      return;
    }
    if (event.type === "tool-start") {
      this.phase = "using tool";
      this.activeTool = sanitizeLabel(event.toolName);
      this.toolUpdateCount = 0;
      return;
    }
    if (event.type === "tool-update") {
      this.phase = "tool still running";
      this.activeTool = sanitizeLabel(event.toolName);
      this.toolUpdateCount += 1;
      return;
    }
    if (event.type === "tool-end") {
      const name = sanitizeLabel(event.toolName);
      this.phase = event.failed ? "tool failed; continuing" : "tool completed";
      this.activeTool = undefined;
      this.toolUpdateCount = 0;
      this.recentTools.unshift({ name, failed: event.failed });
      this.recentTools.splice(5);
      return;
    }
    if (event.type === "compaction-start") {
      this.phase = "compacting context";
      this.activeTool = undefined;
      return;
    }
    if (event.type === "compaction-end") {
      this.phase = "context compacted";
      return;
    }
    if (event.type === "retry-start") {
      this.phase = "retrying after transient error";
      this.activeTool = undefined;
      return;
    }
    if (event.type === "retry-end") {
      this.phase = event.failed ? "retry failed" : "retry completed";
      return;
    }
    if (event.type === "settled") {
      this.phase = "settled";
      this.activeTool = undefined;
      return;
    }
    this.phase = "failed";
    this.activeTool = undefined;
  }

  public render(options: { stalledAfterMs: number; now?: number } = { stalledAfterMs: 120_000 }): string {
    const now = options.now ?? this.clock();
    const idleFor = Math.max(0, now - this.lastActivityAt);
    const lines = [
      "Pi is working…",
      `Phase: ${this.phase}`,
      `Elapsed: ${formatDuration(now - this.startedAt)} · Last Pi event: ${formatDuration(idleFor)} ago`,
    ];
    if (this.activeTool !== undefined) {
      lines.push(
        `Current tool: ${this.activeTool}${this.toolUpdateCount > 0 ? ` (${String(this.toolUpdateCount)} updates)` : ""}`,
      );
    }
    if (this.recentTools.length > 0) {
      lines.push(
        `Recent tools: ${this.recentTools
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
