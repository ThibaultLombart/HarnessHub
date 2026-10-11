import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { downloadTrustedDiscordAttachment } from "../src/infrastructure/discord/trusted-download.js";

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error === undefined ? resolve() : reject(error))),
          ),
      ),
  );
});

describe("trusted Discord attachment download", () => {
  it("streams successful downloads without requiring a trustworthy content-length", async () => {
    const server = await listen((_, response) => {
      response.writeHead(200);
      response.end("hello");
    });

    await expect(
      downloadTrustedDiscordAttachment(server.url, { maximumBytes: 5, timeoutMs: 1_000 }),
    ).resolves.toEqual(new TextEncoder().encode("hello"));
  });

  it("cancels the response and rejects when the actual streamed bytes exceed the cap", async () => {
    let requestClosed = false;
    const server = await listen((request, response) => {
      request.on("close", () => {
        requestClosed = true;
      });
      response.writeHead(200);
      response.write(new Uint8Array([1, 2, 3]));
      setTimeout(() => response.end(new Uint8Array([4, 5, 6])), 10);
    });

    await expect(
      downloadTrustedDiscordAttachment(server.url, { maximumBytes: 5, timeoutMs: 1_000 }),
    ).rejects.toThrow("Uploaded file is too large");
    expect(requestClosed).toBe(true);
  });

  it("aborts downloads that do not complete within the finite timeout", async () => {
    const server = await listen((_, response) => {
      response.writeHead(200);
      response.write("partial");
    });

    await expect(
      downloadTrustedDiscordAttachment(server.url, { maximumBytes: 1024, timeoutMs: 25 }),
    ).rejects.toThrow("Could not download Discord attachment");
  });
});

async function listen(
  handler: (request: http.IncomingMessage, response: http.ServerResponse) => void,
): Promise<{ url: string }> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Unexpected test server address");
  return { url: `http://127.0.0.1:${String(address.port)}/attachment` };
}
