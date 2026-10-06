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

  it("rejects an oversized LF-terminated record before invoking the callback", () => {
    const record = vi.fn();
    const parser = new JsonlParser(record, 8);

    expect(() => parser.push(Buffer.from("123456789\n"))).toThrow(/maximum/i);
    expect(record).not.toHaveBeenCalled();
  });

  it("rejects an oversized CRLF-terminated record before invoking the callback", () => {
    const record = vi.fn();
    const parser = new JsonlParser(record, 8);

    expect(() => parser.push(Buffer.from("123456789\r\n"))).toThrow(/maximum/i);
    expect(record).not.toHaveBeenCalled();
  });

  it("rejects an oversized EOF-terminated record before invoking the callback", () => {
    const record = vi.fn();
    const parser = new JsonlParser(record, 1);

    expect(() => {
      parser.push(Buffer.from([0x31, 0xc3]));
      parser.end();
    }).toThrow(/maximum/i);
    expect(record).not.toHaveBeenCalled();
  });

  it("counts raw UTF-8 bytes across split multibyte characters", () => {
    const record = vi.fn();
    const parser = new JsonlParser(record, 10);
    const chunk = Buffer.from('"ééééé"\n');

    parser.push(chunk.subarray(0, 2));

    expect(() => parser.push(chunk.subarray(2))).toThrow(/maximum/i);
    expect(record).not.toHaveBeenCalled();
  });

  it("accepts a record exactly at the configured raw byte boundary", () => {
    const record = vi.fn();
    const parser = new JsonlParser(record, 8);

    parser.push(Buffer.from("12345678\n"));

    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(12_345_678);
  });

  it("accepts a CRLF record split at the configured raw byte boundary", () => {
    const record = vi.fn();
    const parser = new JsonlParser(record, 8);

    parser.push(Buffer.from("12345678\r"));
    parser.push(Buffer.from("\n"));

    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(12_345_678);
  });

  it("rejects records over the configured bound", () => {
    const parser = new JsonlParser(() => undefined, 8);
    expect(() => parser.push(Buffer.from("123456789"))).toThrow(/maximum/i);
  });
});
