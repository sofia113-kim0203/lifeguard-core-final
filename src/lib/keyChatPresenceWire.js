/**
 * CHAT-KEY-PRESENCE-01 — same-session wire for existing KEY upload sentences (no compose).
 */

export function buildKeyUploadChatPresenceContent({
  keyFirstSentence = null,
  keyFollowUpSentence = null,
} = {}) {
  const first = String(keyFirstSentence ?? "").trim();
  const followUp = String(keyFollowUpSentence ?? "").trim();
  if (first && followUp) return `${first}\n\n${followUp}`;
  if (first) return first;
  if (followUp) return followUp;
  return null;
}

export function buildKeyUploadChatPresenceMessage({
  keyFirstSentence = null,
  keyFollowUpSentence = null,
} = {}) {
  const content = buildKeyUploadChatPresenceContent({ keyFirstSentence, keyFollowUpSentence });
  if (!content) return null;
  return {
    role: "assistant",
    content,
    keyPresence: true,
    keyPresenceSource: "document_upload",
  };
}
