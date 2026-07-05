/**
 * P10-1 — Sales Director KEY orchestrator skeleton.
 * Factories = tools; KEY assembles factBundle then exits before Tom/CB/FT/Frame.
 */
import { classifyConsultationIntent } from "./intentGateLayer.js";
import { TOM_INTERNAL_ROUTES } from "./homeAgentTom.js";
import { SALES_DIRECTOR_MODES } from "./customerObservability.js";
import {
  createSalesDirectorLatencyBucket,
  markLatencyMs,
} from "./salesDirectorLatencyAudit.js";
import {
  KEY_SKIPPED_LAYERS,
  buildKeyFactBundlePolicyFields,
  buildToolBrainAbsorbedTrace,
  isKeyLegacyFallbackEnabled,
  planKeyTools,
  runKeyTools,
  shouldUseSalesDirectorKeyOrchestrator,
} from "./salesDirectorKeyToolRegistry.js";
import { buildRecommendationContextFromPayload } from "./salesDirectorRecommendationContext.js";
import { buildCoverageGapContextFromPayload } from "./salesDirectorCoverageGapContext.js";
import { buildUnderwritingRiskContextFromPayload } from "./salesDirectorUnderwritingRiskContext.js";
import { buildDesignContextFromPayload } from "./salesDirectorInsuranceDesignContext.js";
import { buildRebalancingContextFromAnalysisJob } from "./salesDirectorRebalancingContext.js";

export {
  isKeyLegacyFallbackEnabled,
  isKeyOrchestratorEnabled,
  shouldUseSalesDirectorKeyOrchestrator,
} from "./salesDirectorKeyToolRegistry.js";

/** Tom Hand P2 — 유일한 KEY Runtime SSOT. Entry만 확장; 새 Runtime primitive 금지. */
export const KEY_ENTRY = {
  QUESTION: "question",
  DOCUMENT_INTAKE: "document_intake",
  ANALYSIS_COMPLETE: "analysis_complete",
  BRIDGE: "bridge",
  RETURN_JUDGMENT: "return_judgment",
};

export const KEY_RUNTIME_SSOT = "runSalesDirectorKeyTurn";

export const DOCUMENT_INTAKE_CONSULTATION_INTENT = {
  intent: "document_intake",
  lookup_sub_intent: null,
  companion_cluster: null,
};

export const ANALYSIS_COMPLETE_CONSULTATION_INTENT = {
  intent: "analysis_complete",
  lookup_sub_intent: null,
  companion_cluster: null,
};

export const BRIDGE_CONSULTATION_INTENT = {
  intent: "key_bridge",
  lookup_sub_intent: null,
  companion_cluster: null,
};

export const RETURN_JUDGMENT_CONSULTATION_INTENT = {
  intent: "return_judgment",
  lookup_sub_intent: null,
  companion_cluster: null,
};

function createKeyTruthGatePlaceholder({ draftText = "", factBundle = {}, loadedContext = null } = {}) {
  return {
    status: "placeholder_p10_1_key",
    claims_validation: null,
    final_text_independent_scan: null,
    claims: [],
    draft_text_length: String(draftText ?? "").length,
    loaded_context_snapshot: loadedContext
      ? {
          policies: loadedContext.policies ?? null,
          documents: loadedContext.documents ?? null,
          memory: loadedContext.memory ?? null,
        }
      : null,
    fact_bundle_policy_count:
      factBundle?.active_policy_count ?? factBundle?.policy_count ?? null,
  };
}

function buildKeyModeDecision(consultationIntent = null, keyEntry = KEY_ENTRY.QUESTION) {
  return {
    mode: SALES_DIRECTOR_MODES.KEY,
    key_orchestrator: true,
    key_entry: keyEntry,
    pilotKey: null,
    tomInternalRoute: TOM_INTERNAL_ROUTES.CHAT,
    consultationIntent,
  };
}

