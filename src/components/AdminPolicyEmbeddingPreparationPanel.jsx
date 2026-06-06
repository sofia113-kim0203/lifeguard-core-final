import { useCallback, useEffect, useState } from "react";
import {
  loadPolicyRagSources,
  loadPolicyChunkCount,
  loadPolicyEmbeddingQueueStats,
  loadPolicyEmbeddingQueue,
  loadPolicyVectorRegistry,
  loadApprovedChunks,
  preparePolicyEmbeddingQueue,
  registerPolicyVectorReference,
  POLICY_RAG_SOURCE_TYPE_LABELS,
  POLICY_EMBEDDING_STATUS_LABELS,
  POLICY_VECTOR_STATUS_LABELS,
  POLICY_EMBEDDING_MISSING_LABELS,
} from "../lib/policyEmbeddingPreparation.js";

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
  return POLICY_EMBEDDING_MISSING_LABELS[code] ?? code;
}

function sourceTypeLabel(type) {
  return POLICY_RAG_SOURCE_TYPE_LABELS[type] ?? type;
}

function embeddingStatusLabel(status) {
  return POLICY_EMBEDDING_STATUS_LABELS[status] ?? status;
}

function vectorStatusLabel(status) {
  return POLICY_VECTOR_STATUS_LABELS[status] ?? status;
}

