import { useCallback, useEffect, useState } from "react";
import {
  loadCustomersForGroundingTest,
  captureCustomerConversationMemory,
  prepareCustomerConversationMemoryContext,
  loadConversationMemoryItems,
  loadConversationMemoryRun,
  CONVERSATION_MEMORY_TYPES,
  MESSAGE_ROLES,
  CONVERSATION_MEMORY_RUN_STATUS_LABELS,
  CONVERSATION_MEMORY_ITEM_TYPE_LABELS,
  CONVERSATION_MEMORY_ITEM_STATUS_LABELS,
  CONVERSATION_MEMORY_MISSING_LABELS,
} from "../lib/customerConversationMemory.js";

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
  return CONVERSATION_MEMORY_MISSING_LABELS[code] ?? code;
}

function runStatusLabel(status) {
  return CONVERSATION_MEMORY_RUN_STATUS_LABELS[status] ?? status;
}

function itemTypeLabel(type) {
  return CONVERSATION_MEMORY_ITEM_TYPE_LABELS[type] ?? type;
}

function itemStatusLabel(status) {
  return CONVERSATION_MEMORY_ITEM_STATUS_LABELS[status] ?? status;
}

export default function AdminCustomerConversationMemoryPanel() {
  const [customers, setCustomers] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const [captureResult, setCaptureResult] = useState(null);
  const [contextResult, setContextResult] = useState(null);
  const [run, setRun] = useState(null);

  const [customerId, setCustomerId] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [messageRole, setMessageRole] = useState("user");
  const [messageText, setMessageText] = useState("");
  const [memoryType, setMemoryType] = useState("conversation");
  const [memoryTitle, setMemoryTitle] = useState("");

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

  const refreshItems = useCallback(async () => {
    if (!customerId || !conversationId.trim()) {
      setItems([]);
      return;
    }
    try {
      const rows = await loadConversationMemoryItems({
        customerId,
        conversationId: conversationId.trim(),
      });
      setItems(rows);
    } catch (err) {
      setError(err.message);
      setItems([]);
    }
  }, [customerId, conversationId]);

  useEffect(() => {
    refreshItems();
  }, [refreshItems]);

  const selectedCustomer = customers.find((row) => row.id === customerId) ?? null;

  const handleCapture = async () => {
    if (!customerId) {
      setError("고객을 선택해 주세요.");
      return;
    }
    if (!conversationId.trim()) {
      setError("Conversation ID를 입력해 주세요.");
      return;
    }
    if (!messageText.trim()) {
      setError("Message Text를 입력해 주세요.");
      return;
    }
    if (!memoryTitle.trim()) {
      setError("Memory Title을 입력해 주세요.");
      return;
    }
    setCapturing(true);
    setError("");
    setCaptureResult(null);
    try {
      const data = await captureCustomerConversationMemory({
        customerId,
        conversationId: conversationId.trim(),
        messageRole,
        messageText,
        memoryType,
        memoryTitle,
      });
      setCaptureResult(data);
      await refreshItems();
      if (data.conversationMemoryRunId) {
        const runRow = await loadConversationMemoryRun(data.conversationMemoryRunId);
        setRun(runRow);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setCapturing(false);
    }
  };

  const handlePrepareContext = async () => {
    if (!customerId) {
      setError("고객을 선택해 주세요.");
      return;
    }
    if (!conversationId.trim()) {
      setError("Conversation ID를 입력해 주세요.");
      return;
    }
    setPreparing(true);
    setError("");
    setContextResult(null);
    try {
      const data = await prepareCustomerConversationMemoryContext({
        customerId,
        conversationId: conversationId.trim(),
      });
      setContextResult(data);
      if (data.conversationMemoryRunId) {
        const runRow = await loadConversationMemoryRun(data.conversationMemoryRunId);
        setRun(runRow);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setPreparing(false);
    }
  };

  const missingInfo = [
    ...(Array.isArray(run?.missing_information) ? run.missing_information : []),
    ...(captureResult?.missingInformation ?? []),
    ...(contextResult?.missingInformation ?? []),
  ].filter((value, index, arr) => arr.indexOf(value) === index);

  return (
    <div style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#f8fafc" }}>
          고객 대화 메모리 관리
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: "15px", color: "#94a3b8", lineHeight: 1.55 }}>
          고객 대화를 메모리 레지스트리에 저장·준비합니다. 요약·추천·심사·Claude 호출 없음.
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
          대화 메모리 캡처
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
            Message Role
            <select
              value={messageRole}
              onChange={(e) => setMessageRole(e.target.value)}
              style={{ ...S.input, marginTop: "6px" }}
            >
              {MESSAGE_ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Message Text
            <textarea
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              rows={4}
              style={{ ...S.input, marginTop: "6px", resize: "vertical" }}
            />
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Memory Type
            <select
              value={memoryType}
              onChange={(e) => setMemoryType(e.target.value)}
              style={{ ...S.input, marginTop: "6px" }}
            >
              {CONVERSATION_MEMORY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {itemTypeLabel(type)} ({type})
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Memory Title
            <input
              type="text"
              value={memoryTitle}
              onChange={(e) => setMemoryTitle(e.target.value)}
              style={{ ...S.input, marginTop: "6px" }}
            />
          </label>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <button
              type="button"
              style={{ ...S.btn, opacity: capturing ? 0.6 : 1, maxWidth: "280px" }}
              disabled={capturing || loading || !customerId}
              onClick={handleCapture}
            >
              {capturing ? "캡처 중…" : "메모리 캡처"}
            </button>
            <button
              type="button"
              style={{ ...S.btn, opacity: preparing ? 0.6 : 1, maxWidth: "280px" }}
              disabled={preparing || loading || !customerId}
              onClick={handlePrepareContext}
            >
              {preparing ? "준비 중…" : "대화 컨텍스트 준비"}
            </button>
          </div>
        </div>
      </section>

      {run || captureResult || contextResult ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            현황
          </h2>
          <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
            <div>Customer: {selectedCustomer?.display_name ?? customerId ?? "—"}</div>
            <div>Conversation ID: {conversationId || run?.conversation_id || "—"}</div>
            <div>
              Memory Status:{" "}
              {itemStatusLabel(captureResult?.memoryStatus) ||
                runStatusLabel(run?.memory_status ?? contextResult?.memoryStatus)}
            </div>
            <div>
              Message Count: {run?.message_count ?? contextResult?.messageCount ?? items.length}
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
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            대화 메모리 항목 ({items.length})
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {items.map((item) => (
              <div
                key={item.id}
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
                  {item.message_role} · {itemTypeLabel(item.memory_type)} ·{" "}
                  {itemStatusLabel(item.memory_status)}
                </div>
                <div style={{ marginTop: "4px", color: "#94a3b8" }}>
                  Title: {item.memory_title}
                </div>
                <div style={{ marginTop: "4px", color: "#94a3b8" }}>
                  Text: {item.message_text}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
