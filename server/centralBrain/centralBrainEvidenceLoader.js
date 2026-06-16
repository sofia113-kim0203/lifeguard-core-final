/**
 * P2 Central Brain — Read-only evidence bundle assembly.
 */
import { loadUnifiedCustomerState } from "../unifiedCustomerState.js";
import { buildStructuredMemoryProfile } from "../customerMemorySnapshot.js";
import { loadLatestCompletedAnalysisJob } from "../advisorBrain/advisorRecommendationReasonResponder.js";
import { mapJobResultsToAnalysisPanels } from "../../src/lib/analysisPanelJobUtils.js";
import { buildReviewBundleFromEvidenceData, isCoverageReviewEvidenceSufficient } from "../advisorBrain/advisorCoverageReviewResponder.js";
import { computePremiumLookupStats } from "../intentGateLayer.js";
import { createAdvisorBrainContext } from "../advisorBrain/advisorBrainContext.js";
import { buildToolResult } from "../advisorBrain/advisorToolRunner.js";

function hasStoredPanelEvidence(panels) {
  if (!panels) return false;
  return Boolean(
    panels.coverageGapResult ||
      panels.underwritingResult ||
      panels.recommendationResult ||
      panels.designBundle,
  );
}

export async function loadCentralBrainEvidence({
  supabase,
  customerId,
  plan,
  memorySnapshot = null,
  cachePayload = null,
  conversationHistory = [],
  jobLoader = loadLatestCompletedAnalysisJob,
} = {}) {
  const sources = [];
  const data = {
    unified: null,
    memory: null,
    structured_memory: null,
    cache: cachePayload ?? null,
    stored_panels: null,
    stored_job: null,
    history: conversationHistory,
    policy_count: 0,
    premium_stats: null,
  };

  const loaderKeys = new Set(plan?.loaders ?? []);

  if (loaderKeys.has("unified_state") || loaderKeys.has("memory_snapshot")) {
    try {
      const context = await createAdvisorBrainContext({ supabase, customerId });
      data.unified = context.unified ?? null;
      data.memory = context.snapshot ?? memorySnapshot ?? null;
      data.structured_memory = context.structuredMemory ?? null;
      data.policy_count = context.policyCount ?? 0;
      data.premium_stats = computePremiumLookupStats(context.policies ?? []);
      sources.push({ key: "unified_state", ok: true, confidence: "confirmed" });
    } catch (error) {
      sources.push({
        key: "unified_state",
        ok: false,
        confidence: "unknown",
        error: error instanceof Error ? error.message : "unified_load_failed",
      });
    }
  }

  if (loaderKeys.has("stored_job") && plan?.use_stored_job) {
    try {
      const job = await jobLoader(supabase, customerId);
      data.stored_job = job;
      data.stored_panels = job ? mapJobResultsToAnalysisPanels(job) : null;
      sources.push({
        key: "stored_job",
        ok: Boolean(job),
        confidence: job ? "confirmed" : "insufficient",
      });
    } catch (error) {
      sources.push({
        key: "stored_job",
        ok: false,
        confidence: "unknown",
        error: error instanceof Error ? error.message : "stored_job_load_failed",
      });
    }
  }

  if (loaderKeys.has("analysis_cache") && cachePayload) {
    sources.push({ key: "analysis_cache", ok: true, confidence: "confirmed" });
  }

  if (loaderKeys.has("conversation_history")) {
    sources.push({
      key: "conversation_history",
      ok: Array.isArray(conversationHistory),
      confidence: conversationHistory.length ? "confirmed" : "partial",
    });
  }

  const hasStoredPanels = hasStoredPanelEvidence(data.stored_panels);
  data.review_bundle =
    plan?.central_mode === "coverage_review_request"
      ? buildReviewBundleFromEvidenceData(data)
      : null;

  let sufficiency = "insufficient";
  if (plan?.central_mode === "factual_lookup" && data.unified) {
    sufficiency = "sufficient";
  } else if (plan?.central_mode === "coverage_review_request") {
    sufficiency = isCoverageReviewEvidenceSufficient(data.review_bundle, data.stored_job)
      ? "sufficient"
      : data.unified
        ? "partial"
        : "insufficient";
  } else if (
    (plan?.central_mode === "coverage_gap_reason" ||
      plan?.central_mode === "recommendation_reason" ||
      plan?.central_mode === "advisor_conversation") &&
    hasStoredPanels
  ) {
    sufficiency = "sufficient";
  } else if (data.unified || hasStoredPanels) {
    sufficiency = "partial";
  }

  return {
    bundle_id: `cb-bundle-${Date.now()}`,
    customer_id: customerId,
    loaded_at: new Date().toISOString(),
    read_only: true,
    live_engines_executed: false,
    sources,
    data,
    review_bundle: data.review_bundle,
    sufficiency,
  };
}

export function buildReadOnlyToolRunFromBundle(bundle) {
  const panels = bundle?.data?.stored_panels ?? {};
  const gapResult =
    panels.coverageGapResult ??
    panels.coverage_gap ??
    panels.coverage_gap_result ??
    bundle?.data?.review_bundle?.coverage_gap ??
    bundle?.data?.stored_job?.result_json?.coverage_gap ??
    null;

  return async function readOnlyToolRun({
    classification,
    preloadedContext,
    userMessage = "",
  } = {}) {
    const context = preloadedContext ?? {};
    const policies = context.policies ?? [];
    const allowedTools = classification ? [] : [];

    const tool_results = [];

    tool_results.push(
      buildToolResult({
        ok: true,
        tool: "get_policies",
        data: {
          policies,
          policy_count: context.policyCount ?? policies.length,
          policy_ids: context.unified?.policy_ids ?? policies.map((p) => p.id).filter(Boolean),
        },
        confidence: policies.length ? "confirmed" : "partial",
        source: "unified_customer_state",
      }),
    );

    if (bundle?.data?.premium_stats) {
      tool_results.push(
        buildToolResult({
          ok: true,
          tool: "premium_lookup",
          data: bundle.data.premium_stats,
          confidence: "confirmed",
          source: "policy_explorer_stats",
        }),
      );
    }

    if (gapResult) {
      tool_results.push(
        buildToolResult({
          ok: true,
          tool: "get_coverage_gap",
          data: gapResult,
          confidence: "confirmed",
          source: "stored_analysis_job",
        }),
      );
    }

    if (context.snapshot) {
      tool_results.push(
        buildToolResult({
          ok: true,
          tool: "get_customer_memory",
          data:
            context.structuredMemory ?? buildStructuredMemoryProfile(context.snapshot),
          confidence: "confirmed",
          source: "customer_memory_snapshot",
        }),
      );
    }

    return {
      ok: true,
      called_tools: tool_results.map((result) => result.tool),
      tool_results,
      guardrail_summary: {
        read_only_bundle: true,
        live_engine_bypass: true,
        rag_skipped_in_step1: !userMessage,
      },
      audit_record: null,
      allowed_tools: allowedTools,
    };
  };
}
