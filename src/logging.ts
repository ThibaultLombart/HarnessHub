import pino, { type Logger } from "pino";

const sensitiveKey = /^(?:authorization|cookie|password|secret|token|api[-_]?key|private[-_]?key)$/i;

export function redactSensitive(value: unknown, seen: WeakSet<object> = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => redactSensitive(item, seen));

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      sensitiveKey.test(key) ? "[REDACTED]" : redactSensitive(nested, seen),
    ]),
  );
}

export function createLogger(level: string): Logger {
  return pino({
    level,
    base: null,
    redact: {
      paths: [
        "token",
        "password",
        "secret",
        "apiKey",
        "authorization",
        "req.headers.authorization",
        "req.headers.cookie",
        "config.discordToken",
      ],
      censor: "[REDACTED]",
    },
    serializers: {
      err: serializeError,
      error: serializeError,
    },
  });
}

function serializeError(error: unknown): unknown {
  if (!(error instanceof Error)) return redactSensitive(error);
  return {
    name: error.name,
    message: redactText(error.message),
    ...(error.cause === undefined ? {} : { cause: serializeError(error.cause) }),
  };
}

function redactText(value: string): string {
  return value
    .replace(/(Bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/([?&](?:token|key|password|secret)=)[^&\s]+/gi, "$1[REDACTED]");
}
