export const resourceScopes = ["global", "project"] as const;
export type ResourceScope = (typeof resourceScopes)[number];

export const resourceTypes = ["package"] as const;
export type ResourceType = (typeof resourceTypes)[number];

export const resourceStatuses = ["installed", "removed", "failed"] as const;
export type ResourceStatus = (typeof resourceStatuses)[number];

export type HarnessResource = Readonly<{
  id: string;
  harnessId: string;
  type: ResourceType;
  scope: ResourceScope;
  projectId: string | null;
  source: string;
  status: ResourceStatus;
  safeError: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export class InvalidResourceInputError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidResourceInputError";
  }
}

export function parseResourceSource(input: string): string {
  const source = input.trim();
  if (source.length < 1 || source.length > 2048 || /[\0\r\n]/.test(source) || source.startsWith("-")) {
    throw new InvalidResourceInputError("Resource source is invalid");
  }
  if (source.startsWith("npm:")) return parseNpmSource(source);
  if (source.startsWith("git:")) return parseGitSource(source);
  if (source.startsWith("https://") || source.startsWith("ssh://")) return parseUrlSource(source);
  throw new InvalidResourceInputError("Resource source must use npm:, git:, https:, or ssh:");
}

function parseNpmSource(source: string): string {
  const spec = source.slice("npm:".length);
  if (
    !/^(@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)(@[a-zA-Z0-9._~+-]+)?$/.test(spec)
  ) {
    throw new InvalidResourceInputError("npm resource source is invalid");
  }
  return source;
}

function parseGitSource(source: string): string {
  const spec = source.slice("git:".length);
  if (spec.length < 1 || /\s/.test(spec) || spec.includes("..") || spec.startsWith("-")) {
    throw new InvalidResourceInputError("git resource source is invalid");
  }
  if (/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._~/-]+(@[a-zA-Z0-9._~/-]+)?$/.test(spec)) return source;
  if (/^git@[a-zA-Z0-9.-]+:[a-zA-Z0-9._~/-]+(@[a-zA-Z0-9._~/-]+)?$/.test(spec)) return source;
  if (spec.startsWith("https://") || spec.startsWith("ssh://")) return `git:${parseUrlSource(spec)}`;
  throw new InvalidResourceInputError("git resource source is invalid");
}

function parseUrlSource(source: string): string {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new InvalidResourceInputError("URL resource source is invalid");
  }
  if (url.protocol !== "https:" && url.protocol !== "ssh:") {
    throw new InvalidResourceInputError("URL resource source must use HTTPS or SSH");
  }
  if (
    url.password !== "" ||
    (url.protocol === "https:" && url.username !== "") ||
    (url.protocol === "ssh:" && !/^[a-zA-Z0-9._-]*$/.test(url.username)) ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new InvalidResourceInputError(
      "Resource source must not contain credentials, query parameters, or fragments",
    );
  }
  if (url.hostname === "" || url.pathname === "" || url.pathname === "/") {
    throw new InvalidResourceInputError("URL resource source is incomplete");
  }
  return source;
}
