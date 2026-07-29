/**
 * Hand — display-only cleanup for assistant chat text.
 * Does not change server seal / KEY judgment.
 */

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu;
const CITE_RE = /<\/?cite\b[^>]*>/gi;

export function prepareAssistantChatText(raw) {
  return String(raw ?? "")
    .replace(CITE_RE, "")
    .replace(EMOJI_RE, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
