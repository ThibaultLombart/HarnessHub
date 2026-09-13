import { describe, expect, it } from "vitest";
import { InvalidResourceInputError, parseResourceSource } from "../src/domain/resource.js";

describe("resource input", () => {
  it.each([
    "npm:@scope/pi-pack@1.2.3",
    "npm:pi-pack",
    "git:github.com/user/repo@v1",
    "git:git@github.com:user/repo@v1",
    "https://github.com/user/repo",
    "ssh://git@github.com/user/repo",
  ])("accepts supported Pi package source %s", (source) => {
    expect(parseResourceSource(source)).toBe(source);
  });

  it.each([
    "",
    "--bad",
    "npm:Bad Package",
    "git:../escape",
    "http://example.com/repo",
    "https://user:secret@example.com/repo",
    "https://example.com/repo?token=secret",
    "ssh://git:secret@example.com/repo",
    "file:///tmp/package",
  ])("rejects unsafe resource source %s", (source) => {
    expect(() => parseResourceSource(source)).toThrow(InvalidResourceInputError);
  });
});
