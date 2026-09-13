import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseRepositoryUrl } from "../domain/project.js";
import type { Project } from "../domain/project.js";

const executeFile = promisify(execFile);

export type GitProjectStatus = Readonly<{
  branch: string;
  clean: boolean;
  remote: string | null;
}>;

export class GitRemoteAlreadyConfiguredError extends Error {
  public constructor() {
    super("Git remote origin is already configured");
    this.name = "GitRemoteAlreadyConfiguredError";
  }
}

export class GitOperations {
  public async status(project: Project): Promise<GitProjectStatus> {
    const [branch, porcelain, remote] = await Promise.all([
      gitOutput(["-C", project.path, "branch", "--show-current"]),
      gitOutput(["-C", project.path, "status", "--porcelain"]),
      gitOutput(["-C", project.path, "remote", "get-url", "origin"]).catch(() => null),
    ]);
    const currentBranch = branch.trim();
    const currentRemote = remote?.trim() ?? "";
    return {
      branch: currentBranch === "" ? "detached" : currentBranch,
      clean: porcelain === "",
      remote: currentRemote === "" ? null : currentRemote,
    };
  }

  public async linkRemote(project: Project, repositoryUrl: string): Promise<string> {
    const safeUrl = parseRepositoryUrl(repositoryUrl);
    const existing = await gitOutput(["-C", project.path, "remote", "get-url", "origin"]).catch(() => null);
    if (existing !== null && existing.trim() !== "") throw new GitRemoteAlreadyConfiguredError();
    await executeFile("git", ["-C", project.path, "remote", "add", "origin", safeUrl], {
      shell: false,
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return safeUrl;
  }
}

async function gitOutput(arguments_: readonly string[]): Promise<string> {
  return (
    await executeFile("git", [...arguments_], {
      shell: false,
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    })
  ).stdout;
}
