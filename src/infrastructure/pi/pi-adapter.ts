import fs from "node:fs/promises";
import { safeToolName, type UiResponse } from "../../domain/live-interface.js";
import { decodeSubagentWidget } from "./subagent-widget.js";
import { PiUiRequests } from "./ui-requests.js";
import { PiSessionHistoryError, resolvePiSessionHistory } from "./session-history.js";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  assertOperationActive,
  SessionStoppedError,
  SessionBusyError,
  type HarnessCapability,
  type HarnessEvent,
} from "../../domain/harness.js";
import type { ModelDescriptor } from "../../domain/model.js";
export { SessionBusyError, SessionStoppedError } from "../../domain/harness.js";
import { PiRpcClient, type RpcRecord } from "./rpc-client.js";

const executeFile = promisify(execFile);

type StartSessionInput = {
  projectId: string;
  signal?: AbortSignal;
  cwd: string;
  name: string;
  modelPattern?: string;
  externalSessionId?: string;
  onEvent: (event: HarnessEvent) => void;
};

export class PiInitializationUiUnsupportedError extends Error {
  public constructor() {
    super(
      "Pi initialization dialogs are unsupported with installed Pi 0.85.1: RPC input starts after session_start. Disable the startup dialog in the reviewed extension; an upstream upgrade requires separate verification. No approval was sent.",
    );
    this.name = "PiInitializationUiUnsupportedError";
  }
}

export class NativePiCommandUnsupportedError extends Error {
  public constructor() {
    super(
      "Native Pi slash commands are unsupported in Discord: inline commands have no verified agent-settled completion contract. Use an ordinary prompt or HarnessHub session controls. Nothing was dispatched.",
    );
    this.name = "NativePiCommandUnsupportedError";
  }
}

export class PiPromptLifecycleUnsupportedError extends Error {
  public constructor() {
    super(
      "Pi prompt produced no supported lifecycle activity for 5 seconds outside a human dialog or active model/compaction/retry. Input hooks returning handled and silent preflight are unsupported. The process was terminated; completion was not verified. Use /session resume without replaying this prompt and review the extension locally.",
    );
    this.name = "PiPromptLifecycleUnsupportedError";
  }
}

export class PiSession {
  public externalSessionId: string;
  private readonly ui: PiUiRequests;
  public initializationError: Error | undefined;
  private closed = false;
  private closing: Promise<void> | undefined;
  private busy = false;
  private settle: (() => void) | undefined;
  private rejectSettle: ((error: Error) => void) | undefined;
  private stopRequested = false;
  private stopping = false;
  private promptStartTimer: NodeJS.Timeout | undefined;
  private agentStarted = false;
  private everDispatchedAgent = false;
  private promptSettled = false;
  private readonly preflightWork = new Set<string>();

  public constructor(
    public readonly projectId: string,
    private readonly client: PiRpcClient,
    externalSessionId: string,
    private currentModel: Readonly<{ provider: string; id: string }> | null,
    private onEvent: (event: HarnessEvent) => void,
    private readonly onProcessFailure: () => void,
  ) {
    this.externalSessionId = externalSessionId;
    this.ui = new PiUiRequests(
      client,
      (event) => {
        this.refreshPromptStartWatchdog();
        this.onEvent(event);
      },
      () => {
        void this.close();
        this.onProcessFailure();
      },
    );
    this.client.onEvent((event) => this.handleEvent(event));
  }

  public get hasDispatchedAgent(): boolean {
    return this.everDispatchedAgent;
  }

  public get isClosed(): boolean {
    return this.closed;
  }

  public get isBusy(): boolean {
    return this.busy || this.stopping;
  }

  public get model(): Readonly<{ provider: string; id: string }> | null {
    return this.currentModel;
  }

  public setEventHandler(onEvent: (event: HarnessEvent) => void): void {
    this.onEvent = onEvent;
  }

