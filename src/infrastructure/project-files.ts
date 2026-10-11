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
    await this.assertDirectProjectChild(destination);
    await fs.rm(destination, { recursive: true, force: true });
  }

  public async writeProjectFile(input: {
    projectPath: string;
    relativePath: string;
    content: Uint8Array;
    maximumBytes: number;
  }): Promise<string> {
    if (input.content.byteLength > input.maximumBytes) throw new Error("Uploaded file is too large");
    if (
      input.relativePath.length < 1 ||
      input.relativePath.length > 240 ||
      /[\0\r\n]/.test(input.relativePath)
    ) {
      throw new Error("Upload path is invalid");
    }
    if (path.isAbsolute(input.relativePath) || input.relativePath.split(/[\\/]+/).includes("..")) {
      throw new Error("Upload path must stay inside the project");
    }
    const canonicalProject = await this.assertExistingProjectDirectory(input.projectPath);
    const destination = path.resolve(canonicalProject, input.relativePath);
    const relative = path.relative(canonicalProject, destination);
    if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Upload path must stay inside the project");
    }
    await this.ensureSafeUploadParent(canonicalProject, path.dirname(relative));
    try {
      await fs.writeFile(destination, input.content, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") {
        throw new Error("Upload destination already exists", { cause: error });
      }
      throw error;
    }
    return destination;
  }

  private async createAtomically(
    destination: string,
    populate: (temporary: string) => Promise<void>,
  ): Promise<void> {
    await this.assertDirectProjectChild(destination);
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

  private async assertDirectProjectChild(destination: string): Promise<string> {
    const resolved = path.resolve(destination);
    if (path.basename(resolved) === "") {
      throw new Error("Project destination is outside the workspace root");
    }
    let canonicalParent: string;
    try {
      canonicalParent = await fs.realpath(path.dirname(resolved));
    } catch (error) {
      if (isMissing(error))
        throw new Error("Project destination is outside the workspace root", { cause: error });
      throw error;
    }
    if (samePath(resolved, this.canonicalRoot) || !samePath(canonicalParent, this.canonicalRoot)) {
      throw new Error("Project destination is outside the workspace root");
    }
    return path.join(this.canonicalRoot, path.basename(resolved));
  }

  private async assertExistingProjectDirectory(projectPath: string): Promise<string> {
    const statistics = await fs.lstat(projectPath);
    if (!statistics.isDirectory() || statistics.isSymbolicLink()) {
      throw new Error("Project destination is outside the workspace root");
    }
    const canonicalProject = await fs.realpath(projectPath);
    await this.assertDirectProjectChild(canonicalProject);
    return canonicalProject;
  }

  private async ensureSafeUploadParent(canonicalProject: string, relativeParent: string): Promise<void> {
    if (relativeParent === "") return;
    let current = canonicalProject;
    for (const segment of relativeParent.split(path.sep)) {
      const next = path.join(current, segment);
      await this.ensureSafeUploadDirectory(next, canonicalProject);
      current = await fs.realpath(next);
    }
  }

  private async ensureSafeUploadDirectory(directory: string, canonicalProject: string): Promise<void> {
    try {
      const statistics = await fs.lstat(directory);
      if (!statistics.isDirectory() || statistics.isSymbolicLink()) {
        throw new Error("Upload path escapes the project through a symlink");
      }
    } catch (error) {
      if (!isMissing(error)) throw error;
      await fs.mkdir(directory, { mode: 0o700 });
      const statistics = await fs.lstat(directory);
      if (!statistics.isDirectory() || statistics.isSymbolicLink()) {
        throw new Error("Upload path escapes the project through a symlink", { cause: error });
      }
    }
    const canonicalDirectory = await fs.realpath(directory);
    const relative = path.relative(canonicalProject, canonicalDirectory);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Upload path escapes the project through a symlink");
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

function samePath(left: string, right: string): boolean {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
