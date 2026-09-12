import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { JsonlParser } from "./jsonl-parser.js";

export type RpcRecord = Record<string, unknown>;

type PendingRequest = {
  resolve(value: RpcRecord): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
};

export class PiRpcClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly listeners = new Set<(event: RpcRecord) => void>();
  private closed = false;
  private stderr = "";

  public constructor(input: { command: string; arguments: readonly string[]; cwd: string }) {
    this.child = spawn(input.command, [...input.arguments], {
      cwd: input.cwd,
      env: { ...process.env, PI_SKIP_VERSION_CHECK: "1" },
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const parser = new JsonlParser((record) => this.handleRecord(record));
    this.child.stdout.on("data", (chunk: Buffer) => {
      try {
        parser.push(chunk);
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error("Invalid Pi RPC output"));
      }
    });
    this.child.stdout.on("end", () => {
      try {
        parser.end();
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error("Invalid Pi RPC output"));
      }
    });
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderr = `${this.stderr}${chunk.toString("utf8")}`.slice(-8192);
    });
    this.child.on("error", (error) => this.fail(error));
    this.child.on("exit", (code, signal) => {
      if (!this.closed) {
        const reason = code === null ? (signal ?? "unknown") : String(code);
        this.fail(new Error(`Pi process exited unexpectedly (${reason})`));
      }
    });
  }

  public onEvent(listener: (event: RpcRecord) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public async command(
    type: string,
    data: Readonly<Record<string, unknown>> = {},
    timeoutMs = 30_000,
  ): Promise<RpcRecord> {
    if (this.closed) throw new Error("Pi RPC process is closed");
    const id = randomUUID();
    const response = new Promise<RpcRecord>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Pi RPC command timed out: ${type}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    this.child.stdin.write(`${JSON.stringify({ id, type, ...data })}\n`, (error) => {
      if (error !== null && error !== undefined) this.rejectPending(id, error);
    });
    const result = await response;
    if (result.success !== true)
      throw new Error(typeof result.error === "string" ? result.error : `Pi rejected ${type}`);
    return result;
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const [id] of this.pending) this.rejectPending(id, new Error("Pi RPC process closed"));
    this.child.stdin.end();
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill("SIGKILL");
        resolve();
      }, 2_000);
      this.child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      this.child.kill("SIGTERM");
    });
  }

  private handleRecord(value: unknown): void {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      this.fail(new Error("Pi RPC emitted a non-object record"));
      return;
    }
    const record = value as RpcRecord;
    if (record.type === "response" && typeof record.id === "string") {
      const pending = this.pending.get(record.id);
      if (pending !== undefined) {
        clearTimeout(pending.timer);
        this.pending.delete(record.id);
        pending.resolve(record);
      }
      return;
    }
    for (const listener of this.listeners) listener(record);
  }

  private rejectPending(id: string, error: Error): void {
    const pending = this.pending.get(id);
    if (pending === undefined) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    pending.reject(error);
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    const safeError = new Error(`${error.message}${this.stderr === "" ? "" : "; Pi reported an error"}`);
    for (const [id] of this.pending) this.rejectPending(id, safeError);
    for (const listener of this.listeners) listener({ type: "process_error", error: safeError.message });
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill("SIGKILL");
  }
}
