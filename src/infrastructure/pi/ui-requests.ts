import { randomUUID } from "node:crypto";
import type { HarnessEvent } from "../../domain/harness.js";
import { publicText, suppressedText, type UiRequest, type UiResponse } from "../../domain/live-interface.js";
import type { PiRpcClient, RpcRecord } from "./rpc-client.js";

type Pending = {
  rpcId: string;
  request: UiRequest;
  originalOptions: readonly string[];
  timer: NodeJS.Timeout;
};

/** Process-owned correlation table. Claims are removed synchronously before I/O. */
export class PiUiRequests {
  public readonly sessionId = randomUUID();
  private readonly pending = new Map<string, Pending>();
  private readonly seen = new Set<string>();
  private closed = false;

  public constructor(
    private readonly client: PiRpcClient,
    private readonly emit: (event: HarnessEvent) => void,
    private readonly onLimit: () => void,
  ) {}

  public get hasPending(): boolean {
    return this.pending.size > 0;
  }

  public receive(event: RpcRecord): void {
    if (
      typeof event.id !== "string" ||
      !["select", "confirm", "input", "editor"].includes(String(event.method))
    )
      return;
    if (this.seen.has(event.id)) return;
    // Keep identity facts rather than evicting IDs and accepting replay.
    if (this.seen.size >= 4096 || event.id.length > 256 || event.id.length === 0) {
      void this.clear(true);
      this.onLimit();
      return;
    }
    this.seen.add(event.id);
    const options = Array.isArray(event.options) ? event.options : [];
    if (
      this.closed ||
      this.pending.size >= 4 ||
      options.length > 500 ||
      options.some((option) => typeof option !== "string" || option.length > 2048) ||
      (event.method === "select" && options.length === 0)
    ) {
      void this.client.respondUi(event.id, { cancelled: true }).catch(() => undefined);
      return;
    }
    const timeout =
      typeof event.timeout === "number" && Number.isFinite(event.timeout)
        ? Math.max(1, Math.min(300_000, event.timeout))
        : 300_000;
    const id = randomUUID();
    const request: UiRequest = {
      id,
      method: event.method as UiRequest["method"],
      title: publicText(typeof event.title === "string" ? event.title : "Pi requests a response", 700),
      message: publicText(typeof event.message === "string" ? event.message : "", 500),
      options: (options as string[]).map((option) => publicText(option, 90)),
      expiresAt: Date.now() + timeout,
    };
    // An administrator must see the full decision, not an opaque approval control.
    const originals = [
      typeof event.title === "string" ? event.title : "Pi requests a response",
      typeof event.message === "string" ? event.message : "",
      ...(options as string[]),
    ];
    const projected = [request.title, request.message, ...request.options];
    if (
      projected.some(
        (text, index) => text === suppressedText || text !== publicText(originals[index] ?? "", 16_384),
      )
    ) {
      void this.client.respondUi(event.id, { cancelled: true }).catch(() => this.onLimit());
      return;
    }
    const timer = setTimeout(() => {
      void this.respond(this.sessionId, id, { cancelled: true }).catch(() => undefined);
    }, timeout);
    timer.unref();
    this.pending.set(id, { rpcId: event.id, request, originalOptions: options as string[], timer });
    try {
      this.emit({ type: "ui-request", sessionId: this.sessionId, request });
    } catch {
      void this.respond(this.sessionId, id, { cancelled: true }).catch(() => undefined);
    }
  }

  public async respond(sessionId: string, id: string, response: UiResponse): Promise<void> {
    const pending = this.pending.get(id);
    if (sessionId !== this.sessionId || pending === undefined || this.closed)
      throw new Error("Question is stale or unavailable");
    if (Date.now() >= pending.request.expiresAt && !("cancelled" in response))
      throw new Error("Question expired");
    if (!("cancelled" in response)) {
      if (pending.request.method === "confirm") {
        if (!("confirmed" in response) || typeof response.confirmed !== "boolean")
          throw new Error("Invalid confirmation");
      } else if (
        !("value" in response) ||
        typeof response.value !== "string" ||
        response.value.length > 4096 ||
        (pending.request.method === "select" && !pending.originalOptions.includes(response.value))
      )
        throw new Error("Invalid answer");
    }
    this.pending.delete(id);
    clearTimeout(pending.timer);
    try {
      this.emit({ type: "ui-closed", sessionId: this.sessionId, requestId: id });
    } catch {
      /* Observer failure must not prevent protocol cancellation or delivery. */
    }
    await this.client.respondUi(pending.rpcId, response);
  }

  public async select(sessionId: string, id: string, index: number): Promise<void> {
    const value = this.pending.get(id)?.originalOptions[index];
    if (!Number.isInteger(index) || value === undefined) throw new Error("Invalid choice");
    await this.respond(sessionId, id, { value });
  }

  public async clear(close = false): Promise<void> {
    const responses = [...this.pending.keys()].map(async (id) =>
      this.respond(this.sessionId, id, { cancelled: true }),
    );
    if (close) this.closed = true;
    await Promise.allSettled(responses);
  }
}
