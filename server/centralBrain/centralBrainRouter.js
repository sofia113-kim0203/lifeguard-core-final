/**
 * P2 Central Brain — Intent routing (wraps existing classifiers; no new intents).
 */
import { classifyConsultationIntent } from "../intentGateLayer.js";
import { shouldActivateAdvisorBrainForClassification } from "../advisorBrain/advisorBrainResponder.js";
import { isActivatableFactualLookupClassification } from "../advisorBrain/advisorFactualLookupResponder.js";
import { isRecommendationReasonClassification } from "../advisorBrain/advisorRecommendationReasonResponder.js";
import { isAdvisorConversationQuestion } from "../advisorBrain/advisorConversationResponder.js";

export const CENTRAL_BRAIN_MODES = [
  "coverage_gap_reason",
  "factual_lookup",
  "recommendation_reason",
  "advisor_conversation",
];

export function isCentralBrainEnabled(env = process.env) {
  return String(env?.CENTRAL_BRAIN_ENABLED ?? "").trim().toLowerCase() === "true";
}

export function isAdvisorBrainEnabled(env = process.env) {
  return String(env?.ADVISOR_BRAIN_ENABLED ?? "").trim().toLowerCase() === "true";
}

/** Fail-safe: both flags required. CENTRAL ON + ADVISOR OFF → OFF. */
export function isCentralBrainActive(env = process.env) {
  return isCentralBrainEnabled(env) && isAdvisorBrainEnabled(env);
}

export function resolveCentralBrainMode(classification = {}, question = "") {
  if (classification?.intent === "coverage_gap_check") {
    return "coverage_gap_reason";
  }
  if (isActivatableFactualLookupClassification(classification)) {
    return "factual_lookup";
  }
  if (isRecommendationReasonClassification(classification, question)) {
    return "recommendation_reason";
  }
  if (isAdvisorConversationQuestion(classification, question)) {
    return "advisor_conversation";
  }
  return null;
}

export function routeCentralBrain({ question, history = [], env = process.env } = {}) {
  const classification = classifyConsultationIntent(question);

  if (!isCentralBrainActive(env)) {
    return {
      active: false,
      fail_safe_off: isCentralBrainEnabled(env) && !isAdvisorBrainEnabled(env),
      classification,
      central_mode: null,
      response_lane: "legacy",
      advisor_brain_would_activate: shouldActivateAdvisorBrainForClassification(
        classification,
        env,
        question,
      ),
    };
  }

  const centralMode = resolveCentralBrainMode(classification, question);
  if (!centralMode) {
    return {
      active: true,
      fail_safe_off: false,
      classification,
      central_mode: null,
      response_lane: "legacy",
      advisor_brain_would_activate: shouldActivateAdvisorBrainForClassification(
        classification,
        env,
        question,
      ),
    };
  }

  return {
    active: true,
    fail_safe_off: false,
    classification,
    central_mode: centralMode,
    response_lane: "central_brain",
    advisor_brain_would_activate: true,
  };
}
