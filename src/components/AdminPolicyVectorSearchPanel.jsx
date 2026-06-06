import { useCallback, useEffect, useState } from "react";
import {
  loadCarriersForManualKnowledge,
  loadProductsForManualKnowledge,
  checkPolicyVectorSearchReadiness,
  searchPolicyVectors,
  POLICY_VECTOR_SEARCH_MISSING_LABELS,
} from "../lib/policyVectorSearch.js";

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
  return POLICY_VECTOR_SEARCH_MISSING_LABELS[code] ?? code;
}

export default function AdminPolicyVectorSearchPanel() {
  const [carriers, setCarriers] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [readiness, setReadiness] = useState(null);
  const [searchResult, setSearchResult] = useState(null);

  const [query, setQuery] = useState("");
  const [carrierId, setCarrierId] = useState("");
  const [productId, setProductId] = useState("");

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

  const loadReadiness = useCallback(async (nextCarrierId, nextProductId) => {
    try {
      const data = await checkPolicyVectorSearchReadiness({
        carrierId: nextCarrierId || null,
        productId: nextProductId || null,
      });
      setReadiness(data);
    } catch (err) {
      setError(err.message);
      setReadiness(null);
    }
  }, []);

  useEffect(() => {
    loadCarriers();
  }, [loadCarriers]);

  useEffect(() => {
    loadProducts(carrierId);
  }, [carrierId, loadProducts]);

  useEffect(() => {
    loadReadiness(carrierId, productId);
  }, [carrierId, productId, loadReadiness]);

  const handleSearch = async () => {
    setSearching(true);
    setError("");
    setSearchResult(null);
    try {
      const data = await searchPolicyVectors({
        query,
        carrierId: carrierId || null,
        productId: productId || null,
      });
      setSearchResult(data);
      await loadReadiness(carrierId, productId);
    } catch (err) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#f8fafc" }}>
          약관 Vector Search 테스트
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: "15px", color: "#94a3b8", lineHeight: 1.55 }}>
          vector_status=available 청크만 검색합니다. 가짜 벡터·랭킹 없음.
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
          검색
        </h2>
        <div style={{ display: "grid", gap: "12px", maxWidth: "720px" }}>
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
            style={{ ...S.btn, opacity: searching ? 0.6 : 1, maxWidth: "280px" }}
            disabled={searching}
            onClick={handleSearch}
          >
            {searching ? "검색 중…" : "Vector Search 실행"}
          </button>
        </div>
      </section>

      {readiness ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            준비 상태
          </h2>
          <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
            <div>Available Vector Count: {readiness.availableVectorCount}</div>
            <div>Approved Chunk Count: {readiness.approvedChunkCount}</div>
            {readiness.missingInformation?.length ? (
              <div style={{ marginTop: "8px" }}>
                Missing Information:{" "}
                {readiness.missingInformation.map(missingLabel).join(", ")}
              </div>
            ) : (
              <div style={{ marginTop: "8px" }}>Missing Information: 없음</div>
            )}
          </div>
        </section>
      ) : null}

      {searchResult ? (
        <>
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
                      {item.source_reference ?? "—"}
                    </div>
                    <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "4px" }}>
                      {item.carrier_name ?? "—"} · {item.product_name ?? "—"} · seq{" "}
                      {item.chunk_sequence ?? "—"}
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
          </section>

          <section style={S.card}>
            <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
              Missing Information
            </h2>
            {!searchResult.missingInformation?.length ? (
              <p style={{ margin: 0, color: "#64748b" }}>없음.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: "20px", color: "#94a3b8", fontSize: "13px" }}>
                {searchResult.missingInformation.map((code) => (
                  <li key={code}>{missingLabel(code)}</li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
