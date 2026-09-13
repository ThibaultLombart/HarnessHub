import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SessionBusyError, type HarnessCapability, type HarnessEvent } from "../../domain/harness.js";
export { SessionBusyError } from "../../domain/harness.js";
import { PiRpcClient, type RpcRecord } from "./rpc-client.js";

const executeFile = promisify(execFile);

export class SessionStoppedError extends Error {
  public constructor() {
    super("The Pi operation was stopped");
    this.name = "SessionStoppedError";
  }
}

export class PiSession {
  public readonly externalSessionId: string;
  private busy = false;
  private settle: (() => void) | undefined;
  private rejectSettle: ((error: Error) => void) | undefined;
  private stopRequested = false;

  public constructor(
    public readonly projectId: string,
    private readonly client: PiRpcClient,
    externalSessionId: string,
    private onEvent: (event: HarnessEvent) => void,
    private readonly onProcessFailure: () => void,
  ) {
    this.externalSessionId = externalSessionId;
    this.client.onEvent((event) => this.handleEvent(event));
  }

  public get isBusy(): boolean {
    return this.busy;
  }

  public setEventHandler(onEvent: (event: HarnessEvent) => void): void {
    this.onEvent = onEvent;
  }

  public async sendPrompt(message: string): Promise<string> {
    if (this.busy) throw new SessionBusyError();
    if (message.trim() === "") throw new Error("Prompt must not be empty");
    this.busy = true;
    this.stopRequested = false;
    this.onEvent({ type: "working" });
    const settled = new Promise<void>((resolve, reject) => {
      this.settle = resolve;
      this.rejectSettle = reject;
    });
    try {
      await this.client.command("prompt", { message }, 30_000);
      await settled;
      if (this.wasStopRequested()) throw new SessionStoppedError();
      const response = await this.client.command("get_last_assistant_text");
      const data = objectValue(response.data);
      return typeof data.text === "string" && data.text !== ""
        ? data.text
        : "Pi completed without a text response.";
    } finally {
      this.busy = false;
      this.settle = undefined;
      this.rejectSettle = undefined;
    }
  }

  public async stop(): Promise<void> {
    if (!this.busy) return;
    this.stopRequested = true;
    await this.client.command("abort", {}, 30_000);
    this.rejectSettle?.(new SessionStoppedError());
    this.busy = false;
  }

  public async close(): Promise<void> {
    await this.client.close();
  }

  private wasStopRequested(): boolean {
    return this.stopRequested;
  }

  private handleEvent(event: RpcRecord): void {
    if (event.type === "agent_settled") {
      this.onEvent({ type: "settled" });
      this.settle?.();
    } else if (event.type === "tool_execution_start" && typeof event.toolName === "string") {
      this.onEvent({ type: "tool-start", toolName: event.toolName });
    } else if (event.type === "tool_execution_end" && typeof event.toolName === "string") {
      this.onEvent({ type: "tool-end", toolName: event.toolName, failed: event.isError === true });
    } else if (event.type === "process_error") {
      const message = typeof event.error === "string" ? event.error : "Pi process failed";
      this.onEvent({ type: "failed", message });
      this.rejectSettle?.(new Error(message));
      this.onProcessFailure();
    }
  }
}

export class PiAdapter {
  private readonly sessions = new Map<string, PiSession>();
  private readonly starting = new Map<string, Promise<PiSession>>();
  private installation: Promise<void> | undefined;

  public constructor(
    private readonly options: {
      command: string;
      commandArguments?: readonly string[];
      sessionRoot: string;
      installationRoot?: string;
      maxSessions: number;
    },
  ) {}

  public getCapabilities(): ReadonlySet<HarnessCapability> {
    return new Set(["install", "authStatus", "streaming", "sessionResume"]);
  }

  public async detect(): Promise<{ installed: boolean; version: string | null }> {
    try {
      const executable = await this.resolveExecutable();
      const result = await executeFile(executable.command, [...executable.arguments, "--version"], {
        shell: false,
        windowsHide: true,
        timeout: 10_000,
        maxBuffer: 64 * 1024,
      });
      return { installed: true, version: result.stdout.trim() || null };
    } catch {
      return { installed: false, version: null };
    }
  }

  public async install(): Promise<void> {
    if (this.installation !== undefined) return this.installation;
    this.installation = this.performInstall();
    try {
      await this.installation;
    } finally {
      this.installation = undefined;
    }
  }

