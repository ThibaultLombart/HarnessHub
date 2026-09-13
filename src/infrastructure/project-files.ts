import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const executeFile = promisify(execFile);

export class ProjectFiles {
  private constructor(private readonly canonicalRoot: string) {}

  public static async create(workspaceRoot: string): Promise<ProjectFiles> {
    await fs.mkdir(workspaceRoot, { recursive: true, mode: 0o700 });
    return new ProjectFiles(await fs.realpath(workspaceRoot));
  }

  public async createEmptyGitProject(destination: string): Promise<void> {
    await this.createAtomically(destination, async (temporary) => {
      await this.runGit(["init", "--", temporary]);
    });
  }

  public async cloneProject(repositoryUrl: string, destination: string): Promise<void> {
    await this.createAtomically(destination, async (temporary) => {
      await this.runGit([
        "-c",
        "core.sshCommand=ssh -o BatchMode=yes -o StrictHostKeyChecking=yes",
        "clone",
        "--no-recurse-submodules",
        "--",
        repositoryUrl,
        temporary,
      ]);
    });
  }

  public async removeProject(destination: string): Promise<void> {
    this.assertInsideRoot(destination);
    await fs.rm(destination, { recursive: true, force: true });
  }

  private async createAtomically(
    destination: string,
    populate: (temporary: string) => Promise<void>,
  ): Promise<void> {
    this.assertInsideRoot(destination);
    try {
      await fs.lstat(destination);
      throw new Error("Project destination already exists");
    } catch (error) {
      if (!isMissing(error)) throw error;
    }

    const temporary = path.join(this.canonicalRoot, `.harnesshub-${randomUUID()}`);
    await fs.mkdir(temporary, { mode: 0o700 });
    try {
      await populate(temporary);
      await fs.rename(temporary, destination);
    } catch (error) {
      await fs.rm(temporary, { recursive: true, force: true });
      throw error;
    }
  }

  private assertInsideRoot(destination: string): void {
    const resolved = path.resolve(destination);
    const relative = path.relative(this.canonicalRoot, resolved);
    if (
      relative === "" ||
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      path.dirname(resolved) !== this.canonicalRoot
    ) {
      throw new Error("Project destination is outside the workspace root");
    }
  }

  private async runGit(arguments_: readonly string[]): Promise<void> {
    await executeFile("git", [...arguments_], {
      windowsHide: true,
      timeout: 5 * 60_000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
