import { describe, expect, it } from "vitest";
import { InvalidModelInputError, parseModelPattern } from "../src/domain/model.js";

describe("model input", () => {
  it.each(["anthropic/claude-sonnet-4-5", "openai/gpt-4o", "google/gemini-2.5-pro", "anthropic/sonnet:high"])(
    "accepts model pattern %s",
    (pattern) => {
      expect(parseModelPattern(pattern).pattern).toBe(pattern);
    },
  );

  it.each(["", "gpt-4o", "openai/", "/gpt", "openai/gpt 4", "--model", "openai/gpt/extra", "https://x/y"])(
    "rejects invalid model pattern %s",
    (pattern) => {
      expect(() => parseModelPattern(pattern)).toThrow(InvalidModelInputError);
    },
  );
});
