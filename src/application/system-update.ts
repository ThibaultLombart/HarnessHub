import { execFile } from "node:child_process";
import { promisify } from "node:util";

const executeFile = promisify(execFile);

export type SystemUpdateCheckoutStatus = Readonly<{
  mode: "checkout";
  checkout: string;
  branch: string;
  head: string;
  upstream: string | null;
  upstreamHead: string | null;
  clean: boolean;
  updateAvailable: boolean;
  updateComparison: "current" | "available" | "unavailable";
  upstreamFreshness: "cached" | "not-configured";
  manualUpdateRequired: true;
}>;

export type SystemUpdateInstalledStatus = Readonly<{
  mode: "installed";
  checkout: string;
  branch: null;
  head: null;
  upstream: null;
  upstreamHead: null;
  clean: null;
  updateAvailable: false;
  updateComparison: "unavailable";
  upstreamFreshness: "unavailable";
  manualUpdateRequired: true;
  reason: "git-unavailable" | "not-git-or-corrupt";
  message: string;
}>;

export type SystemUpdateStatus = SystemUpdateCheckoutStatus | SystemUpdateInstalledStatus;

export class SystemUpdateBlockedError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SystemUpdateBlockedError";
  }
}

export class SystemUpdate {
  public constructor(private readonly checkout: string) {}

  public async check(): Promise<SystemUpdateStatus> {
    const checkoutStatus = await this.checkoutStatus();
    if (checkoutStatus !== null) return checkoutStatus;
    const [branch, head, upstream, porcelain] = await Promise.all([
      this.git(["branch", "--show-current"]),
      this.git(["rev-parse", "HEAD"]),
      this.git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).catch(() => null),
      this.git(["status", "--porcelain"], { GIT_OPTIONAL_LOCKS: "0" }),
    ]);
    let upstreamHead: string | null = null;
    if (upstream !== null && upstream.trim() !== "") {
      upstreamHead = (await this.git(["rev-parse", upstream.trim()])).trim();
    }
    const normalizedHead = head.trim();
    const updateAvailable = upstreamHead !== null && upstreamHead !== normalizedHead;
    return {
      mode: "checkout",
      checkout: this.checkout,
      branch: branch.trim() === "" ? "detached" : branch.trim(),
      head: normalizedHead,
      upstream: upstream?.trim() === "" ? null : (upstream?.trim() ?? null),
      upstreamHead,
      clean: porcelain === "",
      updateAvailable,
      updateComparison: upstreamHead === null ? "unavailable" : updateAvailable ? "available" : "current",
      upstreamFreshness: upstreamHead === null ? "not-configured" : "cached",
      manualUpdateRequired: true,
    };
  }

  public async apply(): Promise<SystemUpdateStatus> {
    throw new SystemUpdateBlockedError(
      "Discord self-update is disabled. Run the trusted operator procedure manually from a Git checkout.",
    );
  }

  private async checkoutStatus(): Promise<SystemUpdateInstalledStatus | null> {
    try {
      await this.git(["rev-parse", "--show-toplevel"]);
      return null;
    } catch (error) {
      const reason = isExecutableMissing(error) ? "git-unavailable" : "not-git-or-corrupt";
      return {
        mode: "installed",
        checkout: this.checkout,
        branch: null,
        head: null,
        upstream: null,
        upstreamHead: null,
        clean: null,
        updateAvailable: false,
        updateComparison: "unavailable",
        upstreamFreshness: "unavailable",
        manualUpdateRequired: true,
        reason,
        message:
          reason === "git-unavailable"
            ? "Git is not available to inspect this deployment. Discord update checks are manual-only."
            : "The configured deployment is not a Git checkout, or its Git metadata is corrupt. Discord update checks are manual-only.",
      };
    }
  }

  private async git(arguments_: readonly string[], env?: Readonly<Record<string, string>>): Promise<string> {
    return (await this.run("git", arguments_, env)).stdout;
  }

  private async run(
    command: string,
    arguments_: readonly string[],
    env: Readonly<Record<string, string>> = {},
  ): Promise<{ stdout: string; stderr: string }> {
    return executeFile(command, [...arguments_], {
      cwd: this.checkout,
      shell: false,
      windowsHide: true,
      timeout: 10 * 60_000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: "0" },
    });
  }
}

function isExecutableMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
