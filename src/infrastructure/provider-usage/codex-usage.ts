import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const usageEndpoint = "https://chatgpt.com/backend-api/wham/usage";
const authClaim = "https://api.openai.com/auth";

const credentialSchema = z.object({
  type: z.literal("oauth"),
  access: z.string().min(1),
});

const windowSchema = z.object({
  used_percent: z.number().min(0).max(100),
  limit_window_seconds: z.number().positive(),
  reset_at: z.number().optional(),
  reset_after_seconds: z.number().nonnegative().optional(),
});

const responseSchema = z.object({
  rate_limit: z.object({
    primary_window: windowSchema.nullable().optional(),
    secondary_window: windowSchema.nullable().optional(),
  }),
});

export type UsageWindow = Readonly<{
  usedPercent: number;
  windowSeconds: number;
  resetAt: number | null;
}>;

export type ProviderUsage = Readonly<{
  provider: "codex";
  windows: readonly UsageWindow[];
}>;

export class CodexUsageClient {
  public constructor(
    private readonly piAgentDirectory: string,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  public async getUsage(): Promise<ProviderUsage> {
    const credential = await this.readCredential();
    const accountId = extractAccountId(credential.access);
    const response = await this.fetchImplementation(usageEndpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${credential.access}`,
        "ChatGPT-Account-Id": accountId,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Codex usage request failed (${String(response.status)})`);
    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error("Codex usage response has an unsupported format");
    const candidates = [parsed.data.rate_limit.primary_window, parsed.data.rate_limit.secondary_window];
    return {
      provider: "codex",
      windows: candidates.flatMap((window): UsageWindow[] => {
        if (window === null || window === undefined) return [];
        return [
          {
            usedPercent: Math.round(window.used_percent),
            windowSeconds: window.limit_window_seconds,
            resetAt:
              window.reset_at ??
              (window.reset_after_seconds === undefined
                ? null
                : Math.floor(Date.now() / 1000 + window.reset_after_seconds)),
          },
        ];
      }),
    };
  }

  private async readCredential(): Promise<{ access: string }> {
    const authPath = path.join(this.piAgentDirectory, "auth.json");
    const statistics = await fs.stat(authPath);
    if (!statistics.isFile() || statistics.size > 1024 * 1024 || (statistics.mode & 0o077) !== 0) {
      throw new Error("Pi authentication store is unavailable or has unsafe permissions");
    }
    const content: unknown = JSON.parse(await fs.readFile(authPath, "utf8"));
    if (content === null || typeof content !== "object" || Array.isArray(content)) {
      throw new Error("Pi authentication store has an unsupported format");
    }
    const entries = content as Record<string, unknown>;
    const parsed = credentialSchema.safeParse(entries["openai-codex"] ?? entries.codex);
    if (!parsed.success) throw new Error("Pi has no Codex OAuth credential");
    return { access: parsed.data.access };
  }
}

function extractAccountId(token: string): string {
  const parts = token.split(".");
  const payload = parts[1];
  if (parts.length !== 3 || payload === undefined) throw new Error("Codex OAuth credential is invalid");
  try {
    const value: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid");
    const claim = (value as Record<string, unknown>)[authClaim];
    if (claim === null || typeof claim !== "object" || Array.isArray(claim)) throw new Error("invalid");
    const accountId = (claim as Record<string, unknown>).chatgpt_account_id;
    if (typeof accountId !== "string" || accountId === "") throw new Error("invalid");
    return accountId;
  } catch (error) {
    throw new Error("Codex OAuth credential has no account identifier", { cause: error });
  }
}
