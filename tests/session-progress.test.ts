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

    expect(progress.render({ stalledAfterMs: 120_000 })).toContain("Current tool: bash secret (1 updates)");
    expect(progress.render({ stalledAfterMs: 120_000 })).toContain("Elapsed: 12s · Last Pi event: 12s ago");
  });

  it("keeps a compact list of recent completed tools", () => {
    const progress = new SessionProgress(() => 0);

    progress.record({ type: "tool-end", toolName: "read", failed: false });
    progress.record({ type: "tool-end", toolName: "edit", failed: false });
    progress.record({ type: "tool-end", toolName: "bash", failed: true });

    expect(progress.render({ stalledAfterMs: 120_000 })).toContain("Recent tools: bash ✗, edit ✓, read ✓");
  });

  it("flags a potentially stalled session when Pi stops emitting events", () => {
    const [clock, setNow] = controllableClock();
    const progress = new SessionProgress(clock);
    progress.record({ type: "message-start" });

    setNow(121_000);

    expect(progress.render({ stalledAfterMs: 120_000 })).toContain("⚠️ No Pi event recently");
  });
});
