/**
 * P2 Central Brain — Read-only orchestrator (Router → Planner → Loader → Advisor Brain I/O).
 */
import { buildAdvisorBrainAnswer } from "../advisorBrain/advisorBrainResponder.js";
import { buildAdvisorConversationAnswer } from "../advisorBrain/advisorConversationResponder.js";
import {
  buildCoverageReviewAnswer,
  COVERAGE_REVIEW_PENDING_MESSAGE,
} from "../advisorBrain/advisorCoverageReviewResponder.js";
import { buildRecommendationReasonAnswer } from "../advisorBrain/advisorRecommendationReasonResponder.js";
import { createAdvisorBrainContext } from "../advisorBrain/advisorBrainContext.js";
import { routeCentralBrain } from "./centralBrainRouter.js";
import { planCentralBrainEvidence } from "./centralBrainPlanner.js";
import {
  buildReadOnlyToolRunFromBundle,
  loadCentralBrainEvidence,
} from "./centralBrainEvidenceLoader.js";
import { findInFlightAnalysisJob } from "./centralBrainJobUtils.js";
import {
  buildCentralBrainAssistantMetadata,
  normalizeCentralBrainResponse,
} from "./centralBrainResponseNormalizer.js";

export async function runCentralBrainTurn({
  question,
  supabase,
  customerId,
  env = process.env,
  fetchImpl = fetch,
  memorySnapshot = null,
  cachePayload = null,
  conversationHistory = [],
  memoryVersion = 0,
  jobLoader,
  claudeCall,
} = {}) {
  const route = routeCentralBrain({ question, history: conversationHistory, env });

  if (!route.active || route.response_lane !== "central_brain" || !route.central_mode) {
    return {
      activated: false,
      ok: false,
      message: null,
      route,
      plan: null,
      bundle: null,
      skip_analysis_job: false,
      central_brain_mode: null,
      fail_safe_off: route.fail_safe_off === true,
    };
  }

  const plan = planCentralBrainEvidence({
    route,
    memoryVersion,
    cacheStatus: cachePayload?.cache_status ?? null,
  });

  const bundle = await loadCentralBrainEvidence({
    supabase,
    customerId,
    plan,
    memorySnapshot,
    cachePayload,
    conversationHistory,
    jobLoader,
  });

  const mode = route.central_mode;

  if (mode === "coverage_review_request" && bundle.sufficiency !== "sufficient") {
    const inFlightJob = await findInFlightAnalysisJob(supabase, customerId);
    return {
      activated: true,
      ok: true,
      message: COVERAGE_REVIEW_PENDING_MESSAGE,
      route,
      plan,
      bundle,
      skip_analysis_job: false,
      reuse_analysis_job_id: inFlightJob?.id ?? null,
      central_brain_mode: mode,
      coverage_review_mode: true,
      engine_executed: false,
      live_engines_executed: false,
      reason: inFlightJob ? "REUSE_IN_FLIGHT_JOB" : "INSUFFICIENT_STORED_EVIDENCE",
      metadata: buildCentralBrainAssistantMetadata({
        centralMode: mode,
        plan,
        bundle,
      }),
    };
  }

  if (bundle.sufficiency === "insufficient") {
    return {
      activated: true,
      ok: true,
      message:
        "현재 상담에 활용할 분석 결과가 충분하지 않습니다.\n먼저 분석이 필요합니다.",
      route,
      plan,
      bundle,
      skip_analysis_job: true,
      central_brain_mode: mode,
      engine_executed: false,
      live_engines_executed: false,
      reason: "INSUFFICIENT_STORED_EVIDENCE",
    };
  }

  const preloadedContext = await createAdvisorBrainContext({ supabase, customerId });
  const readOnlyToolRun = buildReadOnlyToolRunFromBundle(bundle);
  const storedJobLoader = async () => bundle.data.stored_job ?? null;

  let advisorResult = null;

  if (mode === "coverage_review_request") {
    advisorResult = await buildCoverageReviewAnswer({
      question,
      reviewBundle: bundle.review_bundle ?? bundle.data.review_bundle,
      storedJob: bundle.data.stored_job ?? null,
      env,
      fetchImpl,
      claudeCall,
    });
  } else if (mode === "recommendation_reason") {
    advisorResult = await buildRecommendationReasonAnswer({
      supabase,
      customerId,
      question,
      classification: route.classification,
      env,
      fetchImpl,
      claudeCall,
      jobLoader: storedJobLoader,
    });
  } else if (mode === "advisor_conversation") {
    advisorResult = await buildAdvisorConversationAnswer({
      supabase,
      customerId,
      question,
      classification: route.classification,
      env,
      fetchImpl,
      claudeCall,
      jobLoader: storedJobLoader,
    });
  } else {
    advisorResult = await buildAdvisorBrainAnswer({
      supabase,
      customerId,
      question,
      classification: route.classification,
      env,
      fetchImpl,
      preloadedContext,
      toolRun: readOnlyToolRun,
      claudeCall,
    });
  }

  const normalizedMessage = advisorResult?.message
    ? normalizeCentralBrainResponse(advisorResult.message)
    : null;

  const skipAnalysisJob =
    mode === "coverage_review_request" ? true : plan.skip_analysis_job === true;

  return {
    activated: true,
    ok: advisorResult?.ok === true && Boolean(normalizedMessage),
    message: normalizedMessage,
    route,
    plan,
    bundle,
    advisor_result: advisorResult,
    skip_analysis_job: skipAnalysisJob,
    central_brain_mode: mode,
    engine_executed: false,
    live_engines_executed: false,
    advisor_conversation_mode: mode === "advisor_conversation",
    recommendation_reason_mode: mode === "recommendation_reason",
    coverage_review_mode: mode === "coverage_review_request",
    metadata: buildCentralBrainAssistantMetadata({
      centralMode: mode,
      plan,
      bundle,
    }),
  };
}

/**
 * Voice foundation — input channel agnostic entry (STT is out of scope for Step1).
 */
export async function routeThroughCentralBrain({
  transcript,
  inputChannel = "text",
  ...turnArgs
} = {}) {
  const question = String(transcript ?? "").trim();
  return runCentralBrainTurn({
    ...turnArgs,
    question,
    inputChannel,
  });
}
