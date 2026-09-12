import { describe, expect, it, vi } from "vitest";
import { JsonlParser } from "../src/infrastructure/pi/jsonl-parser.js";

describe("JsonlParser", () => {
  it("uses only LF framing and preserves Unicode line separators", () => {
    const record = vi.fn();
    const parser = new JsonlParser(record);

    parser.push(Buffer.from('{"value":"a\u2028b"'));
    parser.push(Buffer.from('}\n{"value":2}\r\n'));
    parser.end();

    expect(record).toHaveBeenCalledTimes(2);
    expect(record.mock.calls[0]?.[0]).toEqual({ value: "a\u2028b" });
    expect(record.mock.calls[1]?.[0]).toEqual({ value: 2 });
  });

  it("accepts a large chunk containing individually bounded records", () => {
    const record = vi.fn();
    const parser = new JsonlParser(record, 8);
    parser.push(Buffer.from('{"a":1}\n{"b":2}\n'));
    expect(record).toHaveBeenCalledTimes(2);
  });

  it("rejects records over the configured bound", () => {
    const parser = new JsonlParser(() => undefined, 8);
    expect(() => parser.push(Buffer.from("123456789"))).toThrow(/maximum/i);
  });
});
