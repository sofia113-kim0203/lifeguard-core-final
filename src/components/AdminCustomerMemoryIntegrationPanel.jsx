import { useCallback, useEffect, useState } from "react";
import {
  loadCustomersForGroundingTest,
  registerCustomerMemory,
  prepareCustomerMemoryContext,
  loadCustomerMemories,
  loadCustomerMemoryContextRun,
  MEMORY_TYPES,
  MEMORY_TYPE_LABELS,
  MEMORY_STATUS_LABELS,
  MEMORY_CONTEXT_STATUS_LABELS,
  MEMORY_MISSING_LABELS,
} from "../lib/customerMemoryIntegration.js";

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
  return MEMORY_MISSING_LABELS[code] ?? code;
}

function memoryTypeLabel(type) {
  return MEMORY_TYPE_LABELS[type] ?? type;
}

function memoryStatusLabel(status) {
  return MEMORY_STATUS_LABELS[status] ?? status;
}

function contextStatusLabel(status) {
  return MEMORY_CONTEXT_STATUS_LABELS[status] ?? status;
}

export default function AdminCustomerMemoryIntegrationPanel() {
  const [customers, setCustomers] = useState([]);
  const [memories, setMemories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const [registerResult, setRegisterResult] = useState(null);
  const [contextResult, setContextResult] = useState(null);
  const [contextRun, setContextRun] = useState(null);

  const [customerId, setCustomerId] = useState("");
  const [memoryType, setMemoryType] = useState("profile");
  const [memoryTitle, setMemoryTitle] = useState("");
  const [memoryContent, setMemoryContent] = useState("");
  const [memorySource, setMemorySource] = useState("");

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

  const refreshMemories = useCallback(async () => {
    if (!customerId) {
      setMemories([]);
      return;
    }
    try {
      const rows = await loadCustomerMemories(customerId);
      setMemories(rows);
    } catch (err) {
      setError(err.message);
      setMemories([]);
    }
  }, [customerId]);

  useEffect(() => {
    refreshMemories();
  }, [refreshMemories]);

  const selectedCustomer = customers.find((row) => row.id === customerId) ?? null;

  const handleRegister = async () => {
    if (!customerId) {
      setError("고객을 선택해 주세요.");
      return;
    }
    if (!memoryTitle.trim()) {
      setError("메모리 제목을 입력해 주세요.");
      return;
    }
    if (!memoryContent.trim()) {
      setError("메모리 내용을 입력해 주세요.");
      return;
    }
    setRegistering(true);
    setError("");
    setRegisterResult(null);
    try {
      const data = await registerCustomerMemory({
        customerId,
        memoryType,
        memoryTitle,
        memoryContent,
        memorySource,
      });
      setRegisterResult(data);
      await refreshMemories();
    } catch (err) {
      setError(err.message);
    } finally {
      setRegistering(false);
    }
  };

  const handlePrepareContext = async () => {
    if (!customerId) {
      setError("고객을 선택해 주세요.");
      return;
    }
    setPreparing(true);
    setError("");
    setContextResult(null);
    try {
      const data = await prepareCustomerMemoryContext({ customerId });
      setContextResult(data);
      if (data.memoryContextRunId) {
        const run = await loadCustomerMemoryContextRun(data.memoryContextRunId);
        setContextRun(run);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setPreparing(false);
    }
  };

  const missingInfo = [
    ...(Array.isArray(contextRun?.missing_information) ? contextRun.missing_information : []),
    ...(contextResult?.missingInformation ?? []),
  ].filter((value, index, arr) => arr.indexOf(value) === index);

  return (
    <div style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#f8fafc" }}>
          고객 메모리 관리
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: "15px", color: "#94a3b8", lineHeight: 1.55 }}>
          고객 프로필·대화 메모리·그라운딩 컨텍스트를 연결합니다. AI 답변·추천·심사 결정 없음.
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
          메모리 등록
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
            Memory Type
            <select
              value={memoryType}
              onChange={(e) => setMemoryType(e.target.value)}
              style={{ ...S.input, marginTop: "6px" }}
            >
              {MEMORY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {memoryTypeLabel(type)} ({type})
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
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Memory Content
            <textarea
              value={memoryContent}
              onChange={(e) => setMemoryContent(e.target.value)}
              rows={4}
              style={{ ...S.input, marginTop: "6px", resize: "vertical" }}
            />
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Source
            <input
              type="text"
              value={memorySource}
              onChange={(e) => setMemorySource(e.target.value)}
              placeholder="예: manual_entry"
              style={{ ...S.input, marginTop: "6px" }}
            />
          </label>
          <button
            type="button"
            style={{ ...S.btn, opacity: registering ? 0.6 : 1, maxWidth: "280px" }}
            disabled={registering || loading || !customerId}
            onClick={handleRegister}
          >
            {registering ? "등록 중…" : "메모리 등록"}
          </button>
        </div>
      </section>

      <section style={S.card}>
        <h2 style={{ margin: "0 0 16px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
          컨텍스트 준비
        </h2>
        <button
          type="button"
          style={{ ...S.btn, opacity: preparing ? 0.6 : 1, maxWidth: "280px" }}
          disabled={preparing || loading || !customerId}
          onClick={handlePrepareContext}
        >
          {preparing ? "준비 중…" : "메모리 컨텍스트 준비"}
        </button>
      </section>

      {registerResult || contextResult || contextRun ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            현황
          </h2>
          <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
            <div>Customer: {selectedCustomer?.display_name ?? customerId ?? "—"}</div>
            {registerResult ? (
              <div>Status: {memoryStatusLabel(registerResult.memoryStatus)}</div>
            ) : null}
            <div>
              Context Status:{" "}
              {contextStatusLabel(contextRun?.context_status ?? contextResult?.contextStatus)}
            </div>
            <div>
              Memory Count: {contextRun?.memory_count ?? contextResult?.memoryCount ?? memories.length}
            </div>
            <div>
              Grounding Source Count:{" "}
              {contextRun?.grounding_source_count ?? contextResult?.groundingSourceCount ?? 0}
            </div>
            {missingInfo.length ? (
              <div style={{ marginTop: "8px" }}>
                Missing Information: {missingInfo.map(missingLabel).join(", ")}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {memories.length ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            등록된 메모리 ({memories.length})
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {memories.map((memory) => (
              <div
                key={memory.id}
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
                  {memoryTypeLabel(memory.memory_type)} · {memory.memory_title}
                </div>
                <div style={{ marginTop: "4px", color: "#94a3b8" }}>
                  Source: {memory.memory_source ?? "—"} · Status:{" "}
                  {memoryStatusLabel(memory.memory_status)}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
