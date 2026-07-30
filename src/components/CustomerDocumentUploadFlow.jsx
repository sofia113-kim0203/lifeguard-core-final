import { DOCUMENT_CATEGORIES } from "../lib/documentCategories.js";
import { DOCUMENT_FILE_ACCEPT } from "../lib/customerDocuments.js";
import { LG } from "../lib/lifeguardCustomerTheme.js";
import { DOCUMENT_UI_MESSAGES, UI_LABELS } from "../lib/uiLocale.js";
import { useCustomerDocumentUpload } from "../hooks/useCustomerDocumentUpload.js";

const BACKOFFICE_FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

const BACKOFFICE = {
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
    fontFamily: BACKOFFICE_FONT,
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
    fontFamily: BACKOFFICE_FONT,
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
  uploadGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
    gap: "16px",
    alignItems: "end",
  },
};

const CUSTOMER = {
  card: {
    border: `1px solid ${LG.border}`,
    borderRadius: "12px",
    padding: "16px 18px",
    background: LG.surface,
    marginBottom: "20px",
  },
  sectionTitle: {
    margin: "0 0 10px",
    fontSize: "16px",
    fontWeight: 600,
    color: LG.text,
    fontFamily: LG.sans,
  },
  sectionDesc: {
    margin: "0 0 16px",
    fontSize: "14px",
    color: LG.textMuted,
    lineHeight: 1.6,
    fontFamily: LG.sans,
  },
  label: {
    fontSize: "13px",
    color: LG.textMuted,
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    fontFamily: LG.sans,
  },
  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: "10px",
    border: `1px solid ${LG.borderStrong}`,
    background: LG.inputBg,
    color: LG.text,
    fontSize: "14px",
    fontFamily: LG.sans,
    boxSizing: "border-box",
    outline: "none",
  },
  btn: {
    padding: "11px 18px",
    borderRadius: "10px",
    border: "none",
    background: LG.button,
    color: "#fff",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: LG.sans,
  },
  btnDisabled: {
    background: LG.buttonDisabled,
    cursor: "not-allowed",
  },
  error: {
    padding: "10px 12px",
    borderRadius: "10px",
    background: "#FEF2F2",
    color: "#B91C1C",
    fontSize: "13px",
    border: "1px solid #FECACA",
    marginBottom: "12px",
    fontFamily: LG.sans,
  },
  success: {
    padding: "10px 12px",
    borderRadius: "10px",
    background: "#F0FDF4",
    color: "#166534",
    fontSize: "13px",
    border: "1px solid #BBF7D0",
    marginBottom: "12px",
    fontFamily: LG.sans,
  },
  uploadGrid: {
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: "12px",
  },
};

const FILE_ACCEPT = DOCUMENT_FILE_ACCEPT;

function themeStyles(variant) {
  return variant === "backoffice" ? BACKOFFICE : CUSTOMER;
}

export default function CustomerDocumentUploadFlow({
  variant = "customer",
  user,
  refreshSession,
  setActiveAnalysisJob,
  notifySystemMessage,
  insurancePolicyCount,
  onUploadComplete,
  enableSystemMessage = false,
  defaultCategoryKey = "insurance_policy",
  uploadHook = null,
}) {
  const internalHook = useCustomerDocumentUpload({
    user,
    refreshSession,
    setActiveAnalysisJob,
    notifySystemMessage,
    insurancePolicyCount,
    onUploadComplete,
    enableSystemMessage,
    defaultCategoryKey,
  });
  const hook = uploadHook ?? internalHook;
  const S = themeStyles(variant);
  const fontFamily = variant === "backoffice" ? BACKOFFICE_FONT : LG.sans;
  const disabledUpload = !hook.hasConsent || hook.uploading;

  return (
    <div style={{ fontFamily }}>
      {!hook.hasConsent ? (
        <section style={S.card}>
          <h2 style={S.sectionTitle}>{DOCUMENT_UI_MESSAGES.consentTitle}</h2>
          <p style={S.sectionDesc}>{DOCUMENT_UI_MESSAGES.consentBody}</p>
          <button
            type="button"
            style={S.btn}
            onClick={hook.handleGrantConsent}
            disabled={hook.grantingConsent}
          >
            {hook.grantingConsent ? "처리 중…" : DOCUMENT_UI_MESSAGES.consentAction}
          </button>
        </section>
      ) : null}

      {hook.hasConsent && !hook.hasAnalysisConsent ? (
        <section style={S.card}>
          <h2 style={S.sectionTitle}>{DOCUMENT_UI_MESSAGES.analysisConsentTitle}</h2>
          <p style={S.sectionDesc}>{DOCUMENT_UI_MESSAGES.analysisConsentBody}</p>
          <button
            type="button"
            style={S.btn}
            onClick={hook.handleGrantAnalysisConsent}
            disabled={hook.grantingAnalysisConsent}
          >
            {hook.grantingAnalysisConsent ? "처리 중…" : DOCUMENT_UI_MESSAGES.analysisConsentAction}
          </button>
        </section>
      ) : null}

      {hook.error ? <div style={S.error}>{hook.error}</div> : null}
      {hook.success ? <div style={S.success}>{hook.success}</div> : null}

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
              value={hook.categoryKey}
              onChange={(e) => hook.setCategoryKey(e.target.value)}
              disabled={disabledUpload}
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
              ref={hook.fileInputRef}
              style={S.input}
              type="file"
              multiple
              accept={FILE_ACCEPT}
              disabled={disabledUpload}
              onChange={(e) => hook.handleFileChange(e.target.files)}
            />
          </label>
          <button
            type="button"
            style={{
              ...S.btn,
              ...((disabledUpload || !(hook.selectedFiles?.length > 0)) &&
              variant === "customer"
                ? S.btnDisabled
                : {}),
            }}
            onClick={hook.handleUpload}
            disabled={disabledUpload || !(hook.selectedFiles?.length > 0)}
          >
            {hook.uploading ? "업로드 중…" : DOCUMENT_UI_MESSAGES.uploadAction}
          </button>
        </div>
        <p style={{ ...S.sectionDesc, marginTop: "16px", marginBottom: 0 }}>
          {DOCUMENT_UI_MESSAGES.analysisNotice}
        </p>
      </section>
    </div>
  );
}

export { useCustomerDocumentUpload };
