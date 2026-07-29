/**
 * Slice 5 — Runtime turn bundle (Customer Said → Reality → Reflection → Decision).
 */
import { buildCustomerReality } from "./keyCustomerUnderstanding.js";
import { buildReflection, isReflectionComplete } from "./keyReflection.js";
import { buildDecision, isDecisionComplete } from "./keyDecision.js";
import { buildKeyThinkingFlow } from "./keyThinkingFlow.js";

export const KEY_RUNTIME_S5_SCHEMA = "key-runtime-s5-v1";

/**
 * Post-speak trace labels only — must not feed Speak.
 */
export function buildRuntimeS5Trace({ reflection = null, decision = null } = {}) {
  const situation = decision?.situation_key ?? null;
  return {
    schema_version: "key-runtime-s5-trace-v1",
    inferred_goal: situation,
    inferred_situation: situation,
    reflection_confidence: reflection?.reading_confidence ?? null,
    reflection_reading: reflection?.situation_reading ?? [],
    decision_direction_type: decision?.direction?.type ?? null,
    decision_complete: decision?.decision_complete ?? false,
    speak_input_forbidden: true,
  };
}

export function buildRuntimeS5TurnBundle({
  question = "",
  contextSnapshot = null,
  loadedContext = null,
  consultationIntent = null,
  keyInterprets = null,
  evidenceBundle = null,
} = {}) {
  const customerSaid = question;
  const reality = buildCustomerReality({
    question,
    contextSnapshot,
    loadedContext,
    consultationIntent,
  });

  const reflection = buildReflection({ customerSaid, reality });
  const decision = buildDecision({
    reflection,
    reality,
    question,
    evidenceBundle,
  });

  const legacyFlow = buildKeyThinkingFlow({
    question,
    contextSnapshot,
    loadedContext,
    consultationIntent,
    keyInterprets,
  });

  const runtimeTrace = buildRuntimeS5Trace({ reflection, decision });

  return {
    schema_version: KEY_RUNTIME_S5_SCHEMA,
    customer_said: customerSaid,
    reality,
    reflection,
    decision,
    fact_selection: decision.fact_selection,
    policies: reality.policies ?? [],
    reflection_complete: isReflectionComplete(reflection),
    decision_complete: isDecisionComplete(decision),
    runtime_trace: runtimeTrace,
    slice5_enabled: true,
    thinking_ok: isReflectionComplete(reflection) && isDecisionComplete(decision),
    domain: reality.domain,
    policies_present: reality.policies_present,
    policy_count: reality.policy_count,
    conversation_phase: reality.phase,
    ...legacyFlow,
    customer_understanding: undefined,
    customer_goal: undefined,
    selected_goal: undefined,
  };
}
