/**
 * KEY.speak — KEY Master SSOT (documentFirstSpeak + DU-1 + KU-2c).
 * All customer-facing speak routes through this module only.
 */
import { buildCustomerFirstSentence } from "./documentFirstSpeak.js";
import {
  buildDu1CustomerFirstSentence,
  buildQuestionCustomerFirstSentence,
} from "./du1DocumentUploadFirstSpeak.js";
import { classifyAndResolveSpeechProfile } from "./keySpeechTurnType.js";

export const KEY_SPEAK_MASTER_ID = "key_speak_master_v1";

export const KEY_SPEAK_MASTER_PATH = [
  "keySpeak(key_master)",
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
    const speechMeta = classifyAndResolveSpeechProfile(question, { consultationIntent, conversation });
    speakDraft = buildQuestionCustomerFirstSentence(keyFirstJudgment, {
      question,
      contextSnapshot,
      loadedContext,
      consultationIntent,
    });
    composeMode = "key_master_question";
    return {
      speakDraft: String(speakDraft ?? "").trim(),
      key_speak_master: true,
      key_compose_trace: {
        schema_version: KEY_SPEAK_MASTER_ID,
        path: KEY_SPEAK_MASTER_PATH,
        compose_mode: composeMode,
        event,
        text_preview: String(speakDraft ?? "").slice(0, 300),
        speech_turn_type: speechMeta.turnType,
        speech_profile: speechMeta.profile,
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
