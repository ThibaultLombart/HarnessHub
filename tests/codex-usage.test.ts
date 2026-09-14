import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexUsageClient } from "../src/infrastructure/provider-usage/codex-usage.js";

const roots: string[] = [];
function agentDirectory(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harnesshub-codex-usage-"));
  roots.push(root);
  return root;
}

function jwt(accountId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } }),
  ).toString("base64url");
  return `header.${payload}.signature`;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("CodexUsageClient", () => {
  it("reads Pi OAuth in memory and returns Codex subscription windows", async () => {
    const directory = agentDirectory();
    const access = jwt("account-123");
    fs.writeFileSync(
      path.join(directory, "auth.json"),
      JSON.stringify({ "openai-codex": { type: "oauth", access, refresh: "never-read", expires: 1 } }),
      { mode: 0o600 },
    );
    const request = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            rate_limit: {
              primary_window: { used_percent: 18.4, limit_window_seconds: 18_000, reset_after_seconds: 300 },
              secondary_window: { used_percent: 42, limit_window_seconds: 604_800, reset_at: 2_000_000_000 },
            },
          }),
          { status: 200 },
        ),
    );

    await expect(new CodexUsageClient(directory, request).getUsage()).resolves.toMatchObject({
      provider: "codex",
      windows: [
        { usedPercent: 18, windowSeconds: 18_000 },
        { usedPercent: 42, windowSeconds: 604_800, resetAt: 2_000_000_000 },
      ],
    });
    expect(request).toHaveBeenCalledOnce();
    const [url, options] = request.mock.calls[0] ?? [];
    expect(url).toBe("https://chatgpt.com/backend-api/wham/usage");
    const headers = new Headers(options?.headers);
    expect(headers.get("Authorization")).toBe(`Bearer ${access}`);
    expect(headers.get("ChatGPT-Account-Id")).toBe("account-123");
  });

  it("fails safely when Pi has no Codex OAuth credential", async () => {
    const directory = agentDirectory();
    fs.writeFileSync(path.join(directory, "auth.json"), JSON.stringify({}), { mode: 0o600 });
    const request = vi.fn();

    await expect(new CodexUsageClient(directory, request).getUsage()).rejects.toThrow(/no Codex OAuth/i);
    expect(request).not.toHaveBeenCalled();
  });
});
