/**
 * CHAT-KEY-PRESENCE-01 — same-session wire for KEY upload + P4-01 initiative (no compose).
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

export function buildKeyAnalysisInitiativeMessage(initiativeSentence = null) {
  const content = String(initiativeSentence ?? "").trim();
  if (!content) return null;
  return {
    role: "assistant",
    content,
    keyPresence: true,
    keyPresenceSource: "key_initiative",
  };
}

export function buildKeyBridgeMessage(bridgeSentence = null) {
  const content = String(bridgeSentence ?? "").trim();
  if (!content) return null;
  return {
    role: "assistant",
    content,
    keyPresence: true,
    keyPresenceSource: "key_bridge",
  };
}

export function buildKeyReturnJudgmentMessage(returnJudgmentSentence = null) {
  const content = String(returnJudgmentSentence ?? "").trim();
  if (!content) return null;
  return {
    role: "assistant",
    content,
    keyPresence: true,
    keyPresenceSource: "return_judgment",
  };
}

export function buildKeyChatPresenceMessage({
  keyFirstSentence = null,
  keyFollowUpSentence = null,
  keyInitiativeSentence = null,
  keyBridgeSentence = null,
  keyReturnJudgmentSentence = null,
} = {}) {
  const returnJudgment = String(keyReturnJudgmentSentence ?? "").trim();
  if (returnJudgment) return buildKeyReturnJudgmentMessage(returnJudgment);
  const bridge = String(keyBridgeSentence ?? "").trim();
  if (bridge) return buildKeyBridgeMessage(bridge);
  const initiative = String(keyInitiativeSentence ?? "").trim();
  if (initiative) return buildKeyAnalysisInitiativeMessage(initiative);
  return buildKeyUploadChatPresenceMessage({ keyFirstSentence, keyFollowUpSentence });
}
