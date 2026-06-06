import { useState } from "react";
import {
  prepareEmbeddingExecution,
  storeEmbeddingExecutionResult,
  loadEmbeddingExecutionRun,
  loadEmbeddingExecutionItems,
  EMBEDDING_EXECUTION_STATUS_LABELS,
  EMBEDDING_EXECUTION_ITEM_STATUS_LABELS,
  EMBEDDING_EXECUTION_MISSING_LABELS,
} from "../lib/policyEmbeddingExecution.js";

const FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

const ITEM_STATUSES = Object.keys(EMBEDDING_EXECUTION_ITEM_STATUS_LABELS);

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
  return EMBEDDING_EXECUTION_MISSING_LABELS[code] ?? code;
}

function runStatusLabel(status) {
  return EMBEDDING_EXECUTION_STATUS_LABELS[status] ?? status;
}

function itemStatusLabel(status) {
  return EMBEDDING_EXECUTION_ITEM_STATUS_LABELS[status] ?? status;
}

export default function AdminPolicyEmbeddingExecutionPanel() {
  const [preparing, setPreparing] = useState(false);
  const [storing, setStoring] = useState(false);
  const [error, setError] = useState("");
  const [prepareResult, setPrepareResult] = useState(null);
  const [storeResult, setStoreResult] = useState(null);
  const [run, setRun] = useState(null);
  const [items, setItems] = useState([]);

  const [embeddingProvider, setEmbeddingProvider] = useState("");
  const [embeddingModel, setEmbeddingModel] = useState("");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [vectorReference, setVectorReference] = useState("");
  const [executionStatus, setExecutionStatus] = useState("embedded");
  const [errorMessage, setErrorMessage] = useState("");

  const refreshRun = async (runId) => {
    const [runRow, itemRows] = await Promise.all([
      loadEmbeddingExecutionRun(runId),
      loadEmbeddingExecutionItems(runId),
    ]);
    setRun(runRow);
    setItems(itemRows);
    if (itemRows.length && !selectedItemId) {
      setSelectedItemId(itemRows[0].id);
    }
  };

  const handlePrepare = async () => {
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
    setStoreResult(null);
    try {
      const data = await prepareEmbeddingExecution({
        embeddingProvider,
        embeddingModel,
      });
      setPrepareResult(data);
      if (data.embeddingExecutionRunId) {
        await refreshRun(data.embeddingExecutionRunId);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setPreparing(false);
    }
  };

  const handleStore = async () => {
    if (!selectedItemId) {
      setError("실행 항목을 선택해 주세요.");
      return;
    }
    setStoring(true);
    setError("");
    setStoreResult(null);
    try {
      const data = await storeEmbeddingExecutionResult({
        embeddingExecutionItemId: selectedItemId,
        vectorReference,
        executionStatus,
        errorMessage,
      });
      setStoreResult(data);
      if (prepareResult?.embeddingExecutionRunId) {
        await refreshRun(prepareResult.embeddingExecutionRunId);
      }
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
          실제 Embedding 실행 준비
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: "15px", color: "#94a3b8", lineHeight: 1.55 }}>
          큐된 청크 실행 배치만 준비합니다. 외부 API·가짜 임베딩·API 키 없음.
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
          실행 배치 준비
        </h2>
        <div style={{ display: "grid", gap: "12px", maxWidth: "720px" }}>
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
            disabled={preparing}
            onClick={handlePrepare}
          >
            {preparing ? "준비 중…" : "실행 배치 준비"}
          </button>
        </div>
      </section>

      {run || prepareResult ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            실행 현황
          </h2>
          <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
            <div>Provider: {run?.embedding_provider ?? embeddingProvider ?? "—"}</div>
            <div>Model: {run?.embedding_model ?? embeddingModel ?? "—"}</div>
            <div>Queued Count: {run?.queued_count ?? prepareResult?.queuedCount ?? 0}</div>
            <div>Processed Count: {run?.processed_count ?? storeResult?.processedCount ?? 0}</div>
            <div>Failed Count: {run?.failed_count ?? storeResult?.failedCount ?? 0}</div>
            <div>
              Execution Status:{" "}
              {runStatusLabel(run?.execution_status ?? prepareResult?.executionStatus)}
            </div>
            {prepareResult?.missingInformation?.length ? (
              <div style={{ marginTop: "8px" }}>
                Missing Information:{" "}
                {prepareResult.missingInformation.map(missingLabel).join(", ")}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {items.length ? (
        <>
          <section style={S.card}>
            <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
              실행 항목 ({items.length})
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
                  <div>{itemStatusLabel(item.execution_status)} · chunk {item.chunk_registry_id}</div>
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
              결과 저장
            </h2>
            <div style={{ display: "grid", gap: "12px", maxWidth: "720px" }}>
              <label style={{ fontSize: "13px", color: "#94a3b8" }}>
                Execution Status
                <select
                  value={executionStatus}
                  onChange={(e) => setExecutionStatus(e.target.value)}
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
                style={{ ...S.btn, opacity: storing ? 0.6 : 1, maxWidth: "280px" }}
                disabled={storing || !selectedItemId}
                onClick={handleStore}
              >
                {storing ? "저장 중…" : "실행 결과 저장"}
              </button>
            </div>
          </section>
        </>
      ) : null}

      {storeResult ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            저장 결과
          </h2>
          <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
            <div>Execution Status: {itemStatusLabel(storeResult.executionStatus)}</div>
            <div>Vector Reference: {storeResult.vectorReference ?? "—"}</div>
            <div>Run Status: {runStatusLabel(storeResult.runStatus)}</div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
