import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { resolvePiSessionHistory } from "../src/infrastructure/pi/session-history.js";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-history-"));
  roots.push(root);
  const directory = path.join(root, "one");
  fs.mkdirSync(directory);
  const id = "12345678-abcd-4321-abcd-123456789012";
  const file = path.join(directory, `2026-01-01T00-00-00-000Z_${id}.jsonl`);
  const header = { type: "session", id, version: 3, cwd: root };
  return { root, directory, id, file, header };
}
it("distinguishes known never-dispatched missing history from unknown missing history", async () => {
  const e = setup();
  await expect(resolvePiSessionHistory(e.directory, e.id, e.root, e.file)).resolves.toBeUndefined();
  await expect(resolvePiSessionHistory(e.directory, e.id, e.root)).rejects.toMatchObject({
    name: "PiSessionHistoryError",
  });
});
it("resolves only the exact full ID and preserves bytes", async () => {
  const e = setup();
  const bytes = JSON.stringify(e.header) + "\n";
  fs.writeFileSync(e.file, bytes);
  await expect(resolvePiSessionHistory(e.directory, e.id, e.root)).resolves.toBe(e.file);
  expect(fs.readFileSync(e.file, "utf8")).toBe(bytes);
  await expect(resolvePiSessionHistory(e.directory, e.id.slice(0, 8), e.root)).rejects.toThrow(
    /safely resolved/,
  );
});
for (const invalid of [
  "corrupt",
  "wrong-id",
  "wrong-cwd",
  "symlink",
  "duplicate",
  "bad-filename",
  "corrupt-entry",
  "directory",
] as const) {
  it(`fails closed on ${invalid}, never interpreting it as absent history`, async () => {
    const e = setup();
    fs.writeFileSync(
      e.file,
      JSON.stringify({
        ...e.header,
        ...(invalid === "wrong-id" ? { id: "other" } : {}),
        ...(invalid === "wrong-cwd" ? { cwd: "/other" } : {}),
      }) + "\n",
    );
    if (invalid === "corrupt") fs.writeFileSync(e.file, "bad JSON");
    if (invalid === "corrupt-entry") fs.appendFileSync(e.file, "bad JSON\n");
    if (invalid === "symlink") {
      const target = path.join(e.root, "outside");
      fs.renameSync(e.file, target);
      fs.symlinkSync(target, e.file);
    }
    if (invalid === "duplicate") fs.copyFileSync(e.file, e.file.replace("2026-01", "2026-02"));
    if (invalid === "bad-filename") fs.renameSync(e.file, path.join(e.directory, `bad_${e.id}.jsonl`));
    if (invalid === "directory") {
      fs.rmSync(e.file);
      fs.mkdirSync(e.file);
    }
    await expect(resolvePiSessionHistory(e.directory, e.id, e.root, e.file)).rejects.toMatchObject({
      name: "PiSessionHistoryError",
    });
  });
}
it("fails closed on permission/I/O errors and a symlinked project directory", async () => {
  const e = setup();
  vi.spyOn(fsp, "readdir").mockRejectedValueOnce(
    Object.assign(new Error("private path"), { code: "EACCES" }),
  );
  await expect(resolvePiSessionHistory(e.directory, e.id, e.root, e.file)).rejects.toThrow(/safely resolved/);
  fs.renameSync(e.directory, path.join(e.root, "outside"));
  fs.symlinkSync(path.join(e.root, "outside"), e.directory);
  await expect(resolvePiSessionHistory(e.directory, e.id, e.root, e.file)).rejects.toThrow(/safely resolved/);
});
it("does not recover from foreign or traversal references", async () => {
  const e = setup();
  await expect(
    resolvePiSessionHistory(e.directory, e.id, e.root, path.join(e.root, path.basename(e.file))),
  ).rejects.toThrow();
  await expect(resolvePiSessionHistory(e.directory, "../other", e.root, e.file)).rejects.toThrow();
});
