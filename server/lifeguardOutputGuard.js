/**
 * P3.5 — Customer-facing output guard (inventory + engine term leak).
 */
import { violatesHomeInventoryDump } from "./tomThinkingLoop.js";

export const ENGINE_TERM_PATTERNS = [
  /\bGap\b/i,
  /보장\s*분석/,
  /추천\s*엔진/,
  /gap_audit/,
  /coverage_gap/i,
  /Central\s*Brain/i,
  /Advisor\s*Brain/i,
  /Tom\s*decision/i,
  /분석\s*엔진/,
  /설계\s*엔진/,
];

export const DEFLECTION_PATTERNS = [
  /필요하시면\s*보험\s*상담도\s*도와/,
  /AI\s*상담실/,
];

const GUARD_FALLBACK =
  "잠깐만요 — 지금은 그렇게 말씀드리기 어려워요. 편하게 다른 얘기 이어가도 돼요.";

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
  let out = String(text ?? "").trim();
  if (violatesHomeInventoryDump(out) || violatesEngineTermLeak(out) || violatesDeflectionPhrase(out)) {
    return GUARD_FALLBACK;
  }
  return out;
}
