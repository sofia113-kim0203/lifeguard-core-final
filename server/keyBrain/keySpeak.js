/**
 * KEY.speak — KEY Master SSOT (documentFirstSpeak + DU-1 + KU-2c).
 * All customer-facing speak routes through this module only.
 */
import { buildCustomerFirstSentence } from "./documentFirstSpeak.js";
import {
  buildDu1CustomerFirstSentence,
  buildQuestionCustomerFirstSentence,
} from "./du1DocumentUploadFirstSpeak.js";
import { buildQuestionSpeakFromUnderstanding, buildQuestionSpeakFromUnderstandingAsync } from "./keySpeakThinkingCompose.js";
import { classifyAndResolveSpeechProfile } from "./keySpeechTurnType.js";
import { assertSpeakFactGate } from "../keyCore/keyCustomerUnderstanding.js";
import { assertDecisionFactGate } from "../keyCore/assertFactTextGate.js";
import {
  isKeyCustomerUnderstandingShadow,
  isKeyRuntimeS5Active,
  isKeyVoiceActive,
} from "../keyCore/oneKeyCoreFlags.js";

export const KEY_SPEAK_MASTER_ID = "key_speak_master_v1";

export const KEY_SPEAK_MASTER_PATH = [
  "keySpeak(key_master)",
  "keySpeakThinkingCompose|buildQuestionSpeakFromUnderstanding",
  "documentFirstSpeak|buildQuestionCustomerFirstSentence",
  "DU-1_epistemic_compose",
  "finalizeKeyCustomerText",
];

const KEY_MASTER_BRIDGE_SENTENCE =
  "지난번 같이 보던 기준으로, 오늘은 이어서 살펴볼게요.";

const KEY_MASTER_EVENT_DRAFTS = {
  analysis_complete: "분석이 마무리됐습니다. 확인되는 범위부터 같이 보겠습니다.",
  bridge: KEY_MASTER_BRIDGE_SENTENCE,
  return_judgment: "다시 연결됐습니다. 확인되는 범위부터 같이 보겠습니다.",
};

