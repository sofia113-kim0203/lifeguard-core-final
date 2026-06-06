import { useCallback, useEffect, useState } from "react";
import {
  loadCustomersForGroundingTest,
  prepareCustomerAiConversation,
  executeCustomerAiConversation,
  loadCustomerAiConversationRun,
  loadCustomerAiConversationResponses,
  AI_CONVERSATION_EXECUTION_STATUS_LABELS,
  AI_CONVERSATION_RESPONSE_STATUS_LABELS,
  AI_CONVERSATION_MISSING_LABELS,
} from "../lib/customerAiConversationExecution.js";

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
  return AI_CONVERSATION_MISSING_LABELS[code] ?? code;
}

function executionStatusLabel(status) {
  return AI_CONVERSATION_EXECUTION_STATUS_LABELS[status] ?? status;
}

function responseStatusLabel(status) {
  return AI_CONVERSATION_RESPONSE_STATUS_LABELS[status] ?? status;
}

export default function AdminCustomerAiConversationExecutionPanel() {
  const [customers, setCustomers] = useState([]);
  const [responses, setResponses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState("");
  const [prepareResult, setPrepareResult] = useState(null);
  const [executeResult, setExecuteResult] = useState(null);
  const [run, setRun] = useState(null);

  const [customerId, setCustomerId] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [query, setQuery] = useState("");

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await loadCustomersForGroundingTest();
      setCustomers(rows);
      if (rows.length && !customerId) {
        setCustomerId(rows[0].id);
      }
    } catch (err) {
      setError(err.message);
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  const selectedCustomer = customers.find((row) => row.id === customerId) ?? null;
  const activeRunId = run?.id ?? prepareResult?.aiConversationRunId ?? null;

  const refreshRun = async (runId) => {
    const [runRow, responseRows] = await Promise.all([
      loadCustomerAiConversationRun(runId),
      loadCustomerAiConversationResponses(runId),
    ]);
    setRun(runRow);
    setResponses(responseRows);
  };

  const handlePrepare = async () => {
    if (!customerId) {
      setError("고객을 선택해 주세요.");
      return;
    }
    if (!conversationId.trim()) {
      setError("Conversation ID를 입력해 주세요.");
      return;
    }
    if (!query.trim()) {
      setError("Query를 입력해 주세요.");
      return;
    }
    setPreparing(true);
    setError("");
    setPrepareResult(null);
    setExecuteResult(null);
    try {
      const data = await prepareCustomerAiConversation({
        customerId,
        conversationId: conversationId.trim(),
        query,
      });
      setPrepareResult(data);
      if (data.aiConversationRunId) {
        await refreshRun(data.aiConversationRunId);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setPreparing(false);
    }
  };

  const handleExecute = async () => {
    if (!activeRunId) {
      setError("먼저 AI 대화를 준비해 주세요.");
      return;
    }
    setExecuting(true);
    setError("");
    setExecuteResult(null);
    try {
      const data = await executeCustomerAiConversation(activeRunId);
      setExecuteResult(data);
      await refreshRun(activeRunId);
    } catch (err) {
      setError(err.message);
    } finally {
      setExecuting(false);
    }
  };

  const missingInfo = [
    ...(Array.isArray(run?.missing_information) ? run.missing_information : []),
    ...(prepareResult?.missingInformation ?? []),
  ].filter((value, index, arr) => arr.indexOf(value) === index);

  const responsePreview =
    run?.response_preview ??
    executeResult?.responsePreview?.answer_preview ??
    responses[responses.length - 1]?.response_text ??
    "";

  return (
    <div style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#f8fafc" }}>
          고객 AI 대화 실행 관리
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: "15px", color: "#94a3b8", lineHeight: 1.55 }}>
          Grounded 대화 컨텍스트를 Claude 실행 준비·응답 저장까지 연결합니다. Claude 호출은 서버에서만 수행됩니다.
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
          AI 대화 준비
        </h2>
        <div style={{ display: "grid", gap: "12px", maxWidth: "720px" }}>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Customer
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              disabled={loading}
              style={{ ...S.input, marginTop: "6px" }}
            >
              {customers.length === 0 ? (
                <option value="">등록된 고객 없음</option>
              ) : (
                customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.display_name ?? customer.id}
                  </option>
                ))
              )}
            </select>
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Conversation ID
            <input
              type="text"
              value={conversationId}
              onChange={(e) => setConversationId(e.target.value)}
              placeholder="UUID"
              style={{ ...S.input, marginTop: "6px" }}
            />
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Query
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="예: 암 보장 범위가 어떻게 되나요?"
              style={{ ...S.input, marginTop: "6px" }}
            />
          </label>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <button
              type="button"
              style={{ ...S.btn, opacity: preparing ? 0.6 : 1, maxWidth: "280px" }}
              disabled={preparing || loading || !customerId}
              onClick={handlePrepare}
            >
              {preparing ? "준비 중…" : "AI 대화 준비"}
            </button>
            <button
              type="button"
              style={{
                ...S.btn,
                opacity: executing ? 0.6 : 1,
                maxWidth: "280px",
                background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
              }}
              disabled={executing || !activeRunId}
              onClick={handleExecute}
            >
              {executing ? "실행 중…" : "Claude 실행 (서버)"}
            </button>
          </div>
        </div>
      </section>

      {run || prepareResult ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            실행 결과
          </h2>
          <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
            <div>Customer: {selectedCustomer?.display_name ?? customerId ?? "—"}</div>
            <div>Conversation ID: {run?.conversation_id ?? conversationId ?? "—"}</div>
            <div>Query: {run?.query ?? query ?? "—"}</div>
            <div>
              Execution Status:{" "}
              {executionStatusLabel(
                run?.execution_status ?? executeResult?.executionStatus ?? prepareResult?.executionStatus,
              )}
            </div>
            <div>
              Claude Execution Run:{" "}
              {run?.claude_execution_run_id ?? prepareResult?.claudeExecutionRunId ?? "—"}
            </div>
            <div>
              Response Status:{" "}
              {responseStatusLabel(
                run?.response_status ?? executeResult?.responseStatus ?? "pending",
              )}
            </div>
            {missingInfo.length ? (
              <div style={{ marginTop: "8px" }}>
                Missing Information: {missingInfo.map(missingLabel).join(", ")}
              </div>
            ) : null}
            <div style={{ marginTop: "12px" }}>
              <div style={{ marginBottom: "6px" }}>Response Preview:</div>
              <pre
                style={{
                  margin: 0,
                  padding: "12px",
                  borderRadius: "10px",
                  background: "rgba(15, 23, 42, 0.5)",
                  color: "#cbd5e1",
                  fontSize: "12px",
                  overflow: "auto",
                  whiteSpace: "pre-wrap",
                }}
              >
                {responsePreview || "(응답 없음)"}
              </pre>
            </div>
          </div>
        </section>
      ) : null}

      {responses.length ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            Stored Responses ({responses.length})
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {responses.map((response) => (
              <div
                key={response.id}
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
                  {responseStatusLabel(response.response_status)} · Sources:{" "}
                  {response.response_source_count}
                </div>
                <div style={{ marginTop: "6px", color: "#94a3b8", whiteSpace: "pre-wrap" }}>
                  {response.response_text}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
