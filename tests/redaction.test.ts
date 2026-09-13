import { describe, expect, it } from "vitest";
import { redactSensitive } from "../src/logging.js";

describe("redactSensitive", () => {
  it("redacts nested credentials and authorization headers", () => {
    expect(
      redactSensitive({
        token: "secret",
        nested: { password: "secret", authorization: "Bearer secret" },
        safe: "visible",
      }),
    ).toEqual({
      token: "[REDACTED]",
      nested: { password: "[REDACTED]", authorization: "[REDACTED]" },
      safe: "visible",
    });
  });

  it("handles arrays and circular values without throwing", () => {
    const input: Record<string, unknown> = { apiKey: "secret", values: ["safe"] };
    input.self = input;

    expect(redactSensitive(input)).toEqual({
      apiKey: "[REDACTED]",
      values: ["safe"],
      self: "[Circular]",
    });
  });
});
