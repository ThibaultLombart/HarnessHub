export type ModelDescriptor = Readonly<{
  provider: string;
  id: string;
  label: string;
}>;

export type ModelPreference = Readonly<{
  projectId: string;
  provider: string;
  modelId: string;
  updatedAt: string;
}>;

export class InvalidModelInputError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidModelInputError";
  }
}

export function parseModelPattern(input: string): { provider: string; modelId: string; pattern: string } {
  const pattern = input.trim();
  if (pattern.length < 3 || pattern.length > 200 || /[\0\r\n\s]/.test(pattern) || pattern.startsWith("-")) {
    throw new InvalidModelInputError("Model must use provider/model-id without whitespace");
  }
  const separator = pattern.indexOf("/");
  if (separator <= 0 || separator === pattern.length - 1 || pattern.slice(separator + 1).includes("/")) {
    throw new InvalidModelInputError("Model must use provider/model-id");
  }
  const provider = pattern.slice(0, separator);
  const modelId = pattern.slice(separator + 1);
  if (!/^[a-zA-Z0-9._-]+$/.test(provider) || !/^[a-zA-Z0-9._:+-]+$/.test(modelId)) {
    throw new InvalidModelInputError("Model contains unsupported characters");
  }
  return { provider, modelId, pattern };
}

export function modelPattern(input: { provider: string; modelId: string }): string {
  return `${input.provider}/${input.modelId}`;
}
