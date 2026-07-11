/**
 * KEY.speak — KEY Master SSOT (documentFirstSpeak + DU-1 + KU-2c).
 * All customer-facing speak routes through this module only.
 *
 * Stein Cleanup A corrective:
 * - Normal customer events never use S3/S4/S5 or KEY_MASTER_EVENT_DRAFTS as customerText.
 * - Question / bridge / analysis_complete / return_judgment → Claude compose or empty (failureMode).
 * - Ghost ledger is turn-owned (passed into compose_trace), never module-global.
 */
import { buildCustomerFirstSentence } from "./documentFirstSpeak.js";
import {
  buildDu1CustomerFirstSentence,
} from "./du1DocumentUploadFirstSpeak.js";
import { buildQuestionSpeakFromUnderstandingAsync } from "./keySpeakThinkingCompose.js";
import { classifyAndResolveSpeechProfile } from "./keySpeechTurnType.js";
import { assertSpeakFactGate } from "../keyCore/keyCustomerUnderstanding.js";
import { assertDecisionFactGate } from "../keyCore/assertFactTextGate.js";
import {
  isKeyRuntimeS5Active,
  isKeyVoiceActive,
} from "../keyCore/oneKeyCoreFlags.js";
import { buildKeyVoiceComposeResult } from "../keyCore/keyVoiceCompose.js";
import {
  createGhostLedger,
} from "../keyCore/keyVoiceSpeak.js";

export const KEY_SPEAK_MASTER_ID = "key_speak_master_v1";

export const KEY_SPEAK_MASTER_PATH = [
  "keySpeak(key_master)",
  "keySpeakThinkingCompose|buildQuestionSpeakFromUnderstandingAsync",
  "keyVoiceCompose|buildKeyVoiceComposeResult",
  "finalizeKeyCustomerText",
];

/** Retained for diagnostics only — must never be assigned to customerText. */
const KEY_MASTER_EVENT_DRAFTS = {
  analysis_complete: "분석이 마무리됐습니다. 확인되는 범위부터 같이 보겠습니다.",
  bridge: "지난번 같이 보던 기준으로, 오늘은 이어서 살펴볼게요.",
  return_judgment: "다시 연결됐습니다. 확인되는 범위부터 같이 보겠습니다.",
};

function eventFallbackQuestion(event = "") {
  if (event === "bridge") return "이어서 같이 살펴볼까요?";
  if (event === "analysis_complete") return "분석 결과부터 같이 볼까요?";
  if (event === "return_judgment") return "다시 이어서 확인해볼까요?";
  return "";
}

function baseComposeTrace({
  event = "question",
  speakDraft = "",
  ghostLedger = null,
  composeMode = "key_master",
  speechMeta = null,
  s3Compose = null,
  thinkingFlow = null,
  factSelection = null,
  cu = null,
  speakGate = null,
  voiceOn = false,
  failureMode = false,
} = {}) {
  return {
    schema_version: KEY_SPEAK_MASTER_ID,
    path: KEY_SPEAK_MASTER_PATH,
    compose_mode: composeMode,
    event,
    text_preview: String(speakDraft ?? "").slice(0, 300),
    speech_turn_type: s3Compose?.speech_turn_type ?? speechMeta?.turnType ?? null,
    speech_profile: s3Compose?.speech_profile ?? speechMeta?.profile ?? null,
    thinking_flow_applied: Boolean(s3Compose?.thinking_flow_applied),
    conversation_intention:
      s3Compose?.conversation_intention ?? thinkingFlow?.conversation_intention ?? null,
    conversation_elements_used:
      s3Compose?.conversation_elements_used ?? thinkingFlow?.conversation_elements_selected ?? [],
    facts_used: s3Compose?.facts_used ?? thinkingFlow?.facts_used_planned ?? [],
    facts_spoken: s3Compose?.facts_spoken ?? factSelection?.facts_spoken ?? [],
    facts_withheld: s3Compose?.facts_withheld ?? factSelection?.facts_withheld ?? [],
    defer_detected: s3Compose?.defer_detected ?? false,
    element_count:
      s3Compose?.element_count ?? thinkingFlow?.conversation_elements_selected?.length ?? 0,
    thinking_density: s3Compose?.thinking_density ?? thinkingFlow?.thinking_density ?? null,
    thinking_ok: thinkingFlow?.thinking_ok ?? null,
    understanding_ok: cu?.understanding_ok ?? thinkingFlow?.understanding_ok ?? null,
    speak_fact_gate: speakGate,
    confidence: s3Compose?.confidence ?? cu?.confidence ?? null,
    selected_goal: s3Compose?.selected_goal ?? cu?.selected_goal ?? null,
    rejected_hypotheses: s3Compose?.rejected_hypotheses ?? cu?.rejected_hypotheses ?? [],
    fact_text_gate: s3Compose?.fact_text_gate ?? null,
    runtime_trace: thinkingFlow?.runtime_trace ?? null,
    reflection_snapshot: s3Compose?.reflection_snapshot ?? thinkingFlow?.reflection ?? null,
    decision_snapshot: s3Compose?.decision_snapshot ?? thinkingFlow?.decision ?? null,
    direction_type: s3Compose?.direction_type ?? thinkingFlow?.decision?.direction?.type ?? null,
    slice5_enabled: thinkingFlow?.slice5_enabled ?? false,
    inferred_goal: thinkingFlow?.runtime_trace?.inferred_goal ?? s3Compose?.inferred_goal ?? null,
    confirmation_required: s3Compose?.confirmation_required ?? cu?.confirmation_required ?? false,
    key_voice_enabled: voiceOn,
    key_voice_trace: s3Compose?.key_voice_trace ?? null,
    visual_blocks: s3Compose?.visual_blocks ?? [],
    ghost_path_reached: Array.isArray(ghostLedger) ? ghostLedger : [],
    legacy_speak_blocked: true,
    event_draft_blocked: true,
    failureMode: failureMode === true,
    rewrite_detected: false,
  };
}

