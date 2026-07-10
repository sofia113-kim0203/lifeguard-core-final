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

/** Slice 4 Customer Understanding — off | shadow | active. */
export function getKeyCustomerUnderstandingMode(env = process.env) {
  const raw = String(env.KEY_CUSTOMER_UNDERSTANDING ?? "").trim().toLowerCase();
  if (raw === "shadow") return "shadow";
  if (raw === "active") return "active";
  return "off";
}

export function isKeyCustomerUnderstandingActive(env = process.env) {
  return getKeyCustomerUnderstandingMode(env) === "active";
}

export function isKeyCustomerUnderstandingShadow(env = process.env) {
  return getKeyCustomerUnderstandingMode(env) === "shadow";
}

export function isKeyCustomerUnderstandingEnabled(env = process.env) {
  const mode = getKeyCustomerUnderstandingMode(env);
  return mode === "active" || mode === "shadow";
}

/** Slice 5 Runtime — off | shadow | active (supersedes S4 speak when active). */
export function getKeyRuntimeS5Mode(env = process.env) {
  const raw = String(env.KEY_RUNTIME_S5 ?? "").trim().toLowerCase();
  if (raw === "shadow") return "shadow";
  if (raw === "active") return "active";
  return "off";
}

export function isKeyRuntimeS5Active(env = process.env) {
  return getKeyRuntimeS5Mode(env) === "active";
}

export function isKeyRuntimeS5Shadow(env = process.env) {
  return getKeyRuntimeS5Mode(env) === "shadow";
}

export function isKeyRuntimeS5Enabled(env = process.env) {
  const mode = getKeyRuntimeS5Mode(env);
  return mode === "active" || mode === "shadow";
}

/** Slice 6 KEY Voice — off | on (Decision 이후 Speak 칸 교체). */
export function getKeyVoiceMode(env = process.env) {
  const raw = String(env.KEY_VOICE ?? "").trim().toLowerCase();
  return raw === "on" || raw === "active" || raw === "1" || raw === "true" ? "on" : "off";
}

export function isKeyVoiceActive(env = process.env) {
  return getKeyVoiceMode(env) === "on";
}

/** S7-a Borrowed Senses — off | shadow | active_partial | active.
 *  shadow = trace only, S6 final_answer unchanged.
 *  active_partial = Stage 2 Preview allowlist conditional promotion (NOT Production).
 *  active = Stage 3 Preview Lane-aware promotion (NOT Production).
 */
export function getKeyBorrowedSensesMode(env = process.env) {
  const raw = String(env.KEY_BORROWED_SENSES ?? "").trim().toLowerCase();
  if (raw === "shadow") return "shadow";
  if (raw === "active_partial" || raw === "partial" || raw === "stage2") return "active_partial";
  if (raw === "active" || raw === "stage3") return "active";
  return "off";
}

export function isKeyBorrowedSensesShadow(env = process.env) {
  return getKeyBorrowedSensesMode(env) === "shadow";
}

/** Stage 2 Preview partial — may promote only when Preview + allowlist + gates pass. */
export function isKeyBorrowedSensesStage2Partial(env = process.env) {
  return getKeyBorrowedSensesMode(env) === "active_partial";
}

/** Stage 3 Preview active — Lane-aware promotion (NOT Production). */
export function isKeyBorrowedSensesStage3Active(env = process.env) {
  return getKeyBorrowedSensesMode(env) === "active";
}

/** Run S7 probe (shadow, Stage2 partial, or Stage3 active). Does not imply customer swap. */
export function isKeyBorrowedSensesProbeEnabled(env = process.env) {
  const mode = getKeyBorrowedSensesMode(env);
  return mode === "shadow" || mode === "active_partial" || mode === "active";
}

export function isKeyBorrowedSensesEnabled(env = process.env) {
  const mode = getKeyBorrowedSensesMode(env);
  return mode === "shadow" || mode === "active_partial" || mode === "active";
}

/** Production hard block for Stage 2 / Stage 3 promotion. */
export function isVercelProductionEnv(env = process.env) {
  const vercelEnv = String(env.VERCEL_ENV ?? "").trim().toLowerCase();
  if (vercelEnv === "production") return true;
  // Extra belt: explicit production markers (never treat preview as production)
  const nodeEnv = String(env.NODE_ENV ?? "").trim().toLowerCase();
  const vercelEnvAlt = String(env.VERCEL_ENV ?? "").trim().toLowerCase();
  if (vercelEnvAlt === "preview" || vercelEnvAlt === "development") return false;
  // Do NOT treat NODE_ENV=production alone as Vercel Production (local/build often sets it).
  void nodeEnv;
  return false;
}

/**
 * Stage 2 promotion allowed only when active_partial AND not Production.
 * Callers must still apply allowlist + gate checks.
 */
export function isStage2PromotionEnvAllowed(env = process.env) {
  if (isVercelProductionEnv(env)) return false;
  return isKeyBorrowedSensesStage2Partial(env);
}

/**
 * Stage 3 promotion allowed only when active AND not Production.
 * Callers must still apply lane + gate checks. Mutually exclusive with Stage 2.
 */
export function isStage3PromotionEnvAllowed(env = process.env) {
  if (isVercelProductionEnv(env)) return false;
  return isKeyBorrowedSensesStage3Active(env);
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

/** KEY Master Preview — all Core events + S1 on. Preview-only S7 active. */
export function resolveKeyMasterPreviewEnv(env = process.env) {
  return {
    ...env,
    ONE_KEY_CORE_S1: "1",
    ONE_KEY_CORE_DOCUMENT: "1",
    ONE_KEY_CORE_ANALYSIS_COMPLETE: "1",
    ONE_KEY_CORE_RETURN_JUDGMENT: "1",
    ONE_KEY_CORE_BRIDGE: "1",
    SALES_DIRECTOR_KEY_ORCHESTRATOR: "1",
    SALES_DIRECTOR_KEY_LEGACY_FALLBACK: "0",
    KEY_BORROWED_SENSES: "active",
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
  "generateHumanSalesDirectorResponse",
  "finalizeSalesDirectorResponse",
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
  "buildKeyStructuredResponse",
  "sales_director_loop_legacy_chain",
];
