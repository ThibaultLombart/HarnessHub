import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const installer = path.resolve("scripts", "install.sh");

describe("Linux installer", () => {
  it("is valid Bash and exposes help without requiring root", () => {
    execFileSync("bash", ["-n", installer]);
    const help = execFileSync("bash", [installer, "--help"], { encoding: "utf8" });
    expect(help).toContain("sudo ./scripts/install.sh");
    expect(help).toContain("--no-start");
  });

  it("keeps credential input and generated configuration private", () => {
    const source = fs.readFileSync(installer, "utf8");
    expect(source).toContain("read -r -s");
    expect(source).toContain("umask 077");
    expect(source).toContain("chmod 0640");
    expect(source).not.toMatch(/curl[^\n]*\|[^\n]*(?:sh|bash)/);
  });

  it("installs Pi without lifecycle scripts or global npm permissions", () => {
    const source = fs.readFileSync(installer, "utf8");
    expect(source).toContain("--prefix");
    expect(source).toContain("--ignore-scripts");
    expect(source).not.toContain("npm install -g");
  });

  it("includes both installation documents in the installed application", () => {
    const source = fs.readFileSync(installer, "utf8");
    expect(source).toContain('"${SOURCE_DIR}/docs/INSTALLATION.md"');
    expect(source).toContain('"${SOURCE_DIR}/docs/PROXMOX_VM_GUIDE.md"');
  });

  it("starts authentication from stable state without inheriting a parent Pi session", () => {
    const source = fs.readFileSync(installer, "utf8");
    expect(source).toContain(`--chdir="\${STATE_DIR}"`);
    expect(source).toContain("-u PI_SESSION_FILE");
    expect(source).toContain("--no-session");
    expect(source).toContain("--no-approve");
  });
});