function buildKeyAgentTurn({
  question = "",
  consultationIntent = null,
  customerContextBundle = null,
  unified = null,
  toolRun = null,
  plan = null,
  keyEntry = KEY_ENTRY.QUESTION,
  document = null,
  hasAnalysisConsent = false,
  analysisJob = null,
} = {}) {
  const policies = customerContextBundle?.policies ?? [];
  const legacySlice = plan?.legacy_slice ?? null;
  const policyFields = buildKeyFactBundlePolicyFields({ unified, customerContextBundle });
  const recommendationPriorityLabels =
    toolRun?.recommendationContext?.priority_labels ??
    customerContextBundle?.recommendationContext?.priority_labels ??
    [];
  const coverageGapContext =
    toolRun?.coverageGapContext ?? customerContextBundle?.coverageGapContext ?? null;
  const underwritingRiskContext =
    toolRun?.underwritingContext ?? customerContextBundle?.underwritingRiskContext ?? null;
  const designCtx = toolRun?.designContext ?? customerContextBundle?.designContext ?? null;
  const rebalancingCtx = toolRun?.rebalancingContext ?? customerContextBundle?.rebalancingContext ?? null;
  const designPriorityCoverages = designCtx?.priority_coverages ?? [];
  const designKeepCoverages = designCtx?.keep_existing_coverages ?? [];
  const designNextActions = (designCtx?.next_actions ?? []).slice(0, 2);
  return {
    text: "",
    tomInternalRoute: TOM_INTERNAL_ROUTES.CHAT,
    consultationIntent,
    toolUsed: null,
    responseSource: "sales_director_key",
    factBundle: {
      question,
      classification_intent: consultationIntent?.intent ?? null,
      lookup_sub_intent: consultationIntent?.lookup_sub_intent ?? null,
      companion_cluster: consultationIntent?.companion_cluster ?? null,
      ...policyFields,
      policies,
      memory_fact_count: customerContextBundle?.memoryFactCount ?? 0,
      customer_context_used: true,
      key_orchestrator: true,
      key_entry: keyEntry,
      key_runtime_ssot: KEY_RUNTIME_SSOT,
      ...(keyEntry === KEY_ENTRY.DOCUMENT_INTAKE
        ? {
            document_intake: true,
            document_id: document?.id ?? null,
            has_analysis_consent: hasAnalysisConsent === true,
          }
        : {}),
      ...(keyEntry === KEY_ENTRY.ANALYSIS_COMPLETE
        ? {
            analysis_complete: true,
            analysis_job_id: analysisJob?.id ?? null,
            analysis_job_status: analysisJob?.status ?? null,
          }
        : {}),
      ...(keyEntry === KEY_ENTRY.BRIDGE
        ? {
            key_bridge: true,
            analysis_job_id: analysisJob?.id ?? null,
            analysis_job_status: analysisJob?.status ?? null,
          }
        : {}),
      ...(keyEntry === KEY_ENTRY.RETURN_JUDGMENT
        ? {
            return_judgment: true,
            analysis_job_id: analysisJob?.id ?? null,
            analysis_job_status: analysisJob?.status ?? null,
          }
        : {}),
      key_tools_called: toolRun?.tools_called ?? [],
      premium_stats: toolRun?.premium_stats ?? null,
      snapshot_tool_used: toolRun?.snapshot_used === true,
      memory_tool_used: toolRun?.memory_used === true,
      coverage_gap_used: toolRun?.coverage_gap_used === true,
      has_stored_coverage_analysis: toolRun?.coverage_gap_used === true,
      coverage_gap_top_concerns: coverageGapContext?.top_concerns ?? [],
      coverage_gap_score: coverageGapContext?.gap_score ?? null,
      underwriting_used: toolRun?.underwriting_used === true,
      underwriting_loaded: toolRun?.underwriting_loaded === true,
      has_stored_underwriting_analysis: toolRun?.underwriting_used === true,
      underwriting_risk_score: underwritingRiskContext?.risk_score ?? null,
      underwriting_overall_risk:
        underwritingRiskContext?.overall_underwriting_risk ??
        underwritingRiskContext?.overall_severity ??
        null,
      underwriting_review_flags: underwritingRiskContext?.review_flags ?? [],
      underwriting_health_topics: underwritingRiskContext?.health_topics ?? [],
      underwriting_record_count: underwritingRiskContext?.record_count ?? 0,
      recommendation_used: toolRun?.recommendation_used === true,
      recommendation_loaded: toolRun?.recommendation_loaded === true,
      has_stored_recommendation_analysis: toolRun?.recommendation_used === true,
      recommendation_priority_labels: recommendationPriorityLabels,
      design_used: toolRun?.design_used === true,
      design_loaded: toolRun?.design_loaded === true,
      has_stored_design_analysis: toolRun?.design_used === true,
      design_priority_coverages: designPriorityCoverages,
      design_keep_coverages: designKeepCoverages,
      design_next_actions: designNextActions,
      design_title: designCtx?.design_title ?? null,
      design_summary: designCtx?.design_summary ?? null,
      design_priority: designCtx?.design_priority ?? null,
      rebalancing_used: toolRun?.rebalancing_used === true,
      rebalancing_loaded: toolRun?.rebalancing_loaded === true,
      rebalancing_keep_labels: rebalancingCtx?.rebalancing_keep_labels ?? [],
      rebalancing_strengthen_labels: rebalancingCtx?.rebalancing_strengthen_labels ?? [],
      rebalancing_review_labels: rebalancingCtx?.rebalancing_review_labels ?? [],
      rebalancing_reduce_signal: rebalancingCtx?.rebalancing_reduce_signal === true,
      maintenance_return_eligible:
        keyEntry === KEY_ENTRY.RETURN_JUDGMENT && rebalancingCtx?.maintenance_return_eligible === true,
      tool_brain_slice: legacySlice,
      tool_brain_absorbed: Boolean(legacySlice),
      coverage_gap_suppressed: plan?.coverage_gap_suppressed === true,
    },
    tomGapVoiceHandled: false,
    trace: {
      agent: "sales_director_key",
      key_orchestrator: toolRun?.trace ?? null,
      skipped_layers: KEY_SKIPPED_LAYERS,
    },
  };
}

