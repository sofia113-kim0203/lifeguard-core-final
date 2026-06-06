import { useCallback, useEffect, useState } from "react";
import {
  loadRealPolicyPdfRegistry,
  loadCarriersForManualKnowledge,
  loadProductsForManualKnowledge,
  loadCustomersForGroundingTest,
  searchRealPolicyVectors,
  prepareRealPolicyGroundingContext,
  prepareCustomerRealPolicyGroundedConversation,
  REAL_POLICY_VECTOR_SEARCH_MISSING_LABELS,
} from "../lib/realPolicyVectorSearchIntegration.js";

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
  return REAL_POLICY_VECTOR_SEARCH_MISSING_LABELS[code] ?? code;
}

export default function AdminRealPolicyVectorSearchIntegrationPanel() {
  const [pdfs, setPdfs] = useState([]);
  const [carriers, setCarriers] = useState([]);
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [grounding, setGrounding] = useState(false);
  const [customerPreparing, setCustomerPreparing] = useState(false);
  const [error, setError] = useState("");

  const [policyPdfId, setPolicyPdfId] = useState("");
  const [carrierId, setCarrierId] = useState("");
  const [productId, setProductId] = useState("");
  const [query, setQuery] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [conversationId, setConversationId] = useState("");

  const [searchResult, setSearchResult] = useState(null);
  const [groundingResult, setGroundingResult] = useState(null);
  const [customerResult, setCustomerResult] = useState(null);

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

  const handleSearch = async () => {
    setSearching(true);
    setError("");
    setSearchResult(null);
    try {
      const data = await searchRealPolicyVectors({
        policyPdfId: policyPdfId || null,
        carrierId: carrierId || null,
        productId: productId || null,
        query,
      });
      setSearchResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  };

  const handleGrounding = async () => {
    setGrounding(true);
    setError("");
    setGroundingResult(null);
    try {
      const data = await prepareRealPolicyGroundingContext({
        policyPdfId: policyPdfId || null,
        carrierId: carrierId || null,
        productId: productId || null,
        query,
      });
      setGroundingResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setGrounding(false);
    }
  };

  const handleCustomerPrepare = async () => {
    setCustomerPreparing(true);
    setError("");
    setCustomerResult(null);
    try {
      const data = await prepareCustomerRealPolicyGroundedConversation({
        customerId,
        conversationId,
        policyPdfId: policyPdfId || null,
        carrierId: carrierId || null,
        productId: productId || null,
        query,
      });
      setCustomerResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setCustomerPreparing(false);
    }
  };

  const selectedPdf = pdfs.find((row) => row.id === policyPdfId);

  return (
    <div style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#f8fafc" }}>
          실제 약관 Vector Search 연동
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: "15px", color: "#94a3b8", lineHeight: 1.55 }}>
          Phase 14 실제 약관 벡터를 기존 Vector Search·Grounding·고객 대화 흐름에 연결합니다.
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
            Query
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ ...S.input, marginTop: "6px" }}
            />
          </label>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <button
              type="button"
              style={{ ...S.btn, opacity: searching ? 0.6 : 1 }}
              disabled={searching}
              onClick={handleSearch}
            >
              {searching ? "검색 중…" : "Vector Search"}
            </button>
            <button
              type="button"
              style={{ ...S.btn, opacity: grounding ? 0.6 : 1, background: "linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)" }}
              disabled={grounding}
              onClick={handleGrounding}
            >
              {grounding ? "준비 중…" : "Grounding Context"}
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
            <div>
              Carrier / Product: {selectedPdf.carrier?.carrier_name ?? "—"} ·{" "}
              {selectedPdf.product?.product_name ?? "—"}
            </div>
          </div>
        </section>
      ) : null}

      {searchResult ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            Search Results ({searchResult.resultCount ?? 0})
          </h2>
          {!searchResult.results?.length ? (
            <p style={{ margin: 0, color: "#64748b" }}>검색 결과 없음.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {searchResult.results.map((item, idx) => (
                <div
                  key={`${item.chunk_registry_id}-${idx}`}
                  style={{
                    padding: "14px",
                    borderRadius: "10px",
                    border: "1px solid rgba(148, 163, 184, 0.15)",
                    background: "rgba(15, 23, 42, 0.5)",
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: "14px", color: "#e2e8f0" }}>
                    Chunk Reference: {item.source_reference ?? "—"}
                  </div>
                  <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "4px" }}>
                    PDF File: {item.file_name ?? searchResult.fileName ?? "—"} · Version:{" "}
                    {item.file_version ?? searchResult.fileVersion ?? "—"}
                  </div>
                  <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
                    Vector Reference: {item.vector_reference ?? "—"}
                  </div>
                  {item.chunk_text_preview ? (
                    <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "6px" }}>
                      {item.chunk_text_preview}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          {searchResult.missingInformation?.length ? (
            <div style={{ marginTop: "12px", fontSize: "13px", color: "#94a3b8" }}>
              Missing Information:{" "}
              {searchResult.missingInformation.map(missingLabel).join(", ")}
            </div>
          ) : null}
        </section>
      ) : null}

      {groundingResult ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            Grounding Context
          </h2>
          <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
            <div>Grounding Source Count: {groundingResult.sourceCount ?? 0}</div>
            <div>Status: {groundingResult.groundingStatus ?? "—"}</div>
            {groundingResult.missingInformation?.length ? (
              <div style={{ marginTop: "8px" }}>
                Missing Information:{" "}
                {groundingResult.missingInformation.map(missingLabel).join(", ")}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section style={S.card}>
        <h2 style={{ margin: "0 0 16px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
          고객 Scoped Grounded Conversation
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
          <button
            type="button"
            style={{ ...S.btn, opacity: customerPreparing ? 0.6 : 1, maxWidth: "320px" }}
            disabled={customerPreparing}
            onClick={handleCustomerPrepare}
          >
            {customerPreparing ? "준비 중…" : "고객 Scoped Grounded Conversation"}
          </button>
        </div>
      </section>

      {customerResult ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            Customer Grounded Result
          </h2>
          <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
            <div>Run ID: {customerResult.groundedConversationRunId ?? "—"}</div>
            <div>Grounding Source Count: {customerResult.groundingSourceCount ?? 0}</div>
            <div>Status: {customerResult.runStatus ?? "—"}</div>
            {customerResult.missingInformation?.length ? (
              <div style={{ marginTop: "8px" }}>
                Missing Information:{" "}
                {customerResult.missingInformation.map(missingLabel).join(", ")}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
