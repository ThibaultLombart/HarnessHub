import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectFiles } from "../src/infrastructure/project-files.js";

const roots: string[] = [];
function temporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harnesshub-project-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("ProjectFiles", () => {
  it("atomically initializes a real Git repository inside the workspace", async () => {
    const root = temporaryRoot();
    const target = path.join(root, "demo");
    const files = await ProjectFiles.create(root);

    await files.createEmptyGitProject(target);

    expect(fs.statSync(target).isDirectory()).toBe(true);
    expect(
      execFileSync("git", ["-C", target, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" }).trim(),
    ).toBe("true");
  });

  it("clones a controlled real repository without a shell", async () => {
    const sourceRoot = temporaryRoot();
    const source = path.join(sourceRoot, "source");
    fs.mkdirSync(source);
    execFileSync("git", ["init", source]);
    fs.writeFileSync(path.join(source, "README.md"), "fixture");
    execFileSync("git", [
      "-C",
      source,
      "-c",
      "user.name=HarnessHub Test",
      "-c",
      "user.email=test@example.invalid",
      "add",
      "README.md",
    ]);
    execFileSync("git", [
      "-C",
      source,
      "-c",
      "user.name=HarnessHub Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-m",
      "fixture",
    ]);
    const root = temporaryRoot();
    const target = path.join(root, "clone");
    const files = await ProjectFiles.create(root);

    await files.cloneProject(source, target);

    expect(fs.readFileSync(path.join(target, "README.md"), "utf8")).toBe("fixture");
  });

  it("rejects destinations outside the canonical workspace", async () => {
    const root = temporaryRoot();
    const files = await ProjectFiles.create(root);

    await expect(files.createEmptyGitProject(path.resolve(root, "..", "escape"))).rejects.toThrow(/outside/i);
  });

  it("does not overwrite an existing destination", async () => {
    const root = temporaryRoot();
    const target = path.join(root, "demo");
    fs.mkdirSync(target);
    const files = await ProjectFiles.create(root);

    await expect(files.createEmptyGitProject(target)).rejects.toThrow(/already exists/i);
  });
});
