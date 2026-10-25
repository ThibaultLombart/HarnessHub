import { describe, expect, it } from "vitest";
import { SessionProgress } from "../src/domain/session-progress.js";
import { withModelFooter } from "../src/infrastructure/discord/model-footer.js";

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
  it("bounds escaped progress including the worst valid model footer, preserving lifecycle and honest omissions", () => {
    const progress = new SessionProgress(() => 1_000_000);
    const model = `${"_".repeat(39)}:`.repeat(4);
    progress.record({ type: "turn-start" });
    for (let index = 0; index < 5; index++)
      progress.record({ type: "tool-end", toolName: "bash", failed: true });
    progress.record({ type: "retry-start" });
    progress.record({ type: "compaction-start" });
    progress.record({ type: "tool-start", toolName: "bash" });
    progress.record({ type: "public-explanation", text: "*".repeat(500) });
    progress.record({
      type: "subagents",
      agents: Array.from({ length: 8 }, () => ({
        role: "reviewer",
        status: "needs_attention",
        startedAt: 0,
      })),
    });
    const maximum = 2000 - withModelFooter("", model).length;
    const body = progress.render({ stalledAfterMs: 0, maximum });
    const final = withModelFooter(body, model);
    expect(final.length).toBeLessThanOrEqual(2000);
    expect(final).toContain("Stage: running a project command");
    expect(final).toContain("1 turn · 5 actions completed · 5 failed · 1 retry · 1 compaction");
    expect(final).toContain("Now: running a project command");
    expect(final).toContain("No Pi event recently");
    expect(final).toContain("omitted");
    expect(final).toContain(withModelFooter("", model));
    expect(progress.render({ stalledAfterMs: 0, maximum })).toBe(body);
  });
  it("renders the current observable Pi step without leaking tool details", () => {
    const [clock, setNow] = controllableClock();
    const progress = new SessionProgress(clock);

    progress.record({ type: "tool-start", toolName: "bash" });
    progress.record({ type: "tool-update", toolName: "bash" });
    setNow(12_000);

    const rendered = progress.render({ stalledAfterMs: 120_000 });
    expect(rendered).toContain("Stage: running a project command");
    expect(rendered).toContain("Progress: 0 turns · 0 actions completed");
    expect(rendered).toContain("Now: running a project command (bash) · running 12s · 1 progress updates");
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
  it("shows waiting, public explanations and genuine subagent states without treating attention as failure", () => {
    const progress = new SessionProgress(() => 10_000);
    progress.record({
      type: "subagents",
      agents: [{ role: "reviewer", status: "needs_attention", startedAt: 5_000 }],
    });
    progress.record({ type: "public-explanation", text: "Checking the result" });
    progress.record({
      type: "ui-request",
      sessionId: "s",
      request: { id: "q", method: "input", title: "Question", message: "", options: [], expiresAt: 20_000 },
    });
    const text = progress.render();
    expect(text).toContain("waiting for your response");
    expect(text).toContain("reviewer: needs\\_attention · 5s");
    expect(text).toContain("Checking the result");
    expect(text).not.toContain("Stage: failed");
    progress.record({ type: "ui-closed", sessionId: "s", requestId: "q" });
    expect(progress.render()).not.toContain("waiting for your response");
  });
  it("never displays arbitrary tool labels or infers hidden mental activity", () => {
    const progress = new SessionProgress();
    progress.record({ type: "turn-start" });
    expect(progress.render()).not.toMatch(/analyzing|planning|deciding/);
    progress.record({ type: "tool-start", toolName: "bash token=private" });
    expect(progress.render()).not.toContain("private");
  });
});
