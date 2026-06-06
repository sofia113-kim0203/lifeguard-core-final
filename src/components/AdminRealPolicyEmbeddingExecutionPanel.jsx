import { useCallback, useEffect, useState } from "react";
import {
  prepareRealPolicyEmbeddingExecution,
  storeRealPolicyEmbeddingExecutionResult,
  loadRealPolicyEmbeddingPreparationRunsForExecution,
  loadRealPolicyEmbeddingExecutionRun,
  loadRealPolicyEmbeddingExecutionItems,
  loadRealPolicyEmbeddingExecutionRuns,
  REAL_POLICY_EMBEDDING_EXECUTION_STATUS_LABELS,
  REAL_POLICY_EMBEDDING_EXECUTION_ITEM_STATUS_LABELS,
  REAL_POLICY_EMBEDDING_EXECUTION_MISSING_LABELS,
} from "../lib/realPolicyEmbeddingExecution.js";

const FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

const ITEM_STATUSES = Object.keys(REAL_POLICY_EMBEDDING_EXECUTION_ITEM_STATUS_LABELS);

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
  return REAL_POLICY_EMBEDDING_EXECUTION_MISSING_LABELS[code] ?? code;
}

function executionStatusLabel(status) {
  return REAL_POLICY_EMBEDDING_EXECUTION_STATUS_LABELS[status] ?? status;
}

function itemStatusLabel(status) {
  return REAL_POLICY_EMBEDDING_EXECUTION_ITEM_STATUS_LABELS[status] ?? status;
}

