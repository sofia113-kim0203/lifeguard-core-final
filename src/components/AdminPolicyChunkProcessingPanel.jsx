import { useCallback, useEffect, useState } from "react";
import {
  loadPolicyRagSources,
  loadPolicyChunkRegistry,
  loadPolicyChunkProcessingRuns,
  processPolicyChunks,
  reviewPolicyChunk,
  POLICY_RAG_SOURCE_TYPE_LABELS,
  POLICY_CHUNK_STATUS_LABELS,
  POLICY_CHUNK_PROCESSING_STATUS_LABELS,
  POLICY_CHUNK_MISSING_LABELS,
} from "../lib/policyChunkProcessing.js";

const FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

const CHUNK_STATUSES = Object.keys(POLICY_CHUNK_STATUS_LABELS);

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
  return POLICY_CHUNK_MISSING_LABELS[code] ?? code;
}

function sourceTypeLabel(type) {
  return POLICY_RAG_SOURCE_TYPE_LABELS[type] ?? type;
}

function chunkStatusLabel(status) {
  return POLICY_CHUNK_STATUS_LABELS[status] ?? status;
}

function processingStatusLabel(status) {
  return POLICY_CHUNK_PROCESSING_STATUS_LABELS[status] ?? status;
}

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("ko-KR");
  } catch {
    return String(value);
  }
}

