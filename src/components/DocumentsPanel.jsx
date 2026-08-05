import { useCallback, useEffect, useRef, useState } from "react";
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_DELETE_REASON,
  listDocuments,
  downloadDocument,
  softDeleteDocument,
  softDeleteDocumentsBatched,
  retryPendingPolicyExtractions,
} from "../lib/customerDocuments.js";
import CustomerDocumentUploadFlow from "./CustomerDocumentUploadFlow.jsx";
import { useCustomerSession } from "../hooks/useCustomerSession.js";
import { useCustomerDocumentUpload } from "../hooks/useCustomerDocumentUpload.js";
import {
  clearActiveAttachmentIfDocumentDeleted,
  scrubDeletedDocumentFromMessageActiveAttachments,
} from "../lib/chatActiveAttachment.js";
import {
  readLifeguardChatSnapshot,
  rememberClearedActiveAttachmentId,
  writeLifeguardChatSnapshot,
} from "../lib/lifeguardChatSessions.js";
import {
  DOCUMENT_UI_MESSAGES,
  formatDocClass,
  formatFileSize,
  formatDocumentPipelineStatus,
  formatUploadDate,
  toCustomerErrorMessage,
  UI_LABELS,
} from "../lib/uiLocale.js";

const FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

const FILTER_OPTIONS = [
  { key: "all", label: DOCUMENT_UI_MESSAGES.allCategories },
  ...DOCUMENT_CATEGORIES.map(({ key, label }) => ({ key, label })),
];

const S = {
  card: {
    background: "rgba(30, 41, 59, 0.65)",
    border: "1px solid rgba(148, 163, 184, 0.12)",
    borderRadius: "16px",
    padding: "24px 28px",
  },
  sectionTitle: {
    margin: "0 0 16px",
    fontSize: "17px",
    fontWeight: 700,
    color: "#f1f5f9",
  },
  btnSecondary: {
    padding: "10px 16px",
    borderRadius: "10px",
    border: "1px solid rgba(148, 163, 184, 0.25)",
    background: "rgba(30, 41, 59, 0.8)",
    color: "#e2e8f0",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: FONT,
  },
  btnDanger: {
    padding: "8px 12px",
    borderRadius: "8px",
    border: "1px solid rgba(248, 113, 113, 0.35)",
    background: "rgba(127, 29, 29, 0.35)",
    color: "#fecaca",
    fontSize: "12px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: FONT,
  },
  error: {
    padding: "12px 14px",
    borderRadius: "10px",
    background: "rgba(127, 29, 29, 0.35)",
    color: "#fecaca",
    fontSize: "13px",
    border: "1px solid rgba(248, 113, 113, 0.25)",
  },
  success: {
    padding: "12px 14px",
    borderRadius: "10px",
    background: "rgba(20, 83, 45, 0.35)",
    color: "#86efac",
    fontSize: "13px",
    border: "1px solid rgba(74, 222, 128, 0.25)",
  },
  notice: {
    padding: "12px 14px",
    borderRadius: "10px",
    background: "rgba(59, 130, 246, 0.12)",
    color: "#bfdbfe",
    fontSize: "13px",
    border: "1px solid rgba(96, 165, 250, 0.25)",
  },
  filterRow: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
  },
  filterBtn: (active) => ({
    padding: "8px 14px",
    borderRadius: "999px",
    border: active
      ? "1px solid rgba(96, 165, 250, 0.55)"
      : "1px solid rgba(148, 163, 184, 0.2)",
    background: active ? "rgba(59, 130, 246, 0.2)" : "rgba(15, 23, 42, 0.45)",
    color: active ? "#dbeafe" : "#cbd5e1",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: FONT,
  }),
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "14px",
  },
  th: {
    textAlign: "left",
    padding: "10px 12px",
    color: "#94a3b8",
    fontSize: "12px",
    fontWeight: 700,
    borderBottom: "1px solid rgba(148, 163, 184, 0.15)",
  },
  td: {
    padding: "12px",
    color: "#e2e8f0",
    borderBottom: "1px solid rgba(148, 163, 184, 0.08)",
    verticalAlign: "top",
  },
};

