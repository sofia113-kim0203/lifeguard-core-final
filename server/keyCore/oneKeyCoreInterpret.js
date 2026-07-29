/**
 * ONE KEY Core — Interpret + Thinking (question event · Slice 3/4 Thinking Flow).
 */
import { classifyConsultationIntent } from "../intentGateLayer.js";
import { buildUnderstandingTurnBundle } from "./keyCustomerUnderstanding.js";
import {
  isKeyCustomerUnderstandingEnabled,
  isKeyRuntimeS5Active,
} from "./oneKeyCoreFlags.js";
import { buildRuntimeS5TurnBundle } from "./keyRuntimeS5.js";
import { buildQuestionThinkingBundle as buildThinkingFlowBundle } from "./keyThinkingFlow.js";

export function buildQuestionInterpretShadow({
  question = "",
  loadedContext = null,
  contextSnapshot = null,
  consultationIntent = null,
} = {}) {
  const classification = consultationIntent ?? classifyConsultationIntent(question);
  const knowable = ["question_received"];
  const unknowable = [];
  const mustNotClaim = [];

  if (classification?.intent) knowable.push("consultation_intent");
  if (classification?.lookup_sub_intent) knowable.push("lookup_sub_intent");

  const flags = contextSnapshot?.flags ?? {};
  if (flags.has_policies === true) knowable.push("has_policies");
  if (flags.has_memory === true) knowable.push("has_memory");
  if (flags.has_recent_conversation === true) knowable.push("has_recent_conversation");

  if (loadedContext?.policies === "present") knowable.push("policies_loaded");
  if (loadedContext?.memory === "present") knowable.push("memory_loaded");

  if (classification?.intent === "recommendation_request" || classification?.intent === "design_request") {
    unknowable.push("binding_recommendation", "binding_design");
    mustNotClaim.push("공장 추천·설계 문장 그대로 전달");
  }

  return {
    actor: "KEY",
    event_type: "question",
    document_kind_guess: classification?.intent ?? "general_consultation",
    consultation_intent: classification?.intent ?? null,
    judgment_scope: { knowable, unknowable, must_not_claim: mustNotClaim },
    hold: {
      needed: unknowable.length > 0,
      other_document_request: null,
    },
    orient_speech_planned: {
      customer_visible_in_s1: true,
      posture: "question_provisional",
    },
  };
}

export function buildQuestionThinkingBundle(params = {}, env = process.env) {
  if (isKeyRuntimeS5Active(env)) {
    const bundle = buildRuntimeS5TurnBundle(params);
    return bundle;
  }
  if (isKeyCustomerUnderstandingEnabled(env)) {
    const bundle = buildUnderstandingTurnBundle(params);
    return {
      ...bundle.thinkingBundle,
      customer_understanding: bundle.customerUnderstanding,
      fact_selection: bundle.factSelection,
      reality: bundle.reality,
      slice4_enabled: true,
    };
  }
  return buildThinkingFlowBundle(params);
}