/**
 * Async speak — Claude/KEY Master path for all normal customer question turns
 * (KEY_VOICE on or off). Never retreats to S3/S4/S5.
 */
export async function keySpeakAsync({
  event = "question",
  question = "",
  document = {},
  keyFirstJudgment = null,
  contextSnapshot = null,
  loadedContext = null,
  consultationIntent = null,
  thinkingFlow = null,
  evidenceBundle = null,
  env = process.env,
  history = [],
  previousAnswerSummary = "",
  shadowVisualBlocksOverride = null,
  ghostLedger = null,
  fetchImpl = fetch,
} = {}) {
  const ledger = Array.isArray(ghostLedger) ? ghostLedger : createGhostLedger();

  if (event === "document") {
    return keySpeak({
      event,
      question,
      document,
      keyFirstJudgment,
      contextSnapshot,
      loadedContext,
      consultationIntent,
      thinkingFlow,
      evidenceBundle,
      env,
      ghostLedger: ledger,
    });
  }

  if (event !== "question") {
    return speakNonQuestionCustomerEvent({
      event,
      question,
      thinkingFlow,
      evidenceBundle,
      env,
      history,
      previousAnswerSummary,
      shadowVisualBlocksOverride,
      ghostLedger: ledger,
      fetchImpl,
    });
  }

  const conversation = contextSnapshot?.bundle?.recentConversation ?? null;
  const customerGoal =
    thinkingFlow?.customer_understanding?.customer_goal ?? thinkingFlow?.customer_goal ?? null;
  const speechMeta = classifyAndResolveSpeechProfile(question, {
    consultationIntent,
    conversation,
    customer_goal: customerGoal,
  });

  let s3Compose = null;
  if (thinkingFlow) {
    s3Compose = await buildQuestionSpeakFromUnderstandingAsync(keyFirstJudgment, {
      question,
      contextSnapshot,
      loadedContext,
      consultationIntent,
      thinkingFlow,
      evidenceBundle,
      env,
      history,
      previousAnswerSummary,
      shadowVisualBlocksOverride,
      ghostLedger: ledger,
      fetchImpl,
    });
  }

  const factSelection =
    thinkingFlow?.fact_selection ?? thinkingFlow?.decision?.fact_selection ?? null;
  const cu = thinkingFlow?.customer_understanding ?? null;
  const isS5 = isKeyRuntimeS5Active(env) && thinkingFlow?.slice5_enabled;
  const voiceOn = isKeyVoiceActive(env) && isS5;

  const speakGate = isS5
    ? assertDecisionFactGate({ factSelection })
    : factSelection
      ? assertSpeakFactGate({
          understanding_ok: cu?.understanding_ok,
          factSelection,
          speak_mode: s3Compose?.speak_mode ?? null,
        })
      : { ok: true };

  // Never use buildQuestionCustomerFirstSentence / S3 as customerText.
  const speakDraft = String(s3Compose?.text ?? "").trim();
  const failureMode = !speakDraft;
  const composeMode =
    s3Compose?.compose_mode ??
    (failureMode ? "key_master_question_failure_pending" : "key_s6_voice_speak");

  return {
    speakDraft,
    visual_blocks: s3Compose?.visual_blocks ?? [],
    key_speak_master: true,
    failureMode,
    key_compose_trace: baseComposeTrace({
      event,
      speakDraft,
      ghostLedger: ledger,
      composeMode,
      speechMeta,
      s3Compose,
      thinkingFlow,
      factSelection,
      cu,
      speakGate,
      voiceOn: true,
      failureMode,
    }),
  };
}

