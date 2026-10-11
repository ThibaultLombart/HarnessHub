import pino, { type DestinationStream, type Logger } from "pino";

const sensitiveKey =
  /^(?:authorization|cookie|password|secret|token|api[-_]?key|private[-_]?key|(?:discord|access|refresh)[-_]?token|client[-_]?secret)$/i;

export function redactSensitive(value: unknown, seen: WeakSet<object> = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactText(value.message),
      ...(value.cause === undefined ? {} : { cause: redactSensitive(value.cause, seen) }),
    };
  }

  if (Array.isArray(value)) return value.map((item) => redactSensitive(item, seen));

  return redactRecord(value, seen);
}

function redactRecord(value: object, seen: WeakSet<object> = new WeakSet<object>()): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      sensitiveKey.test(key) ? "[REDACTED]" : redactSensitive(nested, seen),
    ]),
  );
}

export function createLogger(level: string, destination: DestinationStream = process.stdout): Logger {
  return protectChildBindings(
    pino(
      {
        level,
        base: null,
        formatters: { log: redactRecord, bindings: redactRecord },
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
          msg: (value: unknown) => (typeof value === "string" ? redactText(value) : redactSensitive(value)),
        },
      },
      destination,
    ),
  );
}

function protectChildBindings<Levels extends string>(logger: Logger<Levels>): Logger<Levels> {
  const child = logger.child.bind(logger);
  logger.child = (bindings, options) => protectChildBindings(child(redactRecord(bindings), options));
  return logger;
}

function serializeError(error: unknown): unknown {
  return redactSensitive(error);
}

function redactText(value: string): string {
  return value
    .replace(/(Bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/([?&](?:token|key|password|secret)=)[^&\s]+/gi, "$1[REDACTED]");
}
