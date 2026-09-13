import { execFile } from "node:child_process";
import { promisify } from "node:util";

const executeFile = promisify(execFile);

export type SystemUpdateStatus = Readonly<{
  checkout: string;
  branch: string;
  head: string;
  upstream: string | null;
  upstreamHead: string | null;
  clean: boolean;
  updateAvailable: boolean;
}>;

export class SystemUpdateBlockedError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SystemUpdateBlockedError";
  }
}

export class SystemUpdate {
  public constructor(private readonly checkout: string) {}

  public async check(): Promise<SystemUpdateStatus> {
    await this.requireGitCheckout();
    const [branch, head, upstream, porcelain] = await Promise.all([
      this.git(["branch", "--show-current"]),
      this.git(["rev-parse", "HEAD"]),
      this.git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).catch(() => null),
      this.git(["status", "--porcelain"]),
    ]);
    let upstreamHead: string | null = null;
    if (upstream !== null && upstream.trim() !== "") {
      await this.git(["fetch", "--prune"]);
      upstreamHead = (await this.git(["rev-parse", upstream.trim()])).trim();
    }
    return {
      checkout: this.checkout,
      branch: branch.trim() === "" ? "detached" : branch.trim(),
      head: head.trim(),
      upstream: upstream?.trim() === "" ? null : (upstream?.trim() ?? null),
      upstreamHead,
      clean: porcelain === "",
      updateAvailable: upstreamHead !== null && upstreamHead !== head.trim(),
    };
  }

  public async apply(): Promise<SystemUpdateStatus> {
    const before = await this.check();
    if (!before.clean) throw new SystemUpdateBlockedError("Refusing to update with local checkout changes");
    if (before.upstream === null) throw new SystemUpdateBlockedError("No upstream branch is configured");
    await this.git(["merge", "--ff-only", before.upstream]);
    await this.run("npm", ["ci"]);
    await this.run("npm", ["run", "check"]);
    await this.run("sudo", ["-n", "./scripts/install.sh", "--no-pi-login"]);
    return this.check();
  }

  private async requireGitCheckout(): Promise<void> {
    try {
      await this.git(["rev-parse", "--show-toplevel"]);
    } catch {
      throw new SystemUpdateBlockedError("Configured update checkout is not a Git repository");
    }
  }

  private async git(arguments_: readonly string[]): Promise<string> {
    return (await this.run("git", arguments_)).stdout;
  }

  private async run(
    command: string,
    arguments_: readonly string[],
  ): Promise<{ stdout: string; stderr: string }> {
    return executeFile(command, [...arguments_], {
      cwd: this.checkout,
      shell: false,
      windowsHide: true,
      timeout: 10 * 60_000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
  }
}