export default function DocumentsPanel({ user }) {
  const {
    refreshSession,
    notifySystemMessage,
    insurancePolicyCount,
    setActiveAnalysisJob,
  } = useCustomerSession();
  const loadDataRef = useRef(async () => {});
  const [documents, setDocuments] = useState([]);
  const [filterKey, setFilterKey] = useState("all");
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState("");
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const uploadFlow = useCustomerDocumentUpload({
    user,
    refreshSession,
    setActiveAnalysisJob,
    notifySystemMessage,
    insurancePolicyCount,
    enableSystemMessage: true,
    onUploadComplete: async () => {
      await loadDataRef.current();
    },
  });

  const loadData = useCallback(async () => {
    if (!user) {
      setDocuments([]);
      uploadFlow.syncFromListResult({
        hasDocumentStorageConsent: false,
        hasDocumentAnalysisConsent: false,
      });
      setLoading(false);
      setError(DOCUMENT_UI_MESSAGES.loginRequired);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const result = await listDocuments(user, { categoryKey: filterKey });
      setDocuments(result.documents);
      uploadFlow.syncFromListResult(result);

      if (result.hasDocumentAnalysisConsent) {
        const retry = await retryPendingPolicyExtractions(user);
        if (retry.retried > 0) {
          const refreshed = await listDocuments(user, { categoryKey: filterKey });
          setDocuments(refreshed.documents);
          await refreshSession({ event: "policy_extraction_retry_complete", reloadJob: true });
        }
      }
    } catch (err) {
      setDocuments([]);
      setError(toCustomerErrorMessage(err, "문서 목록을 불러오지 못했습니다."));
    } finally {
      setLoading(false);
    }
  }, [user, filterKey, refreshSession, uploadFlow.syncFromListResult]);

  useEffect(() => {
    loadDataRef.current = loadData;
  }, [loadData]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const applyLocalDeleteCleanup = (result) => {
    const customerId = result?.customerId;
    if (!result?.success || !customerId || !result.documentId) return;
    rememberClearedActiveAttachmentId(customerId, result.documentId);
    const snap = readLifeguardChatSnapshot(customerId);
    if (!snap) return;
    const nextActive = clearActiveAttachmentIfDocumentDeleted(
      snap.activeAttachment,
      result.documentId,
    );
    writeLifeguardChatSnapshot(customerId, {
      sessionId: snap.sessionId,
      messages: scrubDeletedDocumentFromMessageActiveAttachments(
        snap.messages,
        result.documentId,
      ),
      activeAttachment: nextActive,
    });
  };

  const describeDeleteFailure = (result, err) => {
    if (err) return toCustomerErrorMessage(err, "문서를 삭제하지 못했습니다.");
    if (
      result?.reason === DOCUMENT_DELETE_REASON.CLAIM_SCRUB_FAILED ||
      result?.reason === DOCUMENT_DELETE_REASON.POLICY_RETIRE_FAILED ||
      result?.reason === DOCUMENT_DELETE_REASON.MEMORY_SCRUB_FAILED
    ) {
      return DOCUMENT_UI_MESSAGES.deleteClaimScrubFailed;
    }
    if (result?.reason === DOCUMENT_DELETE_REASON.STORAGE_REMOVE_FAILED) {
      return DOCUMENT_UI_MESSAGES.deleteStorageRetryHint;
    }
    return (
      result?.error_message || toCustomerErrorMessage(null, "문서를 삭제하지 못했습니다.")
    );
  };

  const handleDownload = async (documentId) => {
    if (!user || bulkDeleting) return;
    setActionId(documentId);
    setError("");
    try {
      const result = await downloadDocument(user, documentId);
      window.open(result.signedUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(toCustomerErrorMessage(err, "문서를 다운로드하지 못했습니다."));
    } finally {
      setActionId("");
    }
  };

  const handleDelete = async (documentId) => {
    if (!user || bulkDeleting) return;
    if (!window.confirm(DOCUMENT_UI_MESSAGES.deleteConfirm)) return;

    setActionId(documentId);
    setError("");
    setSuccess("");
    try {
      const result = await softDeleteDocument(user, documentId);
      applyLocalDeleteCleanup(result);
      // Keep the card in place until every finalization step succeeds. A failed
      // finalize must remain retryable and must not look like a completed delete.
      if (result?.success) {
        await loadData();
      }
      if (result?.success && typeof refreshSession === "function") {
        try {
          await refreshSession({ event: "document_soft_deleted", reloadJob: false });
        } catch {
          /* next session load refreshes; do not block delete UX */
        }
      }
      if (result?.success) {
        setSuccess(
          `${DOCUMENT_UI_MESSAGES.deleteSuccess} ${DOCUMENT_UI_MESSAGES.deleteUploadHint}`,
        );
        return;
      }
      setError(describeDeleteFailure(result));
    } catch (err) {
      setError(describeDeleteFailure(null, err));
    } finally {
      setActionId("");
    }
  };

  const handleDeleteAll = async () => {
    if (!user || bulkDeleting || actionId) return;

    setError("");
    setSuccess("");
    let targets = [];
    try {
      const listed = await listDocuments(user, { categoryKey: "all" });
      targets = Array.isArray(listed?.documents) ? listed.documents : [];
    } catch (err) {
      setError(toCustomerErrorMessage(err, "문서 목록을 불러오지 못했습니다."));
      return;
    }

    const total = targets.length;
    if (total === 0) {
      setSuccess(DOCUMENT_UI_MESSAGES.emptyList);
      await loadData();
      return;
    }

    if (!window.confirm(DOCUMENT_UI_MESSAGES.deleteAllConfirm(total))) return;

    setBulkDeleting(true);
    try {
      const batch = await softDeleteDocumentsBatched(
        user,
        targets.map((document) => document.id),
      );
      for (const row of batch.succeeded) {
        applyLocalDeleteCleanup(row.result);
      }
      await loadData();
      if (batch.deletedCount > 0 && typeof refreshSession === "function") {
        try {
          await refreshSession({ event: "document_soft_deleted", reloadJob: false });
        } catch {
          /* next session load refreshes; do not block delete UX */
        }
      }
      const summary = DOCUMENT_UI_MESSAGES.deleteAllSummary(
        batch.deletedCount,
        batch.failedCount,
      );
      if (batch.failedCount > 0) {
        setError(summary);
        if (batch.deletedCount > 0) {
          setSuccess(
            `삭제 완료 ${batch.deletedCount}개. ${DOCUMENT_UI_MESSAGES.deleteUploadHint}`,
          );
        }
      } else {
        setSuccess(`${summary} ${DOCUMENT_UI_MESSAGES.deleteUploadHint}`);
      }
    } finally {
      setBulkDeleting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ fontFamily: FONT, color: "#94a3b8", fontSize: "15px" }}>
        문서 목록을 불러오는 중…
      </div>
    );
  }

  return (
    <div style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#f8fafc" }}>
          {UI_LABELS.documents}
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: "15px", color: "#94a3b8", lineHeight: 1.55 }}>
          보험증권, 약관, 청구·의료 서류를 업로드하고 안전하게 보관합니다.
        </p>
      </div>

      <CustomerDocumentUploadFlow
        variant="backoffice"
        user={user}
        refreshSession={refreshSession}
        setActiveAnalysisJob={setActiveAnalysisJob}
        notifySystemMessage={notifySystemMessage}
        insurancePolicyCount={insurancePolicyCount}
        enableSystemMessage
        uploadHook={uploadFlow}
      />

      {error ? <div style={S.error}>{error}</div> : null}
      {success ? <div style={S.success}>{success}</div> : null}

      <section style={S.card}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "12px",
            flexWrap: "wrap",
            marginBottom: "16px",
          }}
        >
          <h2 style={{ ...S.sectionTitle, margin: 0 }}>문서 목록</h2>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button
              type="button"
              style={S.btnSecondary}
              disabled={bulkDeleting || Boolean(actionId)}
              onClick={loadData}
            >
              {DOCUMENT_UI_MESSAGES.refreshAction}
            </button>
            <button
              type="button"
              style={S.btnDanger}
              disabled={bulkDeleting || Boolean(actionId)}
              aria-label={DOCUMENT_UI_MESSAGES.deleteAllAction}
              title={DOCUMENT_UI_MESSAGES.deleteAllAction}
              onClick={handleDeleteAll}
            >
              {bulkDeleting
                ? "삭제 중…"
                : `🗑 ${DOCUMENT_UI_MESSAGES.deleteAllAction}`}
            </button>
          </div>
        </div>

        <div style={{ ...S.filterRow, marginBottom: "16px" }}>
          {FILTER_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              style={S.filterBtn(filterKey === option.key)}
              onClick={() => setFilterKey(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {documents.length === 0 ? (
          <div style={S.notice}>{DOCUMENT_UI_MESSAGES.emptyList}</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>{UI_LABELS.documentFilename}</th>
                  <th style={S.th}>{UI_LABELS.documentCategory}</th>
                  <th style={S.th}>{UI_LABELS.documentUploadDate}</th>
                  <th style={S.th}>{UI_LABELS.documentStatus}</th>
                  <th style={S.th}>{UI_LABELS.documentFileSize}</th>
                  <th style={S.th}>작업</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((document) => {
                  const byteSize = document.metadata_json?.byte_size;
                  const busy = bulkDeleting || actionId === document.id;
                  return (
                    <tr key={document.id}>
                      <td style={S.td}>{document.original_filename ?? "—"}</td>
                      <td style={S.td}>{formatDocClass(document.doc_class)}</td>
                      <td style={S.td}>{formatUploadDate(document.created_at)}</td>
                      <td style={S.td}>{formatDocumentPipelineStatus(document)}</td>
                      <td style={S.td}>{formatFileSize(byteSize)}</td>
                      <td style={S.td}>
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                          <button
                            type="button"
                            style={S.btnSecondary}
                            disabled={busy}
                            onClick={() => handleDownload(document.id)}
                          >
                            {DOCUMENT_UI_MESSAGES.downloadAction}
                          </button>
                          <button
                            type="button"
                            style={S.btnDanger}
                            disabled={busy}
                            aria-label={DOCUMENT_UI_MESSAGES.deleteAction}
                            title={DOCUMENT_UI_MESSAGES.deleteAction}
                            onClick={() => handleDelete(document.id)}
                          >
                            {busy && actionId === document.id
                              ? "삭제 중…"
                              : `🗑 ${DOCUMENT_UI_MESSAGES.deleteAction}`}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
