/**
 * KEY Customer Text Seal — KEY 원문 이후 customerText 변경 금지.
 * U2: empty coverage table strip is structural fail-closed before freeze (not rewrite).
 */
import { ONE_KEY_CORE_RESPONSE_SOURCE } from "./oneKeyCoreFlags.js";
import { applyEmptyCoverageTableGuard } from "../../src/lib/keyEmptyCoverageTableGuard.js";
import { stripCustomerFacingEmojisKeepEdges } from "../lifeguardOutputGuard.js";

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

const INTERNAL_LEAK_LINE =
  /(?:^|\n)[ \t]*(?:아,\s*)?(?:이모지\s*쓰지\s*말라고[^\n]*|다시\s*[—–-]\s*|지난번\s*대화(?:\s*내용)?이\s*이번\s*세션[^\n]*|이번\s*(?:세션|턴)에\s*(?:직접\s*)?(?:연결되지|넘어오지)[^\n]*|recent_conversation[^\n]*)(?:\n|$)/gi;

function stripInternalInstructionLeak(text = "") {
  const next = String(text ?? "").replace(INTERNAL_LEAK_LINE, "\n");
  return next.replace(/\n{3,}/g, "\n\n").trim();
}

/** Hangul sentence end jammed into the next Hangul word: "있어요.오늘" → "있어요. 오늘". */
const KOREAN_SENTENCE_JAM_RE = /(?<=\p{Script=Hangul})([.!?。])(?=\p{Script=Hangul})/gu;

export function repairKoreanSentenceBoundarySpace(text = "") {
  return String(text ?? "").replace(KOREAN_SENTENCE_JAM_RE, "$1 ");
}

export function sealKeyCustomerText(customerText = "") {
  const keySpeakOriginal = repairKoreanSentenceBoundarySpace(
    stripInternalInstructionLeak(
      stripCustomerFacingEmojisKeepEdges(
        applyEmptyCoverageTableGuard(normalizeSealedText(customerText)),
      ),
    ),
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
