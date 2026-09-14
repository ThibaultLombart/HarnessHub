import { describe, expect, it } from "vitest";
import { SessionProgress } from "../src/domain/session-progress.js";

function controllableClock(start = 0): [() => number, (value: number) => void] {
  let now = start;
  return [
    () => now,
    (value: number) => {
      now = value;
    },
  ];
}

describe("SessionProgress", () => {
  it("renders the current observable Pi step without leaking tool details", () => {
    const [clock, setNow] = controllableClock();
    const progress = new SessionProgress(clock);

    progress.record({ type: "tool-start", toolName: "bash\nsecret" });
    progress.record({ type: "tool-update", toolName: "bash\nsecret" });
    setNow(12_000);

    const rendered = progress.render({ stalledAfterMs: 120_000 });
    expect(rendered).toContain("Stage: running a project command");
    expect(rendered).toContain("Progress: 0 turns · 0 actions completed");
    expect(rendered).toContain(
      "Now: running a project command (bash secret) · running 12s · 1 progress updates",
    );
    expect(rendered).toContain("Timing: 12s elapsed · last activity 12s ago");
  });

  it("keeps a compact list of recent completed tools", () => {
    const progress = new SessionProgress(() => 0);

    progress.record({ type: "tool-end", toolName: "read", failed: false });
    progress.record({ type: "tool-end", toolName: "edit", failed: false });
    progress.record({ type: "tool-end", toolName: "bash", failed: true });

    const rendered = progress.render({ stalledAfterMs: 120_000 });
    expect(rendered).toContain("Progress: 0 turns · 3 actions completed · 1 failed");
    expect(rendered).toContain("Recent actions: bash ✗, edit ✓, read ✓");
  });

  it("tracks turns, retries, and context compactions without inventing a completion percentage", () => {
    const progress = new SessionProgress(() => 0);
    progress.record({ type: "turn-start" });
    progress.record({ type: "compaction-start" });
    progress.record({ type: "compaction-end" });
    progress.record({ type: "retry-start" });

    const rendered = progress.render({ stalledAfterMs: 120_000 });
    expect(rendered).toContain("Progress: 1 turn · 0 actions completed · 1 retry · 1 compaction");
    expect(rendered).not.toMatch(/\d+%/);
  });

  it("flags a potentially stalled session when Pi stops emitting events", () => {
    const [clock, setNow] = controllableClock();
    const progress = new SessionProgress(clock);
    progress.record({ type: "message-start" });

    setNow(121_000);

    expect(progress.render({ stalledAfterMs: 120_000 })).toContain("⚠️ No Pi event recently");
  });
});
