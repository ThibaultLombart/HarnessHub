import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import readline from "node:readline";

export class PiSessionHistoryError extends Error {
  public constructor() {
    super(
      "Pi conversation history could not be safely resolved in this project's session directory. No replacement was started. Review local session storage; no prompt was replayed.",
    );
    this.name = "PiSessionHistoryError";
  }
}

/** Pi 0.85.1: <ISO timestamp with :/. replaced by ->_<full UUID>.jsonl,
 * with a session header containing the same id and cwd. Never delegate ID lookup
 * to Pi's prefix/global fallback. Only a process-owned missing file can recover.
 */
export async function resolvePiSessionHistory(
  directory: string,
  id: string,
  cwd: string,
  knownSessionFile?: string,
): Promise<string | undefined> {
  try {
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(id)) throw new PiSessionHistoryError();
    if ((await fs.realpath(directory)) !== directory || !(await fs.lstat(directory)).isDirectory())
      throw new PiSessionHistoryError();
    const suffix = `_${id}.jsonl`;
    const entries = (await fs.readdir(directory)).filter((name) => name.endsWith(suffix));
    const validName = (name: string): boolean =>
      /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z_[0-9a-f-]{36}\.jsonl$/u.test(name) &&
      name.endsWith(suffix);
    if (entries.length === 0) {
      if (
        knownSessionFile !== undefined &&
        path.dirname(knownSessionFile) === directory &&
        validName(path.basename(knownSessionFile))
      )
        return undefined;
      throw new PiSessionHistoryError();
    }
    const name = entries[0];
    if (entries.length !== 1 || name === undefined || !validName(name)) throw new PiSessionHistoryError();
    const file = path.join(directory, name);
    if (!(await fs.lstat(file)).isFile()) throw new PiSessionHistoryError();
    const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      if (!(await handle.stat()).isFile()) throw new PiSessionHistoryError();
      let first = true;
      for await (const line of readline.createInterface({
        input: handle.createReadStream({ autoClose: false }),
        crlfDelay: Infinity,
      })) {
        if (line.length === 0 || line.length > 16 * 1024 * 1024) throw new PiSessionHistoryError();
        const parsed: unknown = JSON.parse(line);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
          throw new PiSessionHistoryError();
        const record = parsed as Record<string, unknown>;
        if (typeof record.type !== "string") throw new PiSessionHistoryError();
        if (
          first &&
          (record.type !== "session" || record.id !== id || record.cwd !== cwd || record.version !== 3)
        )
          throw new PiSessionHistoryError();
        first = false;
      }
      if (first) throw new PiSessionHistoryError();
    } finally {
      await handle.close();
    }
    return file;
  } catch {
    throw new PiSessionHistoryError();
  }
}
