import { StringDecoder } from "node:string_decoder";

export class JsonlParser {
  private decoder = new StringDecoder("utf8");
  private buffer = "";
  private recordBytes = 0;

  public constructor(
    private readonly onRecord: (record: unknown) => void,
    private readonly maximumRecordBytes = 1024 * 1024,
  ) {}

  public push(chunk: Buffer): void {
    let recordStart = 0;
    let newline = chunk.indexOf(0x0a, recordStart);

    while (newline >= 0) {
      this.appendRecordBytes(chunk.subarray(recordStart, newline));
      this.completeRecord();
      recordStart = newline + 1;
      newline = chunk.indexOf(0x0a, recordStart);
    }

    this.appendRecordBytes(chunk.subarray(recordStart));
  }

  public end(): void {
    this.buffer += this.decoder.end();
    this.assertBound();
    if (this.buffer !== "") this.completeRecord();
  }

  private appendRecordBytes(bytes: Buffer): void {
    if (bytes.length === 0) return;
    this.recordBytes += bytes.length;
    this.buffer += this.decoder.write(bytes);
    this.assertBound();
  }

  private completeRecord(): void {
    this.buffer += this.decoder.end();
    this.assertBound();
    const line = stripCarriageReturn(this.buffer);
    this.buffer = "";
    this.recordBytes = 0;
    this.decoder = new StringDecoder("utf8");
    this.parseLine(line);
  }

  private parseLine(line: string): void {
    if (line.length > 0) this.onRecord(JSON.parse(line) as unknown);
  }

  private assertBound(): void {
    if (this.effectiveRecordBytes() > this.maximumRecordBytes) {
      throw new Error("RPC record exceeds maximum size");
    }
  }

  private effectiveRecordBytes(): number {
    return this.buffer.endsWith("\r") ? this.recordBytes - 1 : this.recordBytes;
  }
}

function stripCarriageReturn(value: string): string {
  return value.endsWith("\r") ? value.slice(0, -1) : value;
}