/**
 * Async speak — required when KEY_VOICE=on (Claude path).
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
} = {}) {
  if (event !== "question") {
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

  let speakDraft = s3Compose?.text ?? "";
  if (!speakDraft && !voiceOn) {
    speakDraft =
      buildQuestionCustomerFirstSentence(keyFirstJudgment, {
        question,
        contextSnapshot,
        loadedContext,
        consultationIntent,
      }) ?? "";
  }

  const composeMode = s3Compose?.compose_mode ?? (voiceOn ? "key_s6_voice_speak_failed" : "key_master_question");

  return {
    speakDraft: String(speakDraft ?? "").trim(),
    visual_blocks: s3Compose?.visual_blocks ?? [],
    key_speak_master: true,
    key_compose_trace: {
      schema_version: KEY_SPEAK_MASTER_ID,
      path: KEY_SPEAK_MASTER_PATH,
      compose_mode: composeMode,
      event,
      text_preview: String(speakDraft ?? "").slice(0, 300),
      speech_turn_type: s3Compose?.speech_turn_type ?? speechMeta.turnType,
      speech_profile: s3Compose?.speech_profile ?? speechMeta.profile,
      thinking_flow_applied: Boolean(s3Compose?.thinking_flow_applied),
      conversation_intention: s3Compose?.conversation_intention ?? thinkingFlow?.conversation_intention ?? null,
      conversation_elements_used:
        s3Compose?.conversation_elements_used ?? thinkingFlow?.conversation_elements_selected ?? [],
      facts_used: s3Compose?.facts_used ?? thinkingFlow?.facts_used_planned ?? [],
      facts_spoken: s3Compose?.facts_spoken ?? factSelection?.facts_spoken ?? [],
      facts_withheld: s3Compose?.facts_withheld ?? factSelection?.facts_withheld ?? [],
      defer_detected: s3Compose?.defer_detected ?? false,
      element_count: s3Compose?.element_count ?? thinkingFlow?.conversation_elements_selected?.length ?? 0,
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
    },
  };
}

/**
 * @param {object} input
 * @param {"question"|"document"|"analysis_complete"|"bridge"|"return_judgment"} input.event
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
} = {}) {
  let speakDraft = null;
  let composeMode = null;

  if (event === "document") {
    speakDraft =
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
    composeMode = "key_master_document";
  } else if (event === "question") {
    const conversation = contextSnapshot?.bundle?.recentConversation ?? null;
    const customerGoal =
      thinkingFlow?.customer_understanding?.customer_goal ??
      thinkingFlow?.customer_goal ??
      null;
    const speechMeta = classifyAndResolveSpeechProfile(question, {
      consultationIntent,
      conversation,
      customer_goal: customerGoal,
    });

    let s3Compose = null;
    if (thinkingFlow) {
      s3Compose = buildQuestionSpeakFromUnderstanding(keyFirstJudgment, {
        question,
        contextSnapshot,
        loadedContext,
        consultationIntent,
        thinkingFlow,
        evidenceBundle,
      });
    }

    if (isKeyCustomerUnderstandingShadow(env) && thinkingFlow?.customer_understanding) {
      // shadow: trace only — speak path unchanged if compose failed
    }

    const factSelection =
      thinkingFlow?.fact_selection ?? thinkingFlow?.decision?.fact_selection ?? null;
    const cu = thinkingFlow?.customer_understanding ?? null;
    const isS5 = isKeyRuntimeS5Active(env) && thinkingFlow?.slice5_enabled;

    const speakGate = isS5
      ? assertDecisionFactGate({ factSelection })
      : factSelection
        ? assertSpeakFactGate({
            understanding_ok: cu?.understanding_ok,
            factSelection,
            speak_mode: s3Compose?.speak_mode ?? null,
          })
        : { ok: true };

    const speakDraft =
      s3Compose?.text ??
      (isKeyVoiceActive(env) && isS5
        ? ""
        : buildQuestionCustomerFirstSentence(keyFirstJudgment, {
            question,
            contextSnapshot,
            loadedContext,
            consultationIntent,
          }));
    composeMode = s3Compose?.compose_mode ?? (isKeyVoiceActive(env) && isS5 ? "key_s6_voice_speak_failed" : "key_master_question");
    return {
      speakDraft: String(speakDraft ?? "").trim(),
      key_speak_master: true,
      key_compose_trace: {
        schema_version: KEY_SPEAK_MASTER_ID,
        path: KEY_SPEAK_MASTER_PATH,
        compose_mode: composeMode,
        event,
        text_preview: String(speakDraft ?? "").slice(0, 300),
        speech_turn_type: s3Compose?.speech_turn_type ?? speechMeta.turnType,
        speech_profile: s3Compose?.speech_profile ?? speechMeta.profile,
        thinking_flow_applied: Boolean(s3Compose?.thinking_flow_applied),
        conversation_intention: s3Compose?.conversation_intention ?? thinkingFlow?.conversation_intention ?? null,
        conversation_elements_used:
          s3Compose?.conversation_elements_used ?? thinkingFlow?.conversation_elements_selected ?? [],
        facts_used: s3Compose?.facts_used ?? thinkingFlow?.facts_used_planned ?? [],
        facts_spoken: s3Compose?.facts_spoken ?? factSelection?.facts_spoken ?? [],
        facts_withheld: s3Compose?.facts_withheld ?? factSelection?.facts_withheld ?? [],
        defer_detected: s3Compose?.defer_detected ?? false,
        element_count: s3Compose?.element_count ?? thinkingFlow?.conversation_elements_selected?.length ?? 0,
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
        inferred_goal: thinkingFlow?.runtime_trace?.inferred_goal ?? null,
        confirmation_required: s3Compose?.confirmation_required ?? cu?.confirmation_required ?? false,
        key_voice_enabled: isKeyVoiceActive(env) && isS5,
        key_voice_trace: s3Compose?.key_voice_trace ?? null,
        visual_blocks: s3Compose?.visual_blocks ?? [],
      },
    };
  } else if (event === "analysis_complete") {
    speakDraft = KEY_MASTER_EVENT_DRAFTS.analysis_complete;
    composeMode = "key_master_analysis_complete";
  } else if (event === "bridge") {
    speakDraft = KEY_MASTER_EVENT_DRAFTS.bridge;
    composeMode = "key_master_bridge";
  } else if (event === "return_judgment") {
    speakDraft = KEY_MASTER_EVENT_DRAFTS.return_judgment;
    composeMode = "key_master_return_judgment";
  }

  return {
    speakDraft: String(speakDraft ?? "").trim(),
    visual_blocks: s3Compose?.visual_blocks ?? [],
    key_speak_master: true,
    key_compose_trace: {
      called: true,
      compose_mode: composeMode,
      key_speak_master_id: KEY_SPEAK_MASTER_ID,
      text_preview: String(speakDraft ?? "").slice(0, 300),
      fake_hul_blocked: true,
    },
  };
}