  public async sendPrompt(message: string): Promise<string> {
    if (this.closed) throw new Error("Pi session is closed");
    if (this.isBusy) throw new SessionBusyError();
    if (message.trim() === "") throw new Error("Prompt must not be empty");
    if (message.trimStart().startsWith("/")) throw new NativePiCommandUnsupportedError();
    this.busy = true;
    this.stopRequested = false;
    this.agentStarted = false;
    this.promptSettled = false;
    this.preflightWork.clear();
    this.onEvent({ type: "working" });
    const settled = new Promise<void>((resolve, reject) => {
      this.settle = resolve;
      this.rejectSettle = reject;
    });
    void settled.catch(() => undefined);
    try {
      this.refreshPromptStartWatchdog();
      await Promise.all([
        // The start watchdog owns preflight bounds; human dialogs and active work
        // must not inherit an arbitrary command/run-duration deadline.
        this.client.command("prompt", { message }, 0).then(() => this.refreshPromptStartWatchdog()),
        settled,
      ]);
      if (this.wasStopRequested()) throw new SessionStoppedError();
      const response = await this.client.command("get_last_assistant_text");
      const data = objectValue(response.data);
      return typeof data.text === "string" && data.text !== ""
        ? data.text
        : "Pi completed without a text response.";
    } catch (error) {
      if (this.wasStopRequested()) throw new SessionStoppedError();
      await this.close();
      this.onProcessFailure();
      throw error;
    } finally {
      clearTimeout(this.promptStartTimer);
      this.busy = false;
      this.settle = undefined;
      this.rejectSettle = undefined;
    }
  }

  public async setModel(provider: string, modelId: string): Promise<void> {
    await this.client.command("set_model", { provider, modelId }, 30_000);
    this.currentModel = { provider, id: modelId };
  }

  public async stop(): Promise<void> {
    if (this.closed) return this.close();
    this.stopping = true;
    this.stopRequested = true;
    try {
      // abort() cannot cancel an awaited before_agent_start callback in Pi 0.85.1.
      // Terminate before releasing UI callbacks; never reuse this runtime on resume.
      await this.close();
      this.onProcessFailure();
    } finally {
      this.stopping = false;
    }
  }

  public async respondUi(sessionId: string, requestId: string, response: UiResponse): Promise<void> {
    if ("choice" in response) await this.ui.select(sessionId, requestId, response.choice);
    else await this.ui.respond(sessionId, requestId, response);
  }

  public initialize(
    externalSessionId: string,
    model: Readonly<{ provider: string; id: string }> | null,
  ): void {
    if (this.closed) throw new Error("Pi session closed during initialization");
    this.externalSessionId = externalSessionId;
    this.currentModel = model;
  }

