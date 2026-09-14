import type { ModelDescriptor } from "./model.js";
import type { ResourceScope } from "./resource.js";

export class SessionBusyError extends Error {
  public constructor() {
    super("This project already has an active prompt");
    this.name = "SessionBusyError";
  }
}

export type HarnessEvent =
  | { type: "working" }
  | { type: "agent-start" }
  | { type: "model-selected"; provider: string; modelId: string }
  | { type: "turn-start" }
  | { type: "message-start" }
  | { type: "message-end" }
  | { type: "settled" }
  | { type: "tool-start"; toolName: string }
  | { type: "tool-update"; toolName: string }
  | { type: "tool-end"; toolName: string; failed: boolean }
  | { type: "compaction-start" }
  | { type: "compaction-end" }
  | { type: "retry-start" }
  | { type: "retry-end"; failed: boolean }
  | { type: "failed"; message: string };

export type HarnessCapability = "install" | "authStatus" | "streaming" | "sessionResume";

export type HarnessSession = {
  readonly externalSessionId: string;
  readonly isBusy: boolean;
  readonly model: Readonly<{ provider: string; id: string }> | null;
  sendPrompt(message: string): Promise<string>;
  stop(): Promise<void>;
  close(): Promise<void>;
};

export type HarnessAdapter = {
  getCapabilities(): ReadonlySet<HarnessCapability>;
  detect(): Promise<{ installed: boolean; version: string | null }>;
  install(): Promise<void>;
  getAuthStatus(cwd: string): Promise<{ authenticated: boolean; providers: readonly string[] }>;
  startSession(input: {
    projectId: string;
    cwd: string;
    name: string;
    modelPattern?: string;
    externalSessionId?: string;
    onEvent: (event: HarnessEvent) => void;
  }): Promise<HarnessSession>;
  getSession(projectId: string): HarnessSession | undefined;
  stopSession(projectId: string): Promise<void>;
  installPackageResource?(input: { scope: ResourceScope; cwd: string; source: string }): Promise<void>;
  removePackageResource?(input: { scope: ResourceScope; cwd: string; source: string }): Promise<void>;
  listModels?(cwd: string): Promise<readonly ModelDescriptor[]>;
  setSessionModel?(projectId: string, provider: string, modelId: string): Promise<void>;
  dispose(): Promise<void>;
};