async function speakNonQuestionCustomerEvent({
  event = "",
  question = "",
  thinkingFlow = null,
  evidenceBundle = null,
  env = process.env,
  history = [],
  previousAnswerSummary = "",
  shadowVisualBlocksOverride = null,
  ghostLedger = null,
  fetchImpl = fetch,
} = {}) {
  const ledger = Array.isArray(ghostLedger) ? ghostLedger : createGhostLedger();
  // KEY_MASTER_EVENT_DRAFTS retained in module for reference only — never assigned to speakDraft.

  const q = String(question ?? "").trim() || eventFallbackQuestion(event);
  let s3Compose = null;
  if (thinkingFlow?.slice5_enabled && (thinkingFlow.decision || thinkingFlow.reflection)) {
    s3Compose = await buildKeyVoiceComposeResult(thinkingFlow, {
      question: q,
      evidenceBundle,
      env,
      history,
      previousAnswerSummary,
      shadowVisualBlocksOverride,
      ghostLedger: ledger,
      fetchImpl,
    });
  }

  const speakDraft = String(s3Compose?.text ?? "").trim();
  const failureMode = !speakDraft;
  return {
    speakDraft,
    visual_blocks: s3Compose?.visual_blocks ?? [],
    key_speak_master: true,
    failureMode,
    key_compose_trace: baseComposeTrace({
      event,
      speakDraft,
      ghostLedger: ledger,
      composeMode: failureMode
        ? `key_master_${event}_failure_pending`
        : s3Compose?.compose_mode ?? `key_master_${event}_voice`,
      s3Compose,
      thinkingFlow,
      factSelection: thinkingFlow?.decision?.fact_selection ?? null,
      voiceOn: true,
      failureMode,
    }),
  };
}

/**
 * Sync speak — document path only may use DU-1 document compose.
 * Sync question / bridge / analysis_complete / return_judgment never emit legacy drafts.
 */
export function keySpeak({
  event = "question",
  question = "",
  document = {},
  keyFirstJudgment = null,
  contextSnapshot = null,
  loadedContext = null,
  consultationIntent = null,
  thinkingFlow = null,
  evidenceBundle = null,
  env = process.env,
  ghostLedger = null,
} = {}) {
  const ledger = Array.isArray(ghostLedger) ? ghostLedger : createGhostLedger();

  if (event === "document") {
    const speakDraft =
      buildDu1CustomerFirstSentence(keyFirstJudgment, {
        document,
        contextSnapshot,
        loadedContext,
      }) ??
      buildCustomerFirstSentence(keyFirstJudgment, {
        document,
        contextSnapshot,
        loadedContext,
      });
    const text = String(speakDraft ?? "").trim();
    return {
      speakDraft: text,
      key_speak_master: true,
      failureMode: !text,
      key_compose_trace: baseComposeTrace({
        event,
        speakDraft: text,
        ghostLedger: ledger,
        composeMode: "key_master_document",
        thinkingFlow,
        failureMode: !text,
      }),
    };
  }

  if (event === "question") {
    // Sync question cannot run Claude; do not call S3/S4/S5 or customer-first lego.
    return {
      speakDraft: "",
      key_speak_master: true,
      failureMode: true,
      key_compose_trace: baseComposeTrace({
        event,
        speakDraft: "",
        ghostLedger: ledger,
        composeMode: "key_master_sync_question_blocked",
        thinkingFlow,
        failureMode: true,
      }),
    };
  }

  if (event === "analysis_complete" || event === "bridge" || event === "return_judgment") {
    return {
      speakDraft: "",
      key_speak_master: true,
      failureMode: true,
      key_compose_trace: baseComposeTrace({
        event,
        speakDraft: "",
        ghostLedger: ledger,
        composeMode: `key_master_${event}_sync_blocked`,
        thinkingFlow,
        failureMode: true,
      }),
    };
  }

  return {
    speakDraft: "",
    key_speak_master: true,
    failureMode: true,
    key_compose_trace: baseComposeTrace({
      event,
      speakDraft: "",
      ghostLedger: ledger,
      composeMode: "key_master_unknown_event_blocked",
      thinkingFlow,
      failureMode: true,
    }),
  };
}