  private async performInstall(): Promise<void> {
    if (process.platform === "win32") throw new Error("Pi installation is supported on the Linux MVP host");
    const installationRoot = this.installationRoot();
    await fs.mkdir(installationRoot, { recursive: true, mode: 0o700 });
    await executeFile(
      "npm",
      [
        "install",
        "--prefix",
        installationRoot,
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "@earendil-works/pi-coding-agent@0.85.1",
      ],
      {
        shell: false,
        windowsHide: true,
        timeout: 5 * 60_000,
        maxBuffer: 1024 * 1024,
      },
    );
  }

  public async getAuthStatus(cwd: string): Promise<{ authenticated: boolean; providers: readonly string[] }> {
    const executable = await this.resolveExecutable();
    const client = new PiRpcClient({
      command: executable.command,
      arguments: [...executable.arguments, "--mode", "rpc", "--no-session", "--no-approve"],
      cwd: await fs.realpath(cwd),
    });
    try {
      const response = await client.command("get_available_models", {}, 30_000);
      const data = objectValue(response.data);
      const models = Array.isArray(data.models) ? data.models : [];
      const providers = [
        ...new Set(
          models
            .map((model) => objectValue(model).provider)
            .filter((provider): provider is string => typeof provider === "string"),
        ),
      ].sort();
      return { authenticated: models.length > 0, providers };
    } finally {
      await client.close();
    }
  }

  public async startSession(input: {
    projectId: string;
    cwd: string;
    name: string;
    externalSessionId?: string;
    onEvent: (event: HarnessEvent) => void;
  }): Promise<PiSession> {
    const existing = this.sessions.get(input.projectId);
    if (existing !== undefined) {
      existing.setEventHandler(input.onEvent);
      return existing;
    }
    const starting = this.starting.get(input.projectId);
    if (starting !== undefined) return starting;
    if (this.sessions.size + this.starting.size >= this.options.maxSessions) {
      throw new Error("Harness session concurrency limit reached");
    }

    const promise = this.createSession(input);
    this.starting.set(input.projectId, promise);
    try {
      return await promise;
    } finally {
      this.starting.delete(input.projectId);
    }
  }

  private async createSession(input: {
    projectId: string;
    cwd: string;
    name: string;
    externalSessionId?: string;
    onEvent: (event: HarnessEvent) => void;
  }): Promise<PiSession> {
    const cwd = await fs.realpath(input.cwd);
    const executable = await this.resolveExecutable();
    const sessionDirectory = path.join(this.options.sessionRoot, input.projectId);
    await fs.mkdir(sessionDirectory, { recursive: true, mode: 0o700 });
    const arguments_ = [
      ...executable.arguments,
      "--mode",
      "rpc",
      "--session-dir",
      sessionDirectory,
      "--name",
      input.name,
      "--no-approve",
    ];
    if (input.externalSessionId !== undefined) arguments_.push("--session", input.externalSessionId);
    const client = new PiRpcClient({ command: executable.command, arguments: arguments_, cwd });
    try {
      const response = await client.command("get_state", {}, 30_000);
      const data = objectValue(response.data);
      if (typeof data.sessionId !== "string" || data.sessionId === "")
        throw new Error("Pi did not provide a session ID");
      const session = new PiSession(input.projectId, client, data.sessionId, input.onEvent, () => {
        if (this.sessions.get(input.projectId) === session) this.sessions.delete(input.projectId);
      });
      this.sessions.set(input.projectId, session);
      return session;
    } catch (error) {
      await client.close();
      throw error;
    }
  }

  private installationRoot(): string {
    return this.options.installationRoot ?? path.resolve(this.options.sessionRoot, "..", "tools");
  }

  private async resolveExecutable(): Promise<{ command: string; arguments: readonly string[] }> {
    if (this.options.commandArguments !== undefined || this.options.command !== "pi") {
      return { command: this.options.command, arguments: this.options.commandArguments ?? [] };
    }
    const localBinary =
      process.platform === "win32"
        ? path.join(
            this.installationRoot(),
            "node_modules",
            "@earendil-works",
            "pi-coding-agent",
            "dist",
            "bundle",
            "cli.js",
          )
        : path.join(this.installationRoot(), "node_modules", ".bin", "pi");
    try {
      await fs.access(localBinary);
      return process.platform === "win32"
        ? { command: process.execPath, arguments: [localBinary] }
        : { command: localBinary, arguments: [] };
    } catch {
      return { command: this.options.command, arguments: [] };
    }
  }

  public getSession(projectId: string): PiSession | undefined {
    return this.sessions.get(projectId);
  }

  public async stopSession(projectId: string): Promise<void> {
    await this.sessions.get(projectId)?.stop();
  }

  public async dispose(): Promise<void> {
    await Promise.allSettled(this.starting.values());
    await Promise.all([...this.sessions.values()].map(async (session) => session.close()));
    this.sessions.clear();
    this.starting.clear();
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
