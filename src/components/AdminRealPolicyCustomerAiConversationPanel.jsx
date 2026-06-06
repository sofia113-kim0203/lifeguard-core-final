import { useCallback, useEffect, useState } from "react";
import {
  loadRealPolicyPdfRegistry,
  loadCarriersForManualKnowledge,
  loadProductsForManualKnowledge,
  loadCustomersForGroundingTest,
  prepareCustomerRealPolicyAiConversation,
  loadCustomerAiConversationRun,
  REAL_POLICY_CUSTOMER_AI_MISSING_LABELS,
} from "../lib/realPolicyCustomerAiConversation.js";
import {
  executeCustomerAiConversation,
  loadCustomerAiConversationResponses,
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
  return REAL_POLICY_CUSTOMER_AI_MISSING_LABELS[code] ?? code;
}

export default function AdminRealPolicyCustomerAiConversationPanel() {
  const [pdfs, setPdfs] = useState([]);
  const [carriers, setCarriers] = useState([]);
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState("");
  const [prepareResult, setPrepareResult] = useState(null);
  const [executeResult, setExecuteResult] = useState(null);
  const [responses, setResponses] = useState([]);
  const [run, setRun] = useState(null);

  const [policyPdfId, setPolicyPdfId] = useState("");
  const [carrierId, setCarrierId] = useState("");
  const [productId, setProductId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [query, setQuery] = useState("");

  const loadInitialData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [pdfRows, carrierRows, customerRows] = await Promise.all([
        loadRealPolicyPdfRegistry(),
        loadCarriersForManualKnowledge(),
        loadCustomersForGroundingTest(),
      ]);
      setPdfs(pdfRows);
      setCarriers(carrierRows);
      setCustomers(customerRows);
      if (pdfRows.length && !policyPdfId) {
        setPolicyPdfId(pdfRows[0].id);
        setCarrierId(pdfRows[0].carrier_id ?? "");
        setProductId(pdfRows[0].product_id ?? "");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [policyPdfId]);

  const loadProducts = useCallback(async (nextCarrierId) => {
    if (!nextCarrierId) {
      setProducts([]);
      return;
    }
    try {
      const rows = await loadProductsForManualKnowledge(nextCarrierId);
      setProducts(rows);
    } catch (err) {
      setProducts([]);
    }
  }, []);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  useEffect(() => {
    loadProducts(carrierId);
  }, [carrierId, loadProducts]);

  const handlePdfChange = (nextPdfId) => {
    setPolicyPdfId(nextPdfId);
    const pdf = pdfs.find((row) => row.id === nextPdfId);
    if (pdf) {
      setCarrierId(pdf.carrier_id ?? "");
      setProductId(pdf.product_id ?? "");
    }
  };

  const activeRunId = run?.id ?? prepareResult?.customerAiConversationRunId ?? null;

  const refreshRun = async (runId) => {
    const [runRow, responseRows] = await Promise.all([
      loadCustomerAiConversationRun(runId),
      loadCustomerAiConversationResponses(runId),
    ]);
    setRun(runRow);
    setResponses(responseRows);
  };

  const handlePrepare = async () => {
    setPreparing(true);
    setError("");
    setPrepareResult(null);
    setExecuteResult(null);
    setRun(null);
    setResponses([]);
    try {
      const data = await prepareCustomerRealPolicyAiConversation({
        customerId,
        conversationId,
        policyPdfId: policyPdfId || null,
        carrierId: carrierId || null,
        productId: productId || null,
        query,
      });
      setPrepareResult(data);
      if (data.customerAiConversationRunId) {
        await refreshRun(data.customerAiConversationRunId);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setPreparing(false);
    }
  };

  const handleExecute = async () => {
    if (!activeRunId) {
      setError("먼저 AI 답변을 준비해 주세요.");
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

  const selectedPdf = pdfs.find((row) => row.id === policyPdfId);
  const responsePreview =
    run?.response_preview ??
    executeResult?.responsePreview?.answer_preview ??
    responses[responses.length - 1]?.response_text ??
    "";

  return (
    <div style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#f8fafc" }}>
          실제 약관 고객 AI 답변 준비
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: "15px", color: "#94a3b8", lineHeight: 1.55 }}>
          실제 약관 범위 → Grounding → Claude Grounding → Claude Execution → Customer AI Run
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
          입력
        </h2>
        <div style={{ display: "grid", gap: "12px", maxWidth: "720px" }}>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Policy PDF
            <select
              value={policyPdfId}
              onChange={(e) => handlePdfChange(e.target.value)}
              disabled={loading}
              style={{ ...S.input, marginTop: "6px" }}
            >
              <option value="">(선택)</option>
              {pdfs.map((pdf) => (
                <option key={pdf.id} value={pdf.id}>
                  {pdf.file_name ?? pdf.id} · v{pdf.file_version ?? "—"}
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Carrier
            <select
              value={carrierId}
              onChange={(e) => setCarrierId(e.target.value)}
              disabled={loading}
              style={{ ...S.input, marginTop: "6px" }}
            >
              <option value="">(선택)</option>
              {carriers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.carrier_name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Product
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              disabled={!carrierId}
              style={{ ...S.input, marginTop: "6px" }}
            >
              <option value="">(전체)</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.product_name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Customer
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              disabled={loading}
              style={{ ...S.input, marginTop: "6px" }}
            >
              <option value="">(선택)</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.display_name ?? c.id}
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Conversation ID
            <input
              type="text"
              value={conversationId}
              onChange={(e) => setConversationId(e.target.value)}
              style={{ ...S.input, marginTop: "6px" }}
            />
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Query
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ ...S.input, marginTop: "6px" }}
            />
          </label>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <button
              type="button"
              style={{ ...S.btn, opacity: preparing ? 0.6 : 1, maxWidth: "280px" }}
              disabled={preparing}
              onClick={handlePrepare}
            >
              {preparing ? "준비 중…" : "AI 답변 준비"}
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

      {selectedPdf ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            PDF 정보
          </h2>
          <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
            <div>PDF File: {selectedPdf.file_name ?? "—"}</div>
            <div>Version: {selectedPdf.file_version ?? "—"}</div>
          </div>
        </section>
      ) : null}

      {prepareResult ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            준비 결과
          </h2>
          <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
            <div>Grounding Sources: {prepareResult.groundingSourceCount ?? 0}</div>
            <div>
              Claude Grounding Status:{" "}
              {prepareResult.claudeGroundingReady ? "ready" : "not ready"}
            </div>
            <div>Claude Execution Run: {prepareResult.claudeExecutionRunId ?? "—"}</div>
            <div>Customer AI Run: {prepareResult.customerAiConversationRunId ?? "—"}</div>
            <div>Execution Status: {prepareResult.executionStatus ?? "—"}</div>
            {prepareResult.missingInformation?.length ? (
              <div style={{ marginTop: "8px" }}>
                Missing Information:{" "}
                {prepareResult.missingInformation.map(missingLabel).join(", ")}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {run ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            Customer AI Run
          </h2>
          <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
            <div>Run ID: {run.id ?? "—"}</div>
            <div>Grounded Conversation Run: {run.grounded_conversation_run_id ?? "—"}</div>
            <div>Claude Execution Run: {run.claude_execution_run_id ?? "—"}</div>
            <div>Execution Status: {run.execution_status ?? "—"}</div>
            <div>Response Status: {run.response_status ?? "—"}</div>
            <div>Error Message: {run.error_message ?? "—"}</div>
            {responsePreview ? (
              <div style={{ marginTop: "12px", color: "#e2e8f0", whiteSpace: "pre-wrap" }}>
                Response Preview: {responsePreview}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
