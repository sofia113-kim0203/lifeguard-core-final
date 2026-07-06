import { triggerDocumentAnalysisRefresh } from "./customerDocumentAnalysisRefresh.js";
import { processAnalysisJobUntilComplete } from "./customerConversationalAnalysis.js";
import { writeEmitterTrace } from "./keyAnalysisCompleteSessionTransition.js";

function buildIngestStep(ingest) {
  if (!ingest) return { ok: false, status: "missing", error_message: "ingest_missing" };
  if (ingest.blocked) {
    return { ok: false, status: "analysis_blocked_by_consent", error_message: ingest.message ?? null };
  }
  if (ingest.failed) {
    return { ok: false, status: "ingest_failed", error_message: ingest.message ?? null };
  }
  const workerStatus = ingest.workerResult?.ingest_status ?? ingest.ingestStatus ?? "unknown";
  return {
    ok: workerStatus === "ready",
    status: workerStatus,
    error_message: workerStatus === "failed" ? ingest.workerResult?.message ?? null : null,
  };
}

function buildPolicyExtractionStep(policyExtraction) {
  if (!policyExtraction) {
    return { ok: false, status: "skipped", error_message: "policy_extraction_not_run" };
  }
  const reviewPending = policyExtraction.status === "pending_manual_review";
  return {
    ok: Boolean(policyExtraction.ok),
    status: policyExtraction.ok
      ? "completed"
      : reviewPending
        ? "pending_manual_review"
        : "extraction_failed",
    error_message: policyExtraction.ok ? null : policyExtraction.message ?? policyExtraction.reason ?? null,
    policy_id: policyExtraction.policyId ?? null,
    profile_insurance_policies_count: policyExtraction.profileInsurancePoliciesCount ?? null,
    customer_memory_facts_count: policyExtraction.customerMemoryFactsCount ?? null,
  };
}

function buildAnalysisStep(refreshResult, finalJob) {
  const job = finalJob ?? refreshResult?.analysis_job ?? null;
  return {
    ok: Boolean(refreshResult?.ok && job?.status === "completed"),
    status: job?.status ?? refreshResult?.reason ?? "unknown",
    analysis_job_id: refreshResult?.analysis_job_id ?? job?.id ?? null,
    error_message: refreshResult?.error_message ?? job?.error_message ?? null,
    panel_stages: refreshResult?.panel_stages ?? null,
    memory_sync: refreshResult?.memory_sync ?? null,
  };
}

/**
 * After OCR + policy extraction, refresh unified state and run full analysis pipeline.
 */
export async function runPostDocumentPipelineRefresh({
  documentId,
  ingest = null,
  policyExtraction = null,
  workOrderId = null,
  onAnalysisJobProgress = null,
  refreshSession = null,
  setActiveAnalysisJob = null,
  onTrackAnalysisJob = null,
} = {}) {
  const steps = {
    ingest: buildIngestStep(ingest),
    policy_extraction: buildPolicyExtractionStep(policyExtraction),
    memory_sync: null,
    analysis_job: null,
  };

  if (!steps.ingest.ok) {
    writeEmitterTrace({
      pipeline_early_exit: true,
      pipeline_ingest_ok: steps.ingest.ok,
      pipeline_policy_ok: steps.policy_extraction.ok,
      pipeline_ingest_status: steps.ingest.status,
      pipeline_policy_status: steps.policy_extraction.status,
    });
    if (typeof refreshSession === "function") {
      await refreshSession({ event: "document_upload_partial", reloadJob: false });
    }
    return {
      ok: false,
      steps,
      analysisJob: null,
      message: steps.ingest.error_message ?? "문서 파이프라인이 완료되지 않았습니다.",
    };
  }

  if (!steps.policy_extraction.ok) {
    writeEmitterTrace({
      pipeline_policy_gate_bypassed: true,
      pipeline_policy_ok: false,
      pipeline_policy_status: steps.policy_extraction.status,
    });
  }

  let refreshResult = null;
  try {
    refreshResult = await triggerDocumentAnalysisRefresh(documentId, { workOrderId });
  } catch (error) {
    steps.analysis_job = {
      ok: false,
      status: "failed",
      error_message: error instanceof Error ? error.message : "analysis_refresh_failed",
    };
    if (typeof refreshSession === "function") {
      await refreshSession({ event: "document_analysis_refresh_failed", reloadJob: false });
    }
    return {
      ok: false,
      steps,
      analysisJob: null,
      message: steps.analysis_job.error_message,
    };
  }

  steps.memory_sync = refreshResult.memory_sync ?? { ok: true };
  let finalJob = refreshResult.analysisJob ?? null;
  const resolvedJobId =
    finalJob?.id ?? refreshResult.analysisJobId ?? refreshResult.analysis_job_id ?? null;

  if (resolvedJobId && typeof onTrackAnalysisJob === "function") {
    onTrackAnalysisJob(resolvedJobId);
    writeEmitterTrace({
      tracked_job_id: resolvedJobId,
      track_source: "upload_pipeline_refresh",
      refresh_ok: refreshResult.ok,
      refresh_job_status: finalJob?.status ?? null,
    });
  } else {
    writeEmitterTrace({
      track_skipped: true,
      resolved_job_id: resolvedJobId,
      on_track_callable: typeof onTrackAnalysisJob === "function",
    });
  }

  if (!finalJob?.id && resolvedJobId) {
    finalJob = { id: resolvedJobId, status: finalJob?.status ?? "processing" };
  }

  if (finalJob && typeof setActiveAnalysisJob === "function") {
    setActiveAnalysisJob(finalJob);
  }

  if (
    finalJob?.id &&
    finalJob.status !== "completed" &&
    finalJob.status !== "failed"
  ) {
    finalJob = await processAnalysisJobUntilComplete({
      jobId: finalJob.id,
      onProgress: (job) => {
        if (typeof onAnalysisJobProgress === "function") onAnalysisJobProgress(job);
        if (typeof setActiveAnalysisJob === "function") setActiveAnalysisJob(job);
      },
    });
  }

  steps.analysis_job = buildAnalysisStep(refreshResult, finalJob);

  if (typeof refreshSession === "function") {
    await refreshSession({ event: "document_pipeline_complete", reloadJob: true });
  }

  if (finalJob && typeof setActiveAnalysisJob === "function") {
    setActiveAnalysisJob(finalJob);
  }

  return {
    ok: steps.analysis_job.ok,
    steps,
    analysisJob: finalJob,
    message: steps.analysis_job.ok
      ? "문서 분석과 보험 추천 갱신이 완료되었습니다."
      : steps.analysis_job.error_message ?? "분석 파이프라인이 완료되지 않았습니다.",
  };
}
