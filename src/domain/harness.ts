export class SessionBusyError extends Error {
  public constructor() {
    super("This project already has an active prompt");
    this.name = "SessionBusyError";
  }
}

export type HarnessEvent =
  | { type: "working" }
  | { type: "agent-start" }
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
    externalSessionId?: string;
    onEvent: (event: HarnessEvent) => void;
  }): Promise<HarnessSession>;
  getSession(projectId: string): HarnessSession | undefined;
  stopSession(projectId: string): Promise<void>;
  dispose(): Promise<void>;
};
