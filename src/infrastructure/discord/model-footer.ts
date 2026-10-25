import { escapeMarkdownText } from "../../domain/display-text.js";
import { publicText } from "../../domain/live-interface.js";

export const discordContentMaximum = 1900;

/** Only actual runtime model evidence belongs here; callers use unknown until selected. */
export function withModelFooter(message: string, modelLabel: string): string {
  const safeModel =
    /^[a-zA-Z0-9._:/-]{1,160}$/.test(modelLabel) && publicText(modelLabel, 160) === modelLabel
      ? escapeMarkdownText(modelLabel)
      : "unknown";
  return `${message}\n\nModel used: ${safeModel}`;
}
