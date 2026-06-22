/**
 * P4-A — Customer-facing output guard (inventory + engine term leak + deflection).
 */
import { violatesHomeInventoryDump } from "./tomThinkingLoop.js";

export const ENGINE_TERM_PATTERNS = [
  /\bGap\b/i,
  /\bCoverage\s*Gap\b/i,
  /\bRecommendation\s*Engine\b/i,
  /\bDesign\s*Engine\b/i,
  /\bCustomer\s*Analysis\b/i,
  /보장\s*분석/,
  /추천\s*엔진/,
  /설계\s*엔진/,
  /보험\s*분석\s*엔진/,
  /gap_audit/,
  /coverage_gap/i,
  /Central\s*Brain/i,
  /Advisor\s*Brain/i,
  /Tom\s*decision/i,
  /분석\s*엔진/,
];

export const DEFLECTION_PATTERNS = [
  /필요하시면\s*보험\s*상담도\s*도와/,
  /보험\s*상담도\s*가능/,
  /보험\s*상담도\s*도와/,
  /보험\s*이야기\s*해볼까/,
  /보험\s*얘기\s*해볼까/,
  /AI\s*상담실/,
];

const GUARD_FALLBACK =
  "잠깐만요 — 지금은 그렇게 말씀드리기 어려워요. 편하게 다른 얘기 이어가도 돼요.";

/** P4-UI POLISH — strip all emoji/emoticons from customer-facing text. */
export function stripCustomerFacingEmojis(text = "") {
  return String(text ?? "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu, "")
    .replace(/[\u{1F1E6}-\u{1F1FF}]{2}/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** P4-UI POLISH — no "LIFEGUARD:" speaker prefix in transcript-style replies. */
export function stripLifeguardSpeakerPrefix(text = "") {
  return String(text ?? "")
    .replace(/^LIFEGUARD\s*[:：]\s*/i, "")
    .trim();
}

export function polishLifeguardCustomerText(text = "") {
  return stripLifeguardSpeakerPrefix(stripCustomerFacingEmojis(text));
}

export function violatesEngineTermLeak(text = "") {
  const normalized = String(text ?? "").trim();
  if (!normalized) return false;
  return ENGINE_TERM_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function violatesDeflectionPhrase(text = "") {
  const normalized = String(text ?? "").trim();
  if (!normalized) return false;
  return DEFLECTION_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function applyLifeguardCustomerOutputGuard(text = "") {
  let out = polishLifeguardCustomerText(text);
  if (violatesHomeInventoryDump(out) || violatesEngineTermLeak(out) || violatesDeflectionPhrase(out)) {
    return GUARD_FALLBACK;
  }
  return out;
}