export default function AdminPolicyEmbeddingPreparationPanel() {
  const [sources, setSources] = useState([]);
  const [chunkCount, setChunkCount] = useState(0);
  const [queueStats, setQueueStats] = useState(null);
  const [queueRows, setQueueRows] = useState([]);
  const [vectorRows, setVectorRows] = useState([]);
  const [approvedChunks, setApprovedChunks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState("");
  const [prepareResult, setPrepareResult] = useState(null);
  const [registerResult, setRegisterResult] = useState(null);

  const [ragSourceId, setRagSourceId] = useState("");
  const [chunkRegistryId, setChunkRegistryId] = useState("");
  const [embeddingProvider, setEmbeddingProvider] = useState("");
  const [embeddingModel, setEmbeddingModel] = useState("");
  const [vectorReference, setVectorReference] = useState("");

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

  const loadSourceData = useCallback(async (sourceId) => {
    if (!sourceId) {
      setChunkCount(0);
      setQueueStats(null);
      setQueueRows([]);
      setVectorRows([]);
      setApprovedChunks([]);
      setChunkRegistryId("");
      return;
    }
    try {
      const [count, stats, queue, vectors, chunks] = await Promise.all([
        loadPolicyChunkCount(sourceId),
        loadPolicyEmbeddingQueueStats(sourceId),
        loadPolicyEmbeddingQueue(sourceId),
        loadPolicyVectorRegistry(sourceId),
        loadApprovedChunks(sourceId),
      ]);
      setChunkCount(count);
      setQueueStats(stats);
      setQueueRows(queue);
      setVectorRows(vectors);
      setApprovedChunks(chunks);
      if (chunks.length) {
        setChunkRegistryId(chunks[0].id);
      } else {
        setChunkRegistryId("");
      }
    } catch (err) {
      setError(err.message);
      setChunkCount(0);
      setQueueStats(null);
      setQueueRows([]);
      setVectorRows([]);
      setApprovedChunks([]);
    }
  }, []);

  useEffect(() => {
    loadSources();
  }, [loadSources]);

  useEffect(() => {
    loadSourceData(ragSourceId);
  }, [ragSourceId, loadSourceData]);

  const selectedSource = sources.find((s) => s.ragSourceId === ragSourceId) ?? null;

  const handlePrepare = async () => {
    if (!ragSourceId) {
      setError("RAG 소스를 선택해 주세요.");
      return;
    }
    setPreparing(true);
    setError("");
    setPrepareResult(null);
    try {
      const data = await preparePolicyEmbeddingQueue({ ragSourceId });
      setPrepareResult(data);
      await loadSourceData(ragSourceId);
    } catch (err) {
      setError(err.message);
    } finally {
      setPreparing(false);
    }
  };

  const handleRegister = async () => {
    if (!chunkRegistryId) {
      setError("청크를 선택해 주세요.");
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
    if (!vectorReference.trim()) {
      setError("Vector Reference를 입력해 주세요.");
      return;
    }
    setRegistering(true);
    setError("");
    setRegisterResult(null);
    try {
      const data = await registerPolicyVectorReference({
        chunkRegistryId,
        embeddingProvider,
        embeddingModel,
        vectorReference,
      });
      setRegisterResult(data);
      await loadSourceData(ragSourceId);
    } catch (err) {
      setError(err.message);
    } finally {
      setRegistering(false);
    }
  };

  return (
    <div style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#f8fafc" }}>
          약관 Embedding 준비 관리
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: "15px", color: "#94a3b8", lineHeight: 1.55 }}>
          승인된 청크만 큐에 등록합니다. 외부 API·가짜 벡터 생성 없음.
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
                  {sourceTypeLabel(src.sourceType)} · {src.sourceReference}
                </option>
              ))}
            </select>
          </label>
          {selectedSource ? (
            <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
              <div>Source Reference: {selectedSource.sourceReference}</div>
              <div>Carrier: {selectedSource.carrierName ?? "—"}</div>
              <div>Product: {selectedSource.productName ?? "—"}</div>
            </div>
          ) : null}
          <button
            type="button"
            style={{ ...S.btn, opacity: preparing ? 0.6 : 1, maxWidth: "280px" }}
            disabled={preparing || !ragSourceId}
            onClick={handlePrepare}
          >
            {preparing ? "준비 중…" : "Embedding 큐 준비"}
          </button>
        </div>
      </section>

      {ragSourceId ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            큐 현황
          </h2>
          <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
            <div>Chunk Count: {chunkCount}</div>
            <div>Queued Count: {queueStats?.queued ?? 0}</div>
            <div>Embedded Count: {queueStats?.embedded ?? 0}</div>
            <div>Failed Count: {queueStats?.failed ?? 0}</div>
            <div>Skipped Count: {queueStats?.skipped ?? 0}</div>
            {prepareResult?.missingInformation?.length ? (
              <div style={{ marginTop: "8px" }}>
                Missing Information:{" "}
                {prepareResult.missingInformation.map(missingLabel).join(", ")}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {queueRows.length ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            Embedding Queue
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {queueRows.map((row) => (
              <div
                key={row.id}
                style={{
                  padding: "12px",
                  borderRadius: "10px",
                  border: "1px solid rgba(148, 163, 184, 0.15)",
                  background: "rgba(15, 23, 42, 0.5)",
                  fontSize: "12px",
                  color: "#94a3b8",
                }}
              >
                <div>
                  {embeddingStatusLabel(row.embedding_status)} · chunk: {row.chunk_registry_id}
                </div>
                <div>
                  Provider: {row.embedding_provider ?? "—"} · Model: {row.embedding_model ?? "—"}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section style={S.card}>
        <h2 style={{ margin: "0 0 16px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
          Vector Reference 등록
        </h2>
        <div style={{ display: "grid", gap: "12px", maxWidth: "720px" }}>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Approved Chunk
            <select
              value={chunkRegistryId}
              onChange={(e) => setChunkRegistryId(e.target.value)}
              disabled={!approvedChunks.length}
              style={{ ...S.input, marginTop: "6px" }}
            >
              <option value="">(선택)</option>
              {approvedChunks.map((chunk) => (
                <option key={chunk.id} value={chunk.id}>
                  #{chunk.chunk_sequence} · {chunk.source_reference}
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
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Vector Reference
            <input
              type="text"
              value={vectorReference}
              onChange={(e) => setVectorReference(e.target.value)}
              placeholder="예: policy_vector:chunk_001"
              style={{ ...S.input, marginTop: "6px" }}
            />
          </label>
          <button
            type="button"
            style={{ ...S.btn, opacity: registering ? 0.6 : 1, maxWidth: "280px" }}
            disabled={registering || !chunkRegistryId}
            onClick={handleRegister}
          >
            {registering ? "등록 중…" : "Vector Reference 등록"}
          </button>
        </div>
      </section>

      {registerResult ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            등록 결과
          </h2>
          <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
            <div>vector_registry_id: {registerResult.vectorRegistryId ?? "—"}</div>
            <div>Vector Status: {vectorStatusLabel(registerResult.vectorStatus)}</div>
            <div>Provider: {registerResult.embeddingProvider ?? "—"}</div>
            <div>Model: {registerResult.embeddingModel ?? "—"}</div>
            <div>Vector Reference: {registerResult.vectorReference ?? "—"}</div>
          </div>
        </section>
      ) : null}

      {vectorRows.length ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            Vector Registry
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {vectorRows.map((row) => (
              <div
                key={row.id}
                style={{
                  padding: "12px",
                  borderRadius: "10px",
                  border: "1px solid rgba(148, 163, 184, 0.15)",
                  background: "rgba(15, 23, 42, 0.5)",
                  fontSize: "12px",
                  color: "#94a3b8",
                }}
              >
                <div>
                  {vectorStatusLabel(row.vector_status)} · chunk: {row.chunk_registry_id}
                </div>
                <div>
                  Provider: {row.embedding_provider} · Model: {row.embedding_model}
                </div>
                <div>Vector Reference: {row.vector_reference}</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
