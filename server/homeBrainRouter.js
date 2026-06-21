/**
 * P3 — Home brain route resolver (gap / defer / casual / factual).
 */
import {
  classifyConsultationIntent,
  detectCasualChatIntent,
  hasInsuranceTopicSignal,
} from "./intentGateLayer.js";

export const HOME_BRAIN_ROUTES = {
  GAP_GROUNDED: "gap_grounded",
  FACTUAL_GROUNDED: "factual_grounded",
  HIGH_STAKES_DEFER: "high_stakes_defer",
  CASUAL_CHAT: "casual_chat",
};

export const HOME_BRAIN_SUPPORTED_INTENTS = new Set([
  "premium_lookup",
  "policy_count",
  "insurer_lookup",
  "premium_unknown_lookup",
  "memory_recall_lookup",
]);

export const HOME_HIGH_STAKES_DEFER_MESSAGE =
  "그건 같이 생각은 해볼 수 있는데, 정확한 계산은 확인/전문가 영역이에요.";

const BLOCKED_CLASSIFICATION_INTENTS = new Set([
  "coverage_gap_check",
  "coverage_review_request",
  "recommendation_request",
  "design_request",
  "claim_eligibility_check",
  "policy_detail",
]);

const PREMIUM_LOOKUP_SIGNAL = /보험료|월\s*납입?|월납|월\s*보험료|납입\s*보험료|보험료\s*합계/;
const PREMIUM_UNKNOWN_SIGNAL = /보험료\s*미확인|미확인\s*건|미확인\s*보험료/;
const MEMORY_RECALL_SIGNAL = /(기억|remember)/i;
const POLICY_COUNT_SIGNAL =
  /보험\s*(총\s*)?건수|몇\s*건|몇\s*개|가입\s*보험\s*수|보유\s*보험|내\s*보험(?!\s*(?:료|에))/;
const INSURER_LOOKUP_SIGNAL = /가입한\s*보험사|어느\s*보험사|보험사는|어떤\s*보험사/;

const HIGH_STAKES_TOPIC_SIGNAL =
  /상속세|상속\s*세|증여세|양도세|소득세|법인세|재무\s*설계|재무\s*관리|세무|세금\s*계산|법인\s*(?:분|설립|세)|투자\s*수익|자산\s*배분|결산|손익|순이익|배당|금융\s*소득|부동산\s*세/i;

const HIGH_STAKES_CLASSIFICATION_INTENTS = new Set([
  "design_request",
  "recommendation_request",
  "coverage_review_request",
  "claim_eligibility_check",
  "policy_detail",
]);

function normalizeQuestion(question = "") {
  return String(question ?? "").replace(/\s+/g, " ").trim();
}

export function classifyHomeBrainIntent(question = "") {
  const text = normalizeQuestion(question);
  if (!text) return "unsupported";

  const classification = classifyConsultationIntent(text);
  if (BLOCKED_CLASSIFICATION_INTENTS.has(classification.intent)) {
    return "unsupported";
  }

  if (MEMORY_RECALL_SIGNAL.test(text) && /(정보|나|내|기억|저|알)/.test(text)) {
    return "memory_recall_lookup";
  }
  if (PREMIUM_UNKNOWN_SIGNAL.test(text)) {
    return "premium_unknown_lookup";
  }
  if (PREMIUM_LOOKUP_SIGNAL.test(text)) {
    return "premium_lookup";
  }
  if (POLICY_COUNT_SIGNAL.test(text)) {
    return "policy_count";
  }
  if (INSURER_LOOKUP_SIGNAL.test(text)) {
    return "insurer_lookup";
  }

  return "unsupported";
}

export function hasHighStakesSignal(question = "", consultationIntent = null) {
  const text = normalizeQuestion(question);
  if (!text) return false;
  if (HIGH_STAKES_TOPIC_SIGNAL.test(text)) return true;
  if (HIGH_STAKES_CLASSIFICATION_INTENTS.has(consultationIntent?.intent)) return true;
  if (/얼마|계산|산출|추정/.test(text) && /세|세금|상속|증여|양도|법|재무|자산|소득|법인/.test(text)) {
    return true;
  }
  return false;
}

export function isCasualHomeQuestion(question = "", consultationIntent = null) {
  const text = normalizeQuestion(question);
  if (!text) return false;
  if (consultationIntent?.intent === "casual_chat") return true;
  if (detectCasualChatIntent(text)) return true;
  if (hasHighStakesSignal(text, consultationIntent)) return false;
  if (!hasInsuranceTopicSignal(text)) {
    if (consultationIntent?.intent === "general_consultation") return true;
    if (text.length <= 120) return true;
  }
  return false;
}

export function resolveHomeBrainRoute(question = "", consultationIntent = null) {
  const classification = consultationIntent ?? classifyConsultationIntent(question);
  const intent = classification?.intent ?? null;

  if (intent === "coverage_gap_check") {
    return HOME_BRAIN_ROUTES.GAP_GROUNDED;
  }

  const homeFactualIntent = classifyHomeBrainIntent(question);
  if (HOME_BRAIN_SUPPORTED_INTENTS.has(homeFactualIntent)) {
    return HOME_BRAIN_ROUTES.FACTUAL_GROUNDED;
  }

  if (hasHighStakesSignal(question, classification)) {
    return HOME_BRAIN_ROUTES.HIGH_STAKES_DEFER;
  }

  if (isCasualHomeQuestion(question, classification)) {
    return HOME_BRAIN_ROUTES.CASUAL_CHAT;
  }

  return HOME_BRAIN_ROUTES.HIGH_STAKES_DEFER;
}

export function composeHomeHighStakesDeferMessage() {
  return HOME_HIGH_STAKES_DEFER_MESSAGE;
}
