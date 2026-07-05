/**
 * P4-01 — KEY Analysis Initiative (Speech only).
 * Customer feels "KEY came to me" — NOT "analysis completed".
 * No Memory · Recommendation · Gap · Design · Thinking · new factory.
 */

import { applyKeySpeechPresence, hasKeySpeechPresenceSignals } from "./keySpeechPresence.js";

export const P4_01_SLICE_ID = "P4-01";
export const P4_01_SLICE_NAME = "KEY Analysis Initiative";

/** Tom PASS voice — KEY Initiative, not system notification. */
export const KEY_ANALYSIS_INITIATIVE_PASS_VOICE =
  "자료를 다 살펴봤어요. 먼저 같이 보면 좋을 부분이 하나 있어서 찾아왔어요.";

/** System / notification phrasing — must NOT appear in customer-facing initiative Speech. */
export const SYSTEM_ANALYSIS_NOTIFICATION_SIGNAL_RES = [
  /분석(?:이)?\s*(?:완료|끝)/,
  /결과를\s*확인(?:해\s*주세요|하세요)?/,
  /클릭(?:해\s*주세요)?/,
  /고객님[,，]?\s*분석/,
  /분석\s*결과/,
  /갱신(?:이)?\s*완료/,
];

/** KEY Initiative signals — companion arrived, not procedure finished. */
export const KEY_INITIATIVE_SIGNAL_RES = [
  /살펴봤/,
  /찾아왔/,
  /(?:같이|함께)/,
  /말씀(?:드리|해)/,
];

function normalizeText(text = "") {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasSystemAnalysisNotificationSpeech(text = "") {
  const body = normalizeText(text);
  if (!body) return false;
  return SYSTEM_ANALYSIS_NOTIFICATION_SIGNAL_RES.some((pattern) => pattern.test(body));
}

export function hasKeyInitiativeSignals(text = "") {
  const body = normalizeText(text);
  if (!body) return false;
  return KEY_INITIATIVE_SIGNAL_RES.some((pattern) => pattern.test(body));
}

/**
 * P4-01 — fixed KEY Initiative line after document analysis pipeline completes.
 * @returns {string}
 */
export function buildKeyAnalysisInitiativeSentence() {
  const { text } = applyKeySpeechPresence(KEY_ANALYSIS_INITIATIVE_PASS_VOICE, {
    slice: P4_01_SLICE_ID,
  });
  return normalizeText(text) || normalizeText(KEY_ANALYSIS_INITIATIVE_PASS_VOICE);
}

export function validateKeyAnalysisInitiativeSpeech(text = "") {
  const body = normalizeText(text);
  return {
    ok: Boolean(body) && !hasSystemAnalysisNotificationSpeech(body) && hasKeyInitiativeSignals(body),
    has_system_notification: hasSystemAnalysisNotificationSpeech(body),
    has_key_initiative: hasKeyInitiativeSignals(body),
    has_key_presence: hasKeySpeechPresenceSignals(body),
  };
}
