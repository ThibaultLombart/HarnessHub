import { describe, expect, it } from "vitest";
import { ResourceProjectRequiredError } from "../src/application/manage-resources.js";
import {
  safeDiscordError,
  splitDiscordMessage,
  splitDiscordMessageWithModelFooter,
  withModelFooter,
} from "../src/infrastructure/discord/discord-bot.js";

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

  it("adds the actual model at the bottom of every Discord response chunk", () => {
    expect(withModelFooter("Pi is working…", "openai-codex/gpt-5.3-codex")).toBe(
      "Pi is working…\n\nModel used: openai-codex/gpt-5.3-codex",
    );
    const chunks = splitDiscordMessageWithModelFooter("a".repeat(40), "fake/model", 35);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.endsWith("Model used: fake/model") && chunk.length <= 35)).toBe(
      true,
    );
  });

  it("renders safe upload errors", () => {
    expect(safeDiscordError(new Error("Upload destination already exists"))).toBe(
      "Upload destination already exists",
    );
    expect(safeDiscordError(new Error("Upload path must stay inside the project"))).toBe(
      "Upload path must stay inside the project",
    );
  });

  it("renders safe resource management errors", () => {
    expect(safeDiscordError(new ResourceProjectRequiredError())).toBe(
      "This resource operation requires a project channel",
    );
  });

  it("explains the Discord permissions required by workspace setup", () => {
    const error = Object.assign(new Error("Missing Permissions"), { code: 50_013 });
    expect(safeDiscordError(error)).toBe(
      "HarnessHub needs the Discord permissions Manage Channels and Manage Roles to set up its private workspace.",
    );
  });
});
