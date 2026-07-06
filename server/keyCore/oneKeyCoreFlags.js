/**
 * ONE KEY Core — feature gates (question S1 · document S02-1 · analysis_complete S02-2 · bridge S02-5 · return_judgment S02-4).
 */

export function isOneKeyCoreS1Enabled(env = process.env) {
  const raw = String(env.ONE_KEY_CORE_S1 ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "active";
}

/** KEY First Decision — off | shadow | active (S1 = shadow only). */
export function getKeyFirstDecisionMode(env = process.env) {
  const raw = String(env.KEY_FIRST_DECISION ?? "").trim().toLowerCase();
  if (raw === "shadow") return "shadow";
  if (raw === "active") return "active";
  return "off";
}

export function isKeyFirstDecisionShadowEnabled(env = process.env) {
  return isOneKeyCoreS1Enabled(env) && getKeyFirstDecisionMode(env) === "shadow";
}

export function isOneKeyCoreDocumentEnabled(env = process.env) {
  const raw = String(env.ONE_KEY_CORE_DOCUMENT ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "active";
}

export function isOneKeyCoreAnalysisCompleteEnabled(env = process.env) {
  const raw = String(env.ONE_KEY_CORE_ANALYSIS_COMPLETE ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "active";
}

export function isOneKeyCoreReturnJudgmentEnabled(env = process.env) {
  const raw = String(env.ONE_KEY_CORE_RETURN_JUDGMENT ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "active";
}

export function isOneKeyCoreBridgeEnabled(env = process.env) {
  const raw = String(env.ONE_KEY_CORE_BRIDGE ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "active";
}

/** S1 env overlay — orchestrator on, legacy speak fallback off. */
export function resolveOneKeyCoreS1Env(env = process.env) {
  return {
    ...env,
    ONE_KEY_CORE_S1: "1",
    SALES_DIRECTOR_KEY_ORCHESTRATOR: "1",
    SALES_DIRECTOR_KEY_LEGACY_FALLBACK: "0",
  };
}

/** S02-1 document env overlay. */
export function resolveOneKeyCoreDocumentEnv(env = process.env) {
  return {
    ...env,
    ONE_KEY_CORE_DOCUMENT: "1",
    SALES_DIRECTOR_KEY_ORCHESTRATOR: "1",
    SALES_DIRECTOR_KEY_LEGACY_FALLBACK: "0",
  };
}

/** S02-2 analysis_complete env overlay. */
export function resolveOneKeyCoreAnalysisCompleteEnv(env = process.env) {
  return {
    ...env,
    ONE_KEY_CORE_ANALYSIS_COMPLETE: "1",
    SALES_DIRECTOR_KEY_ORCHESTRATOR: "1",
    SALES_DIRECTOR_KEY_LEGACY_FALLBACK: "0",
  };
}

/** S02-4 return_judgment env overlay. */
export function resolveOneKeyCoreReturnJudgmentEnv(env = process.env) {
  return {
    ...env,
    ONE_KEY_CORE_RETURN_JUDGMENT: "1",
    SALES_DIRECTOR_KEY_ORCHESTRATOR: "1",
    SALES_DIRECTOR_KEY_LEGACY_FALLBACK: "0",
  };
}

/** S02-5 bridge env overlay. */
export function resolveOneKeyCoreBridgeEnv(env = process.env) {
  return {
    ...env,
    ONE_KEY_CORE_BRIDGE: "1",
    SALES_DIRECTOR_KEY_ORCHESTRATOR: "1",
    SALES_DIRECTOR_KEY_LEGACY_FALLBACK: "0",
  };
}

export const ONE_KEY_CORE_RESPONSE_SOURCE = {
  QUESTION: "one_key_core_s1",
  DOCUMENT: "one_key_core_document",
  ANALYSIS_COMPLETE: "one_key_core_analysis_complete",
  BRIDGE: "one_key_core_bridge",
  RETURN_JUDGMENT: "one_key_core_return_judgment",
};

export const ONE_KEY_CORE_S1_BLOCKED_PATHS = [
  "legacy_tom_speak",
  "tom_gap_light_voice",
  "conversation_brain_compose",
  "free_thinking_compose",
  "tool_brain_customer_text",
  "hul_parallel_full_compose",
  "general_knowledge_delegation",
  "fast_response_layer",
  "advisor_fallback_compose",
  "guidance_builder_message",
  "home_brain_compose_answer",
  "trusted_advisor_compose",
  "tool_brain_fixed_hul",
  "sales_director_loop_legacy_chain",
];
