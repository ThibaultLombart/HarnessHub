/** Escape content exactly once, at the Discord presentation boundary. */
export function escapeMarkdownText(text: string): string {
  return text.replace(/[\\`*_~|<>[\]()#]/gu, "\\$&");
}
