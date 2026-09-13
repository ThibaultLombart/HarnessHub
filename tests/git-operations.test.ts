import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { GitOperations, GitRemoteAlreadyConfiguredError } from "../src/application/git-operations.js";
import type { Project } from "../src/domain/project.js";

const roots: string[] = [];
function repoProject(): Project {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harnesshub-git-"));
  roots.push(root);
  execFileSync("git", ["init"], { cwd: root });
  return {
    id: "project",
    workspaceId: "workspace",
    name: "Demo",
    slug: "demo",
    channelId: "channel",
    path: root,
    harnessId: "pi",
    gitRemote: null,
    createdAt: new Date().toISOString(),
    archivedAt: null,
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("GitOperations", () => {
  it("reports branch, cleanliness, and remote", async () => {
    const project = repoProject();
    await new GitOperations().linkRemote(project, "https://github.com/example/repo.git");

    await expect(new GitOperations().status(project)).resolves.toMatchObject({
      branch: "master",
      clean: true,
      remote: "https://github.com/example/repo.git",
    });
  });

  it("rejects unsafe or duplicate remote links", async () => {
    const project = repoProject();
    const git = new GitOperations();

    await expect(git.linkRemote(project, "https://user:secret@example.com/repo.git")).rejects.toThrow(
      /credentials/i,
    );
    await git.linkRemote(project, "git@github.com:example/repo.git");
    await expect(git.linkRemote(project, "https://github.com/example/other.git")).rejects.toThrow(
      GitRemoteAlreadyConfiguredError,
    );
  });
});
