import { describe, expect, it } from "vitest";
import { InvalidJobTransitionError, transitionJob } from "../src/domain/job.js";

describe("transitionJob", () => {
  it.each([
    ["queued", "running"],
    ["queued", "cancelled"],
    ["running", "succeeded"],
    ["running", "failed"],
    ["running", "cancelled"],
  ] as const)("allows %s -> %s", (from, to) => {
    expect(transitionJob(from, to)).toBe(to);
  });

  it.each([
    ["queued", "succeeded"],
    ["succeeded", "running"],
    ["failed", "running"],
    ["cancelled", "running"],
  ] as const)("rejects %s -> %s", (from, to) => {
    expect(() => transitionJob(from, to)).toThrow(InvalidJobTransitionError);
  });
});
