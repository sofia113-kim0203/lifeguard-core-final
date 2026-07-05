/**
 * ONE KEY Core — Interpret + Thinking (question event · Prototype generalization).
 */
import { classifyConsultationIntent } from "../intentGateLayer.js";
import {
  buildDu1InputBundle,
  resolveDu1InputGates,
} from "../keyBrain/du1DocumentUploadFirstSpeak.js";

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

export function buildQuestionThinkingBundle({
  question = "",
  contextSnapshot = null,
  loadedContext = null,
  keyInterprets = null,
} = {}) {
  const bundle = buildDu1InputBundle({
    document: { id: null, event_type: "question" },
    contextSnapshot,
    loadedContext,
    keyFirstJudgment: keyInterprets
      ? {
          judgment_scope: keyInterprets.judgment_scope,
          hold: keyInterprets.hold,
          posture: keyInterprets.orient_speech_planned?.posture ?? "question_provisional",
        }
      : null,
  });

  return {
    schema_version: "one-key-core-thinking-question-v1",
    question,
    inputGates: resolveDu1InputGates(loadedContext, bundle),
    four_inputs: {
      document: false,
      policies: (bundle.policies ?? []).length,
      memory: (bundle.memoryFacts ?? []).length,
      conversation: bundle.conversation?.has_recent === true,
    },
    snapshot_loaded: bundle.context_snapshot_loaded === true,
  };
}
