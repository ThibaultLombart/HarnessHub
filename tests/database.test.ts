import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Database } from "../src/infrastructure/database.js";

const temporaryDirectories: string[] = [];

function temporaryDatabasePath(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "harnesshub-db-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "state.sqlite");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("Database", () => {
  it("migrates idempotently and persists jobs across restart", () => {
    const databasePath = temporaryDatabasePath();
    const first = Database.open(databasePath);
    const job = first.jobs.create({ type: "bootstrap", metadata: { safe: true } });
    first.jobs.transition(job.id, "running");
    first.close();

    const second = Database.open(databasePath);
    expect(second.schemaVersion).toBeGreaterThan(0);
    expect(second.jobs.findById(job.id)).toMatchObject({ status: "running", type: "bootstrap" });
    second.close();
  });

  it("reconciles interrupted jobs without touching terminal jobs", () => {
    const database = Database.open(temporaryDatabasePath());
    const running = database.jobs.create({ type: "clone" });
    const done = database.jobs.create({ type: "setup" });
    database.jobs.transition(running.id, "running");
    database.jobs.transition(done.id, "running");
    database.jobs.transition(done.id, "succeeded");

    expect(database.reconcileInterruptedWork()).toBe(1);
    expect(database.jobs.findById(running.id)?.status).toBe("failed");
    expect(database.jobs.findById(done.id)?.status).toBe("succeeded");
    database.close();
  });
});
