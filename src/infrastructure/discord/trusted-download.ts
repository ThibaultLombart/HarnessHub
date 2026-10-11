export type TrustedDiscordDownloadOptions = {
  readonly maximumBytes: number;
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
};

const defaultTimeoutMs = 30_000;

export async function downloadTrustedDiscordAttachment(
  url: string,
  options: TrustedDiscordDownloadOptions,
): Promise<Uint8Array> {
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const fetchImplementation = options.fetch ?? fetch;
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);
  try {
    const response = await fetchImplementation(url, { signal: abortController.signal });
    if (!response.ok || response.body === null) throw new Error("Could not download Discord attachment");
    const declaredLength = parseContentLength(response.headers.get("content-length"));
    if (declaredLength !== null && declaredLength > options.maximumBytes) {
      await response.body.cancel();
      throw new Error("Uploaded file is too large");
    }
    return await readBounded(response.body, options.maximumBytes, abortController);
  } catch (error) {
    if (error instanceof Error && error.message === "Uploaded file is too large") throw error;
    throw new Error("Could not download Discord attachment", { cause: error });
  } finally {
    clearTimeout(timeout);
    abortController.abort();
  }
}

async function readBounded(
  body: ReadableStream<Uint8Array>,
  maximumBytes: number,
  abortController: AbortController,
): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    let result = await reader.read();
    while (!result.done) {
      total += result.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        abortController.abort();
        throw new Error("Uploaded file is too large");
      }
      chunks.push(result.value);
      result = await reader.read();
    }
  } finally {
    reader.releaseLock();
  }
  const content = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    content.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return content;
}

function parseContentLength(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}
