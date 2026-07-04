/**
 * KEY-RECOVERY-03 Slice A — Chat preload KEY control flags.
 * A1 shadow: observability only — legacy full preload unchanged.
 * A2 active: KEY-planned selective preload when orchestrator eligible.
 */
import { classifyConsultationIntent } from "../intentGateLayer.js";
import { KEY_TOOLS, planKeyTools } from "../salesDirectorKeyToolRegistry.js";
import { buildKeyBrainShadowPlan } from "./shadowPlan.js";

export const KEY_CHAT_PRELOAD_CONTROL_MODES = {
  OFF: "off",
  SHADOW: "shadow",
  ACTIVE: "active",
};

/** Loop unconditional preload — off/shadow/F8 fallback. */
export const LEGACY_CHAT_FULL_FACTORY_PRELOAD = [
  "coverage_gap",
  "underwriting",
  "recommendation",
  "design",
];

export const KEY_CHAT_PRELOAD_SHADOW_SCHEMA_VERSION = "key-chat-preload-shadow-a1-v1";
export const KEY_CHAT_PRELOAD_ACTIVE_SCHEMA_VERSION = "key-chat-preload-active-a2-v1";

const TOOL_TO_FACTORY_PRELOAD = {
  [KEY_TOOLS.COVERAGE_GAP]: "coverage_gap",
  [KEY_TOOLS.UNDERWRITING]: "underwriting",
  [KEY_TOOLS.RECOMMENDATION]: "recommendation",
  [KEY_TOOLS.DESIGN]: "design",
};

const FACTORY_CONTEXT_FIELDS = {
  coverage_gap: "coverageGapContext",
  underwriting: "underwritingRiskContext",
  recommendation: "recommendationContext",
  design: "designContext",
};

export function getKeyChatPreloadControlMode(env = process.env) {
  const raw = String(env.KEY_CHAT_PRELOAD_CONTROL ?? "").trim().toLowerCase();
  if (raw === "shadow") return KEY_CHAT_PRELOAD_CONTROL_MODES.SHADOW;
  if (raw === "active") return KEY_CHAT_PRELOAD_CONTROL_MODES.ACTIVE;
  return KEY_CHAT_PRELOAD_CONTROL_MODES.OFF;
}

export function isKeyChatPreloadShadowEnabled(env = process.env) {
  return getKeyChatPreloadControlMode(env) === KEY_CHAT_PRELOAD_CONTROL_MODES.SHADOW;
}

export function isKeyChatPreloadActiveEnabled(env = process.env) {
  return getKeyChatPreloadControlMode(env) === KEY_CHAT_PRELOAD_CONTROL_MODES.ACTIVE;
}

export function shouldExecuteSelectivePreload({ preloadControlMode, keyOrchestratorEligible } = {}) {
  return (
    preloadControlMode === KEY_CHAT_PRELOAD_CONTROL_MODES.ACTIVE &&
    keyOrchestratorEligible === true
  );
}

export function emptyFactoryContextBundle() {
  return {
    coverageGapContext: null,
    underwritingRiskContext: null,
    recommendationContext: null,
    designContext: null,
  };
}

export function factoryContextsFromTuple([coverageGapContext, underwritingRiskContext, recommendationContext, designContext]) {
  return {
    coverageGapContext: coverageGapContext ?? null,
    underwritingRiskContext: underwritingRiskContext ?? null,
    recommendationContext: recommendationContext ?? null,
    designContext: designContext ?? null,
  };
}

export function factoryContextTupleFromBundle(contexts = {}) {
  return [
    contexts.coverageGapContext ?? null,
    contexts.underwritingRiskContext ?? null,
    contexts.recommendationContext ?? null,
    contexts.designContext ?? null,
  ];
}

/**
 * Map planKeyTools output → factory preload keys (snapshot/memory excluded).
 */
export function deriveFactoryPreloadKeysFromPlan(plan = null) {
  const tools = plan?.tools ?? [];
  const ordered = [];
  const seen = new Set();
  for (const tool of tools) {
    const factory = TOOL_TO_FACTORY_PRELOAD[tool];
    if (!factory || seen.has(factory)) continue;
    seen.add(factory);
    ordered.push(factory);
  }
  return ordered;
}

function buildPreloadWouldChange(keyPlanned, legacyActual) {
  const legacy = [...legacyActual];
  const planned = [...keyPlanned];
  const wouldSkip = legacy.filter((factory) => !planned.includes(factory));
  const wouldAdd = planned.filter((factory) => !legacy.includes(factory));
  return {
    shadow_recommended: planned,
    legacy_actual: legacy,
    strict_subset: planned.length < legacy.length,
    would_skip: wouldSkip,
    would_add: wouldAdd,
    differs: wouldSkip.length > 0 || wouldAdd.length > 0,
  };
}

