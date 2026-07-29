/**
 * Slice 5 — Fact ↔ Text alignment gate (Speak 종료 직전).
 */
import { extractFactTextMarkers } from "./speakFactRenderer.js";

const FALSE_ONE_WHEN_MANY = [
  /이\s*한\s*건만/,
  /한\s*건만\s*보여/,
  /실손\s*한\s*건\s*기준/,
];

/**
 * @param {string} answerText
 * @param {Array<{ fact_id: string, value: string }>} factsSpoken
 */
export function assertFactTextAlignment({ answerText = "", factsSpoken = [] } = {}) {
  const text = String(answerText ?? "");
  if (!text.trim()) {
    return { ok: false, reason: "empty_answer" };
  }

  const countFact = factsSpoken.find((f) => f.fact_id === "policy_count");
  const count = countFact ? Number(countFact.value) : null;

  if (Number.isFinite(count) && count > 1) {
    for (const re of FALSE_ONE_WHEN_MANY) {
      if (re.test(text)) {
        return { ok: false, reason: "count_mismatch_hardcoded_one", pattern: re.source };
      }
    }
  }

  const markers = extractFactTextMarkers(factsSpoken);
  const missing = [];

  for (const marker of markers) {
    const hit = marker.patterns.some((p) => p && text.includes(p));
    if (!hit) {
      missing.push(marker.fact_id);
    }
  }

  if (missing.length > 0) {
    return { ok: false, reason: "facts_not_in_answer_text", missing };
  }

  return { ok: true };
}

/**
 * Fact spoken / withheld binary gate for Decision path (no understanding_ok).
 */
export function assertDecisionFactGate({ factSelection = null } = {}) {
  const { facts_spoken = [], facts_withheld = [] } = factSelection ?? {};
  const spokenOk = facts_spoken.length > 0;
  const withheldOk =
    facts_withheld.length > 0 && facts_withheld.every((w) => w.fact && w.reason);

  if (!spokenOk && !withheldOk) {
    return { ok: false, reason: "fact_third_state_forbidden" };
  }
  if (!spokenOk && facts_withheld.some((w) => !w.reason)) {
    return { ok: false, reason: "withheld_missing_reason" };
  }
  return { ok: true };
}
