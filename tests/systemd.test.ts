import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("systemd service hardening", () => {
  it("runs as the dedicated non-root user with a constrained writable surface", () => {
    const unit = fs.readFileSync(path.resolve("deploy", "harnesshub.service"), "utf8");
    expect(unit).toContain("User=harnesshub");
    expect(unit).not.toContain("User=root");
    expect(unit).toContain("NoNewPrivileges=true");
    expect(unit).toContain("ProtectSystem=strict");
    expect(unit).toContain("ProtectHome=true");
    expect(unit).toContain("ReadWritePaths=/var/lib/harnesshub /srv/harnesshub/workspaces");
    expect(unit).toContain("MemoryMax=4G");
    expect(unit).toContain("TasksMax=256");
  });

  it("places Pi native state in the writable service state directory", () => {
    const environment = fs.readFileSync(path.resolve(".env.example"), "utf8");
    expect(environment).toContain("PI_CODING_AGENT_DIR=/var/lib/harnesshub/pi-agent");
  });
});
