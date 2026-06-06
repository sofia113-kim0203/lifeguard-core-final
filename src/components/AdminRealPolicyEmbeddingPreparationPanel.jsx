import { useCallback, useEffect, useState } from "react";
import {
  prepareRealPolicyEmbedding,
  loadRealPolicyChunkGenerationRunsForEmbeddingPrep,
  loadRealPolicyEmbeddingPreparationRun,
  loadRealPolicyEmbeddingPreparationRuns,
  loadApprovedRealPolicyChunkCount,
  loadPolicyRagSources,
  POLICY_RAG_SOURCE_TYPE_LABELS,
  REAL_POLICY_EMBEDDING_PREPARATION_STATUS_LABELS,
  REAL_POLICY_EMBEDDING_PREPARATION_MISSING_LABELS,
} from "../lib/realPolicyEmbeddingPreparation.js";

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
  return REAL_POLICY_EMBEDDING_PREPARATION_MISSING_LABELS[code] ?? code;
}

function preparationStatusLabel(status) {
  return REAL_POLICY_EMBEDDING_PREPARATION_STATUS_LABELS[status] ?? status;
}

function sourceTypeLabel(type) {
  return POLICY_RAG_SOURCE_TYPE_LABELS[type] ?? type;
}

export default function AdminRealPolicyEmbeddingPreparationPanel() {
  const [chunkRuns, setChunkRuns] = useState([]);
  const [ragSources, setRagSources] = useState([]);
  const [prepRuns, setPrepRuns] = useState([]);
  const [approvedCount, setApprovedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const [prepareResult, setPrepareResult] = useState(null);
  const [run, setRun] = useState(null);

  const [chunkGenerationRunId, setChunkGenerationRunId] = useState("");
  const [ragSourceId, setRagSourceId] = useState("");
  const [embeddingProvider, setEmbeddingProvider] = useState("");
  const [embeddingModel, setEmbeddingModel] = useState("");

  const loadChunkRuns = useCallback(async () => {
    try {
      const rows = await loadRealPolicyChunkGenerationRunsForEmbeddingPrep();
      setChunkRuns(rows);
      if (rows.length && !chunkGenerationRunId) {
        setChunkGenerationRunId(rows[0].id);
        const ctxRag = rows[0].generation_context?.rag_source_id;
        if (ctxRag && !ragSourceId) {
          setRagSourceId(ctxRag);
        }
      }
    } catch (err) {
      setError(err.message);
      setChunkRuns([]);
    }
  }, [chunkGenerationRunId, ragSourceId]);

  const loadPrepRuns = useCallback(async () => {
    try {
      const rows = await loadRealPolicyEmbeddingPreparationRuns();
      setPrepRuns(rows);
    } catch (err) {
      setPrepRuns([]);
    }
  }, []);

  const loadInitialData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const sources = await loadPolicyRagSources();
      setRagSources(sources);
      await Promise.all([loadChunkRuns(), loadPrepRuns()]);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [loadChunkRuns, loadPrepRuns]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  useEffect(() => {
    if (!chunkGenerationRunId || !ragSourceId) {
      setApprovedCount(0);
      return;
    }
    loadApprovedRealPolicyChunkCount(chunkGenerationRunId, ragSourceId)
      .then(setApprovedCount)
      .catch(() => setApprovedCount(0));
  }, [chunkGenerationRunId, ragSourceId]);

  const selectedChunkRun = chunkRuns.find((row) => row.id === chunkGenerationRunId) ?? null;
  const selectedRagSource = ragSources.find((src) => src.ragSourceId === ragSourceId) ?? null;

  const activeRunId = prepareResult?.realEmbeddingPreparationRunId ?? run?.id ?? null;
  const displayStatus = prepareResult?.preparationStatus ?? run?.preparation_status ?? null;
  const displayApproved =
    prepareResult?.approvedChunkCount ?? run?.approved_chunk_count ?? approvedCount;
  const displayQueued = prepareResult?.queuedChunkCount ?? run?.queued_chunk_count ?? 0;
  const displaySkipped = prepareResult?.skippedChunkCount ?? run?.skipped_chunk_count ?? 0;
  const missingInformation = run?.missing_information ?? prepareResult?.missingInformation ?? [];
  const displayError = run?.error_message ?? "";
  const displayProvider = run?.embedding_provider ?? embeddingProvider;
  const displayModel = run?.embedding_model ?? embeddingModel;

  const handleChunkRunChange = (runId) => {
    setChunkGenerationRunId(runId);
    const selected = chunkRuns.find((row) => row.id === runId);
    const ctxRag = selected?.generation_context?.rag_source_id;
    if (ctxRag) {
      setRagSourceId(ctxRag);
    }
  };

  const handlePrepare = async () => {
    if (!chunkGenerationRunId) {
      setError("Real Chunk Generation Run을 선택해 주세요.");
      return;
    }
    if (!ragSourceId) {
      setError("RAG Source를 선택해 주세요.");
      return;
    }
    if (!embeddingProvider.trim()) {
      setError("Provider를 입력해 주세요.");
      return;
    }
    if (!embeddingModel.trim()) {
      setError("Model을 입력해 주세요.");
      return;
    }
    setPreparing(true);
    setError("");
    setPrepareResult(null);
    try {
      const data = await prepareRealPolicyEmbedding({
        realChunkGenerationRunId: chunkGenerationRunId,
        ragSourceId,
        embeddingProvider,
        embeddingModel,
      });
      setPrepareResult(data);
      if (data.realEmbeddingPreparationRunId) {
        const runRow = await loadRealPolicyEmbeddingPreparationRun(data.realEmbeddingPreparationRunId);
        setRun(runRow);
      }
      await loadPrepRuns();
    } catch (err) {
      setError(err.message);
    } finally {
      setPreparing(false);
    }
  };

  return (
    <div style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#f8fafc" }}>
          실제 약관 Embedding 준비
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: "15px", color: "#94a3b8", lineHeight: 1.55 }}>
          승인된 실제 약관 청크만 Embedding 큐에 등록합니다. 외부 API·가짜 벡터 생성 없음.
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
          Embedding 준비 실행
        </h2>
        <div style={{ display: "grid", gap: "12px", maxWidth: "720px" }}>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Real Chunk Generation Run
            <select
              value={chunkGenerationRunId}
              onChange={(e) => handleChunkRunChange(e.target.value)}
              disabled={loading}
              style={{ ...S.input, marginTop: "6px" }}
            >
              <option value="">(선택)</option>
              {chunkRuns.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.pdf?.file_name ?? row.policy_pdf_id} — {row.generated_chunk_count} chunks
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            RAG Source
            <select
              value={ragSourceId}
              onChange={(e) => setRagSourceId(e.target.value)}
              disabled={loading}
              style={{ ...S.input, marginTop: "6px" }}
            >
              <option value="">(선택)</option>
              {ragSources.map((src) => (
                <option key={src.ragSourceId} value={src.ragSourceId}>
                  {sourceTypeLabel(src.sourceType)} · {src.sourceReference}
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Provider
            <input
              type="text"
              value={embeddingProvider}
              onChange={(e) => setEmbeddingProvider(e.target.value)}
              placeholder="예: openai"
              style={{ ...S.input, marginTop: "6px" }}
            />
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Model
            <input
              type="text"
              value={embeddingModel}
              onChange={(e) => setEmbeddingModel(e.target.value)}
              placeholder="예: text-embedding-3-small"
              style={{ ...S.input, marginTop: "6px" }}
            />
          </label>
          {selectedChunkRun || selectedRagSource ? (
            <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
              <div>PDF: {selectedChunkRun?.pdf?.file_name ?? "—"}</div>
              <div>
                Policy Source: {selectedChunkRun?.source?.source_name ?? "—"}
              </div>
              <div>
                RAG Source: {selectedRagSource?.sourceReference ?? ragSourceId ?? "—"}
              </div>
              <div>Approved Chunk Count (preview): {approvedCount}</div>
            </div>
          ) : null}
          <button
            type="button"
            style={{ ...S.btn, opacity: preparing ? 0.6 : 1, maxWidth: "280px" }}
            disabled={preparing || loading || !chunkGenerationRunId || !ragSourceId}
            onClick={handlePrepare}
          >
            {preparing ? "준비 중…" : "Embedding 준비 실행"}
          </button>
        </div>
      </section>

      {prepareResult || run ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            준비 상태
          </h2>
          <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
            <div>Real Chunk Generation Run: {run?.real_chunk_generation_run_id ?? chunkGenerationRunId ?? "—"}</div>
            <div>RAG Source: {run?.rag_source?.source_reference ?? selectedRagSource?.sourceReference ?? ragSourceId ?? "—"}</div>
            <div>Provider: {displayProvider || "—"}</div>
            <div>Model: {displayModel || "—"}</div>
            <div>Preparation Status: {preparationStatusLabel(displayStatus) || "—"}</div>
            <div>Approved Chunk Count: {displayApproved}</div>
            <div>Queued Chunk Count: {displayQueued}</div>
            <div>Skipped Chunk Count: {displaySkipped}</div>
            {displayError ? <div>Error Message: {displayError}</div> : null}
            {activeRunId ? <div>Preparation Run ID: {activeRunId}</div> : null}
          </div>
        </section>
      ) : null}

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

      {prepRuns.length ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            Embedding 준비 Run 목록 ({prepRuns.length})
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {prepRuns.map((prepRun) => {
              const missing = Array.isArray(prepRun.missing_information)
                ? prepRun.missing_information
                : [];
              return (
                <div
                  key={prepRun.id}
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
                    {prepRun.chunk_run?.pdf?.file_name ?? prepRun.real_chunk_generation_run_id}
                  </div>
                  <div style={{ marginTop: "6px", color: "#94a3b8", lineHeight: 1.6 }}>
                    <div>Provider: {prepRun.embedding_provider}</div>
                    <div>Model: {prepRun.embedding_model}</div>
                    <div>Preparation Status: {preparationStatusLabel(prepRun.preparation_status)}</div>
                    <div>Approved: {prepRun.approved_chunk_count}</div>
                    <div>Queued: {prepRun.queued_chunk_count}</div>
                    <div>Skipped: {prepRun.skipped_chunk_count}</div>
                    {prepRun.error_message ? <div>Error: {prepRun.error_message}</div> : null}
                    {missing.length ? (
                      <div>Missing: {missing.map(missingLabel).join(", ")}</div>
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
