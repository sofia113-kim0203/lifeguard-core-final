import { useCallback, useEffect, useState } from "react";
import {
  loadPolicyRagSources,
  prepareEmbeddingPipeline,
  linkEmbeddingPipelineResult,
  loadEmbeddingPipelineRun,
  loadEmbeddingPipelineItems,
  EMBEDDING_PIPELINE_STATUS_LABELS,
  EMBEDDING_PIPELINE_ITEM_STATUS_LABELS,
  EMBEDDING_PIPELINE_MISSING_LABELS,
} from "../lib/policyEmbeddingPipeline.js";
import { POLICY_RAG_SOURCE_TYPE_LABELS } from "../lib/policyEmbeddingPreparation.js";

const FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

const ITEM_STATUSES = Object.keys(EMBEDDING_PIPELINE_ITEM_STATUS_LABELS);

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
  return EMBEDDING_PIPELINE_MISSING_LABELS[code] ?? code;
}

function pipelineStatusLabel(status) {
  return EMBEDDING_PIPELINE_STATUS_LABELS[status] ?? status;
}

function itemStatusLabel(status) {
  return EMBEDDING_PIPELINE_ITEM_STATUS_LABELS[status] ?? status;
}

function sourceTypeLabel(type) {
  return POLICY_RAG_SOURCE_TYPE_LABELS[type] ?? type;
}

