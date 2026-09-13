import { parseResourceSource, type HarnessResource, type ResourceScope } from "../domain/resource.js";
import type { Project } from "../domain/project.js";

export type ResourceStore = {
  saveInstalled(input: {
    harnessId: string;
    type: "package";
    scope: ResourceScope;
    projectId: string | null;
    source: string;
  }): HarnessResource;
  markFailed(input: {
    harnessId: string;
    type: "package";
    scope: ResourceScope;
    projectId: string | null;
    source: string;
    safeError: string;
  }): HarnessResource;
  list(input: { harnessId: string; scope?: ResourceScope; projectId?: string | null }): HarnessResource[];
  findById(id: string): HarnessResource | undefined;
  markRemoved(id: string): HarnessResource;
};

export type ResourceHarnessPort = {
  installPackageResource(input: { scope: ResourceScope; cwd: string; source: string }): Promise<void>;
  removePackageResource(input: { scope: ResourceScope; cwd: string; source: string }): Promise<void>;
};

export class ResourceNotFoundError extends Error {
  public constructor() {
    super("Resource not found");
    this.name = "ResourceNotFoundError";
  }
}

export class ResourceProjectRequiredError extends Error {
  public constructor() {
    super("This resource operation requires a project channel");
    this.name = "ResourceProjectRequiredError";
  }
}

export class ResourceScopeMismatchError extends Error {
  public constructor() {
    super("This resource does not belong to the requested scope");
    this.name = "ResourceScopeMismatchError";
  }
}

export class ManageResources {
  public constructor(
    private readonly store: ResourceStore,
    private readonly harness: ResourceHarnessPort,
    private readonly harnessId = "pi",
  ) {}

  public async install(input: {
    scope: ResourceScope;
    project: Project | null;
    workspaceRoot: string;
    source: string;
  }): Promise<HarnessResource> {
    const source = parseResourceSource(input.source);
    const projectId = input.scope === "project" ? requireProject(input.project).id : null;
    const cwd = input.scope === "project" ? requireProject(input.project).path : input.workspaceRoot;
    try {
      await this.harness.installPackageResource({ scope: input.scope, cwd, source });
      return this.store.saveInstalled({
        harnessId: this.harnessId,
        type: "package",
        scope: input.scope,
        projectId,
        source,
      });
    } catch (error) {
      this.store.markFailed({
        harnessId: this.harnessId,
        type: "package",
        scope: input.scope,
        projectId,
        source,
        safeError: safeResourceError(error),
      });
      throw error;
    }
  }

  public list(input: { scope?: ResourceScope; project?: Project | null }): HarnessResource[] {
    if (input.scope === "project") {
      return this.store.list({
        harnessId: this.harnessId,
        scope: "project",
        projectId: requireProject(input.project).id,
      });
    }
    if (input.scope === "global") return this.store.list({ harnessId: this.harnessId, scope: "global" });
    const global = this.store.list({ harnessId: this.harnessId, scope: "global" });
    if (input.project === null || input.project === undefined) return global;
    return [
      ...global,
      ...this.store.list({ harnessId: this.harnessId, scope: "project", projectId: input.project.id }),
    ];
  }

  public async remove(input: {
    id: string;
    scope: ResourceScope;
    project: Project | null;
    workspaceRoot: string;
  }): Promise<HarnessResource> {
    const resource = this.store.findById(input.id);
    if (resource?.harnessId !== this.harnessId || resource.status === "removed") {
      throw new ResourceNotFoundError();
    }
    const project = input.scope === "project" ? requireProject(input.project) : null;
    if (
      resource.scope !== input.scope ||
      (resource.scope === "project" && resource.projectId !== project?.id) ||
      (resource.scope === "global" && resource.projectId !== null)
    ) {
      throw new ResourceScopeMismatchError();
    }
    const cwd = resource.scope === "project" ? requireProject(project).path : input.workspaceRoot;
    await this.harness.removePackageResource({ scope: resource.scope, cwd, source: resource.source });
    return this.store.markRemoved(resource.id);
  }
}

function requireProject(project: Project | null | undefined): Project {
  if (project === null || project === undefined) throw new ResourceProjectRequiredError();
  return project;
}

function safeResourceError(error: unknown): string {
  if (error instanceof Error && error.name === "InvalidResourceInputError") return error.message;
  return "Resource operation failed; inspect the redacted service logs";
}
