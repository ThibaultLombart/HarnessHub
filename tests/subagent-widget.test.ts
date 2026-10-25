import { describe, expect, it } from "vitest";
import { decodeSubagentWidget } from "../src/infrastructure/pi/subagent-widget.js";

describe("Pi subagent widget envelope", () => {
  it("honors the actual RPC clear-widget contract rather than retaining stale roles", () => {
    expect(decodeSubagentWidget({ method: "setWidget", widgetKey: "subagent-async" })).toEqual([]);
    expect(decodeSubagentWidget({ method: "setWidget", widgetKey: "other" })).toBeUndefined();
  });
  it("ignores malformed/oversized widgets and never invents states for unknown versions", () => {
    const envelope = { method: "setWidget", widgetKey: "subagent-async" };
    expect(
      decodeSubagentWidget({ ...envelope, widgetLines: ["PI_SUBAGENT_ASYNC_JSON:invalid"] }),
    ).toBeUndefined();
    expect(decodeSubagentWidget({ ...envelope, widgetLines: ["x".repeat(40_001)] })).toBeUndefined();
    expect(
      decodeSubagentWidget({
        ...envelope,
        widgetLines: [
          'PI_SUBAGENT_ASYNC_JSON:{"kind":"pi-subagents.async-status-snapshot","version":2,"runs":[{"state":"success"}]}',
        ],
      }),
    ).toEqual([]);
  });
});
