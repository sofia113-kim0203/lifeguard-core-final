import { useCallback, useEffect, useState } from "react";
import {
  registerRealPolicyChunkGeneration,
  generateRealPolicyChunks,
  loadRealPolicyChunkGenerationRun,
  loadRealPolicyChunkItems,
  loadRealPolicyTextExtractionRunsForChunkGeneration,
  loadRealPolicyChunkGenerationRuns,
  REAL_POLICY_CHUNK_GENERATION_STATUS_LABELS,
  REAL_POLICY_CHUNK_GENERATION_MISSING_LABELS,
} from "../lib/realPolicyChunkGeneration.js";

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
  return REAL_POLICY_CHUNK_GENERATION_MISSING_LABELS[code] ?? code;
}

function generationStatusLabel(status) {
  return REAL_POLICY_CHUNK_GENERATION_STATUS_LABELS[status] ?? status;
}

function chunkPreview(items) {
  if (!items?.length) return "";
  const first = items[0];
  const text = String(first?.chunk_text ?? "");
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

export default function AdminRealPolicyChunkGenerationPanel() {
  const [textRuns, setTextRuns] = useState([]);
  const [chunkRuns, setChunkRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [registerResult, setRegisterResult] = useState(null);
  const [generateResult, setGenerateResult] = useState(null);
  const [run, setRun] = useState(null);
  const [chunks, setChunks] = useState([]);

  const [textExtractionRunId, setTextExtractionRunId] = useState("");

  const loadTextRuns = useCallback(async () => {
    try {
      const rows = await loadRealPolicyTextExtractionRunsForChunkGeneration();
      setTextRuns(rows);
      if (rows.length && !textExtractionRunId) {
        setTextExtractionRunId(rows[0].id);
      }
    } catch (err) {
      setError(err.message);
      setTextRuns([]);
    }
  }, [textExtractionRunId]);

  const loadChunkRuns = useCallback(async () => {
    try {
      const rows = await loadRealPolicyChunkGenerationRuns();
      setChunkRuns(rows);
    } catch (err) {
      setChunkRuns([]);
    }
  }, []);

  const loadInitialData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await Promise.all([loadTextRuns(), loadChunkRuns()]);
    } finally {
      setLoading(false);
    }
  }, [loadTextRuns, loadChunkRuns]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  const refreshRun = async (runId) => {
    const [runRow, chunkRows] = await Promise.all([
      loadRealPolicyChunkGenerationRun(runId),
      loadRealPolicyChunkItems(runId),
    ]);
    setRun(runRow);
    setChunks(chunkRows);
  };

  const selectedTextRun = textRuns.find((row) => row.id === textExtractionRunId) ?? null;
  const policyPdfId = selectedTextRun?.policy_pdf_id ?? selectedTextRun?.pdf?.id ?? null;
  const policySourceId =
    selectedTextRun?.pdf?.policy_source_id ?? selectedTextRun?.pdf?.source?.id ?? null;

  const activeRunId = registerResult?.realChunkGenerationRunId ?? run?.id ?? null;
  const displayStatus =
    generateResult?.generationStatus ?? run?.generation_status ?? registerResult?.generationStatus ?? null;
  const sourcePageCount = run?.source_page_count ?? registerResult?.sourcePageCount ?? 0;
  const generatedChunkCount =
    generateResult?.generatedChunkCount ?? run?.generated_chunk_count ?? 0;
  const missingInformation =
    run?.missing_information ??
    registerResult?.missingInformation ??
    generateResult?.missingInformation ??
    [];
  const displayError = run?.error_message ?? "";
  const preview = chunkPreview(chunks);
  const canGenerate =
    Boolean(activeRunId) && ["pending", "processing"].includes(displayStatus);

  const handleRegister = async () => {
    if (!textExtractionRunId) {
      setError("Text Extraction Run을 선택해 주세요.");
      return;
    }
    if (!policyPdfId) {
      setError("Policy PDF가 연결되지 않았습니다.");
      return;
    }
    if (!policySourceId) {
      setError("Policy Source가 연결되지 않았습니다.");
      return;
    }
    setRegistering(true);
    setError("");
    setRegisterResult(null);
    setGenerateResult(null);
    try {
      const data = await registerRealPolicyChunkGeneration({
        textExtractionRunId,
        policyPdfId,
        policySourceId,
      });
      setRegisterResult(data);
      if (data.realChunkGenerationRunId) {
        await refreshRun(data.realChunkGenerationRunId);
      }
      await loadChunkRuns();
    } catch (err) {
      setError(err.message);
    } finally {
      setRegistering(false);
    }
  };

  const handleGenerate = async () => {
    if (!activeRunId) {
      setError("먼저 Chunk 생성 run을 등록해 주세요.");
      return;
    }
    setGenerating(true);
    setError("");
    setGenerateResult(null);
    try {
      const data = await generateRealPolicyChunks(activeRunId);
      setGenerateResult(data);
      await refreshRun(activeRunId);
      await loadChunkRuns();
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#f8fafc" }}>
          실제 약관 Chunk 생성 관리
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: "15px", color: "#94a3b8", lineHeight: 1.55 }}>
          저장된 실제 약관 추출 텍스트 기반 Chunk 생성 워크플로만 준비합니다. 가짜 청크·임베딩·외부 AI 없음.
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
          Chunk 생성 Run 등록
        </h2>
        <div style={{ display: "grid", gap: "12px", maxWidth: "720px" }}>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Text Extraction Run
            <select
              value={textExtractionRunId}
              onChange={(e) => setTextExtractionRunId(e.target.value)}
              disabled={loading}
              style={{ ...S.input, marginTop: "6px" }}
            >
              <option value="">(선택)</option>
              {textRuns.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.pdf?.file_name ?? row.policy_pdf_id} — {row.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          {selectedTextRun ? (
            <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
              <div>PDF: {selectedTextRun.pdf?.file_name ?? "—"}</div>
              <div>
                Policy Source:{" "}
                {selectedTextRun.pdf?.source?.source_name ?? policySourceId ?? "—"}
              </div>
              <div>Carrier: {selectedTextRun.pdf?.carrier?.carrier_name ?? "—"}</div>
              <div>Product: {selectedTextRun.pdf?.product?.product_name ?? "—"}</div>
              <div>Extracted Page Count: {selectedTextRun.extracted_page_count ?? 0}</div>
            </div>
          ) : null}
          <button
            type="button"
            style={{ ...S.btn, opacity: registering ? 0.6 : 1, maxWidth: "280px" }}
            disabled={registering || loading || !textExtractionRunId}
            onClick={handleRegister}
          >
            {registering ? "등록 중…" : "Chunk 생성 Run 등록"}
          </button>
        </div>
      </section>

      {registerResult || run ? (
        <>
          <section style={S.card}>
            <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
              생성 상태
            </h2>
            <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
              <div>Text Extraction Run: {run?.text_extraction_run_id ?? textExtractionRunId ?? "—"}</div>
              <div>PDF: {run?.pdf?.file_name ?? selectedTextRun?.pdf?.file_name ?? "—"}</div>
              <div>
                Policy Source:{" "}
                {run?.source?.source_name ?? selectedTextRun?.pdf?.source?.source_name ?? "—"}
              </div>
              <div>Generation Status: {generationStatusLabel(displayStatus) || "—"}</div>
              <div>Page Count: {sourcePageCount}</div>
              <div>Generated Chunk Count: {generatedChunkCount}</div>
              {displayError ? <div>Error Message: {displayError}</div> : null}
              <div style={{ marginTop: "8px" }}>
                Chunk Preview:
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
                  {preview || "(생성된 청크 없음)"}
                </pre>
              </div>
              {canGenerate ? (
                <button
                  type="button"
                  style={{ ...S.btn, opacity: generating ? 0.6 : 1, maxWidth: "280px", marginTop: "16px" }}
                  disabled={generating}
                  onClick={handleGenerate}
                >
                  {generating ? "생성 중…" : "Chunk 생성 실행"}
                </button>
              ) : null}
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
        </>
      ) : null}

      {chunkRuns.length ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            Chunk 생성 Run 목록 ({chunkRuns.length})
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {chunkRuns.map((chunkRun) => {
              const missing = Array.isArray(chunkRun.missing_information)
                ? chunkRun.missing_information
                : [];
              return (
                <div
                  key={chunkRun.id}
                  style={{
                    padding: "12px",
                    borderRadius: "10px",
                    border: "1px solid rgba(148, 163, 184, 0.15)",
                    background: "rgba(15, 23, 42, 0.5)",
                    fontSize: "12px",
                    color: "#e2e8f0",
                  }}
                >
                  <div style={{ fontWeight: 600 }}>
                    {chunkRun.pdf?.file_name ?? chunkRun.policy_pdf_id}
                  </div>
                  <div style={{ marginTop: "6px", color: "#94a3b8", lineHeight: 1.6 }}>
                    <div>Policy Source: {chunkRun.source?.source_name ?? "—"}</div>
                    <div>Generation Status: {generationStatusLabel(chunkRun.generation_status)}</div>
                    <div>Page Count: {chunkRun.source_page_count}</div>
                    <div>Generated Chunk Count: {chunkRun.generated_chunk_count}</div>
                    {chunkRun.error_message ? (
                      <div>Error Message: {chunkRun.error_message}</div>
                    ) : null}
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
