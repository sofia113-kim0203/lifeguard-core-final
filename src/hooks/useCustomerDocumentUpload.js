import { useCallback, useRef, useState } from "react";
import {
  grantDocumentAnalysisConsent,
  grantDocumentStorageConsent,
  requeuePendingDocumentIngest,
  uploadDocument,
} from "../lib/customerDocuments.js";
import { runPostDocumentPipelineRefresh } from "../lib/customerDocumentPipeline.js";
import { DOCUMENT_UI_MESSAGES, toCustomerErrorMessage } from "../lib/uiLocale.js";

export function useCustomerDocumentUpload({
  user,
  refreshSession,
  setActiveAnalysisJob,
  notifySystemMessage = null,
  insurancePolicyCount = null,
  onUploadComplete = null,
  enableSystemMessage = false,
  defaultCategoryKey = "insurance_policy",
} = {}) {
  const fileInputRef = useRef(null);
  const [hasConsent, setHasConsent] = useState(false);
  const [hasAnalysisConsent, setHasAnalysisConsent] = useState(false);
  const [categoryKey, setCategoryKey] = useState(defaultCategoryKey);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [grantingConsent, setGrantingConsent] = useState(false);
  const [grantingAnalysisConsent, setGrantingAnalysisConsent] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const syncFromListResult = useCallback((result) => {
    if (!result) return;
    setHasConsent(Boolean(result.hasDocumentStorageConsent));
    setHasAnalysisConsent(Boolean(result.hasDocumentAnalysisConsent));
  }, []);

  const clearMessages = useCallback(() => {
    setError("");
    setSuccess("");
  }, []);

  const handleGrantConsent = useCallback(async () => {
    if (!user) return;
    setGrantingConsent(true);
    clearMessages();
    try {
      await grantDocumentStorageConsent(user);
      setHasConsent(true);
      setSuccess("문서 보관 동의가 완료되었습니다.");
    } catch (err) {
      setError(toCustomerErrorMessage(err, "문서 보관 동의를 완료하지 못했습니다."));
    } finally {
      setGrantingConsent(false);
    }
  }, [user, clearMessages]);

  const handleGrantAnalysisConsent = useCallback(async () => {
    if (!user) return;
    setGrantingAnalysisConsent(true);
    clearMessages();
    try {
      await grantDocumentAnalysisConsent(user);
      setHasAnalysisConsent(true);
      const requeue = await requeuePendingDocumentIngest(user);
      let pipelineMessage = "";
      const lastResult = requeue.results?.at(-1);
      if (lastResult?.ingest?.policyExtraction?.ok) {
        const pipeline = await runPostDocumentPipelineRefresh({
          documentId: lastResult.documentId,
          ingest: lastResult.ingest,
          policyExtraction: lastResult.ingest.policyExtraction,
          refreshSession,
          setActiveAnalysisJob,
        });
        if (pipeline.ok) pipelineMessage = ` ${DOCUMENT_UI_MESSAGES.pipelineRefreshSuccessNotice}`;
        else if (pipeline.message) pipelineMessage = ` (${pipeline.message})`;
      }
      setSuccess(
        requeue.requeued > 0
          ? `${DOCUMENT_UI_MESSAGES.analysisConsentSuccess} (${requeue.requeued}건 시작)${pipelineMessage}`
          : `${DOCUMENT_UI_MESSAGES.analysisConsentSuccess}${pipelineMessage}`,
      );
      if (typeof refreshSession === "function") {
        await refreshSession({ event: "document_requeue_complete", reloadJob: true });
      }
      if (typeof onUploadComplete === "function") {
        await onUploadComplete();
      }
    } catch (err) {
      setError(toCustomerErrorMessage(err, "문서 분석 동의를 완료하지 못했습니다."));
    } finally {
      setGrantingAnalysisConsent(false);
    }
  }, [user, clearMessages, refreshSession, setActiveAnalysisJob, onUploadComplete]);

  const handleUpload = useCallback(async () => {
    if (!user) return;
    if (!hasConsent) {
      setError("문서 보관 동의가 필요합니다.");
      return;
    }
    if (!selectedFile) {
      setError(DOCUMENT_UI_MESSAGES.selectFile);
      return;
    }

    setUploading(true);
    clearMessages();
    try {
      const uploadResult = await uploadDocument(user, { file: selectedFile, categoryKey });
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      const ingest = uploadResult?.ingest;
      if (ingest?.blocked) {
        setSuccess(`${DOCUMENT_UI_MESSAGES.uploadSuccess} ${DOCUMENT_UI_MESSAGES.analysisBlockedNotice}`);
      } else if (ingest?.failed) {
        setSuccess(DOCUMENT_UI_MESSAGES.uploadSuccess);
        setError(ingest.message ?? DOCUMENT_UI_MESSAGES.ingestFailedNotice);
      } else if (ingest?.policyExtraction?.ok) {
        setSuccess(`${DOCUMENT_UI_MESSAGES.uploadSuccess} ${DOCUMENT_UI_MESSAGES.policyExtractSuccessNotice}`);
      } else if (
        ingest?.workerResult?.ingest_status === "ready" &&
        ingest?.policyExtraction &&
        !ingest.policyExtraction.ok
      ) {
        setSuccess(DOCUMENT_UI_MESSAGES.uploadSuccess);
        setError(ingest.policyExtraction.message ?? DOCUMENT_UI_MESSAGES.policyExtractPartialNotice);
      } else if (ingest && !ingest.blocked) {
        setSuccess(`${DOCUMENT_UI_MESSAGES.uploadSuccess} ${DOCUMENT_UI_MESSAGES.ingestQueuedNotice}`);
      } else {
        setSuccess(DOCUMENT_UI_MESSAGES.uploadSuccess);
      }

      const documentId = uploadResult?.document?.id ?? ingest?.documentId ?? null;
      const pipeline = await runPostDocumentPipelineRefresh({
        documentId,
        ingest,
        policyExtraction: ingest?.policyExtraction,
        refreshSession,
        setActiveAnalysisJob,
      });

      let refreshed = null;
      if (typeof refreshSession === "function") {
        refreshed = await refreshSession({ event: "document_pipeline_complete", reloadJob: true });
      }
      const policyCount =
        refreshed?.unified?.policy_count ??
        refreshed?.dashboard?.insurancePolicyCount ??
        insurancePolicyCount;

      if (pipeline.ok) {
        setSuccess(`${DOCUMENT_UI_MESSAGES.uploadSuccess} ${DOCUMENT_UI_MESSAGES.pipelineRefreshSuccessNotice}`);
        setError("");
      } else if (pipeline.steps?.policy_extraction?.ok && !pipeline.steps?.analysis_job?.ok) {
        setSuccess(DOCUMENT_UI_MESSAGES.uploadSuccess);
        setError(pipeline.message ?? DOCUMENT_UI_MESSAGES.pipelineAnalysisFailedNotice);
      } else if (!pipeline.steps?.policy_extraction?.ok && ingest?.workerResult?.ingest_status === "ready") {
        setSuccess(DOCUMENT_UI_MESSAGES.uploadSuccess);
        setError(
          pipeline.steps?.policy_extraction?.error_message ?? DOCUMENT_UI_MESSAGES.policyExtractPartialNotice,
        );
      }

      if (enableSystemMessage && typeof notifySystemMessage === "function") {
        await notifySystemMessage(
          pipeline.ok
            ? `문서 분석과 보험 추천이 갱신되었습니다. 현재 등록된 가입 보험은 ${policyCount}건입니다.`
            : `문서가 업로드되었습니다. 현재 등록된 가입 보험은 ${policyCount}건으로 확인됩니다.`,
          { metadata: { category_key: categoryKey, pipeline_ok: pipeline.ok }, refresh: false },
        );
      }

      if (typeof onUploadComplete === "function") {
        await onUploadComplete();
      }
    } catch (err) {
      setError(toCustomerErrorMessage(err, "문서 업로드에 실패했습니다."));
    } finally {
      setUploading(false);
    }
  }, [
    user,
    hasConsent,
    selectedFile,
    categoryKey,
    clearMessages,
    refreshSession,
    setActiveAnalysisJob,
    insurancePolicyCount,
    enableSystemMessage,
    notifySystemMessage,
    onUploadComplete,
  ]);

  const handleFileChange = useCallback((file) => {
    setSelectedFile(file ?? null);
  }, []);

  return {
    fileInputRef,
    hasConsent,
    hasAnalysisConsent,
    categoryKey,
    setCategoryKey,
    selectedFile,
    setSelectedFile,
    uploading,
    grantingConsent,
    grantingAnalysisConsent,
    error,
    success,
    syncFromListResult,
    handleGrantConsent,
    handleGrantAnalysisConsent,
    handleUpload,
    handleFileChange,
    clearMessages,
  };
}
