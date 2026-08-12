/**
 * KEY Customer Text Seal — KEY 원문 이후 customerText 변경 금지.
 * U2: empty coverage table strip is structural fail-closed before freeze (not rewrite).
 */
import { ONE_KEY_CORE_RESPONSE_SOURCE } from "./oneKeyCoreFlags.js";
import { applyEmptyCoverageTableGuard } from "../../src/lib/keyEmptyCoverageTableGuard.js";

export const KEY_CUSTOMER_TEXT_FORBIDDEN_POST_MUTATORS = [
  "generateHumanSalesDirectorResponse",
  "buildKeyStructuredResponse",
  "finalizeSalesDirectorResponse",
  "finalizeHomeAgentResponse",
  "coerceKeyMonopolyCustomerText",
  "applyLifeguardCustomerOutputGuard",
  "delegateGeneralKnowledgeChatTurn",
  "runSalesDirectorLoopTurn",
  "finalizeOneBrainResponse",
  "onReplace",
  "persona_rewrite",
  "factory_prose",
  "hydration_rewrite",
  "conversation_brain_rewrite",
  "free_thinking_rewrite",
  "advisor_rewrite",
  "tom_voice_rewrite",
  "legacy_fallback_speak",
];

const ALLOWED_RESPONSE_SOURCE = ONE_KEY_CORE_RESPONSE_SOURCE.QUESTION;

function normalizeSealedText(text = "") {
  return String(text ?? "");
}

export function sealKeyCustomerText(customerText = "") {
  const keySpeakOriginal = applyEmptyCoverageTableGuard(
    normalizeSealedText(customerText),
  );
  return {
    key_speak_original: keySpeakOriginal,
    key_customer_text_sealed: true,
    sealed_at: "one_key_core_speak_outlet",
  };
}

export function assertKeyCustomerTextIntegrity({
  keySpeakOriginal = "",
  finalCustomerText = "",
  responseSource = "",
  postMutators = [],
} = {}) {
  const original = normalizeSealedText(keySpeakOriginal);
  const finalText = normalizeSealedText(finalCustomerText);
  const source = String(responseSource ?? "").trim();

  if (source !== ALLOWED_RESPONSE_SOURCE) {
    return {
      ok: false,
      reason: "key_forbidden_response_source",
      response_source: source,
      text_equal: original === finalText,
    };
  }
  if (!original) {
    return { ok: false, reason: "key_empty_speak_original", text_equal: false };
  }
  if (original !== finalText) {
    return {
      ok: false,
      reason: "key_customer_text_tampered",
      text_equal: false,
      original_preview: original.slice(0, 200),
      final_preview: finalText.slice(0, 200),
    };
  }
  const blocked = (postMutators ?? []).filter((name) =>
    KEY_CUSTOMER_TEXT_FORBIDDEN_POST_MUTATORS.includes(name),
  );
  if (blocked.length > 0) {
    return {
      ok: false,
      reason: "key_forbidden_post_mutator",
      post_mutators: blocked,
      text_equal: original === finalText,
    };
  }
  return {
    ok: true,
    reason: null,
    text_equal: true,
    response_source: source,
  };
}

export function enforceKeyCustomerTextIntegrity(params = {}) {
  const check = assertKeyCustomerTextIntegrity(params);
  if (!check.ok) {
    const error = new Error(check.reason ?? "key_customer_text_integrity_failed");
    error.key_integrity = check;
    throw error;
  }
  return check;
}
