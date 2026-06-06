import { useCallback, useEffect, useState } from "react";
import {
  registerPolicyTextExtraction,
  storePolicyExtractedText,
  loadPolicyTextExtractionRun,
  loadPolicyTextExtractionPages,
  loadPdfIngestionRunsForExtraction,
  POLICY_TEXT_EXTRACTION_STATUS_LABELS,
  POLICY_TEXT_EXTRACTION_MISSING_LABELS,
} from "../lib/policyTextExtraction.js";

const FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

const S = {
  card: {
    background: "rgba(30, 41, 59, 0.65)",
    border: "1px solid rgba(148, 163, 184, 0.12)",
    borderRadius: "16px",
    padding: "24px 28px",
  },
  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: "10px",
    border: "1px solid rgba(148, 163, 184, 0.2)",
    background: "rgba(15, 23, 42, 0.6)",
    color: "#e2e8f0",
    fontSize: "14px",
    fontFamily: FONT,
    boxSizing: "border-box",
  },
  btn: {
    padding: "12px 20px",
    borderRadius: "12px",
    border: "none",
    background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
    color: "#fff",
    fontSize: "15px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: FONT,
  },
};

function missingLabel(code) {
  return POLICY_TEXT_EXTRACTION_MISSING_LABELS[code] ?? code;
}

function extractionStatusLabel(status) {
  return POLICY_TEXT_EXTRACTION_STATUS_LABELS[status] ?? status;
}