  public close(): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    this.closed = true;
    clearTimeout(this.promptStartTimer);
    this.rejectSettle?.(new SessionStoppedError());
    // Signal the process synchronously, before any UI delivery can unblock preflight.
    const processClosed = this.client.close();
    this.closing = (async () => {
      await this.ui.clear(true);
      await processClosed;
    })();
    return this.closing;
  }

  private wasStopRequested(): boolean {
    return this.stopRequested;
  }

  private refreshPromptStartWatchdog(): void {
    clearTimeout(this.promptStartTimer);
    if (
      !this.busy ||
      this.closed ||
      this.stopRequested ||
      this.agentStarted ||
      this.promptSettled ||
      this.preflightWork.size > 0 ||
      this.ui.hasPending
    )
      return;
    // No run-duration deadline: this applies only before a supported agent lifecycle.
    this.promptStartTimer = setTimeout(() => {
      this.rejectSettle?.(new PiPromptLifecycleUnsupportedError());
    }, 5_000);
    this.promptStartTimer.unref();
  }

  private handleEvent(event: RpcRecord): void {
    if (this.closed) return;
    if (event.type === "agent_start" || event.type === "turn_start") {
      this.agentStarted = true;
      this.everDispatchedAgent = true;
    }
    if (event.type === "compaction_start") this.preflightWork.add("compaction");
    if (event.type === "compaction_end") this.preflightWork.delete("compaction");
    if (event.type === "auto_retry_start" || event.type === "summarization_retry_attempt_start")
      this.preflightWork.add("retry");
    if (event.type === "auto_retry_end" || event.type === "summarization_retry_finished")
      this.preflightWork.delete("retry");
    if (event.type === "agent_settled") this.promptSettled = true;
    if (
      [
        "agent_start",
        "turn_start",
        "compaction_start",
        "compaction_end",
        "auto_retry_start",
        "auto_retry_end",
        "summarization_retry_attempt_start",
        "summarization_retry_finished",
        "agent_settled",
      ].includes(String(event.type))
    )
      this.refreshPromptStartWatchdog();
    if (event.type === "extension_ui_request") {
      if (
        this.externalSessionId === "" &&
        ["select", "confirm", "input", "editor"].includes(String(event.method))
      ) {
        this.initializationError = new PiInitializationUiUnsupportedError();
        void this.close();
        return;
      }
      this.ui.receive(event);
      const agents = decodeSubagentWidget(event);
      if (agents !== undefined) this.onEvent({ type: "subagents", agents });
    } else if (event.type === "agent_start") {
      this.onEvent({ type: "agent-start" });
    } else if (event.type === "turn_start") {
      this.onEvent({ type: "turn-start" });
    } else if (event.type === "message_start") {
      this.onEvent({ type: "message-start" });
    } else if (event.type === "message_end") {
      this.onEvent({ type: "message-end" });
      const message = objectValue(event.message);
      if (message.role === "assistant" && Array.isArray(message.content)) {
        // Only finalized public text, never thinking/deltas or tool results.
        const text = message.content
          .slice(0, 20)
          .flatMap((part) => {
            const block = objectValue(part);
            return block.type === "text" && typeof block.text === "string"
              ? [block.text.slice(0, 16_385)]
              : [];
          })
          .join(" ");
        if (text !== "") this.onEvent({ type: "public-explanation", text });
      }
    } else if (event.type === "agent_settled") {
      void this.ui.clear();
      this.onEvent({ type: "settled" });
      this.settle?.();
    } else if (event.type === "tool_execution_start" && typeof event.toolName === "string") {
      this.onEvent({ type: "tool-start", toolName: safeToolName(event.toolName) });
    } else if (event.type === "tool_execution_update" && typeof event.toolName === "string") {
      this.onEvent({ type: "tool-update", toolName: safeToolName(event.toolName) });
    } else if (event.type === "tool_execution_end" && typeof event.toolName === "string") {
      this.onEvent({
        type: "tool-end",
        toolName: safeToolName(event.toolName),
        failed: event.isError === true,
      });
    } else if (event.type === "compaction_start") {
      this.onEvent({ type: "compaction-start" });
    } else if (event.type === "compaction_end") {
      this.onEvent({ type: "compaction-end" });
    } else if (event.type === "auto_retry_start" || event.type === "summarization_retry_attempt_start") {
      this.onEvent({ type: "retry-start" });
    } else if (event.type === "auto_retry_end" || event.type === "summarization_retry_finished") {
      this.onEvent({ type: "retry-end", failed: event.success === false });
    } else if (event.type === "process_error") {
      const message = typeof event.error === "string" ? event.error : "Pi process failed";
      this.rejectSettle?.(new Error(message));
      void this.close()
        .then(() => this.onProcessFailure())
        .catch(() => undefined);
      this.onEvent({ type: "failed", message });
    }
  }
}

