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
  it("accepts a direct project child reached through a workspace root alias", async () => {
    const root = temporaryRoot();
    const aliasParent = temporaryRoot();
    const workspaceAlias = path.join(aliasParent, "workspace-alias");
    createDirectoryLink(root, workspaceAlias);
    const target = path.join(workspaceAlias, "demo");
    const files = await ProjectFiles.create(workspaceAlias);

    await files.createEmptyGitProject(target);

    expect(fs.statSync(path.join(root, "demo")).isDirectory()).toBe(true);
  });

  it.each([
    ["workspace root itself", (root: string) => root],
    ["outside the workspace", (root: string) => path.resolve(root, "..", "escape")],
    ["nested below a project child", (root: string) => path.join(root, "demo", "nested")],
    [
      "traversal back into a nested project child",
      (root: string) => path.join(root, "demo", "..", "demo", "nested"),
    ],
  ])(
    "rejects project destination that is not a direct workspace child: %s",
    async (_name, destinationFor) => {
      const root = temporaryRoot();
      const files = await ProjectFiles.create(root);

      await expect(files.createEmptyGitProject(destinationFor(root))).rejects.toThrow(/outside/i);
    },
  );

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

  it("writes uploaded files only inside a project without overwriting", async () => {
    const root = temporaryRoot();
    const files = await ProjectFiles.create(root);
    const projectPath = path.join(root, "demo");
    await files.createEmptyGitProject(projectPath);

    const written = await files.writeProjectFile({
      projectPath,
      relativePath: "docs/input.txt",
      content: new TextEncoder().encode("hello"),
      maximumBytes: 100,
    });

    expect(written).toBe(path.join(fs.realpathSync.native(projectPath), "docs", "input.txt"));
    expect(fs.readFileSync(written, "utf8")).toBe("hello");
    await expect(
      files.writeProjectFile({
        projectPath,
        relativePath: "docs/input.txt",
        content: new TextEncoder().encode("again"),
        maximumBytes: 100,
      }),
    ).rejects.toThrow(/already exists/i);
  });

  it.each(["../escape.txt", "/absolute.txt", "line\nbreak.txt"])(
    "rejects unsafe upload path %s",
    async (relativePath) => {
      const root = temporaryRoot();
      const files = await ProjectFiles.create(root);
      const projectPath = path.join(root, "demo");
      await files.createEmptyGitProject(projectPath);

      await expect(
        files.writeProjectFile({
          projectPath,
          relativePath,
          content: new TextEncoder().encode("hello"),
          maximumBytes: 100,
        }),
      ).rejects.toThrow(/path|inside|invalid/i);
    },
  );

  it("rejects symlink escapes", async () => {
    const root = temporaryRoot();
    const outside = temporaryRoot();
    const files = await ProjectFiles.create(root);
    const projectPath = path.join(root, "demo");
    await files.createEmptyGitProject(projectPath);
    createDirectoryLink(outside, path.join(projectPath, "escape"));

    await expect(
      files.writeProjectFile({
        projectPath,
        relativePath: "escape/file.txt",
        content: new TextEncoder().encode("hello"),
        maximumBytes: 100,
      }),
    ).rejects.toThrow(/escape/i);
  });

  it("rejects upload escapes through directory links before creating external subdirectories", async () => {
    const root = temporaryRoot();
    const outside = temporaryRoot();
    const files = await ProjectFiles.create(root);
    const projectPath = path.join(root, "demo");
    await files.createEmptyGitProject(projectPath);
    createDirectoryLink(outside, path.join(projectPath, "escape"));

    await expect(
      files.writeProjectFile({
        projectPath,
        relativePath: "escape/created-outside/file.txt",
        content: new TextEncoder().encode("hello"),
        maximumBytes: 100,
      }),
    ).rejects.toThrow(/escape/i);

    expect(fs.existsSync(path.join(outside, "created-outside"))).toBe(false);
  });

  it("rejects uploads when the project directory itself is a link escaping the workspace", async () => {
    const root = temporaryRoot();
    const outside = temporaryRoot();
    const files = await ProjectFiles.create(root);
    const projectPath = path.join(root, "linked-project");
    createDirectoryLink(outside, projectPath);

    await expect(
      files.writeProjectFile({
        projectPath,
        relativePath: "file.txt",
        content: new TextEncoder().encode("hello"),
        maximumBytes: 100,
      }),
    ).rejects.toThrow(/outside|escape/i);

    expect(fs.existsSync(path.join(outside, "file.txt"))).toBe(false);
  });
});

function createDirectoryLink(target: string, linkPath: string): void {
  fs.symlinkSync(target, linkPath, process.platform === "win32" ? "junction" : "dir");
}
