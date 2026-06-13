import { triggerDocumentAnalysisRefresh } from "./customerDocumentAnalysisRefresh.js";
import { processAnalysisJobUntilComplete } from "./customerConversationalAnalysis.js";

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
  onAnalysisJobProgress = null,
  refreshSession = null,
  setActiveAnalysisJob = null,
} = {}) {
  const steps = {
    ingest: buildIngestStep(ingest),
    policy_extraction: buildPolicyExtractionStep(policyExtraction),
    memory_sync: null,
    analysis_job: null,
  };

  if (!steps.ingest.ok || !steps.policy_extraction.ok) {
    if (typeof refreshSession === "function") {
      await refreshSession({ event: "document_upload_partial", reloadJob: false });
    }
    return {
      ok: false,
      steps,
      analysisJob: null,
      message: steps.policy_extraction.error_message ?? steps.ingest.error_message ?? "문서 파이프라인이 완료되지 않았습니다.",
    };
  }

  let refreshResult = null;
  try {
    refreshResult = await triggerDocumentAnalysisRefresh(documentId);
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
