import { useCallback, useEffect, useRef, useState } from "react";
import {
  DOCUMENT_CATEGORIES,
  grantDocumentStorageConsent,
  listDocuments,
  uploadDocument,
  downloadDocument,
  softDeleteDocument,
} from "../lib/customerDocuments.js";
import {
  DOCUMENT_UI_MESSAGES,
  formatDocClass,
  formatFileSize,
  formatIngestStatus,
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
  sectionDesc: {
    margin: "0 0 20px",
    fontSize: "13px",
    color: "#94a3b8",
    lineHeight: 1.55,
  },
  label: {
    fontSize: "13px",
    color: "#94a3b8",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  input: {
    width: "100%",
    padding: "11px 14px",
    borderRadius: "10px",
    border: "1px solid rgba(148, 163, 184, 0.2)",
    background: "rgba(15, 23, 42, 0.6)",
    color: "#e2e8f0",
    fontSize: "14px",
    fontFamily: FONT,
    boxSizing: "border-box",
    outline: "none",
  },
  btn: {
    padding: "12px 20px",
    borderRadius: "10px",
    border: "none",
    background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
    color: "#fff",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: FONT,
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
  uploadGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
    gap: "16px",
    alignItems: "end",
  },
};

export default function DocumentsPanel({ user }) {
  const fileInputRef = useRef(null);
  const [documents, setDocuments] = useState([]);
  const [hasConsent, setHasConsent] = useState(false);
  const [categoryKey, setCategoryKey] = useState("insurance_policy");
  const [filterKey, setFilterKey] = useState("all");
  const [selectedFile, setSelectedFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [grantingConsent, setGrantingConsent] = useState(false);
  const [actionId, setActionId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadData = useCallback(async () => {
    if (!user) {
      setDocuments([]);
      setHasConsent(false);
      setLoading(false);
      setError(DOCUMENT_UI_MESSAGES.loginRequired);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const result = await listDocuments(user, { categoryKey: filterKey });
      setDocuments(result.documents);
      setHasConsent(result.hasDocumentStorageConsent);
    } catch (err) {
      setDocuments([]);
      setError(toCustomerErrorMessage(err, "문서 목록을 불러오지 못했습니다."));
    } finally {
      setLoading(false);
    }
  }, [user, filterKey]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleGrantConsent = async () => {
    if (!user) return;
    setGrantingConsent(true);
    setError("");
    setSuccess("");
    try {
      await grantDocumentStorageConsent(user);
      setHasConsent(true);
      setSuccess("문서 보관 동의가 완료되었습니다.");
    } catch (err) {
      setError(toCustomerErrorMessage(err, "문서 보관 동의를 완료하지 못했습니다."));
    } finally {
      setGrantingConsent(false);
    }
  };

  const handleUpload = async () => {
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
    setError("");
    setSuccess("");
    try {
      await uploadDocument(user, { file: selectedFile, categoryKey });
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      setSuccess(DOCUMENT_UI_MESSAGES.uploadSuccess);
      await loadData();
    } catch (err) {
      setError(toCustomerErrorMessage(err, "문서 업로드에 실패했습니다."));
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (documentId) => {
    if (!user) return;
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
    if (!user) return;
    if (!window.confirm(DOCUMENT_UI_MESSAGES.deleteConfirm)) return;

    setActionId(documentId);
    setError("");
    setSuccess("");
    try {
      await softDeleteDocument(user, documentId);
      setSuccess(DOCUMENT_UI_MESSAGES.deleteSuccess);
      await loadData();
    } catch (err) {
      setError(toCustomerErrorMessage(err, "문서를 삭제하지 못했습니다."));
    } finally {
      setActionId("");
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

      {!hasConsent ? (
        <section style={S.card}>
          <h2 style={S.sectionTitle}>{DOCUMENT_UI_MESSAGES.consentTitle}</h2>
          <p style={S.sectionDesc}>{DOCUMENT_UI_MESSAGES.consentBody}</p>
          <button
            type="button"
            style={S.btn}
            onClick={handleGrantConsent}
            disabled={grantingConsent}
          >
            {grantingConsent ? "처리 중…" : DOCUMENT_UI_MESSAGES.consentAction}
          </button>
        </section>
      ) : null}

      {error ? <div style={S.error}>{error}</div> : null}
      {success ? <div style={S.success}>{success}</div> : null}

      <section style={S.card}>
        <h2 style={S.sectionTitle}>문서 업로드</h2>
        <p style={S.sectionDesc}>
          PDF, JPG, PNG, HEIC, HEIF, WEBP 파일만 업로드할 수 있습니다. 최대 20MB입니다.
        </p>
        <div style={S.uploadGrid}>
          <label style={S.label}>
            <span>{UI_LABELS.documentCategory}</span>
            <select
              style={S.input}
              value={categoryKey}
              onChange={(e) => setCategoryKey(e.target.value)}
              disabled={!hasConsent || uploading}
            >
              {DOCUMENT_CATEGORIES.map((category) => (
                <option key={category.key} value={category.key}>
                  {category.label}
                </option>
              ))}
            </select>
          </label>
          <label style={S.label}>
            <span>파일</span>
            <input
              ref={fileInputRef}
              style={S.input}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,.webp,application/pdf,image/jpeg,image/png,image/heic,image/heif,image/webp"
              disabled={!hasConsent || uploading}
              onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <button
            type="button"
            style={S.btn}
            onClick={handleUpload}
            disabled={!hasConsent || uploading || !selectedFile}
          >
            {uploading ? "업로드 중…" : DOCUMENT_UI_MESSAGES.uploadAction}
          </button>
        </div>
        <p style={{ ...S.sectionDesc, marginTop: "16px", marginBottom: 0 }}>
          {DOCUMENT_UI_MESSAGES.analysisNotice}
        </p>
      </section>

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
          <button type="button" style={S.btnSecondary} onClick={loadData}>
            {DOCUMENT_UI_MESSAGES.refreshAction}
          </button>
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
                  const busy = actionId === document.id;
                  return (
                    <tr key={document.id}>
                      <td style={S.td}>{document.original_filename ?? "—"}</td>
                      <td style={S.td}>{formatDocClass(document.doc_class)}</td>
                      <td style={S.td}>{formatUploadDate(document.created_at)}</td>
                      <td style={S.td}>{formatIngestStatus(document.ingest_status)}</td>
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
                            onClick={() => handleDelete(document.id)}
                          >
                            {DOCUMENT_UI_MESSAGES.deleteAction}
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
