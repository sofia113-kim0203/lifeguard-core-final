/**
 * ONE_PATH daily-chat policy — reconnect existing matchers to Provider assembly.
 * Does not own customer text. Does not reopen keySpeak / legacy Decision.
 * productShowcase (insurance) stays a separate matcher; this module never merges them.
 */
import {
  detectCasualChatIntent,
  detectContinuityCompanionCluster,
} from "../intentGateLayer.js";
import {
  hasInsuranceConsultationIntent,
  isGeneralKnowledgeEligible,
} from "../generalKnowledgeEligibility.js";
import { isKeySocialTurn } from "../keyConversationPatterns.js";
import { isCasualHomeQuestion } from "../homeBrainRouter.js";
import {
  classifySpeechTurnType,
  SPEECH_TURN_TYPE,
} from "../keyBrain/keySpeechTurnType.js";
import {
  isActivePlaceCustomerThread,
  isExplicitCurrentInsuranceProductRequest,
  isPlacePublicResearchRequest,
  needsFreshPublicFacts,
} from "./keyBorrowedSensesSpeak.js";
import { buildOutOfDomainPlaceRecommendAddendum } from "./keyOutOfDomainRecommend.js";

export const ONE_PATH_DAILY_CHAT_LANES = Object.freeze({
  GREETING: "greeting",
  EMOTION: "emotion",
  CHITCHAT: "chitchat",
  LIFE: "life",
  GENERAL_KNOWLEDGE: "general_knowledge",
  PLACE_RECOMMEND: "place_recommend",
  NON_INSURANCE_RECOMMEND: "non_insurance_recommend",
  CONTINUITY: "continuity",
  NONE: "none",
});