function previewText(pages) {
  if (!pages?.length) return "";
  const first = pages.find((page) => page.extracted_text) ?? pages[0];
  const text = String(first?.extracted_text ?? "");
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

export default function AdminPolicyTextExtractionPanel() {
  const [pdfRuns, setPdfRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [storing, setStoring] = useState(false);
  const [error, setError] = useState("");
  const [registerResult, setRegisterResult] = useState(null);
  const [storeResult, setStoreResult] = useState(null);
  const [run, setRun] = useState(null);
  const [pages, setPages] = useState([]);

  const [pdfIngestionRunId, setPdfIngestionRunId] = useState("");
  const [pageNumber, setPageNumber] = useState("1");
  const [extractedText, setExtractedText] = useState("");
  const [extractionConfidence, setExtractionConfidence] = useState("");

  const loadPdfRuns = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await loadPdfIngestionRunsForExtraction();
      setPdfRuns(rows);
      if (rows.length && !pdfIngestionRunId) {
        setPdfIngestionRunId(rows[0].id);
      }
    } catch (err) {
      setError(err.message);
      setPdfRuns([]);
    } finally {
      setLoading(false);
    }
  }, [pdfIngestionRunId]);

  useEffect(() => {
    loadPdfRuns();
  }, [loadPdfRuns]);

  const refreshRun = async (runId) => {
    const [runRow, pageRows] = await Promise.all([
      loadPolicyTextExtractionRun(runId),
      loadPolicyTextExtractionPages(runId),
    ]);
    setRun(runRow);
    setPages(pageRows);
  };

  const selectedPdf = pdfRuns.find((row) => row.id === pdfIngestionRunId);
  const activeRunId = registerResult?.textExtractionRunId ?? run?.id ?? null;
  const displayStatus =
    storeResult?.extractionStatus ?? run?.extraction_status ?? registerResult?.extractionStatus ?? null;
  const pageCount = pages.length || storeResult?.pageCount || run?.extraction_context?.page_count || 0;
  const missingInformation =
    run?.missing_information ??
    registerResult?.missingInformation ??
    storeResult?.missingInformation ??
    [];
  const displayError = run?.error_message ?? "";
  const textPreview = previewText(pages);

  const handleRegister = async () => {
    if (!pdfIngestionRunId) {
      setError("PDF Ingestion Run을 선택해 주세요.");
      return;
    }
    setRegistering(true);
    setError("");
    setRegisterResult(null);
    setStoreResult(null);
    try {
      const data = await registerPolicyTextExtraction(pdfIngestionRunId);
      setRegisterResult(data);
      if (data.textExtractionRunId) {
        await refreshRun(data.textExtractionRunId);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setRegistering(false);
    }
  };

  const handleStore = async () => {
    if (!activeRunId) {
      setError("먼저 텍스트 추출 run을 등록해 주세요.");
      return;
    }
    if (!extractedText.trim()) {
      setError("추출 텍스트를 입력해 주세요.");
      return;
    }
    const pageNum = Number(pageNumber);
    if (!pageNum || pageNum <= 0) {
      setError("페이지 번호를 입력해 주세요.");
      return;
    }
    setStoring(true);
    setError("");
    setStoreResult(null);
    try {
      const data = await storePolicyExtractedText({
        textExtractionRunId: activeRunId,
        pageNumber: pageNum,
        extractedText,
        extractionConfidence: extractionConfidence ? Number(extractionConfidence) : null,
      });
      setStoreResult(data);
      await refreshRun(activeRunId);
    } catch (err) {
      setError(err.message);
    } finally {
      setStoring(false);
    }
  };

  return (
    <div style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#f8fafc" }}>
          약관 텍스트 추출 관리
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: "15px", color: "#94a3b8", lineHeight: 1.55 }}>
          실제 PDF 텍스트 추출 워크플로만 추적합니다. 가짜 텍스트·OCR·외부 AI·청크·임베딩 없음.
        </p>
      </div>

      {error ? (
        <div
          style={{
            padding: "14px 16px",
            borderRadius: "12px",
            background: "rgba(127, 29, 29, 0.35)",
            color: "#fecaca",
            fontSize: "14px",
          }}
        >
          {error}
        </div>
      ) : null}

      <section style={S.card}>
        <h2 style={{ margin: "0 0 16px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
          추출 Run 등록
        </h2>
        <div style={{ display: "grid", gap: "12px", maxWidth: "720px" }}>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            PDF Ingestion Run
            <select
              value={pdfIngestionRunId}
              onChange={(e) => setPdfIngestionRunId(e.target.value)}
              disabled={loading}
              style={{ ...S.input, marginTop: "6px" }}
            >
              <option value="">(선택)</option>
              {pdfRuns.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.original_filename} — {row.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          {selectedPdf ? (
            <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
              <div>Carrier: {selectedPdf.carrier?.carrier_name ?? "—"}</div>
              <div>Product: {selectedPdf.product?.product_name ?? "—"}</div>
              <div>File: {selectedPdf.original_filename}</div>
            </div>
          ) : null}
          <button
            type="button"
            style={{ ...S.btn, opacity: registering ? 0.6 : 1, maxWidth: "280px" }}
            disabled={registering}
            onClick={handleRegister}
          >
            {registering ? "등록 중…" : "텍스트 추출 Run 등록"}
          </button>
        </div>
      </section>

      {registerResult || run ? (
        <>
          <section style={S.card}>
            <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
              추출 상태
            </h2>
            <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
              <div>PDF Ingestion Run: {run?.pdf_ingestion_run_id ?? pdfIngestionRunId ?? "—"}</div>
              <div>Carrier: {run?.carrier?.carrier_name ?? selectedPdf?.carrier?.carrier_name ?? "—"}</div>
              <div>Product: {run?.product?.product_name ?? selectedPdf?.product?.product_name ?? "—"}</div>
              <div>Extraction Status: {extractionStatusLabel(displayStatus) || "—"}</div>
              <div>Page Count: {pageCount}</div>
              {displayError ? <div>Error Message: {displayError}</div> : null}
              <div style={{ marginTop: "8px" }}>
                Extracted Text Preview:
                <pre
                  style={{
                    margin: "8px 0 0",
                    padding: "12px",
                    borderRadius: "10px",
                    background: "rgba(15, 23, 42, 0.6)",
                    color: "#e2e8f0",
                    fontSize: "12px",
                    overflow: "auto",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {textPreview || "(저장된 추출 텍스트 없음)"}
                </pre>
              </div>
            </div>
          </section>

          {missingInformation?.length ? (
            <section style={S.card}>
              <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
                Missing Information
              </h2>
              <ul style={{ margin: 0, paddingLeft: "20px", color: "#94a3b8", fontSize: "13px" }}>
                {missingInformation.map((code) => (
                  <li key={code}>{missingLabel(code)}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <section style={S.card}>
            <h2 style={{ margin: "0 0 16px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
              추출 텍스트 저장
            </h2>
            <div style={{ display: "grid", gap: "12px", maxWidth: "720px" }}>
              <label style={{ fontSize: "13px", color: "#94a3b8" }}>
                Page Number
                <input
                  type="number"
                  min="1"
                  value={pageNumber}
                  onChange={(e) => setPageNumber(e.target.value)}
                  style={{ ...S.input, marginTop: "6px" }}
                />
              </label>
              <label style={{ fontSize: "13px", color: "#94a3b8" }}>
                Extracted Text
                <textarea
                  value={extractedText}
                  onChange={(e) => setExtractedText(e.target.value)}
                  rows={8}
                  style={{ ...S.input, marginTop: "6px", resize: "vertical" }}
                />
              </label>
              <label style={{ fontSize: "13px", color: "#94a3b8" }}>
                Extraction Confidence (0–1, 선택)
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.0001"
                  value={extractionConfidence}
                  onChange={(e) => setExtractionConfidence(e.target.value)}
                  style={{ ...S.input, marginTop: "6px" }}
                />
              </label>
              <button
                type="button"
                style={{ ...S.btn, opacity: storing ? 0.6 : 1, maxWidth: "280px" }}
                disabled={storing}
                onClick={handleStore}
              >
                {storing ? "저장 중…" : "추출 텍스트 저장"}
              </button>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
