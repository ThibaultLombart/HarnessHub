export type UiRequest = Readonly<{
  id: string;
  method: "select" | "confirm" | "input" | "editor";
  title: string;
  message: string;
  options: readonly string[];
  expiresAt: number;
}>;
export type UiResponse =
  { cancelled: true } | { value: string } | { confirmed: boolean } | { choice: number };
export type SubagentStatus = Readonly<{ role: string; status: string; startedAt?: number; endedAt?: number }>;

export const suppressedText = "[suppressed for privacy]";

const privateMaterial =
  /<\/?(?:think|analysis)\b|-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----|sk-[\w-]{12,}|[A-Za-z0-9_+=-]{40,}/iu;
const credentialAssignment =
  /\b(?:[\w-]*[_-])?(?:token|password|secret|credential|api[_ -]?key|authorization|cookie|(?:discord|access|refresh)Token|clientSecret)["']?\s*[:=]\s*["']?\S+|\bbearer\s+\S+/iu;
const credentialUrl =
  /https?:\/\/[^\s/?#]*@|https?:\/\/\S*[?&][^=&#\s]*(?:token|signature|credential|password|secret|api[_-]?key|key|sig|auth)[^=&#\s]*=/iu;
const mention = /@(?:everyone|here)|<@/iu;

/** Bounded public content, not a general-purpose secret detector or presentation escape. */
export function publicText(value: string, maximum = 1000): string {
  if (
    value.length > 16_384 ||
    [privateMaterial, credentialAssignment, credentialUrl, mention].some((pattern) => pattern.test(value))
  )
    return suppressedText;
  const text = value.replace(/[\p{Cc}\p{Cf}]/gu, " ");
  return text.length > maximum
    ? `${text.slice(0, Math.max(0, maximum - 14))}… [truncated]`.slice(0, maximum)
    : text;
}

export function safeToolName(value: string): string {
  return [
    "read",
    "write",
    "edit",
    "bash",
    "powershell",
    "grep",
    "find",
    "ls",
    "subagent",
    "bg_wait",
    "ask_user_question",
    "ask_question",
  ].includes(value)
    ? value
    : "extension tool";
}
