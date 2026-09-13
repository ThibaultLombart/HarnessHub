export type Project = Readonly<{
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  channelId: string;
  path: string;
  harnessId: string | null;
  gitRemote: string | null;
  createdAt: string;
  archivedAt: string | null;
}>;

export class InvalidProjectInputError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidProjectInputError";
  }
}

export function projectSlug(name: string): string {
  const normalizedName = name.trim();
  if (normalizedName.length < 1 || normalizedName.length > 100 || /[\0\r\n]/.test(normalizedName)) {
    throw new InvalidProjectInputError("Project name must contain 1 to 100 characters on one line");
  }
  const slug = normalizedName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  if (slug.length < 1) throw new InvalidProjectInputError("Project name must contain letters or numbers");
  return slug;
}

export function parseRepositoryUrl(input: string): string {
  if (input.length > 2048 || /[\0\r\n]/.test(input) || input.startsWith("-")) {
    throw new InvalidProjectInputError("Repository URL is invalid");
  }

  if (/^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+:[a-zA-Z0-9._~/-]+$/.test(input)) return input;

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new InvalidProjectInputError("Repository URL must use HTTPS or SSH");
  }
  if (url.protocol !== "https:" && url.protocol !== "ssh:") {
    throw new InvalidProjectInputError("Repository URL must use HTTPS or SSH");
  }
  if (
    url.password !== "" ||
    (url.protocol === "https:" && url.username !== "") ||
    (url.protocol === "ssh:" && !/^[a-zA-Z0-9._-]*$/.test(url.username)) ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new InvalidProjectInputError(
      "Repository URL must not contain credentials, query parameters, or fragments",
    );
  }
  if (url.hostname === "" || url.pathname === "" || url.pathname === "/") {
    throw new InvalidProjectInputError("Repository URL is incomplete");
  }
  return input;
}
