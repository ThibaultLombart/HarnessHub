import fs from "node:fs/promises";
import type { Database } from "./infrastructure/database.js";

export type Health = Readonly<{
  status: "healthy" | "unhealthy";
  database: boolean;
  workspace: boolean;
}>;

export async function checkHealth(database: Database, workspaceRoot: string): Promise<Health> {
  const databaseHealthy = databaseIsHealthy(database);
  const workspaceHealthy = await workspaceIsHealthy(workspaceRoot);
  return {
    status: databaseHealthy && workspaceHealthy ? "healthy" : "unhealthy",
    database: databaseHealthy,
    workspace: workspaceHealthy,
  };
}

function databaseIsHealthy(database: Database): boolean {
  try {
    return database.raw().prepare("SELECT 1 AS ok").get() !== undefined;
  } catch {
    return false;
  }
}

async function workspaceIsHealthy(workspaceRoot: string): Promise<boolean> {
  try {
    await fs.access(workspaceRoot, fs.constants.R_OK | fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
