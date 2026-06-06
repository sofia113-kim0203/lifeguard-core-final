import { useCallback, useEffect, useState } from "react";
import {
  loadCarriersForManualKnowledge,
  loadProductsForManualKnowledge,
  prepareClaudeGroundingRequest,
  storeClaudeGroundedResponse,
  CLAUDE_GROUNDING_STATUS_LABELS,
  CLAUDE_GROUNDING_MISSING_LABELS,
} from "../lib/claudeGroundingIntegration.js";

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
  return CLAUDE_GROUNDING_MISSING_LABELS[code] ?? code;
}

function statusLabel(status) {
  return CLAUDE_GROUNDING_STATUS_LABELS[status] ?? status;
}

export default function AdminClaudeGroundingIntegrationPanel() {
  const [carriers, setCarriers] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [storing, setStoring] = useState(false);
  const [error, setError] = useState("");
  const [prepareResult, setPrepareResult] = useState(null);
  const [storeResult, setStoreResult] = useState(null);

  const [customerId, setCustomerId] = useState("");
  const [query, setQuery] = useState("");
  const [carrierId, setCarrierId] = useState("");
  const [productId, setProductId] = useState("");
  const [responseContextJson, setResponseContextJson] = useState("{}");

  const loadCarriers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await loadCarriersForManualKnowledge();
      setCarriers(rows);
    } catch (err) {
      setError(err.message);
      setCarriers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadProducts = useCallback(async (nextCarrierId) => {
    if (!nextCarrierId) {
      setProducts([]);
      setProductId("");
      return;
    }
    try {
      const rows = await loadProductsForManualKnowledge(nextCarrierId);
      setProducts(rows);
      setProductId("");
    } catch (err) {
      setError(err.message);
      setProducts([]);
      setProductId("");
    }
  }, []);

  useEffect(() => {
    loadCarriers();
  }, [loadCarriers]);

  useEffect(() => {
    loadProducts(carrierId);
  }, [carrierId, loadProducts]);

  const handlePrepare = async () => {
    if (!customerId.trim()) {
      setError("Customer ID를 입력해 주세요.");
      return;
    }
    setPreparing(true);
    setError("");
    setPrepareResult(null);
    setStoreResult(null);
    try {
      const data = await prepareClaudeGroundingRequest({
        customerId: customerId.trim(),
        query,
        carrierId: carrierId || null,
        productId: productId || null,
      });
      setPrepareResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setPreparing(false);
    }
  };

  const handleStore = async () => {
    if (!prepareResult?.claudeGroundingRunId) {
      setError("먼저 Claude grounding 요청을 준비해 주세요.");
      return;
    }
    let parsed = {};
    try {
      parsed = JSON.parse(responseContextJson || "{}");
    } catch {
      setError("Response Context JSON 형식이 올바르지 않습니다.");
      return;
    }
    setStoring(true);
    setError("");
    setStoreResult(null);
    try {
      const data = await storeClaudeGroundedResponse({
        claudeGroundingRunId: prepareResult.claudeGroundingRunId,
        responseContext: parsed,
      });
      setStoreResult(data);
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
          Claude Grounding 준비 테스트
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: "15px", color: "#94a3b8", lineHeight: 1.55 }}>
          Grounding Context 기반 Claude 요청 구조만 준비합니다. 외부 API·가짜 답변 없음.
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
            Customer ID
            <input
              type="text"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
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
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Carrier
            <select
              value={carrierId}
              onChange={(e) => setCarrierId(e.target.value)}
              disabled={loading}
              style={{ ...S.input, marginTop: "6px" }}
            >
              <option value="">(전체)</option>
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
              disabled={!carrierId || products.length === 0}
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
          <button
            type="button"
            style={{ ...S.btn, opacity: preparing ? 0.6 : 1, maxWidth: "280px" }}
            disabled={preparing}
            onClick={handlePrepare}
          >
            {preparing ? "준비 중…" : "Claude Grounding 준비"}
          </button>
        </div>
      </section>

      {prepareResult ? (
        <>
          <section style={S.card}>
            <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
              준비 결과
            </h2>
            <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
              <div>Source Count: {prepareResult.sourceCount ?? 0}</div>
              <div>Response Status: {statusLabel(prepareResult.responseStatus)}</div>
              <div style={{ marginTop: "8px" }}>
                Request Context Preview:
                <pre
                  style={{
                    margin: "8px 0 0",
                    padding: "12px",
                    borderRadius: "10px",
                    background: "rgba(15, 23, 42, 0.6)",
                    color: "#e2e8f0",
                    fontSize: "12px",
                    overflow: "auto",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {JSON.stringify(prepareResult.requestContext ?? {}, null, 2)}
                </pre>
              </div>
            </div>
          </section>

          <section style={S.card}>
            <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
              Missing Information
            </h2>
            {!prepareResult.missingInformation?.length ? (
              <p style={{ margin: 0, color: "#64748b" }}>없음.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: "20px", color: "#94a3b8", fontSize: "13px" }}>
                {prepareResult.missingInformation.map((code) => (
                  <li key={code}>{missingLabel(code)}</li>
                ))}
              </ul>
            )}
          </section>

          <section style={S.card}>
            <h2 style={{ margin: "0 0 16px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
              Response 저장 테스트
            </h2>
            <div style={{ display: "grid", gap: "12px", maxWidth: "720px" }}>
              <label style={{ fontSize: "13px", color: "#94a3b8" }}>
                Response Context (JSON)
                <textarea
                  value={responseContextJson}
                  onChange={(e) => setResponseContextJson(e.target.value)}
                  rows={6}
                  style={{ ...S.input, marginTop: "6px", resize: "vertical" }}
                />
              </label>
              <button
                type="button"
                style={{ ...S.btn, opacity: storing ? 0.6 : 1, maxWidth: "280px" }}
                disabled={storing}
                onClick={handleStore}
              >
                {storing ? "저장 중…" : "Response Context 저장"}
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
            <div>Response Status: {statusLabel(storeResult.responseStatus)}</div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