export class PiAdapter {
  private readonly sessions = new Map<string, PiSession>();
  private readonly unpersistedSessions = new Map<string, { id: string; file: string; generation: symbol }>();
  private readonly startControllers = new Map<string, AbortController>();
  private readonly discoveryClients = new Set<PiRpcClient>();
  private readonly starting = new Map<string, Promise<PiSession>>();
  private readonly restarting = new Map<string, Promise<void>>();
  private installation: Promise<void> | undefined;
  private disposed = false;

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
    return new Set(["install", "authStatus", "streaming", "sessionResume", "sessionRestart"]);
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
    const canonicalCwd = await fs.realpath(cwd);
    this.assertOpen();
    const client = new PiRpcClient({
      command: executable.command,
      arguments: [
        ...executable.arguments,
        "--mode",
        "rpc",
        "--no-session",
        "--no-approve",
        "--no-extensions",
        "--no-skills",
        "--no-prompt-templates",
        "--no-themes",
        "--no-context-files",
      ],
      cwd: canonicalCwd,
    });
    this.discoveryClients.add(client);
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
      this.discoveryClients.delete(client);
      await client.close();
    }
  }

  public async listModels(cwd: string): Promise<readonly ModelDescriptor[]> {
    const executable = await this.resolveExecutable();
    const canonicalCwd = await fs.realpath(cwd);
    this.assertOpen();
    const client = new PiRpcClient({
      command: executable.command,
      arguments: [
        ...executable.arguments,
        "--mode",
        "rpc",
        "--no-session",
        "--no-approve",
        "--no-extensions",
        "--no-skills",
        "--no-prompt-templates",
        "--no-themes",
        "--no-context-files",
      ],
      cwd: canonicalCwd,
    });
    this.discoveryClients.add(client);
    try {
      const response = await client.command("get_available_models", {}, 30_000);
      const data = objectValue(response.data);
      const models = Array.isArray(data.models) ? data.models : [];
      return models.flatMap((model): ModelDescriptor[] => {
        const value = objectValue(model);
        const provider = typeof value.provider === "string" ? value.provider : "";
        const id =
          typeof value.id === "string" ? value.id : typeof value.modelId === "string" ? value.modelId : "";
        if (provider === "" || id === "") return [];
        const name = typeof value.name === "string" ? value.name : "";
        return [{ provider, id, label: name }];
      });
    } finally {
      this.discoveryClients.delete(client);
      await client.close();
    }
  }

  public async startSession(input: StartSessionInput): Promise<PiSession> {
    this.assertOpen();
    assertOperationActive(input.signal);
    const starting = this.starting.get(input.projectId);
    if (starting !== undefined) return starting;

    const controller = new AbortController();
    const cancel = (): void => controller.abort();
    input.signal?.addEventListener("abort", cancel, { once: true });
    this.startControllers.set(input.projectId, controller);
    const promise = this.acquireSession({ ...input, signal: controller.signal });
    this.starting.set(input.projectId, promise);
    try {
      const session = await promise;
      assertOperationActive(controller.signal);
      return session;
    } finally {
      input.signal?.removeEventListener("abort", cancel);
      if (this.startControllers.get(input.projectId) === controller)
        this.startControllers.delete(input.projectId);
      if (this.starting.get(input.projectId) === promise) this.starting.delete(input.projectId);
    }
  }

  private async acquireSession(input: StartSessionInput): Promise<PiSession> {
    const restart = this.restarting.get(input.projectId);
    if (restart !== undefined) await restart;
    this.assertOpen();
    assertOperationActive(input.signal);
    const existing = this.sessions.get(input.projectId);
    if (existing !== undefined) {
      if (existing.isClosed) {
        await existing.close();
        if (existing.hasDispatchedAgent) this.unpersistedSessions.delete(input.projectId);
        if (this.sessions.get(input.projectId) === existing) this.sessions.delete(input.projectId);
      } else {
        if (existing.isBusy) throw new SessionBusyError();
        existing.setEventHandler(input.onEvent);
        return existing;
      }
    }
    const projects = new Set([...this.sessions.keys(), ...this.starting.keys(), input.projectId]);
    if (projects.size > this.options.maxSessions)
      throw new Error("Harness session concurrency limit reached");
    return this.createSession(input);
  }

  private async createSession(input: StartSessionInput): Promise<PiSession> {
    assertOperationActive(input.signal);
    const cwd = await fs.realpath(input.cwd);
    assertOperationActive(input.signal);
    const executable = await this.resolveExecutable();
    assertOperationActive(input.signal);
    await fs.mkdir(this.options.sessionRoot, { recursive: true, mode: 0o700 });
    const sessionRoot = await fs.realpath(this.options.sessionRoot);
    if (path.basename(input.projectId) !== input.projectId || [".", "..", ""].includes(input.projectId))
      throw new PiSessionHistoryError();
    const sessionDirectory = path.join(sessionRoot, input.projectId);
    await fs.mkdir(sessionDirectory, { recursive: true, mode: 0o700 });
    if ((await fs.realpath(sessionDirectory)) !== sessionDirectory) throw new PiSessionHistoryError();
    assertOperationActive(input.signal);
    let resumeFile: string | undefined;
    let historyUnavailable = false;
    if (input.externalSessionId !== undefined) {
      const known = this.unpersistedSessions.get(input.projectId);
      resumeFile = await resolvePiSessionHistory(
        sessionDirectory,
        input.externalSessionId,
        cwd,
        known?.id === input.externalSessionId ? known.file : undefined,
      );
      historyUnavailable = resumeFile === undefined;
      assertOperationActive(input.signal);
    }
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
    if (input.modelPattern !== undefined) arguments_.push("--model", input.modelPattern);
    if (resumeFile !== undefined) arguments_.push("--session", resumeFile);
    this.assertOpen();
    const client = new PiRpcClient({ command: executable.command, arguments: arguments_, cwd });
    // Observe startup dialogs only to fail promptly: Pi 0.85.1 cannot read their responses yet.
    const generation = Symbol();
    const session = new PiSession(input.projectId, client, "", null, input.onEvent, () => {
      if (
        this.unpersistedSessions.get(input.projectId)?.generation === generation &&
        session.hasDispatchedAgent
      )
        this.unpersistedSessions.delete(input.projectId);
      if (this.sessions.get(input.projectId) === session) this.sessions.delete(input.projectId);
    });
    this.sessions.set(input.projectId, session);
    const cancel = (): void => {
      void session.close();
    };
    input.signal?.addEventListener("abort", cancel, { once: true });
    try {
      const response = await client.command("get_state", {}, 30_000);
      assertOperationActive(input.signal);
      const data = objectValue(response.data);
      if (typeof data.sessionId !== "string" || data.sessionId === "")
        throw new Error("Pi did not provide a session ID");
      const stateModel = objectValue(data.model);
      const model =
        typeof stateModel.provider === "string" && typeof stateModel.id === "string"
          ? { provider: stateModel.provider, id: stateModel.id }
          : null;
      session.initialize(data.sessionId, model);
      this.unpersistedSessions.delete(input.projectId);
      if (resumeFile === undefined && data.messageCount === 0 && typeof data.sessionFile === "string") {
        this.unpersistedSessions.set(input.projectId, {
          id: data.sessionId,
          file: data.sessionFile,
          generation,
        });
      }
      if (historyUnavailable) input.onEvent({ type: "history-unavailable" });
      return session;
    } catch (error) {
      if (this.sessions.get(input.projectId) === session) this.sessions.delete(input.projectId);
      await session.close();
      if (input.signal?.aborted === true) throw new SessionStoppedError();
      throw session.initializationError ?? error;
    } finally {
      input.signal?.removeEventListener("abort", cancel);
    }
  }

  private assertOpen(): void {
    if (this.disposed) throw new Error("Pi adapter is closed");
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
    this.startControllers.get(projectId)?.abort();
    await this.sessions.get(projectId)?.stop();
  }

  public async restartSession(projectId: string): Promise<void> {
    if (this.starting.has(projectId) || this.restarting.has(projectId)) throw new SessionBusyError();
    const session = this.sessions.get(projectId);
    if (session === undefined) return;
    if (session.isBusy) throw new SessionBusyError();
    const restart = (async (): Promise<void> => {
      await session.close();
      if (this.sessions.get(projectId) === session) {
        if (session.hasDispatchedAgent) this.unpersistedSessions.delete(projectId);
        this.sessions.delete(projectId);
      }
    })();
    this.restarting.set(projectId, restart);
    try {
      await restart;
    } finally {
      if (this.restarting.get(projectId) === restart) this.restarting.delete(projectId);
    }
  }

  public async setSessionModel(projectId: string, provider: string, modelId: string): Promise<void> {
    await this.sessions.get(projectId)?.setModel(provider, modelId);
  }

  public async installPackageResource(input: {
    scope: "global" | "project";
    cwd: string;
    source: string;
  }): Promise<void> {
    await this.runPiPackageCommand(
      ["install", ...(input.scope === "project" ? ["-l"] : []), input.source],
      input.cwd,
    );
  }

  public async removePackageResource(input: {
    scope: "global" | "project";
    cwd: string;
    source: string;
  }): Promise<void> {
    await this.runPiPackageCommand(
      ["remove", ...(input.scope === "project" ? ["-l"] : []), input.source],
      input.cwd,
    );
  }

  private async runPiPackageCommand(arguments_: readonly string[], cwd: string): Promise<void> {
    const executable = await this.resolveExecutable();
    await executeFile(executable.command, [...executable.arguments, ...arguments_], {
      cwd: await fs.realpath(cwd),
      shell: false,
      windowsHide: true,
      timeout: 5 * 60_000,
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o StrictHostKeyChecking=yes",
      },
    });
  }

  public async dispose(): Promise<void> {
    this.disposed = true;
    for (const controller of this.startControllers.values()) controller.abort();
    await Promise.all([...this.discoveryClients].map(async (client) => client.close()));
    await Promise.all([...this.sessions.values()].map(async (session) => session.close()));
    await Promise.allSettled([...this.starting.values(), ...this.restarting.values()]);
    this.sessions.clear();
    this.unpersistedSessions.clear();
    this.starting.clear();
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
