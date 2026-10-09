import { describe, expect, it } from "vitest";
import { createLogger, redactSensitive } from "../src/logging.js";

describe("redactSensitive", () => {
  it("redacts real logger output and child bindings without losing error diagnostics", () => {
    const lines: string[] = [];
    const logger = createLogger("info", {
      write: (line: string) => {
        lines.push(line);
      },
    });
    const payload = {
      nested: { token: "FAKE_NESTED", config: { discordToken: "FAKE_DISCORD" } },
      safe: "visible",
    };
    logger.info(payload);
    logger.child({ identity: { refreshToken: "FAKE_REFRESH" } }).error({
      err: new Error("Bearer FAKE_BEARER", { cause: new Error("https://example.test/?token=FAKE_QUERY") }),
    });
    const output = lines.join("");
    for (const secret of ["FAKE_NESTED", "FAKE_DISCORD", "FAKE_REFRESH", "FAKE_BEARER", "FAKE_QUERY"]) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain("visible");
    expect(output).toContain("Bearer [REDACTED]");
    expect(output).toContain("cause");
    expect(payload.nested.token).toBe("FAKE_NESTED");
  });
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