export default function AdminRealPolicyEmbeddingExecutionPanel() {
  const [prepRuns, setPrepRuns] = useState([]);
  const [executionRuns, setExecutionRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [storing, setStoring] = useState(false);
  const [error, setError] = useState("");
  const [prepareResult, setPrepareResult] = useState(null);
  const [storeResult, setStoreResult] = useState(null);
  const [run, setRun] = useState(null);
  const [items, setItems] = useState([]);

  const [preparationRunId, setPreparationRunId] = useState("");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [vectorReference, setVectorReference] = useState("");
  const [itemStatus, setItemStatus] = useState("embedded");
  const [errorMessage, setErrorMessage] = useState("");

  const loadPrepRuns = useCallback(async () => {
    try {
      const rows = await loadRealPolicyEmbeddingPreparationRunsForExecution();
      setPrepRuns(rows);
      if (rows.length && !preparationRunId) {
        setPreparationRunId(rows[0].id);
      }
    } catch (err) {
      setError(err.message);
      setPrepRuns([]);
    }
  }, [preparationRunId]);

  const loadExecutionRuns = useCallback(async () => {
    try {
      const rows = await loadRealPolicyEmbeddingExecutionRuns();
      setExecutionRuns(rows);
    } catch (err) {
      setExecutionRuns([]);
    }
  }, []);

  const loadInitialData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await Promise.all([loadPrepRuns(), loadExecutionRuns()]);
    } finally {
      setLoading(false);
    }
  }, [loadPrepRuns, loadExecutionRuns]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  const refreshRun = async (runId) => {
    const [runRow, itemRows] = await Promise.all([
      loadRealPolicyEmbeddingExecutionRun(runId),
      loadRealPolicyEmbeddingExecutionItems(runId),
    ]);
    setRun(runRow);
    setItems(itemRows);
    if (itemRows.length && !selectedItemId) {
      setSelectedItemId(itemRows[0].id);
    }
  };

  const selectedPrepRun = prepRuns.find((row) => row.id === preparationRunId) ?? null;

  const activeRunId = prepareResult?.realPolicyEmbeddingExecutionRunId ?? run?.id ?? null;
  const displayStatus = storeResult?.executionStatus ?? run?.execution_status ?? prepareResult?.executionStatus ?? null;
  const displayQueued = run?.queued_chunk_count ?? prepareResult?.queuedChunkCount ?? 0;
  const displayProcessed = storeResult?.processedChunkCount ?? run?.processed_chunk_count ?? 0;
  const displayFailed = storeResult?.failedChunkCount ?? run?.failed_chunk_count ?? 0;
  const missingInformation = run?.missing_information ?? prepareResult?.missingInformation ?? storeResult?.missingInformation ?? [];
  const displayError = run?.error_message ?? "";
  const genericRunId = run?.embedding_execution_run_id ?? prepareResult?.embeddingExecutionRunId ?? null;

  const handlePrepare = async () => {
    if (!preparationRunId) {
      setError("Preparation Run을 선택해 주세요.");
      return;
    }
    setPreparing(true);
    setError("");
    setPrepareResult(null);
    setStoreResult(null);
    try {
      const data = await prepareRealPolicyEmbeddingExecution(preparationRunId);
      setPrepareResult(data);
      if (data.realPolicyEmbeddingExecutionRunId) {
        await refreshRun(data.realPolicyEmbeddingExecutionRunId);
      }
      await loadExecutionRuns();
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
    if (itemStatus === "embedded" && !vectorReference.trim()) {
      setError("Vector Reference를 입력해 주세요.");
      return;
    }
    setStoring(true);
    setError("");
    setStoreResult(null);
    try {
      const data = await storeRealPolicyEmbeddingExecutionResult({
        realPolicyEmbeddingExecutionItemId: selectedItemId,
        vectorReference,
        itemStatus,
        errorMessage,
      });
      setStoreResult(data);
      if (activeRunId) {
        await refreshRun(activeRunId);
      }
      await loadExecutionRuns();
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
          실제 약관 Embedding 실행
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: "15px", color: "#94a3b8", lineHeight: 1.55 }}>
          준비된 실제 약관 청크만 범위 제한 실행합니다. 외부 Embedding API·가짜 벡터 없음.
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
          실행 준비
        </h2>
        <div style={{ display: "grid", gap: "12px", maxWidth: "720px" }}>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Preparation Run
            <select
              value={preparationRunId}
              onChange={(e) => setPreparationRunId(e.target.value)}
              disabled={loading}
              style={{ ...S.input, marginTop: "6px" }}
            >
              <option value="">(선택)</option>
              {prepRuns.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.chunk_run?.pdf?.file_name ?? row.id.slice(0, 8)} — queued {row.queued_chunk_count}
                </option>
              ))}
            </select>
          </label>
          {selectedPrepRun ? (
            <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
              <div>Provider: {selectedPrepRun.embedding_provider}</div>
              <div>Model: {selectedPrepRun.embedding_model}</div>
              <div>Queued Chunks: {selectedPrepRun.queued_chunk_count}</div>
            </div>
          ) : null}
          <button
            type="button"
            style={{ ...S.btn, opacity: preparing ? 0.6 : 1, maxWidth: "280px" }}
            disabled={preparing || loading || !preparationRunId}
            onClick={handlePrepare}
          >
            {preparing ? "준비 중…" : "실행 Run 준비"}
          </button>
        </div>
      </section>

      {prepareResult || run ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            실행 상태
          </h2>
          <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
            <div>Preparation Run: {run?.real_embedding_preparation_run_id ?? preparationRunId ?? "—"}</div>
            <div>Generic Execution Run: {genericRunId ?? "—"}</div>
            <div>Provider: {run?.embedding_provider ?? selectedPrepRun?.embedding_provider ?? "—"}</div>
            <div>Model: {run?.embedding_model ?? selectedPrepRun?.embedding_model ?? "—"}</div>
            <div>Execution Status: {executionStatusLabel(displayStatus) || "—"}</div>
            <div>Queued Chunks: {displayQueued}</div>
            <div>Processed Chunks: {displayProcessed}</div>
            <div>Failed Chunks: {displayFailed}</div>
            {displayError ? <div>Error Message: {displayError}</div> : null}
          </div>
        </section>
      ) : null}

      {items.length ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 16px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            결과 저장
          </h2>
          <div style={{ display: "grid", gap: "12px", maxWidth: "720px" }}>
            <label style={{ fontSize: "13px", color: "#94a3b8" }}>
              Execution Item
              <select
                value={selectedItemId}
                onChange={(e) => setSelectedItemId(e.target.value)}
                style={{ ...S.input, marginTop: "6px" }}
              >
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {itemStatusLabel(item.item_status)} · chunk {item.chunk_registry_id?.slice(0, 8) ?? "—"}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: "13px", color: "#94a3b8" }}>
              Item Status
              <select
                value={itemStatus}
                onChange={(e) => setItemStatus(e.target.value)}
                style={{ ...S.input, marginTop: "6px" }}
              >
                {ITEM_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {itemStatusLabel(status)}
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
                placeholder="벡터 참조 ID (metadata only)"
                style={{ ...S.input, marginTop: "6px" }}
              />
            </label>
            <label style={{ fontSize: "13px", color: "#94a3b8" }}>
              Error Message
              <input
                type="text"
                value={errorMessage}
                onChange={(e) => setErrorMessage(e.target.value)}
                placeholder="실패 시 오류 메시지"
                style={{ ...S.input, marginTop: "6px" }}
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
              disabled={storing || !selectedItemId}
              onClick={handleStore}
            >
              {storing ? "저장 중…" : "실행 결과 저장"}
            </button>
          </div>
          {storeResult ? (
            <div style={{ marginTop: "16px", fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
              <div>Item Status: {itemStatusLabel(storeResult.itemStatus)}</div>
              <div>Vector Reference: {storeResult.vectorReference ?? "—"}</div>
            </div>
          ) : null}
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

      {executionRuns.length ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            실행 Run 목록 ({executionRuns.length})
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {executionRuns.map((execRun) => (
              <div
                key={execRun.id}
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
                  {execRun.embedding_provider} / {execRun.embedding_model}
                </div>
                <div style={{ marginTop: "6px", color: "#94a3b8", lineHeight: 1.6 }}>
                  <div>Execution Status: {executionStatusLabel(execRun.execution_status)}</div>
                  <div>Generic Run: {execRun.embedding_execution_run_id}</div>
                  <div>Queued: {execRun.queued_chunk_count} · Processed: {execRun.processed_chunk_count} · Failed: {execRun.failed_chunk_count}</div>
                  {execRun.error_message ? <div>Error: {execRun.error_message}</div> : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
