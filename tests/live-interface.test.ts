import { describe, expect, it } from "vitest";
import { publicText } from "../src/domain/live-interface.js";
import { SessionProgress } from "../src/domain/session-progress.js";

describe("public content projection", () => {
  it("preserves useful paths, formatting and ordinary security explanations idempotently", () => {
    for (const text of [
      "Updated src/auth/login.ts and C:\\work\\app.ts; tests pass.",
      "Public **explanation** with `src/main.ts` and [docs](https://example.com/docs).",
      "The token refresh logic now handles expired credentials without logging secrets.",
    ]) {
      expect(publicText(text)).toBe(text);
      expect(publicText(publicText(text))).toBe(text);
    }
    const bounded = publicText("A short sentence. ".repeat(300), 100);
    expect(bounded.length).toBeLessThanOrEqual(100);
    expect(publicText(bounded, 100)).toBe(bounded);
  });
  it("suppresses known secret forms and private reasoning rather than relying on keywords", () => {
    for (const text of [
      "token=canary",
      '{"access_token":"canary"}',
      "DISCORD_TOKEN=canary",
      "https://canary@example.com/path",
      "https://example.com/?key=canary",
      "https://example.com/?sig=canary",
      "password: canary",
      "Authorization: Bearer canary",
      "https://user:canary@example.com/path",
      "https://example.com/?access_token=canary",
      "https://example.com/?X-Amz-Signature=canary",
      "sk-test12345678901234567890",
      "-----BEGIN PRIVATE KEY-----",
      "<think>canary</think>",
    ]) {
      expect(publicText(text)).toBe("[suppressed for privacy]");
      expect(publicText(publicText(text))).toBe("[suppressed for privacy]");
    }
  });
  it("escapes progress presentation only once, without erasing safe explanations", () => {
    const progress = new SessionProgress();
    progress.record({ type: "public-explanation", text: publicText("Updated **src/main.ts** safely") });
    expect(progress.render()).toContain("Public update: Updated \\*\\*src/main.ts\\*\\* safely");
    expect(progress.render()).not.toContain("suppressed");
  });
});
