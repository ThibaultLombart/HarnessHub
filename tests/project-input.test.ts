import { describe, expect, it } from "vitest";
import { InvalidProjectInputError, parseRepositoryUrl, projectSlug } from "../src/domain/project.js";

describe("project input", () => {
  it("creates stable Discord-safe slugs", () => {
    expect(projectSlug("  Démo Project  ")).toBe("demo-project");
  });

  it.each(["", "line\nbreak", "x".repeat(101)])("rejects invalid project name %j", (name) => {
    expect(() => projectSlug(name)).toThrow(InvalidProjectInputError);
  });

  it.each(["../escape", "/absolute", "--upload-pack=evil", "x\0y"])(
    "rejects unsafe repository URL %j",
    (url) => {
      expect(() => parseRepositoryUrl(url)).toThrow(InvalidProjectInputError);
    },
  );

  it.each([
    "https://user:secret@example.com/org/repo.git",
    "https://example.com/org/repo.git?token=secret",
    "ssh://git:secret@example.com/org/repo.git",
  ])("rejects credentials embedded in repository URL %s", (url) => {
    expect(() => parseRepositoryUrl(url)).toThrow(/credentials/i);
  });

  it.each([
    "https://github.com/example/repo.git",
    "ssh://git@github.com/example/repo.git",
    "git@github.com:example/repo.git",
  ])("accepts supported repository URL %s", (url) => {
    expect(parseRepositoryUrl(url)).toBe(url);
  });

  it("rejects non-HTTPS network protocols and local paths", () => {
    expect(() => parseRepositoryUrl("http://example.com/repo.git")).toThrow(InvalidProjectInputError);
    expect(() => parseRepositoryUrl("file:///tmp/repo.git")).toThrow(InvalidProjectInputError);
  });
});