/**
 * Run KEY orchestrator turn. Returns { handled, result?, reason? }.
 * When handled=false and legacy fallback is on, caller continues legacy loop.
 */
export async function runSalesDirectorKeyTurn({
  userSupabase,
  customerId,
  question,
  history: _history = [],
  env = process.env,
  fetchImpl: _fetchImpl = fetch,
  startedAt = Date.now(),
  streamHandlers: _streamHandlers = null,
  requestStartedAt: _requestStartedAt = null,
  snapshot,
  unified,
  loadedContext,
  customerContextBundle,
  reconciliationWarning,
  modeDecision = null,
  latency = null,
  loopStartedAt = null,
  keyEntry = KEY_ENTRY.QUESTION,
  document = null,
  hasAnalysisConsent = false,
  analysisJob = null,
} = {}) {
  const consultationIntent =
    keyEntry === KEY_ENTRY.DOCUMENT_INTAKE
      ? DOCUMENT_INTAKE_CONSULTATION_INTENT
      : keyEntry === KEY_ENTRY.ANALYSIS_COMPLETE
        ? ANALYSIS_COMPLETE_CONSULTATION_INTENT
        : keyEntry === KEY_ENTRY.BRIDGE
          ? BRIDGE_CONSULTATION_INTENT
          : keyEntry === KEY_ENTRY.RETURN_JUDGMENT
            ? RETURN_JUDGMENT_CONSULTATION_INTENT
            : modeDecision?.consultationIntent ?? classifyConsultationIntent(question);
  const keyLatency = latency ?? createSalesDirectorLatencyBucket();
  const keyModeDecision = buildKeyModeDecision(consultationIntent, keyEntry);

  const planStart = Date.now();
  const planQuestion =
    keyEntry === KEY_ENTRY.DOCUMENT_INTAKE ||
    keyEntry === KEY_ENTRY.ANALYSIS_COMPLETE ||
    keyEntry === KEY_ENTRY.BRIDGE ||
    keyEntry === KEY_ENTRY.RETURN_JUDGMENT
      ? ""
      : question;

  if (
    keyEntry === KEY_ENTRY.ANALYSIS_COMPLETE &&
    analysisJob?.result_json?.recommendation &&
    customerContextBundle
  ) {
    const jobReco = buildRecommendationContextFromPayload(analysisJob.result_json.recommendation, {
      jobId: analysisJob.id ?? null,
    });
    if (jobReco?.loaded) {
      customerContextBundle.recommendationContext = jobReco;
    }
  }

  if (
    keyEntry === KEY_ENTRY.RETURN_JUDGMENT &&
    analysisJob?.result_json?.coverage_gap &&
    customerContextBundle
  ) {
    const jobGap = buildCoverageGapContextFromPayload(analysisJob.result_json.coverage_gap, {
      jobId: analysisJob.id ?? null,
    });
    if (jobGap?.loaded) {
      customerContextBundle.coverageGapContext = jobGap;
    }
  }

  if (
    keyEntry === KEY_ENTRY.RETURN_JUDGMENT &&
    analysisJob?.result_json?.underwriting_risk &&
    customerContextBundle
  ) {
    const jobUw = buildUnderwritingRiskContextFromPayload(analysisJob.result_json.underwriting_risk, {
      jobId: analysisJob.id ?? null,
    });
    if (jobUw?.loaded) {
      customerContextBundle.underwritingRiskContext = jobUw;
    }
  }

  if (
    keyEntry === KEY_ENTRY.RETURN_JUDGMENT &&
    analysisJob?.result_json?.insurance_design &&
    customerContextBundle
  ) {
    const jobDesign = buildDesignContextFromPayload(analysisJob.result_json.insurance_design, {
      jobId: analysisJob.id ?? null,
    });
    if (jobDesign?.loaded) {
      customerContextBundle.designContext = jobDesign;
    }
  }

  if (keyEntry === KEY_ENTRY.RETURN_JUDGMENT && analysisJob && customerContextBundle) {
    const jobRebalancing = buildRebalancingContextFromAnalysisJob(analysisJob, {
      policies: customerContextBundle.policies ?? [],
    });
    if (jobRebalancing?.loaded) {
      customerContextBundle.rebalancingContext = jobRebalancing;
    }
  }

  const plan = planKeyTools(consultationIntent, loadedContext, planQuestion, analysisJob);
  keyLatency.key_plan_ms = markLatencyMs(planStart);

  const toolsStart = Date.now();
  const toolRun = await runKeyTools({
    plan,
    userSupabase,
    customerId,
    customerContextBundle,
    loadedContext,
    existingGapContext: customerContextBundle?.coverageGapContext ?? null,
    existingUnderwritingContext: customerContextBundle?.underwritingRiskContext ?? null,
    existingRecommendationContext: customerContextBundle?.recommendationContext ?? null,
    existingDesignContext: customerContextBundle?.designContext ?? null,
    existingRebalancingContext: customerContextBundle?.rebalancingContext ?? null,
    unified,
    analysisJob,
  });
  keyLatency.key_tools_ms = markLatencyMs(toolsStart);

  if (!toolRun.ok) {
    return {
      handled: false,
      reason: toolRun.reason ?? "key_tools_failed",
      legacy_fallback: isKeyLegacyFallbackEnabled(env),
    };
  }

  if (toolRun.coverageGapContext) {
    customerContextBundle.coverageGapContext = toolRun.coverageGapContext;
  }
  if (toolRun.underwritingContext) {
    customerContextBundle.underwritingRiskContext = toolRun.underwritingContext;
  }
  if (toolRun.recommendationContext) {
    customerContextBundle.recommendationContext = toolRun.recommendationContext;
  }
  if (toolRun.designContext) {
    customerContextBundle.designContext = toolRun.designContext;
  }
  if (toolRun.rebalancingContext) {
    customerContextBundle.rebalancingContext = toolRun.rebalancingContext;
  }

  const agentTurn = buildKeyAgentTurn({
    question,
    consultationIntent,
    customerContextBundle,
    unified,
    toolRun,
    plan,
    keyEntry,
    document,
    hasAnalysisConsent,
    analysisJob,
  });

  const toolBrainAbsorbed = buildToolBrainAbsorbedTrace({
    plan,
    toolRun,
    customerContextBundle,
    unified,
  });

  const truthGate = createKeyTruthGatePlaceholder({
    draftText: agentTurn.text,
    factBundle: agentTurn.factBundle,
    loadedContext,
  });

  const salesDirectorTrace = {
    sales_director_loop: true,
    sales_director_mode: SALES_DIRECTOR_MODES.KEY,
    sales_director_step: "key_tools_complete",
    legacy_response_source: agentTurn.responseSource,
    legacy_tom_internal_route: agentTurn.tomInternalRoute,
    key_orchestrator: {
      status: "p10_1_skeleton",
      key_entry: keyEntry,
      key_runtime_ssot: KEY_RUNTIME_SSOT,
      plan,
      tools_called: toolRun.tools_called ?? [],
      skipped_layers: KEY_SKIPPED_LAYERS,
      tool_results: toolRun.tool_results ?? [],
    },
    tool_brain: toolBrainAbsorbed,
    tool_brain_absorbed: toolBrainAbsorbed,
    conversation_brain: null,
    truth_gate: truthGate,
    snapshot_cache_hit: keyLatency.snapshot_cache_hit === true,
    latency: {
      ...keyLatency,
      total_ms: markLatencyMs(loopStartedAt ?? startedAt),
    },
  };

  return {
    handled: true,
    result: {
      ok: true,
      contextSnapshot: snapshot,
      unifiedState: unified,
      loadedContext,
      reconciliationWarning,
      customerContextBundle,
      modeDecision: keyModeDecision,
      agentTurn,
      salesDirectorTrace,
      truthGate,
      latency: keyLatency,
      loopStartedAt: loopStartedAt ?? startedAt,
      keyEntry,
      keyRuntimeSsot: KEY_RUNTIME_SSOT,
    },
  };
}
