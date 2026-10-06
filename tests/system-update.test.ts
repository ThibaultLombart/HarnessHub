import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { SystemUpdate, SystemUpdateBlockedError } from "../src/application/system-update.js";

const roots: string[] = [];
function temporaryDirectory(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harnesshub-update-"));
  roots.push(root);
  return root;
}

function installFailingCommands(bin: string, log: string, names: readonly string[]): void {
  fs.mkdirSync(bin, { recursive: true });
  for (const name of names) {
    fs.writeFileSync(
      path.join(bin, name),
      `#!/bin/sh\nprintf '%s %s\\n' '${name}' "$*" >> '${log}'\nexit 2\n`,
      { mode: 0o755 },
    );
    fs.writeFileSync(
      path.join(bin, `${name}.cmd`),
      `@echo off\r\necho ${name} %*>> "${log}"\r\nexit /b 2\r\n`,
    );
  }
}

async function withPrependedPath<T>(bin: string, operation: () => Promise<T>): Promise<T> {
  const previous = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previous ?? ""}`;
  try {
    return await operation();
  } finally {
    if (previous === undefined) delete process.env.PATH;
    else process.env.PATH = previous;
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("SystemUpdate", () => {
  it("reports local checkout status without applying changes", async () => {
    const checkout = temporaryDirectory();
    execFileSync("git", ["init"], { cwd: checkout });
    fs.writeFileSync(path.join(checkout, "README.md"), "demo");
    execFileSync(
      "git",
      ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "add", "README.md"],
      { cwd: checkout },
    );
    execFileSync(
      "git",
      ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "initial"],
      { cwd: checkout },
    );

    await expect(new SystemUpdate(checkout).check()).resolves.toMatchObject({
      checkout,
      clean: true,
      updateAvailable: false,
    });
  });

  it("reports deployed non-git installations as manual-only without fabricated checkout details", async () => {
    const deployed = temporaryDirectory();
    fs.writeFileSync(path.join(deployed, "artifact.txt"), "unchanged");

    await expect(new SystemUpdate(deployed).check()).resolves.toMatchObject({
      mode: "installed",
      checkout: deployed,
      branch: null,
      head: null,
      upstream: null,
      upstreamHead: null,
      clean: null,
      updateAvailable: false,
      updateComparison: "unavailable",
      manualUpdateRequired: true,
    });
    expect(fs.readFileSync(path.join(deployed, "artifact.txt"), "utf8")).toBe("unchanged");
  });

  it("checks update status from cached upstream data without fetching or writing fetch state", async () => {
    const origin = path.join(temporaryDirectory(), "origin.git");
    const seed = temporaryDirectory();
    const checkout = temporaryDirectory();
    execFileSync("git", ["init", "--bare", origin]);
    execFileSync("git", ["init"], { cwd: seed });
    fs.writeFileSync(path.join(seed, "README.md"), "one");
    execFileSync(
      "git",
      ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "add", "README.md"],
      {
        cwd: seed,
      },
    );
    execFileSync(
      "git",
      ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "initial"],
      { cwd: seed },
    );
    execFileSync("git", ["branch", "-M", "main"], { cwd: seed });
    execFileSync("git", ["remote", "add", "origin", origin], { cwd: seed });
    execFileSync("git", ["push", "-u", "origin", "main"], { cwd: seed });
    execFileSync("git", ["clone", "-b", "main", origin, checkout]);
    fs.appendFileSync(path.join(seed, "README.md"), "\ntwo");
    execFileSync(
      "git",
      ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-am", "second"],
      {
        cwd: seed,
      },
    );
    execFileSync("git", ["push", "origin", "main"], { cwd: seed });
    const fetchHead = path.join(checkout, ".git", "FETCH_HEAD");
    expect(fs.existsSync(fetchHead)).toBe(false);

    const status = await new SystemUpdate(checkout).check();

    expect(status).toMatchObject({
      mode: "checkout",
      upstreamFreshness: "cached",
      updateAvailable: false,
    });
    expect(fs.existsSync(fetchHead)).toBe(false);
  });

  it("blocks update apply before invoking Git, npm, sudo, or writing to the deployment", async () => {
    const deployed = temporaryDirectory();
    const marker = path.join(deployed, "marker.txt");
    fs.writeFileSync(marker, "unchanged");
    const bin = path.join(temporaryDirectory(), "bin");
    const log = path.join(temporaryDirectory(), "commands.log");
    installFailingCommands(bin, log, ["git", "npm", "sudo"]);

    await withPrependedPath(bin, async () => {
      await expect(new SystemUpdate(deployed).apply()).rejects.toThrow(SystemUpdateBlockedError);
      await expect(new SystemUpdate(deployed).apply()).rejects.toThrow("Discord self-update is disabled");
    });

    expect(fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "").toBe("");
    expect(fs.readFileSync(marker, "utf8")).toBe("unchanged");
  });
});
