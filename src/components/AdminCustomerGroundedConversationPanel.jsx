import { useCallback, useEffect, useState } from "react";
import {
  loadCustomersForGroundingTest,
  prepareCustomerGroundedConversation,
  loadCustomerGroundedConversationRun,
  loadCustomerGroundedConversationSources,
  GROUNDED_CONVERSATION_RUN_STATUS_LABELS,
  GROUNDED_CONVERSATION_SOURCE_TYPE_LABELS,
  GROUNDED_CONVERSATION_SOURCE_STATUS_LABELS,
  GROUNDED_CONVERSATION_MISSING_LABELS,
} from "../lib/customerGroundedConversation.js";

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
  return GROUNDED_CONVERSATION_MISSING_LABELS[code] ?? code;
}

function runStatusLabel(status) {
  return GROUNDED_CONVERSATION_RUN_STATUS_LABELS[status] ?? status;
}

function sourceTypeLabel(type) {
  return GROUNDED_CONVERSATION_SOURCE_TYPE_LABELS[type] ?? type;
}

function sourceStatusLabel(status) {
  return GROUNDED_CONVERSATION_SOURCE_STATUS_LABELS[status] ?? status;
}

function contextPreview(summary) {
  if (!summary || typeof summary !== "object") return "";
  const text = JSON.stringify(summary, null, 2);
  return text.length > 800 ? `${text.slice(0, 800)}…` : text;
}

export default function AdminCustomerGroundedConversationPanel() {
  const [customers, setCustomers] = useState([]);
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const [prepareResult, setPrepareResult] = useState(null);
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

  const refreshRun = async (runId) => {
    const [runRow, sourceRows] = await Promise.all([
      loadCustomerGroundedConversationRun(runId),
      loadCustomerGroundedConversationSources(runId),
    ]);
    setRun(runRow);
    setSources(sourceRows);
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
    try {
      const data = await prepareCustomerGroundedConversation({
        customerId,
        conversationId: conversationId.trim(),
        query,
      });
      setPrepareResult(data);
      if (data.groundedConversationRunId) {
        await refreshRun(data.groundedConversationRunId);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setPreparing(false);
    }
  };

  const contextSummary =
    run?.context_summary ?? prepareResult?.contextSummary ?? {};
  const missingInfo = [
    ...(Array.isArray(run?.missing_information) ? run.missing_information : []),
    ...(prepareResult?.missingInformation ?? []),
  ].filter((value, index, arr) => arr.indexOf(value) === index);

  return (
    <div style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#f8fafc" }}>
          고객 Grounded 대화 관리
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: "15px", color: "#94a3b8", lineHeight: 1.55 }}>
          고객 메모리·대화 메모리·그라운딩·Claude 준비 파이프라인을 연결합니다. Claude 실행·답변 생성 없음.
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
          Grounded 대화 준비
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
          <button
            type="button"
            style={{ ...S.btn, opacity: preparing ? 0.6 : 1, maxWidth: "280px" }}
            disabled={preparing || loading || !customerId}
            onClick={handlePrepare}
          >
            {preparing ? "준비 중…" : "Grounded 대화 준비"}
          </button>
        </div>
      </section>

      {run || prepareResult ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            준비 결과
          </h2>
          <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
            <div>Customer: {selectedCustomer?.display_name ?? customerId ?? "—"}</div>
            <div>Conversation ID: {run?.conversation_id ?? conversationId ?? "—"}</div>
            <div>Query: {run?.query ?? query ?? "—"}</div>
            <div>Memory Count: {run?.memory_count ?? prepareResult?.memoryCount ?? 0}</div>
            <div>
              Conversation Memory Count:{" "}
              {run?.conversation_memory_count ?? prepareResult?.conversationMemoryCount ?? 0}
            </div>
            <div>
              Grounding Source Count:{" "}
              {run?.grounding_source_count ?? prepareResult?.groundingSourceCount ?? 0}
            </div>
            <div>
              Claude Grounding Ready:{" "}
              {(run?.claude_grounding_ready ?? prepareResult?.claudeGroundingReady) ? "예" : "아니오"}
            </div>
            <div>
              Run Status: {runStatusLabel(run?.run_status ?? prepareResult?.runStatus)}
            </div>
            {missingInfo.length ? (
              <div style={{ marginTop: "8px" }}>
                Missing Information: {missingInfo.map(missingLabel).join(", ")}
              </div>
            ) : null}
            <div style={{ marginTop: "12px" }}>
              <div style={{ marginBottom: "6px" }}>Context Summary:</div>
              <pre
                style={{
                  margin: 0,
                  padding: "12px",
                  borderRadius: "10px",
                  background: "rgba(15, 23, 42, 0.5)",
                  color: "#cbd5e1",
                  fontSize: "11px",
                  overflow: "auto",
                  whiteSpace: "pre-wrap",
                }}
              >
                {contextPreview(contextSummary)}
              </pre>
            </div>
          </div>
        </section>
      ) : null}

      {sources.length ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            Sources ({sources.length})
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {sources.map((source) => (
              <div
                key={source.id}
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
                  {sourceTypeLabel(source.source_type)} · {sourceStatusLabel(source.source_status)}
                </div>
                <div style={{ marginTop: "4px", color: "#94a3b8" }}>
                  Reference: {source.source_reference}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