export default function AdminPolicyEmbeddingPipelinePanel() {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState("");
  const [prepareResult, setPrepareResult] = useState(null);
  const [linkResult, setLinkResult] = useState(null);
  const [run, setRun] = useState(null);
  const [items, setItems] = useState([]);

  const [ragSourceId, setRagSourceId] = useState("");
  const [embeddingProvider, setEmbeddingProvider] = useState("");
  const [embeddingModel, setEmbeddingModel] = useState("");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [vectorReference, setVectorReference] = useState("");
  const [itemStatus, setItemStatus] = useState("embedded");
  const [errorMessage, setErrorMessage] = useState("");

  const loadSources = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await loadPolicyRagSources();
      setSources(rows);
      if (rows.length && !ragSourceId) {
        setRagSourceId(rows[0].id);
      }
    } catch (err) {
      setError(err.message);
      setSources([]);
    } finally {
      setLoading(false);
    }
  }, [ragSourceId]);

  useEffect(() => {
    loadSources();
  }, [loadSources]);

  const selectedSource = sources.find((source) => source.id === ragSourceId) ?? null;

  const refreshRun = async (runId) => {
    const [runRow, itemRows] = await Promise.all([
      loadEmbeddingPipelineRun(runId),
      loadEmbeddingPipelineItems(runId),
    ]);
    setRun(runRow);
    setItems(itemRows);
    if (itemRows.length && !selectedItemId) {
      setSelectedItemId(itemRows[0].id);
    }
  };

  const handlePrepare = async () => {
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
    setLinkResult(null);
    try {
      const data = await prepareEmbeddingPipeline({
        ragSourceId,
        embeddingProvider,
        embeddingModel,
      });
      setPrepareResult(data);
      if (data.embeddingPipelineRunId) {
        await refreshRun(data.embeddingPipelineRunId);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setPreparing(false);
    }
  };

  const handleLink = async () => {
    if (!selectedItemId) {
      setError("Pipeline 항목을 선택해 주세요.");
      return;
    }
    setLinking(true);
    setError("");
    setLinkResult(null);
    try {
      const data = await linkEmbeddingPipelineResult({
        embeddingPipelineItemId: selectedItemId,
        vectorReference,
        itemStatus,
        errorMessage,
      });
      setLinkResult(data);
      const runId = prepareResult?.embeddingPipelineRunId ?? run?.id;
      if (runId) {
        await refreshRun(runId);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLinking(false);
    }
  };

  const missingInfo = [
    ...(Array.isArray(run?.missing_information) ? run.missing_information : []),
    ...(prepareResult?.missingInformation ?? []),
    ...(linkResult?.missingInformation ?? []),
  ].filter((value, index, arr) => arr.indexOf(value) === index);

  return (
    <div style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#f8fafc" }}>
          Embedding Pipeline 관리
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: "15px", color: "#94a3b8", lineHeight: 1.55 }}>
          승인된 Chunk를 큐·실행·벡터 레지스트리 워크플로에 연결합니다. 외부 API·가짜 벡터·API 키 없음.
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
          Pipeline 준비
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
              {sources.length === 0 ? (
                <option value="">등록된 RAG Source 없음</option>
              ) : (
                sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.source_reference ?? source.id} · {sourceTypeLabel(source.source_type)}
                  </option>
                ))
              )}
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
          <button
            type="button"
            style={{ ...S.btn, opacity: preparing ? 0.6 : 1, maxWidth: "280px" }}
            disabled={preparing || loading || !ragSourceId}
            onClick={handlePrepare}
          >
            {preparing ? "준비 중…" : "Pipeline 준비"}
          </button>
        </div>
      </section>

      {run || prepareResult ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            Pipeline 현황
          </h2>
          <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
            <div>
              RAG Source:{" "}
              {selectedSource?.source_reference ?? run?.rag_source_id ?? ragSourceId ?? "—"}
            </div>
            <div>Provider: {run?.embedding_provider ?? embeddingProvider ?? "—"}</div>
            <div>Model: {run?.embedding_model ?? embeddingModel ?? "—"}</div>
            <div>
              Approved Chunks: {run?.approved_chunk_count ?? prepareResult?.approvedChunkCount ?? 0}
            </div>
            <div>Queued Count: {run?.queued_count ?? prepareResult?.queuedCount ?? 0}</div>
            <div>Embedded Count: {run?.embedded_count ?? linkResult?.embeddedCount ?? 0}</div>
            <div>Failed Count: {run?.failed_count ?? linkResult?.failedCount ?? 0}</div>
            <div>
              Pipeline Status:{" "}
              {pipelineStatusLabel(run?.pipeline_status ?? prepareResult?.pipelineStatus)}
            </div>
            {missingInfo.length ? (
              <div style={{ marginTop: "8px" }}>
                Missing Information: {missingInfo.map(missingLabel).join(", ")}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {items.length ? (
        <>
          <section style={S.card}>
            <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
              Pipeline 항목 ({items.length})
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedItemId(item.id)}
                  style={{
                    textAlign: "left",
                    padding: "12px",
                    borderRadius: "10px",
                    border:
                      selectedItemId === item.id
                        ? "1px solid rgba(59, 130, 246, 0.45)"
                        : "1px solid rgba(148, 163, 184, 0.15)",
                    background:
                      selectedItemId === item.id
                        ? "rgba(37, 99, 235, 0.2)"
                        : "rgba(15, 23, 42, 0.5)",
                    color: "#e2e8f0",
                    cursor: "pointer",
                    fontFamily: FONT,
                    fontSize: "12px",
                  }}
                >
                  <div>
                    {itemStatusLabel(item.item_status)} · chunk {item.chunk_registry_id}
                  </div>
                  <div style={{ marginTop: "4px", color: "#94a3b8" }}>
                    Vector Reference: {item.vector_reference ?? "—"}
                  </div>
                  {item.error_message ? (
                    <div style={{ marginTop: "4px", color: "#f87171" }}>
                      Error: {item.error_message}
                    </div>
                  ) : null}
                </button>
              ))}
            </div>
          </section>

          <section style={S.card}>
            <h2 style={{ margin: "0 0 16px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
              결과 연결
            </h2>
            <div style={{ display: "grid", gap: "12px", maxWidth: "720px" }}>
              <label style={{ fontSize: "13px", color: "#94a3b8" }}>
                Item Status
                <select
                  value={itemStatus}
                  onChange={(e) => setItemStatus(e.target.value)}
                  style={{ ...S.input, marginTop: "6px" }}
                >
                  {ITEM_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {itemStatusLabel(status)} ({status})
                    </option>
                  ))}
                </select>
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
              <label style={{ fontSize: "13px", color: "#94a3b8" }}>
                Error Message
                <input
                  type="text"
                  value={errorMessage}
                  onChange={(e) => setErrorMessage(e.target.value)}
                  style={{ ...S.input, marginTop: "6px" }}
                />
              </label>
              <button
                type="button"
                style={{ ...S.btn, opacity: linking ? 0.6 : 1, maxWidth: "280px" }}
                disabled={linking || !selectedItemId}
                onClick={handleLink}
              >
                {linking ? "연결 중…" : "결과 연결"}
              </button>
            </div>
          </section>
        </>
      ) : null}

      {linkResult ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            연결 결과
          </h2>
          <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
            <div>Item Status: {itemStatusLabel(linkResult.itemStatus)}</div>
            <div>Vector Reference: {linkResult.vectorReference ?? "—"}</div>
            <div>Pipeline Status: {pipelineStatusLabel(linkResult.pipelineStatus)}</div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
