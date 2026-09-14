import type { Project } from "../domain/project.js";

export type ProjectWorkStatus = "idle" | "working" | "blocked";

export type ProjectStatusDiscordPort = {
  updateProjectChannelStatus(project: Project, status: ProjectWorkStatus): Promise<void>;
};

export class ProjectStatusIndicators {
  public constructor(
    private readonly discord: ProjectStatusDiscordPort,
    private readonly logger: { warn(bindings: object, message: string): void },
  ) {}

  public async update(project: Project, status: ProjectWorkStatus): Promise<void> {
    try {
      await this.discord.updateProjectChannelStatus(project, status);
    } catch (error) {
      this.logger.warn({ error, projectId: project.id, status }, "Could not update project status indicator");
    }
  }
}

export function projectStatusFromSession(sessionStatus: string | undefined): ProjectWorkStatus {
  if (sessionStatus === "starting" || sessionStatus === "working" || sessionStatus === "stopping") {
    return "working";
  }
  if (sessionStatus === "failed" || sessionStatus === "stopped") return "blocked";
  return "idle";
}