export default function AdminPolicyChunkProcessingPanel() {
  const [sources, setSources] = useState([]);
  const [chunks, setChunks] = useState([]);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState("");
  const [processResult, setProcessResult] = useState(null);
  const [reviewResult, setReviewResult] = useState(null);

  const [ragSourceId, setRagSourceId] = useState("");
  const [selectedChunkId, setSelectedChunkId] = useState("");
  const [chunkStatus, setChunkStatus] = useState("created");

  const loadSources = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await loadPolicyRagSources();
      setSources(rows);
    } catch (err) {
      setError(err.message);
      setSources([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadChunksAndRuns = useCallback(async (sourceId) => {
    if (!sourceId) {
      setChunks([]);
      setRuns([]);
      return;
    }
    try {
      const [chunkRows, runRows] = await Promise.all([
        loadPolicyChunkRegistry(sourceId),
        loadPolicyChunkProcessingRuns(sourceId),
      ]);
      setChunks(chunkRows);
      setRuns(runRows);
      if (chunkRows.length) {
        setSelectedChunkId(chunkRows[0].chunkRegistryId);
        setChunkStatus(chunkRows[0].chunkStatus ?? "created");
      } else {
        setSelectedChunkId("");
      }
    } catch (err) {
      setError(err.message);
      setChunks([]);
      setRuns([]);
    }
  }, []);

  useEffect(() => {
    loadSources();
  }, [loadSources]);

  useEffect(() => {
    loadChunksAndRuns(ragSourceId);
  }, [ragSourceId, loadChunksAndRuns]);

  const selectedSource = sources.find((s) => s.ragSourceId === ragSourceId) ?? null;
  const latestRun = runs[0] ?? null;

  const handleProcess = async () => {
    if (!ragSourceId) {
      setError("RAG 소스를 선택해 주세요.");
      return;
    }
    setProcessing(true);
    setError("");
    setProcessResult(null);
    try {
      const data = await processPolicyChunks({ ragSourceId });
      setProcessResult(data);
      await loadChunksAndRuns(ragSourceId);
      await loadSources();
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleSelectChunk = (chunk) => {
    setSelectedChunkId(chunk.chunkRegistryId);
    setChunkStatus(chunk.chunkStatus ?? "created");
    setReviewResult(null);
  };

  const handleReview = async () => {
    if (!selectedChunkId) {
      setError("청크를 선택해 주세요.");
      return;
    }
    setReviewing(true);
    setError("");
    setReviewResult(null);
    try {
      const data = await reviewPolicyChunk({
        chunkRegistryId: selectedChunkId,
        chunkStatus,
      });
      setReviewResult(data);
      await loadChunksAndRuns(ragSourceId);
    } catch (err) {
      setError(err.message);
    } finally {
      setReviewing(false);
    }
  };

  return (
    <div style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#f8fafc" }}>
          약관 Chunk 처리 관리
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: "15px", color: "#94a3b8", lineHeight: 1.55 }}>
          승인된 수작업 지식·기존 약관 문서 청크만 처리합니다. 임베딩·외부 AI 없음.
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
          Source
        </h2>
        <div style={{ display: "grid", gap: "12px", maxWidth: "720px" }}>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            RAG Source
            <select
              value={ragSourceId}
              onChange={(e) => setRagSourceId(e.target.value)}
              disabled={loading}
              style={{ ...S.input, marginTop: "6px" }}
            >
              <option value="">(선택)</option>
              {sources.map((src) => (
                <option key={src.ragSourceId} value={src.ragSourceId}>
                  {sourceTypeLabel(src.sourceType)} · {src.sourceReference} ·{" "}
                  {src.carrierName ?? "—"}
                </option>
              ))}
            </select>
          </label>
          {selectedSource ? (
            <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
              <div>Source Type: {sourceTypeLabel(selectedSource.sourceType)}</div>
              <div>Source Reference: {selectedSource.sourceReference}</div>
              <div>Carrier: {selectedSource.carrierName ?? "—"}</div>
              <div>Product: {selectedSource.productName ?? "—"}</div>
            </div>
          ) : null}
          <button
            type="button"
            style={{ ...S.btn, opacity: processing ? 0.6 : 1, maxWidth: "280px" }}
            disabled={processing || !ragSourceId}
            onClick={handleProcess}
          >
            {processing ? "처리 중…" : "Chunk 처리 실행"}
          </button>
        </div>
      </section>

      {processResult || latestRun ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            Processing Status
          </h2>
          <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
            <div>
              Processing Status:{" "}
              {processingStatusLabel(
                processResult?.processingStatus ?? latestRun?.processingStatus
              )}
            </div>
            <div>
              Chunk Count: {processResult?.totalChunks ?? latestRun?.totalChunks ?? 0}
            </div>
            {(processResult?.missingInformation ?? latestRun?.missingInformation)?.length ? (
              <div style={{ marginTop: "8px" }}>
                Missing Information:{" "}
                {(processResult?.missingInformation ?? latestRun?.missingInformation)
                  .map(missingLabel)
                  .join(", ")}
              </div>
            ) : (
              <div style={{ marginTop: "8px" }}>Missing Information: 없음</div>
            )}
            {latestRun?.createdAt ? (
              <div style={{ marginTop: "4px" }}>최근 실행: {formatDate(latestRun.createdAt)}</div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section style={S.card}>
        <h2 style={{ margin: "0 0 16px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
          Chunk Registry ({chunks.length})
        </h2>
        {!chunks.length ? (
          <p style={{ margin: 0, color: "#64748b" }}>등록된 청크 없음.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {chunks.map((chunk) => {
              const selected = selectedChunkId === chunk.chunkRegistryId;
              return (
                <button
                  key={chunk.chunkRegistryId}
                  type="button"
                  onClick={() => handleSelectChunk(chunk)}
                  style={{
                    textAlign: "left",
                    padding: "14px",
                    borderRadius: "10px",
                    border: selected
                      ? "1px solid rgba(59, 130, 246, 0.45)"
                      : "1px solid rgba(148, 163, 184, 0.15)",
                    background: selected
                      ? "rgba(37, 99, 235, 0.2)"
                      : "rgba(15, 23, 42, 0.5)",
                    color: "#e2e8f0",
                    cursor: "pointer",
                    fontFamily: FONT,
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: "14px" }}>
                    #{chunk.chunkSequence} · {chunkStatusLabel(chunk.chunkStatus)}
                  </div>
                  <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "4px" }}>
                    {sourceTypeLabel(chunk.sourceType)} · {chunk.sourceReference}
                  </div>
                  <div style={{ fontSize: "12px", color: "#64748b", marginTop: "6px" }}>
                    Chunk Text: {chunk.chunkText?.slice(0, 200)}
                    {(chunk.chunkText?.length ?? 0) > 200 ? "…" : ""}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {chunks.length ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 16px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            Chunk Status
          </h2>
          <div style={{ display: "grid", gap: "12px", maxWidth: "720px" }}>
            <label style={{ fontSize: "13px", color: "#94a3b8" }}>
              선택 청크 ID
              <input
                type="text"
                value={selectedChunkId}
                readOnly
                style={{ ...S.input, marginTop: "6px" }}
              />
            </label>
            <label style={{ fontSize: "13px", color: "#94a3b8" }}>
              Chunk Status
              <select
                value={chunkStatus}
                onChange={(e) => setChunkStatus(e.target.value)}
                style={{ ...S.input, marginTop: "6px" }}
              >
                {CHUNK_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {chunkStatusLabel(status)} ({status})
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              style={{ ...S.btn, opacity: reviewing ? 0.6 : 1, maxWidth: "280px" }}
              disabled={reviewing || !selectedChunkId}
              onClick={handleReview}
            >
              {reviewing ? "저장 중…" : "청크 상태 저장"}
            </button>
          </div>
        </section>
      ) : null}

      {reviewResult ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            검토 결과
          </h2>
          <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
            <div>chunk_registry_id: {reviewResult.chunkRegistryId ?? "—"}</div>
            <div>Chunk Status: {chunkStatusLabel(reviewResult.chunkStatus)}</div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