export function buildKeyPreloadPlanBundle({
  question = "",
  loadedContext = null,
  history = [],
  unified = null,
  customerId = null,
} = {}) {
  const trimmedQuestion = String(question ?? "").replace(/\s+/g, " ").trim();
  const classification = classifyConsultationIntent(trimmedQuestion);
  const plan = planKeyTools(classification, loadedContext, trimmedQuestion);
  const keyPlannedFactoryPreloads = deriveFactoryPreloadKeysFromPlan(plan);
  return {
    trimmedQuestion,
    classification,
    plan,
    keyPlannedFactoryPreloads,
    legacyFullPreload: [...LEGACY_CHAT_FULL_FACTORY_PRELOAD],
    preloadWouldChange: buildPreloadWouldChange(
      keyPlannedFactoryPreloads,
      LEGACY_CHAT_FULL_FACTORY_PRELOAD,
    ),
    kb0Plan: buildKeyBrainShadowPlan({
      question: trimmedQuestion,
      history,
      loadedContext,
      unified,
      customerId,
    }),
  };
}

export async function executeSelectiveFactoryPreloads({
  factoryKeys = [],
  loadFactoryPreload = async () => null,
} = {}) {
  const contexts = emptyFactoryContextBundle();
  const preloadsExecuted = [];

  for (const factoryKey of factoryKeys) {
    const field = FACTORY_CONTEXT_FIELDS[factoryKey];
    if (!field) continue;
    contexts[field] = await loadFactoryPreload(factoryKey);
    preloadsExecuted.push(factoryKey);
  }

  const preloadsSkipped = LEGACY_CHAT_FULL_FACTORY_PRELOAD.filter(
    (factoryKey) => !preloadsExecuted.includes(factoryKey),
  );

  return {
    contexts,
    preloads_executed: preloadsExecuted,
    preloads_skipped: preloadsSkipped,
  };
}

export function getMissingFactoryPreloadKeys(contexts = {}) {
  return LEGACY_CHAT_FULL_FACTORY_PRELOAD.filter((factoryKey) => {
    const field = FACTORY_CONTEXT_FIELDS[factoryKey];
    return !contexts[field];
  });
}

/**
 * F8 — KEY turn fail + legacy fallback: backfill any factory contexts skipped by selective preload.
 */
export async function backfillMissingLegacyFactoryPreloads({
  contexts = {},
  loadFactoryPreload = async () => null,
} = {}) {
  const missing = getMissingFactoryPreloadKeys(contexts);
  if (missing.length === 0) {
    return {
      contexts: { ...contexts },
      backfilled: [],
      f8_backfill_executed: false,
      f8_backfill_full: false,
    };
  }

  const updated = { ...contexts };
  const backfilled = [];
  for (const factoryKey of missing) {
    const field = FACTORY_CONTEXT_FIELDS[factoryKey];
    updated[field] = await loadFactoryPreload(factoryKey);
    backfilled.push(factoryKey);
  }

  return {
    contexts: updated,
    backfilled,
    f8_backfill_executed: true,
    f8_backfill_full: backfilled.length === LEGACY_CHAT_FULL_FACTORY_PRELOAD.length,
  };
}

export function attachF8LegacyBackfillToTrace(trace, backfillMeta = {}) {
  if (!trace || !backfillMeta?.f8_backfill_executed) return trace;
  return {
    ...trace,
    f8_legacy_fallback_backfill: {
      executed: true,
      backfilled: backfillMeta.backfilled ?? [],
      f8_backfill_full: backfillMeta.f8_backfill_full === true,
    },
    legacy_preload_executed: true,
  };
}

/**
 * A1 shadow trace — never throws. Does not load factories or change answers.
 */
export function buildKeyChatPreloadShadowTrace({
  question = "",
  loadedContext = null,
  history = [],
  unified = null,
  customerId = null,
} = {}) {
  try {
    const planBundle = buildKeyPreloadPlanBundle({
      question,
      loadedContext,
      history,
      unified,
      customerId,
    });
    const { classification, plan, keyPlannedFactoryPreloads, legacyFullPreload, preloadWouldChange, kb0Plan } =
      planBundle;

    const kb0Ok = kb0Plan?.meta?.failed !== true;
    const kb0PreloadRecommendation =
      kb0Ok ? (kb0Plan.key_dispatches?.preload_shadow_recommendation ?? null) : null;

    return {
      schema_version: KEY_CHAT_PRELOAD_SHADOW_SCHEMA_VERSION,
      gate: "SLICE-A-A1",
      mode: "shadow",
      subject: "KEY",
      executed_selective_preload: false,
      legacy_preload_executed: true,
      customer_answer_impact: false,
      classification: {
        intent: classification.intent ?? null,
        lookup_sub_intent: classification.lookup_sub_intent ?? null,
        companion_cluster: classification.companion_cluster ?? null,
        matched_rule: classification.matched_rule ?? null,
      },
      plan_key_tools: {
        tools: plan.tools ?? [],
        coverage_gap_suppressed: plan.coverage_gap_suppressed === true,
        coverage_gap_suppress_reason: plan.coverage_gap_suppress_reason ?? null,
        legacy_slice: plan.legacy_slice ?? null,
        companion_cluster: plan.companion_cluster ?? null,
      },
      key_planned_factory_preloads: keyPlannedFactoryPreloads,
      legacy_full_preload_actual: legacyFullPreload,
      preload_would_change: preloadWouldChange,
      kb0_shadow_parity: {
        ok: kb0Ok,
        preload_shadow_recommendation: kb0PreloadRecommendation,
        tools_parity: kb0Plan?.diff?.tools_parity ?? null,
        preload_would_change_kb0: kb0Plan?.diff?.preload_would_change ?? null,
      },
    };
  } catch (error) {
    return {
      schema_version: KEY_CHAT_PRELOAD_SHADOW_SCHEMA_VERSION,
      gate: "SLICE-A-A1",
      mode: "shadow",
      subject: "KEY",
      failed: true,
      error: error instanceof Error ? error.message : "shadow_trace_failed",
      executed_selective_preload: false,
      legacy_preload_executed: true,
      customer_answer_impact: false,
    };
  }
}

