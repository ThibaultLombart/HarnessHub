import { describe, expect, it } from "vitest";
import { safeDiscordError, splitDiscordMessage } from "../src/infrastructure/discord/discord-bot.js";

describe("splitDiscordMessage", () => {
  it("keeps messages under the configured limit", () => {
    const chunks = splitDiscordMessage("a".repeat(25), 10);
    expect(chunks.map((chunk) => chunk.length)).toEqual([10, 10, 5]);
  });

  it("does not split a Unicode surrogate pair", () => {
    const chunks = splitDiscordMessage(`1234😀5678`, 5);
    expect(chunks.join("")).toBe("1234😀5678");
    expect(chunks[0]).toBe("1234");
  });

  it("explains the Discord permissions required by workspace setup", () => {
    const error = Object.assign(new Error("Missing Permissions"), { code: 50_013 });
    expect(safeDiscordError(error)).toBe(
      "HarnessHub needs the Discord permissions Manage Channels and Manage Roles to set up its private workspace.",
    );
  });
});
