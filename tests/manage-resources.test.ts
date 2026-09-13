import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ManageResources,
  type ResourceHarnessPort,
  type ResourceStore,
} from "../src/application/manage-resources.js";
import type { HarnessResource } from "../src/domain/resource.js";
import type { Project } from "../src/domain/project.js";

const project: Project = {
  id: "project",
  workspaceId: "workspace",
  name: "Demo",
  slug: "demo",
  channelId: "channel",
  path: path.resolve("demo"),
  harnessId: "pi",
  gitRemote: null,
  createdAt: new Date().toISOString(),
  archivedAt: null,
};

function resource(input: Partial<HarnessResource> = {}): HarnessResource {
  return {
    id: "resource",
    harnessId: "pi",
    type: "package",
    scope: "global",
    projectId: null,
    source: "npm:demo",
    status: "installed",
    safeError: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...input,
  };
}

function subject() {
  const stored = resource();
  const store: ResourceStore = {
    saveInstalled: vi.fn(() => stored),
    markFailed: vi.fn((input: Parameters<ResourceStore["markFailed"]>[0]) =>
      resource({ ...input, status: "failed" }),
    ),
    list: vi.fn(() => [stored]),
    findById: vi.fn(() => stored),
    markRemoved: vi.fn((id: string) => resource({ id, status: "removed" })),
  };
  const harness: ResourceHarnessPort = {
    installPackageResource: vi.fn(async () => undefined),
    removePackageResource: vi.fn(async () => undefined),
  };
  return { manager: new ManageResources(store, harness), store, harness };
}

describe("ManageResources", () => {
  it("installs and persists a global Pi package", async () => {
    const { manager, store, harness } = subject();

    await manager.install({
      scope: "global",
      project: null,
      workspaceRoot: path.resolve("workspaces"),
      source: "npm:demo",
    });

    expect(harness.installPackageResource).toHaveBeenCalledWith({
      scope: "global",
      cwd: path.resolve("workspaces"),
      source: "npm:demo",
    });
    expect(store.saveInstalled).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "global", projectId: null }),
    );
  });

  it("installs project resources in the project directory", async () => {
    const { manager, store, harness } = subject();

    await manager.install({
      scope: "project",
      project,
      workspaceRoot: path.resolve("workspaces"),
      source: "git:github.com/user/repo@v1",
    });

    expect(harness.installPackageResource).toHaveBeenCalledWith({
      scope: "project",
      cwd: project.path,
      source: "git:github.com/user/repo@v1",
    });
    expect(store.saveInstalled).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "project", projectId: project.id }),
    );
  });

  it("records safe failed state when installation fails", async () => {
    const { manager, store, harness } = subject();
    vi.mocked(harness.installPackageResource).mockRejectedValue(new Error("token secret failed"));

    await expect(
      manager.install({
        scope: "global",
        project: null,
        workspaceRoot: path.resolve("workspaces"),
        source: "npm:demo",
      }),
    ).rejects.toThrow("token secret failed");

    const failedCalls = vi.mocked(store.markFailed).mock.calls as [
      Parameters<ResourceStore["markFailed"]>[0],
    ][];
    expect(failedCalls[0]?.[0].safeError).not.toContain("secret");
  });

  it("removes only resources from the requested scope", async () => {
    const { manager, harness, store } = subject();
    vi.mocked(store.findById).mockReturnValue(
      resource({ id: "project-resource", scope: "project", projectId: project.id }),
    );

    await manager.remove({
      id: "project-resource",
      scope: "project",
      project,
      workspaceRoot: path.resolve("workspaces"),
    });

    expect(harness.removePackageResource).toHaveBeenCalledWith({
      scope: "project",
      cwd: project.path,
      source: "npm:demo",
    });
    expect(store.markRemoved).toHaveBeenCalledWith("project-resource");
  });
});