export function buildKeyChatPreloadActiveTrace({
  planBundle = null,
  selectiveResult = null,
  latencyPreloadMs = null,
} = {}) {
  const { classification, plan, keyPlannedFactoryPreloads, legacyFullPreload } = planBundle ?? {};
  return {
    schema_version: KEY_CHAT_PRELOAD_ACTIVE_SCHEMA_VERSION,
    gate: "SLICE-A-A2",
    mode: "active",
    subject: "KEY",
    executed_selective_preload: true,
    legacy_preload_executed: false,
    customer_answer_impact: false,
    classification: {
      intent: classification?.intent ?? null,
      lookup_sub_intent: classification?.lookup_sub_intent ?? null,
      companion_cluster: classification?.companion_cluster ?? null,
      matched_rule: classification?.matched_rule ?? null,
    },
    plan_key_tools: {
      tools: plan?.tools ?? [],
      coverage_gap_suppressed: plan?.coverage_gap_suppressed === true,
      coverage_gap_suppress_reason: plan?.coverage_gap_suppress_reason ?? null,
      legacy_slice: plan?.legacy_slice ?? null,
      companion_cluster: plan?.companion_cluster ?? null,
    },
    key_planned_factory_preloads: keyPlannedFactoryPreloads ?? [],
    legacy_full_preload_actual: legacyFullPreload ?? [...LEGACY_CHAT_FULL_FACTORY_PRELOAD],
    preloads_executed: selectiveResult?.preloads_executed ?? [],
    preloads_skipped: selectiveResult?.preloads_skipped ?? [],
    latency_preload_ms: latencyPreloadMs,
  };
}

export function buildKeyChatPreloadActiveFallbackTrace({
  planBundle = null,
  fallbackReason = "orchestrator_ineligible",
  error = null,
} = {}) {
  const classification = planBundle?.classification ?? null;
  const plan = planBundle?.plan ?? null;
  return {
    schema_version: KEY_CHAT_PRELOAD_ACTIVE_SCHEMA_VERSION,
    gate: "SLICE-A-A2",
    mode: "active",
    subject: "KEY",
    executed_selective_preload: false,
    legacy_preload_executed: true,
    customer_answer_impact: false,
    fallback_reason: fallbackReason,
    failed: error ? true : undefined,
    error: error ?? undefined,
    classification: classification
      ? {
          intent: classification.intent ?? null,
          lookup_sub_intent: classification.lookup_sub_intent ?? null,
          companion_cluster: classification.companion_cluster ?? null,
          matched_rule: classification.matched_rule ?? null,
        }
      : null,
    plan_key_tools: plan
      ? {
          tools: plan.tools ?? [],
          coverage_gap_suppressed: plan.coverage_gap_suppressed === true,
          coverage_gap_suppress_reason: plan.coverage_gap_suppress_reason ?? null,
          legacy_slice: plan.legacy_slice ?? null,
          companion_cluster: plan.companion_cluster ?? null,
        }
      : null,
    key_planned_factory_preloads: planBundle?.keyPlannedFactoryPreloads ?? [],
    legacy_full_preload_actual: [...LEGACY_CHAT_FULL_FACTORY_PRELOAD],
  };
}

export function attachKeyPreloadControlToSalesDirectorTrace(salesDirectorTrace, keyPreloadControlTrace) {
  if (!keyPreloadControlTrace) return salesDirectorTrace;
  return {
    ...(salesDirectorTrace ?? {}),
    key_preload_control: keyPreloadControlTrace,
  };
}

export async function loadFactoryPreloadByKey(userSupabase, customerId, factoryKey, loaders = {}) {
  switch (factoryKey) {
    case "coverage_gap":
      return loaders.loadCoverageGap?.(userSupabase, customerId) ?? null;
    case "underwriting":
      return loaders.loadUnderwriting?.(userSupabase, customerId) ?? null;
    case "recommendation":
      return loaders.loadRecommendation?.(userSupabase, customerId) ?? null;
    case "design":
      return loaders.loadDesign?.(userSupabase, customerId) ?? null;
    default:
      return null;
  }
}
