/**
 * ONE KEY Core S1 — feature gate (customer-home-brain-fact 1 turn only).
 */

export function isOneKeyCoreS1Enabled(env = process.env) {
  const raw = String(env.ONE_KEY_CORE_S1 ?? "").trim().toLowerCase();
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
