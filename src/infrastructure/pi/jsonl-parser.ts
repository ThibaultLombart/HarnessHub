import { StringDecoder } from "node:string_decoder";

export class JsonlParser {
  private readonly decoder = new StringDecoder("utf8");
  private buffer = "";

  public constructor(
    private readonly onRecord: (record: unknown) => void,
    private readonly maximumRecordBytes = 1024 * 1024,
  ) {}

  public push(chunk: Buffer): void {
    this.buffer += this.decoder.write(chunk);
    this.drain(false);
    this.assertBound();
  }

  public end(): void {
    this.buffer += this.decoder.end();
    this.drain(true);
    this.assertBound();
  }

  private drain(flush: boolean): void {
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = stripCarriageReturn(this.buffer.slice(0, newline));
      this.buffer = this.buffer.slice(newline + 1);
      this.parseLine(line);
      newline = this.buffer.indexOf("\n");
    }
    if (flush && this.buffer !== "") {
      const line = stripCarriageReturn(this.buffer);
      this.buffer = "";
      this.parseLine(line);
    }
  }

  private parseLine(line: string): void {
    if (line.length > 0) this.onRecord(JSON.parse(line) as unknown);
  }

  private assertBound(): void {
    if (Buffer.byteLength(this.buffer, "utf8") > this.maximumRecordBytes) {
      throw new Error("RPC record exceeds maximum size");
    }
  }
}

function stripCarriageReturn(value: string): string {
  return value.endsWith("\r") ? value.slice(0, -1) : value;
}