function normalizeQuestion(question = "") {
  return String(question ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Non-insurance recommend (영화/생활 추천) — reuses casual-home + 추천.
 * Uses hasInsuranceConsultationIntent (not hasInsuranceTopicSignal): the latter
 * matches bare 추천 and would wrongly block daily recommends.
 * productShowcase remains a separate insurance matcher.
 */
export function isNonInsuranceDailyRecommendRequest(question = "") {
  const q = normalizeQuestion(question);
  if (!q) return false;
  if (isExplicitCurrentInsuranceProductRequest(q)) return false;
  if (hasInsuranceConsultationIntent(q)) return false;
  if (!/추천/.test(q)) return false;
  return isCasualHomeQuestion(q) === true;
}

/**
 * Resolve daily-chat lane + web_search policy from existing matchers only.
 * Insurance productShowcase is reported separately and never classified as a daily lane.
 */
export function resolveOnePathDailyChatPolicy({
  question = "",
  history = [],
} = {}) {
  const q = normalizeQuestion(question);
  const productShowcaseRequest =
    isExplicitCurrentInsuranceProductRequest(q) === true;

  const empty = {
    lane: ONE_PATH_DAILY_CHAT_LANES.NONE,
    web_search: false,
    matched_rule: null,
    product_showcase_request: productShowcaseRequest,
    place_addendum: "",
    signals: {},
  };

  if (!q || productShowcaseRequest) {
    return empty;
  }

  const casual = detectCasualChatIntent(q);
  const continuity = detectContinuityCompanionCluster(q);
  const speech = classifySpeechTurnType(q);
  const placeOpen = isActivePlaceCustomerThread({ question: q, history });
  const placeAsk = isPlacePublicResearchRequest(q) === true;
  const freshPublic = needsFreshPublicFacts({ question: q, history }) === true;
  const gk = isGeneralKnowledgeEligible(q) === true;
  const social = isKeySocialTurn(q) === true;
  const nonInsuranceRecommend = isNonInsuranceDailyRecommendRequest(q);
  const homeCasual = isCasualHomeQuestion(q) === true;

  const signals = {
    casual_rule: casual?.matched_rule ?? null,
    continuity_cluster: continuity?.cluster_id ?? null,
    speech_turn_type: speech || null,
    place_ask: placeAsk,
    place_thread_open: placeOpen,
    needs_fresh_public_facts: freshPublic,
    general_knowledge: gk,
    key_social: social,
    non_insurance_recommend: nonInsuranceRecommend,
    casual_home: homeCasual,
  };

  // 1) Place / venue — public search required.
  if (placeAsk || placeOpen) {
    const place_addendum = buildOutOfDomainPlaceRecommendAddendum({
      question: q,
      history,
    });
    return {
      lane: ONE_PATH_DAILY_CHAT_LANES.PLACE_RECOMMEND,
      web_search: true,
      matched_rule: placeAsk
        ? "isPlacePublicResearchRequest"
        : "isActivePlaceCustomerThread",
      product_showcase_request: false,
      place_addendum: place_addendum || "",
      signals,
    };
  }

  // 2) Non-insurance recommend (영화 등) — search allowed; not productShowcase.
  if (nonInsuranceRecommend) {
    return {
      lane: ONE_PATH_DAILY_CHAT_LANES.NON_INSURANCE_RECOMMEND,
      web_search: true,
      matched_rule: "non_insurance_daily_recommend",
      product_showcase_request: false,
      place_addendum: "",
      signals,
    };
  }

  // 3) General knowledge — search allowed for public facts.
  if (gk) {
    return {
      lane: ONE_PATH_DAILY_CHAT_LANES.GENERAL_KNOWLEDGE,
      web_search: true,
      matched_rule: "general_knowledge_eligible",
      product_showcase_request: false,
      place_addendum: "",
      signals,
    };
  }

  // 4) Continuity / repeat — history card only; no search.
  if (
    continuity ||
    speech === SPEECH_TURN_TYPE.REPEAT ||
    speech === SPEECH_TURN_TYPE.CONTINUATION
  ) {
    return {
      lane: ONE_PATH_DAILY_CHAT_LANES.CONTINUITY,
      web_search: false,
      matched_rule: continuity
        ? "continuity_companion_cluster"
        : `speech_${speech}`,
      product_showcase_request: false,
      place_addendum: "",
      signals,
    };
  }

  // 5) Greeting / social.
  if (casual?.matched_rule === "casual_greeting" || social) {
    return {
      lane: ONE_PATH_DAILY_CHAT_LANES.GREETING,
      web_search: false,
      matched_rule: casual?.matched_rule || "key_social_greeting",
      product_showcase_request: false,
      place_addendum: "",
      signals,
    };
  }

  // 6) Emotion / empathy.
  if (
    casual?.matched_rule === "casual_emotion_check" ||
    speech === SPEECH_TURN_TYPE.EMOTION
  ) {
    return {
      lane: ONE_PATH_DAILY_CHAT_LANES.EMOTION,
      web_search: false,
      matched_rule: casual?.matched_rule || "speech_emotion",
      product_showcase_request: false,
      place_addendum: "",
      signals,
    };
  }

  // 7) Named casual chitchat.
  if (
    casual?.matched_rule === "casual_small_talk" ||
    casual?.matched_rule === "casual_thanks"
  ) {
    return {
      lane: ONE_PATH_DAILY_CHAT_LANES.CHITCHAT,
      web_search: false,
      matched_rule: casual.matched_rule,
      product_showcase_request: false,
      place_addendum: "",
      signals,
    };
  }

  // 8) Broader daily / life (비보험 home casual).
  // Narrow insurance check — bare 추천 must not eject life/chitchat lanes.
  if (homeCasual && !hasInsuranceConsultationIntent(q)) {
    return {
      lane: ONE_PATH_DAILY_CHAT_LANES.LIFE,
      web_search: freshPublic === true,
      matched_rule: "casual_home_life",
      product_showcase_request: false,
      place_addendum: "",
      signals,
    };
  }

  return { ...empty, signals };
}
