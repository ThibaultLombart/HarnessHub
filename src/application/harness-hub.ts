import { SessionBusyError, type HarnessAdapter, type HarnessEvent } from "../domain/harness.js";
import type { Project } from "../domain/project.js";

export type Actor = Readonly<{ guildId: string; userId: string }>;

export type HarnessHubRepositories = {
  projects: {
    findByChannelId(channelId: string): Project | undefined;
    findById(id: string): Project | undefined;
  };
  modelPreferences: {
    findByProject(projectId: string): { provider: string; modelId: string } | undefined;
  };
  sessions: {
    findLatestByProject(projectId: string): { externalSessionId: string | null; status: string } | undefined;
    recordStarted(projectId: string, harnessId: string, externalSessionId: string): void;
    updateStatus(projectId: string, status: string): void;
  };
};

export class UnauthorizedError extends Error {
  public constructor() {
    super("You are not authorized to use HarnessHub");
    this.name = "UnauthorizedError";
  }
}

export class SessionRestartUnsupportedError extends Error {
  public constructor() {
    super("The configured harness does not support process restart");
    this.name = "SessionRestartUnsupportedError";
  }
}

export class UnmappedChannelError extends Error {
  public constructor() {
    super("This Discord channel is not mapped to a HarnessHub project");
    this.name = "UnmappedChannelError";
  }
}

export class HarnessHub {
  public constructor(
    private readonly boundary: { guildId: string; administratorId: string },
    private readonly repositories: HarnessHubRepositories,
    private readonly adapter: HarnessAdapter,
  ) {}

  public authorize(actor: Actor): void {
    if (actor.guildId !== this.boundary.guildId || actor.userId !== this.boundary.administratorId) {
      throw new UnauthorizedError();
    }
  }

  public async detectHarness(actor: Actor): Promise<{ installed: boolean; version: string | null }> {
    this.authorize(actor);
    return this.adapter.detect();
  }

  public async installHarness(actor: Actor): Promise<void> {
    this.authorize(actor);
    await this.adapter.install();
  }

  public async getAuthStatus(
    actor: Actor,
    cwd: string,
  ): Promise<{ authenticated: boolean; providers: readonly string[] }> {
    this.authorize(actor);
    return this.adapter.getAuthStatus(cwd);
  }

  public async prompt(
    input: Actor & { channelId: string; content: string },
    onEvent: (event: HarnessEvent) => void,
  ): Promise<string> {
    this.authorize(input);
    const project = this.repositories.projects.findByChannelId(input.channelId);
    if (project?.archivedAt !== null) throw new UnmappedChannelError();
    const previous = this.repositories.sessions.findLatestByProject(project.id);
    const startInput = {
      projectId: project.id,
      cwd: project.path,
      name: project.slug,
      ...modelPreferenceInput(this.repositories.modelPreferences.findByProject(project.id)),
      onEvent,
      ...(previous?.externalSessionId === null || previous?.externalSessionId === undefined
        ? {}
        : { externalSessionId: previous.externalSessionId }),
    };
    const session = await this.adapter.startSession(startInput);
    if (session.isBusy) throw new SessionBusyError();
    if (session.model !== null) {
      onEvent({ type: "model-selected", provider: session.model.provider, modelId: session.model.id });
    }
    this.repositories.sessions.recordStarted(project.id, "pi", session.externalSessionId);
    this.repositories.sessions.updateStatus(project.id, "working");
    try {
      const answer = await session.sendPrompt(input.content);
      this.repositories.sessions.updateStatus(project.id, "idle");
      return answer;
    } catch (error) {
      this.repositories.sessions.updateStatus(
        project.id,
        error instanceof Error && error.name === "SessionStoppedError" ? "stopped" : "failed",
      );
      throw error;
    }
  }

  public async stop(actor: Actor, projectId: string): Promise<void> {
    this.authorize(actor);
    if (this.repositories.projects.findById(projectId) === undefined) throw new Error("Project not found");
    await this.adapter.stopSession(projectId);
    this.repositories.sessions.updateStatus(projectId, "stopped");
  }

  public async restart(
    actor: Actor,
    projectId: string,
    onEvent: (event: HarnessEvent) => void,
  ): Promise<void> {
    this.authorize(actor);
    if (this.repositories.projects.findById(projectId) === undefined) throw new Error("Project not found");
    if (this.adapter.getSession(projectId)?.isBusy === true) throw new SessionBusyError();
    if (this.adapter.restartSession === undefined) throw new SessionRestartUnsupportedError();
    await this.adapter.restartSession(projectId);
    this.repositories.sessions.updateStatus(projectId, "stopped");
    await this.resume(actor, projectId, onEvent);
  }

  public async resume(
    actor: Actor,
    projectId: string,
    onEvent: (event: HarnessEvent) => void,
  ): Promise<void> {
    this.authorize(actor);
    const project = this.repositories.projects.findById(projectId);
    if (project === undefined) throw new Error("Project not found");
    const previous = this.repositories.sessions.findLatestByProject(project.id);
    const session = await this.adapter.startSession({
      projectId: project.id,
      cwd: project.path,
      name: project.slug,
      ...modelPreferenceInput(this.repositories.modelPreferences.findByProject(project.id)),
      onEvent,
      ...(previous?.externalSessionId === null || previous?.externalSessionId === undefined
        ? {}
        : { externalSessionId: previous.externalSessionId }),
    });
    if (session.model !== null) {
      onEvent({ type: "model-selected", provider: session.model.provider, modelId: session.model.id });
    }
    this.repositories.sessions.recordStarted(project.id, "pi", session.externalSessionId);
    this.repositories.sessions.updateStatus(project.id, "idle");
  }
}

function modelPreferenceInput(preference: { provider: string; modelId: string } | undefined): {
  modelPattern?: string;
} {
  return preference === undefined ? {} : { modelPattern: `${preference.provider}/${preference.modelId}` };
}
