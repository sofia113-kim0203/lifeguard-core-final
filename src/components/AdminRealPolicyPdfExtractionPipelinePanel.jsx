import { useCallback, useEffect, useState } from "react";
import {
  loadRealPolicyPdfRegistry,
  registerRealPolicyExtraction,
  registerRealPolicyPage,
  loadRealPolicyExtractionRuns,
  loadRealPolicyPageRegistry,
  REAL_POLICY_EXTRACTION_STATUS_LABELS,
  REAL_POLICY_PAGE_STATUS_LABELS,
  REAL_POLICY_EXTRACTION_MISSING_LABELS,
} from "../lib/realPolicyPdfExtractionPipeline.js";

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
  return REAL_POLICY_EXTRACTION_MISSING_LABELS[code] ?? code;
}

function extractionStatusLabel(status) {
  return REAL_POLICY_EXTRACTION_STATUS_LABELS[status] ?? status;
}

function pageStatusLabel(status) {
  return REAL_POLICY_PAGE_STATUS_LABELS[status] ?? status;
}

export default function AdminRealPolicyPdfExtractionPipelinePanel() {
  const [pdfs, setPdfs] = useState([]);
  const [runs, setRuns] = useState([]);
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [registeringPage, setRegisteringPage] = useState(false);
  const [error, setError] = useState("");
  const [extractionResult, setExtractionResult] = useState(null);
  const [pageResult, setPageResult] = useState(null);

  const [policyPdfId, setPolicyPdfId] = useState("");
  const [pageCount, setPageCount] = useState("");
  const [selectedRunId, setSelectedRunId] = useState("");
  const [pageNumber, setPageNumber] = useState("1");
  const [pageReference, setPageReference] = useState("");

  const loadRuns = useCallback(async () => {
    try {
      const rows = await loadRealPolicyExtractionRuns();
      setRuns(rows);
      if (rows.length && !selectedRunId) {
        setSelectedRunId(rows[0].id);
      }
    } catch (err) {
      setError(err.message);
      setRuns([]);
    }
  }, [selectedRunId]);

  const loadPages = useCallback(async (runId) => {
    if (!runId) {
      setPages([]);
      return;
    }
    try {
      const rows = await loadRealPolicyPageRegistry(runId);
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
      const pdfRows = await loadRealPolicyPdfRegistry();
      setPdfs(pdfRows);
      if (pdfRows.length && !policyPdfId) {
        setPolicyPdfId(pdfRows[0].id);
      }
      await loadRuns();
    } catch (err) {
      setError(err.message);
      setPdfs([]);
    } finally {
      setLoading(false);
    }
  }, [policyPdfId, loadRuns]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  useEffect(() => {
    loadPages(selectedRunId);
  }, [selectedRunId, loadPages]);

  const selectedPdf = pdfs.find((row) => row.id === policyPdfId) ?? null;
  const selectedRun = runs.find((row) => row.id === selectedRunId) ?? null;
  const runPdf = selectedRun?.pdf ?? null;

  const handleRegisterExtraction = async () => {
    if (!policyPdfId) {
      setError("Policy PDF를 선택해 주세요.");
      return;
    }
    const count = Number(pageCount);
    if (!count || count <= 0) {
      setError("페이지 수를 입력해 주세요.");
      return;
    }
    setRegistering(true);
    setError("");
    setExtractionResult(null);
    try {
      const data = await registerRealPolicyExtraction({
        policyPdfId,
        pageCount: count,
      });
      setExtractionResult(data);
      if (data.extractionRunId) {
        setSelectedRunId(data.extractionRunId);
      }
      await loadRuns();
      await loadPages(data.extractionRunId);
    } catch (err) {
      setError(err.message);
    } finally {
      setRegistering(false);
    }
  };

  const handleRegisterPage = async () => {
    if (!selectedRunId) {
      setError("추출 run을 선택해 주세요.");
      return;
    }
    const runPolicyPdfId = selectedRun?.policy_pdf_id ?? policyPdfId;
    if (!runPolicyPdfId) {
      setError("Policy PDF가 연결되지 않았습니다.");
      return;
    }
    const num = Number(pageNumber);
    if (!num || num <= 0) {
      setError("페이지 번호를 입력해 주세요.");
      return;
    }
    if (!pageReference.trim()) {
      setError("페이지 참조를 입력해 주세요.");
      return;
    }
    setRegisteringPage(true);
    setError("");
    setPageResult(null);
    try {
      const data = await registerRealPolicyPage({
        extractionRunId: selectedRunId,
        policyPdfId: runPolicyPdfId,
        pageNumber: num,
        pageReference: pageReference.trim(),
      });
      setPageResult(data);
      await loadRuns();
      await loadPages(selectedRunId);
    } catch (err) {
      setError(err.message);
    } finally {
      setRegisteringPage(false);
    }
  };

  const runMissing = [
    ...(Array.isArray(selectedRun?.missing_information) ? selectedRun.missing_information : []),
    ...(extractionResult?.missingInformation ?? []),
    ...(pageResult?.missingInformation ?? []),
  ].filter((value, index, arr) => arr.indexOf(value) === index);

  return (
    <div style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#f8fafc" }}>
          실제 약관 추출 파이프라인
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: "15px", color: "#94a3b8", lineHeight: 1.55 }}>
          업로드된 실제 PDF의 추출 준비 페이지 구조를 등록합니다. OCR·텍스트 추출·청크·임베딩 없음.
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
            PDF File
            <select
              value={policyPdfId}
              onChange={(e) => setPolicyPdfId(e.target.value)}
              disabled={loading}
              style={{ ...S.input, marginTop: "6px" }}
            >
              {pdfs.length === 0 ? (
                <option value="">등록된 PDF 없음</option>
              ) : (
                pdfs.map((pdf) => (
                  <option key={pdf.id} value={pdf.id}>
                    {pdf.file_name}
                  </option>
                ))
              )}
            </select>
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Page Count
            <input
              type="number"
              value={pageCount}
              onChange={(e) => setPageCount(e.target.value)}
              placeholder="예: 42"
              style={{ ...S.input, marginTop: "6px" }}
            />
          </label>
          <button
            type="button"
            style={{ ...S.btn, opacity: registering ? 0.6 : 1, maxWidth: "280px" }}
            disabled={registering || loading || !policyPdfId}
            onClick={handleRegisterExtraction}
          >
            {registering ? "등록 중…" : "추출 Run 등록"}
          </button>
        </div>
      </section>

      {extractionResult ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            추출 Run 결과
          </h2>
          <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
            <div>Extraction Run ID: {extractionResult.extractionRunId ?? "—"}</div>
            <div>Extraction Status: {extractionStatusLabel(extractionResult.extractionStatus)}</div>
            <div>Page Count: {extractionResult.pageCount ?? 0}</div>
            {extractionResult.missingInformation?.length ? (
              <div>
                Missing Information:{" "}
                {extractionResult.missingInformation.map(missingLabel).join(", ")}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section style={S.card}>
        <h2 style={{ margin: "0 0 16px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
          페이지 등록
        </h2>
        <div style={{ display: "grid", gap: "12px", maxWidth: "720px" }}>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Extraction Run
            <select
              value={selectedRunId}
              onChange={(e) => setSelectedRunId(e.target.value)}
              style={{ ...S.input, marginTop: "6px" }}
            >
              {runs.length === 0 ? (
                <option value="">등록된 추출 run 없음</option>
              ) : (
                runs.map((run) => (
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
            Page Reference
            <input
              type="text"
              value={pageReference}
              onChange={(e) => setPageReference(e.target.value)}
              placeholder="예: page-1"
              style={{ ...S.input, marginTop: "6px" }}
            />
          </label>
          <button
            type="button"
            style={{
              ...S.btn,
              opacity: registeringPage ? 0.6 : 1,
              maxWidth: "280px",
              background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
            }}
            disabled={registeringPage || !selectedRunId}
            onClick={handleRegisterPage}
          >
            {registeringPage ? "등록 중…" : "페이지 등록"}
          </button>
        </div>
      </section>

      {pageResult ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            페이지 등록 결과
          </h2>
          <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
            <div>Page Registry ID: {pageResult.pageRegistryId ?? "—"}</div>
            <div>Page Number: {pageResult.pageNumber ?? "—"}</div>
            <div>Page Status: {pageStatusLabel(pageResult.pageStatus)}</div>
            <div>
              Extraction Status: {extractionStatusLabel(pageResult.extractionStatus)}
            </div>
          </div>
        </section>
      ) : null}

      {selectedRun || selectedPdf ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            현재 선택
          </h2>
          <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
            <div>Carrier: {runPdf?.carrier?.carrier_name ?? selectedPdf?.carrier?.carrier_name ?? "—"}</div>
            <div>Product: {runPdf?.product?.product_name ?? selectedPdf?.product?.product_name ?? "—"}</div>
            <div>PDF File: {runPdf?.file_name ?? selectedPdf?.file_name ?? "—"}</div>
            <div>
              Extraction Status:{" "}
              {extractionStatusLabel(selectedRun?.extraction_status ?? extractionResult?.extractionStatus)}
            </div>
            <div>Page Count: {selectedRun?.page_count ?? extractionResult?.pageCount ?? "—"}</div>
            {runMissing.length ? (
              <div>Missing Information: {runMissing.map(missingLabel).join(", ")}</div>
            ) : null}
          </div>
        </section>
      ) : null}

      {pages.length ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            등록된 페이지 ({pages.length})
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
                  Page {page.page_number} · {pageStatusLabel(page.page_status)}
                </div>
                <div style={{ marginTop: "4px", color: "#94a3b8" }}>
                  Reference: {page.page_reference}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {runs.length ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            추출 Run 목록 ({runs.length})
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {runs.map((run) => {
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
                    <div>Page Count: {run.page_count}</div>
                    <div>Storage Path: {run.pdf?.storage_path ?? "—"}</div>
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
