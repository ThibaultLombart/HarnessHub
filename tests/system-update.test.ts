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

  it("rejects non-git update checkouts", async () => {
    await expect(new SystemUpdate(temporaryDirectory()).check()).rejects.toThrow(SystemUpdateBlockedError);
  });
});
