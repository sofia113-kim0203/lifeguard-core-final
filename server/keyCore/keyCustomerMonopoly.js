/**
 * KEY Customer Monopoly — 고객 customerText는 KEY만 만든다.
 */
import { polishLifeguardCustomerText } from "../lifeguardOutputGuard.js";
import { guardKeyCustomerTextCompleteness } from "./keyCustomerTextCompleteness.js";
import { sealKeyCustomerText } from "./keyCustomerTextSeal.js";
import { ONE_KEY_CORE_RESPONSE_SOURCE } from "./oneKeyCoreFlags.js";
import { startSpan } from "./keyLatencyMarks.js";

export const KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT =
  "지금은 여기까지 확인했어요. 잠시 후 다시 말씀해 주시면 KEY가 이어서 볼게요.";

/** True only for the exact monopoly system-failure stub (not normal conversation). */
export function isKeyMonopolyFailureCustomerText(text = "") {
  const t = String(text ?? "").trim();
  if (!t) return false;
  if (t === KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT) return true;
  return /지금은\s*여기까지\s*확인했어요/.test(t) && /잠시\s*후\s*다시\s*말씀해\s*주시면/.test(t);
}

export const KEY_CUSTOMER_TEXT_PATH = [
  "keySpeak(key_master)",
  "DU-1_epistemic_compose",
  "guardKeyCustomerTextCompleteness",
  "polishLifeguardCustomerText",
  "sealKeyCustomerText",
];

const ALLOWED_QUESTION_SOURCES = new Set([ONE_KEY_CORE_RESPONSE_SOURCE.QUESTION]);

export function isAllowedKeyCustomerResponseSource(responseSource = "") {
  return ALLOWED_QUESTION_SOURCES.has(String(responseSource ?? "").trim());
}

export function finalizeKeyCustomerText(
  speakDraft = "",
  { failureMode = false, startedAt = null } = {},
) {
  const finalizeSpan = typeof startedAt === "number" ? startSpan(startedAt) : null;
  const trimmed = String(speakDraft ?? "").trim();
  if (!trimmed && failureMode) {
    const sealSpan = typeof startedAt === "number" ? startSpan(startedAt) : null;
    // Failure: seal empty — never invent KEY counseling / monopoly stub for the customer.
    const sealed = sealKeyCustomerText("");
    const sealMark = sealSpan ? sealSpan.end() : null;
    const finalizeMark = finalizeSpan ? finalizeSpan.end() : null;
    return {
      customerText: sealed.key_speak_original,
      keySpeakOriginal: sealed.key_speak_original,
      generation_mode: "key_customer_monopoly_failure",
      persona_rewrite_blocked: true,
      completeness_guard: { applied: false, reason: "key_speak_failure" },
      key_customer_text_sealed: true,
      latency_marks: { finalize: finalizeMark, seal: sealMark },
    };
  }
  const guarded = guardKeyCustomerTextCompleteness(trimmed);
  const cleaned = polishLifeguardCustomerText(guarded.customerText);
  const sealSpan = typeof startedAt === "number" ? startSpan(startedAt) : null;
  const sealed = sealKeyCustomerText(cleaned);
  const sealMark = sealSpan ? sealSpan.end() : null;
  const finalizeMark = finalizeSpan ? finalizeSpan.end() : null;
  return {
    customerText: sealed.key_speak_original,
    keySpeakOriginal: sealed.key_speak_original,
    generation_mode: "key_customer_monopoly",
    persona_rewrite_blocked: true,
    completeness_guard: guarded.completeness_guard,
    key_customer_text_sealed: true,
    latency_marks: { finalize: finalizeMark, seal: sealMark },
  };
}

export function buildKeyCustomerTextFailureEnvelope({
  reason = "one_key_core_failed",
  trace = null,
} = {}) {
  const outlet = finalizeKeyCustomerText("", { failureMode: true });
  return {
    ok: true,
    customerText: outlet.keySpeakOriginal,
    keySpeakOriginal: outlet.keySpeakOriginal,
    key_monopoly_failure: true,
    failure_reason: reason,
    agentTurn: {
      text: outlet.keySpeakOriginal,
      responseSource: ONE_KEY_CORE_RESPONSE_SOURCE.QUESTION,
    },
    oneKeyCoreTrace: trace,
  };
}

export function assertKeyCustomerMonopoly({ answerText = "", responseSource = "" } = {}) {
  if (!isAllowedKeyCustomerResponseSource(responseSource)) {
    return {
      ok: false,
      reason: "key_monopoly_forbidden_response_source",
      response_source: responseSource,
    };
  }
  const text = String(answerText ?? "");
  if (!text) {
    return { ok: false, reason: "key_monopoly_empty_customer_text" };
  }
  return { ok: true, reason: null };
}

/** @deprecated Post-KEY mutation forbidden — use assertKeyCustomerTextIntegrity + pass-through. */
export function coerceKeyMonopolyCustomerText({ answerText = "", responseSource = "" } = {}) {
  const check = assertKeyCustomerMonopoly({ answerText, responseSource });
  if (check.ok) {
    return {
      answerText: String(answerText ?? "").trim(),
      response_source: responseSource,
      key_monopoly_coerced: false,
    };
  }
  return {
    answerText: "",
    response_source: ONE_KEY_CORE_RESPONSE_SOURCE.QUESTION,
    key_monopoly_coerced: true,
    key_monopoly_coerce_reason: check.reason,
  };
}
