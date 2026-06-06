import { useCallback, useEffect, useState } from "react";
import {
  loadRealPolicyExtractionRuns,
  registerRealPolicyTextExtraction,
  storeRealPolicyExtractedText,
  loadRealPolicyTextExtractionRuns,
  loadRealPolicyExtractedTextPages,
  REAL_POLICY_TEXT_EXTRACTION_STATUS_LABELS,
  REAL_POLICY_EXTRACTED_TEXT_STATUS_LABELS,
  REAL_POLICY_TEXT_EXTRACTION_MISSING_LABELS,
} from "../lib/realPolicyTextExtractionExecution.js";

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
  return REAL_POLICY_TEXT_EXTRACTION_MISSING_LABELS[code] ?? code;
}

function extractionStatusLabel(status) {
  return REAL_POLICY_TEXT_EXTRACTION_STATUS_LABELS[status] ?? status;
}

function textStatusLabel(status) {
  return REAL_POLICY_EXTRACTED_TEXT_STATUS_LABELS[status] ?? status;
}

function textPreview(text) {
  if (!text) return "";
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

export default function AdminRealPolicyTextExtractionExecutionPanel() {
  const [extractionRuns, setExtractionRuns] = useState([]);
  const [textRuns, setTextRuns] = useState([]);
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [storing, setStoring] = useState(false);
  const [error, setError] = useState("");
  const [registerResult, setRegisterResult] = useState(null);
  const [storeResult, setStoreResult] = useState(null);

  const [extractionRunId, setExtractionRunId] = useState("");
  const [selectedTextRunId, setSelectedTextRunId] = useState("");
  const [pageNumber, setPageNumber] = useState("1");
  const [extractedText, setExtractedText] = useState("");

  const loadTextRuns = useCallback(async () => {
    try {
      const rows = await loadRealPolicyTextExtractionRuns();
      setTextRuns(rows);
      if (rows.length && !selectedTextRunId) {
        setSelectedTextRunId(rows[0].id);
      }
    } catch (err) {
      setError(err.message);
      setTextRuns([]);
    }
  }, [selectedTextRunId]);

  const loadPages = useCallback(async (runId) => {
    if (!runId) {
      setPages([]);
      return;
    }
    try {
      const rows = await loadRealPolicyExtractedTextPages(runId);
      setPages(rows);
    } catch (err) {
      setError(err.message);
      setPages([]);
    }
  }, []);

  const loadInitialData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const pdfRuns = await loadRealPolicyExtractionRuns();
      setExtractionRuns(pdfRuns);
      if (pdfRuns.length && !extractionRunId) {
        setExtractionRunId(pdfRuns[0].id);
      }
      await loadTextRuns();
    } catch (err) {
      setError(err.message);
      setExtractionRuns([]);
    } finally {
      setLoading(false);
    }
  }, [extractionRunId, loadTextRuns]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  useEffect(() => {
    loadPages(selectedTextRunId);
  }, [selectedTextRunId, loadPages]);

  const selectedExtractionRun = extractionRuns.find((row) => row.id === extractionRunId) ?? null;
  const selectedTextRun = textRuns.find((row) => row.id === selectedTextRunId) ?? null;
  const pdfInfo = selectedTextRun?.pdf ?? selectedExtractionRun?.pdf ?? null;

  const handleRegister = async () => {
    if (!extractionRunId) {
      setError("추출 run을 선택해 주세요.");
      return;
    }
    const policyPdfId = selectedExtractionRun?.policy_pdf_id;
    if (!policyPdfId) {
      setError("Policy PDF가 연결되지 않았습니다.");
      return;
    }
    setRegistering(true);
    setError("");
    setRegisterResult(null);
    try {
      const data = await registerRealPolicyTextExtraction({
        extractionRunId,
        policyPdfId,
      });
      setRegisterResult(data);
      if (data.textExtractionRunId) {
        setSelectedTextRunId(data.textExtractionRunId);
      }
      await loadTextRuns();
      await loadPages(data.textExtractionRunId);
    } catch (err) {
      setError(err.message);
    } finally {
      setRegistering(false);
    }
  };

  const handleStore = async () => {
    if (!selectedTextRunId) {
      setError("텍스트 추출 run을 선택해 주세요.");
      return;
    }
    const policyPdfId = selectedTextRun?.policy_pdf_id ?? selectedExtractionRun?.policy_pdf_id;
    if (!policyPdfId) {
      setError("Policy PDF가 연결되지 않았습니다.");
      return;
    }
    const num = Number(pageNumber);
    if (!num || num <= 0) {
      setError("페이지 번호를 입력해 주세요.");
      return;
    }
    if (!extractedText.trim()) {
      setError("추출 텍스트를 입력해 주세요.");
      return;
    }
    setStoring(true);
    setError("");
    setStoreResult(null);
    try {
      const data = await storeRealPolicyExtractedText({
        textExtractionRunId: selectedTextRunId,
        policyPdfId,
        pageNumber: num,
        extractedText,
      });
      setStoreResult(data);
      await loadTextRuns();
      await loadPages(selectedTextRunId);
    } catch (err) {
      setError(err.message);
    } finally {
      setStoring(false);
    }
  };

  const missingInfo = [
    ...(Array.isArray(selectedTextRun?.missing_information) ? selectedTextRun.missing_information : []),
    ...(registerResult?.missingInformation ?? []),
    ...(storeResult?.missingInformation ?? []),
  ].filter((value, index, arr) => arr.indexOf(value) === index);

  return (
    <div style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#f8fafc" }}>
          실제 약관 텍스트 추출 관리
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: "15px", color: "#94a3b8", lineHeight: 1.55 }}>
          등록된 PDF 페이지의 추출 텍스트를 저장합니다. OCR·청크·임베딩·Claude 실행 없음.
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
          텍스트 추출 Run 등록
        </h2>
        <div style={{ display: "grid", gap: "12px", maxWidth: "720px" }}>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            PDF Extraction Run
            <select
              value={extractionRunId}
              onChange={(e) => setExtractionRunId(e.target.value)}
              disabled={loading}
              style={{ ...S.input, marginTop: "6px" }}
            >
              {extractionRuns.length === 0 ? (
                <option value="">등록된 추출 run 없음</option>
              ) : (
                extractionRuns.map((run) => (
                  <option key={run.id} value={run.id}>
                    {run.pdf?.file_name ?? run.policy_pdf_id}
                  </option>
                ))
              )}
            </select>
          </label>
          <button
            type="button"
            style={{ ...S.btn, opacity: registering ? 0.6 : 1, maxWidth: "280px" }}
            disabled={registering || loading || !extractionRunId}
            onClick={handleRegister}
          >
            {registering ? "등록 중…" : "텍스트 추출 Run 등록"}
          </button>
        </div>
      </section>

      {registerResult ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            Run 등록 결과
          </h2>
          <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
            <div>Text Extraction Run ID: {registerResult.textExtractionRunId ?? "—"}</div>
            <div>Extraction Status: {extractionStatusLabel(registerResult.extractionStatus)}</div>
            <div>Expected Page Count: {registerResult.expectedPageCount ?? 0}</div>
            {registerResult.missingInformation?.length ? (
              <div>
                Missing Information:{" "}
                {registerResult.missingInformation.map(missingLabel).join(", ")}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section style={S.card}>
        <h2 style={{ margin: "0 0 16px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
          추출 텍스트 저장
        </h2>
        <div style={{ display: "grid", gap: "12px", maxWidth: "720px" }}>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Text Extraction Run
            <select
              value={selectedTextRunId}
              onChange={(e) => setSelectedTextRunId(e.target.value)}
              style={{ ...S.input, marginTop: "6px" }}
            >
              {textRuns.length === 0 ? (
                <option value="">등록된 텍스트 추출 run 없음</option>
              ) : (
                textRuns.map((run) => (
                  <option key={run.id} value={run.id}>
                    {run.pdf?.file_name ?? run.policy_pdf_id} (
                    {extractionStatusLabel(run.extraction_status)})
                  </option>
                ))
              )}
            </select>
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Page Number
            <input
              type="number"
              value={pageNumber}
              onChange={(e) => setPageNumber(e.target.value)}
              min="1"
              style={{ ...S.input, marginTop: "6px" }}
            />
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Extracted Text
            <textarea
              value={extractedText}
              onChange={(e) => setExtractedText(e.target.value)}
              rows={6}
              placeholder="실제 추출된 페이지 텍스트"
              style={{ ...S.input, marginTop: "6px", resize: "vertical" }}
            />
          </label>
          <button
            type="button"
            style={{
              ...S.btn,
              opacity: storing ? 0.6 : 1,
              maxWidth: "280px",
              background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
            }}
            disabled={storing || !selectedTextRunId}
            onClick={handleStore}
          >
            {storing ? "저장 중…" : "추출 텍스트 저장"}
          </button>
        </div>
      </section>

      {storeResult ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            저장 결과
          </h2>
          <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
            <div>Extracted Page ID: {storeResult.extractedPageId ?? "—"}</div>
            <div>Page Number: {storeResult.pageNumber ?? "—"}</div>
            <div>Text Status: {textStatusLabel(storeResult.textStatus)}</div>
            <div>Extraction Status: {extractionStatusLabel(storeResult.extractionStatus)}</div>
            <div>Extracted Page Count: {storeResult.extractedPageCount ?? 0}</div>
          </div>
        </section>
      ) : null}

      {selectedTextRun || selectedExtractionRun ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            현재 상태
          </h2>
          <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
            <div>Carrier: {pdfInfo?.carrier?.carrier_name ?? "—"}</div>
            <div>Product: {pdfInfo?.product?.product_name ?? "—"}</div>
            <div>PDF File: {pdfInfo?.file_name ?? "—"}</div>
            <div>
              Extraction Status:{" "}
              {extractionStatusLabel(
                selectedTextRun?.extraction_status ??
                  storeResult?.extractionStatus ??
                  registerResult?.extractionStatus,
              )}
            </div>
            <div>
              Extracted Page Count:{" "}
              {selectedTextRun?.extracted_page_count ?? storeResult?.extractedPageCount ?? 0}
            </div>
            {missingInfo.length ? (
              <div>Missing Information: {missingInfo.map(missingLabel).join(", ")}</div>
            ) : null}
          </div>
        </section>
      ) : null}

      {pages.length ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            저장된 페이지 ({pages.length})
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {pages.map((page) => (
              <div
                key={page.id}
                style={{
                  padding: "12px",
                  borderRadius: "10px",
                  border: "1px solid rgba(148, 163, 184, 0.15)",
                  background: "rgba(15, 23, 42, 0.5)",
                  fontSize: "12px",
                  color: "#e2e8f0",
                }}
              >
                <div>
                  Page {page.page_number} · {textStatusLabel(page.text_status)}
                </div>
                <pre
                  style={{
                    margin: "8px 0 0",
                    color: "#94a3b8",
                    whiteSpace: "pre-wrap",
                    fontSize: "11px",
                  }}
                >
                  {textPreview(page.extracted_text)}
                </pre>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {textRuns.length ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            텍스트 추출 Run 목록 ({textRuns.length})
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {textRuns.map((run) => {
              const missing = Array.isArray(run.missing_information) ? run.missing_information : [];
              return (
                <div
                  key={run.id}
                  style={{
                    padding: "12px",
                    borderRadius: "10px",
                    border: "1px solid rgba(148, 163, 184, 0.15)",
                    background: "rgba(15, 23, 42, 0.5)",
                    fontSize: "12px",
                    color: "#e2e8f0",
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{run.pdf?.file_name ?? run.policy_pdf_id}</div>
                  <div style={{ marginTop: "6px", color: "#94a3b8", lineHeight: 1.6 }}>
                    <div>Carrier: {run.pdf?.carrier?.carrier_name ?? "—"}</div>
                    <div>Product: {run.pdf?.product?.product_name ?? "—"}</div>
                    <div>Extraction Status: {extractionStatusLabel(run.extraction_status)}</div>
                    <div>Extracted Page Count: {run.extracted_page_count}</div>
                    {missing.length ? (
                      <div>Missing Information: {missing.map(missingLabel).join(", ")}</div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
