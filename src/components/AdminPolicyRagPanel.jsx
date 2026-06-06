import { useCallback, useEffect, useState } from "react";
import {
  loadCarriersForManualKnowledge,
  loadProductsForManualKnowledge,
  loadPolicyRagSources,
  registerPolicyRagSource,
  searchPolicyRag,
  POLICY_RAG_SOURCE_TYPE_LABELS,
  POLICY_RAG_SOURCE_STATUS_LABELS,
  POLICY_RAG_MISSING_LABELS,
} from "../lib/policyRag.js";

const FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

const SOURCE_TYPES = Object.keys(POLICY_RAG_SOURCE_TYPE_LABELS);

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
  return POLICY_RAG_MISSING_LABELS[code] ?? code;
}

function sourceTypeLabel(type) {
  return POLICY_RAG_SOURCE_TYPE_LABELS[type] ?? type;
}

function sourceStatusLabel(status) {
  return POLICY_RAG_SOURCE_STATUS_LABELS[status] ?? status;
}

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("ko-KR");
  } catch {
    return String(value);
  }
}

export default function AdminPolicyRagPanel() {
  const [carriers, setCarriers] = useState([]);
  const [products, setProducts] = useState([]);
  const [registerProducts, setRegisterProducts] = useState([]);
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [registerResult, setRegisterResult] = useState(null);
  const [searchResult, setSearchResult] = useState(null);

  const [sourceType, setSourceType] = useState("manual_knowledge");
  const [sourceId, setSourceId] = useState("");
  const [registerCarrierId, setRegisterCarrierId] = useState("");
  const [registerProductId, setRegisterProductId] = useState("");
  const [sourceReference, setSourceReference] = useState("");

  const [searchQuery, setSearchQuery] = useState("");
  const [searchCarrierId, setSearchCarrierId] = useState("");
  const [searchProductId, setSearchProductId] = useState("");

  const loadSources = useCallback(async () => {
    try {
      const rows = await loadPolicyRagSources();
      setSources(rows);
    } catch (err) {
      setError(err.message);
      setSources([]);
    }
  }, []);

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

  const loadProducts = useCallback(async (carrierId, setter) => {
    if (!carrierId) {
      setter([]);
      return;
    }
    try {
      const rows = await loadProductsForManualKnowledge(carrierId);
      setter(rows);
    } catch (err) {
      setError(err.message);
      setter([]);
    }
  }, []);

  useEffect(() => {
    loadCarriers();
    loadSources();
  }, [loadCarriers, loadSources]);

  useEffect(() => {
    loadProducts(registerCarrierId, setRegisterProducts);
    setRegisterProductId("");
  }, [registerCarrierId, loadProducts]);

  useEffect(() => {
    loadProducts(searchCarrierId, setProducts);
    setSearchProductId("");
  }, [searchCarrierId, loadProducts]);

  const handleRegister = async () => {
    if (!sourceType) {
      setError("소스 유형을 선택해 주세요.");
      return;
    }
    if (!sourceId.trim()) {
      setError("소스 ID를 입력해 주세요.");
      return;
    }
    if (!registerCarrierId) {
      setError("보험사를 선택해 주세요.");
      return;
    }
    setRegistering(true);
    setError("");
    setRegisterResult(null);
    try {
      const data = await registerPolicyRagSource({
        sourceType,
        sourceId: sourceId.trim(),
        carrierId: registerCarrierId,
        productId: registerProductId || null,
        sourceReference,
      });
      setRegisterResult(data);
      await loadSources();
    } catch (err) {
      setError(err.message);
    } finally {
      setRegistering(false);
    }
  };

  const handleSearch = async () => {
    setSearching(true);
    setError("");
    setSearchResult(null);
    try {
      const data = await searchPolicyRag({
        query: searchQuery,
        carrierId: searchCarrierId || null,
        productId: searchProductId || null,
      });
      setSearchResult(data);
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
          약관 RAG 소스 관리
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: "15px", color: "#94a3b8", lineHeight: 1.55 }}>
          기존 저장 청크·승인된 수작업 지식만 등록·검색합니다. 가짜 청크·임베딩 생성 없음.
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
          RAG 소스 등록
        </h2>
        <div style={{ display: "grid", gap: "12px", maxWidth: "720px" }}>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Source Type
            <select
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value)}
              style={{ ...S.input, marginTop: "6px" }}
            >
              {SOURCE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {sourceTypeLabel(type)} ({type})
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Source ID (UUID)
            <input
              type="text"
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              style={{ ...S.input, marginTop: "6px" }}
            />
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Carrier
            <select
              value={registerCarrierId}
              onChange={(e) => setRegisterCarrierId(e.target.value)}
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
              value={registerProductId}
              onChange={(e) => setRegisterProductId(e.target.value)}
              disabled={!registerCarrierId || registerProducts.length === 0}
              style={{ ...S.input, marginTop: "6px" }}
            >
              <option value="">(선택 안 함)</option>
              {registerProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.product_name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Source Reference
            <input
              type="text"
              value={sourceReference}
              onChange={(e) => setSourceReference(e.target.value)}
              placeholder="선택 입력"
              style={{ ...S.input, marginTop: "6px" }}
            />
          </label>
          <button
            type="button"
            style={{ ...S.btn, opacity: registering ? 0.6 : 1, maxWidth: "280px" }}
            disabled={registering}
            onClick={handleRegister}
          >
            {registering ? "등록 중…" : "소스 등록"}
          </button>
        </div>
      </section>

      {registerResult ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            등록 결과
          </h2>
          <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
            <div>rag_source_id: {registerResult.ragSourceId ?? "—"}</div>
            <div>Source Status: {sourceStatusLabel(registerResult.sourceStatus)}</div>
            {registerResult.missingInformation?.length ? (
              <div style={{ marginTop: "8px" }}>
                Missing Information:{" "}
                {registerResult.missingInformation.map(missingLabel).join(", ")}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section style={S.card}>
        <h2 style={{ margin: "0 0 16px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
          등록된 RAG 소스
        </h2>
        {!sources.length ? (
          <p style={{ margin: 0, color: "#64748b" }}>등록된 소스 없음.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "13px",
                color: "#e2e8f0",
              }}
            >
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(148, 163, 184, 0.2)" }}>
                  {[
                    "Source Type",
                    "Carrier",
                    "Product",
                    "Source Status",
                    "Source Reference",
                    "등록일",
                  ].map((col) => (
                    <th
                      key={col}
                      style={{
                        textAlign: "left",
                        padding: "10px 12px",
                        color: "#94a3b8",
                        fontWeight: 600,
                      }}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sources.map((src) => (
                  <tr
                    key={src.ragSourceId}
                    style={{ borderBottom: "1px solid rgba(148, 163, 184, 0.08)" }}
                  >
                    <td style={{ padding: "10px 12px" }}>{sourceTypeLabel(src.sourceType)}</td>
                    <td style={{ padding: "10px 12px" }}>{src.carrierName ?? "—"}</td>
                    <td style={{ padding: "10px 12px" }}>{src.productName ?? "—"}</td>
                    <td style={{ padding: "10px 12px" }}>
                      {sourceStatusLabel(src.sourceStatus)}
                    </td>
                    <td style={{ padding: "10px 12px" }}>{src.sourceReference}</td>
                    <td style={{ padding: "10px 12px" }}>{formatDate(src.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={S.card}>
        <h2 style={{ margin: "0 0 16px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
          Search Test
        </h2>
        <div style={{ display: "grid", gap: "12px", maxWidth: "720px" }}>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            검색어
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ ...S.input, marginTop: "6px" }}
            />
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Carrier
            <select
              value={searchCarrierId}
              onChange={(e) => setSearchCarrierId(e.target.value)}
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
              value={searchProductId}
              onChange={(e) => setSearchProductId(e.target.value)}
              disabled={!searchCarrierId || products.length === 0}
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
            {searching ? "검색 중…" : "RAG 검색 테스트"}
          </button>
        </div>
      </section>

      {searchResult ? (
        <>
          <section style={S.card}>
            <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
              검색 결과 ({searchResult.resultCount ?? 0})
            </h2>
            {!searchResult.results?.length ? (
              <p style={{ margin: 0, color: "#64748b" }}>검색 결과 없음.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {searchResult.results.map((item, idx) => (
                  <div
                    key={`${item.source_id}-${idx}`}
                    style={{
                      padding: "14px",
                      borderRadius: "10px",
                      border: "1px solid rgba(148, 163, 184, 0.15)",
                      background: "rgba(15, 23, 42, 0.5)",
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: "14px" }}>{item.title ?? "—"}</div>
                    <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "4px" }}>
                      {sourceTypeLabel(item.source_type)} · {item.carrier_name ?? "—"} ·{" "}
                      {item.product_name ?? "—"}
                    </div>
                    <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
                      Source Reference: {item.source_reference ?? "—"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section style={S.card}>
            <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
              Retrieved Chunks
            </h2>
            {!searchResult.retrievedChunks?.length ? (
              <p style={{ margin: 0, color: "#64748b" }}>검색된 청크 없음.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {searchResult.retrievedChunks.map((chunk, idx) => (
                  <div
                    key={`${chunk.chunk_id}-${idx}`}
                    style={{
                      padding: "14px",
                      borderRadius: "10px",
                      border: "1px solid rgba(148, 163, 184, 0.15)",
                      background: "rgba(15, 23, 42, 0.5)",
                    }}
                  >
                    <div style={{ fontSize: "12px", color: "#94a3b8" }}>
                      {sourceTypeLabel(chunk.source_type)} ·{" "}
                      {sourceStatusLabel(chunk.source_status)}
                    </div>
                    <div style={{ fontSize: "13px", color: "#e2e8f0", marginTop: "6px" }}>
                      {chunk.chunk_text ?? "—"}
                    </div>
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
            {searchResult.sourceReferences?.length ? (
              <div style={{ marginTop: "12px", fontSize: "12px", color: "#64748b" }}>
                Source References: {searchResult.sourceReferences.join(", ")}
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
