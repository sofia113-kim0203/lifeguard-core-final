import { useCallback, useEffect, useState } from "react";
import {
  loadCarriersForManualKnowledge,
  loadProductsForManualKnowledge,
  registerManualKnowledgeEntry,
  MANUAL_KNOWLEDGE_ENTRY_TYPE_LABELS,
  MANUAL_KNOWLEDGE_MISSING_LABELS,
} from "../lib/manualKnowledgeIngestion.js";

const FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

const ENTRY_TYPES = Object.keys(MANUAL_KNOWLEDGE_ENTRY_TYPE_LABELS);

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

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("ko-KR");
  } catch {
    return String(value);
  }
}

function missingLabel(code) {
  return MANUAL_KNOWLEDGE_MISSING_LABELS[code] ?? code;
}

export default function AdminManualKnowledgeIngestionPanel() {
  const [carriers, setCarriers] = useState([]);
  const [products, setProducts] = useState([]);
  const [carrierId, setCarrierId] = useState("");
  const [productId, setProductId] = useState("");
  const [entryType, setEntryType] = useState("underwriting_manual");
  const [title, setTitle] = useState("");
  const [contentText, setContentText] = useState("");
  const [sourceReference, setSourceReference] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [expirationDate, setExpirationDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const loadCarriers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await loadCarriersForManualKnowledge();
      setCarriers(rows);
      if (rows.length && !carrierId) {
        setCarrierId(rows[0].id);
      }
    } catch (err) {
      setError(err.message);
      setCarriers([]);
    } finally {
      setLoading(false);
    }
  }, [carrierId]);

  const loadProducts = useCallback(async (nextCarrierId) => {
    if (!nextCarrierId) {
      setProducts([]);
      setProductId("");
      return;
    }
    try {
      const rows = await loadProductsForManualKnowledge(nextCarrierId);
      setProducts(rows);
      setProductId(rows[0]?.id ?? "");
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

  const handleRun = async () => {
    if (!carrierId) {
      setError("보험사를 선택해 주세요.");
      return;
    }
    if (!title.trim()) {
      setError("제목을 입력해 주세요.");
      return;
    }
    if (!contentText.trim()) {
      setError("내용을 입력해 주세요.");
      return;
    }
    if (!sourceReference.trim()) {
      setError("출처를 입력해 주세요.");
      return;
    }
    setRunning(true);
    setError("");
    setResult(null);
    try {
      const data = await registerManualKnowledgeEntry({
        carrierId,
        productId: productId || null,
        entryType,
        title,
        contentText,
        sourceReference,
        effectiveDate: effectiveDate || null,
        expirationDate: expirationDate || null,
      });
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#f8fafc" }}>
          수작업 지식 등록
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: "15px", color: "#94a3b8", lineHeight: 1.55 }}>
          관리자가 입력한 실제 지식만 등록합니다. 가짜 데이터·자동 생성 없음.
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
            보험사
            <select
              value={carrierId}
              onChange={(e) => setCarrierId(e.target.value)}
              disabled={loading}
              style={{ ...S.input, marginTop: "6px" }}
            >
              {loading ? (
                <option value="">불러오는 중…</option>
              ) : carriers.length === 0 ? (
                <option value="">등록된 보험사 없음</option>
              ) : (
                carriers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.carrier_name}
                  </option>
                ))
              )}
            </select>
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            상품
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              disabled={!carrierId || products.length === 0}
              style={{ ...S.input, marginTop: "6px" }}
            >
              <option value="">(선택 없음)</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.product_name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            지식 유형
            <select
              value={entryType}
              onChange={(e) => setEntryType(e.target.value)}
              style={{ ...S.input, marginTop: "6px" }}
            >
              {ENTRY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {MANUAL_KNOWLEDGE_ENTRY_TYPE_LABELS[type]} ({type})
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            제목
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={{ ...S.input, marginTop: "6px" }}
            />
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            내용
            <textarea
              value={contentText}
              onChange={(e) => setContentText(e.target.value)}
              rows={8}
              style={{ ...S.input, marginTop: "6px", resize: "vertical" }}
            />
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            출처
            <input
              type="text"
              value={sourceReference}
              onChange={(e) => setSourceReference(e.target.value)}
              style={{ ...S.input, marginTop: "6px" }}
            />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <label style={{ fontSize: "13px", color: "#94a3b8" }}>
              시행일
              <input
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                style={{ ...S.input, marginTop: "6px" }}
              />
            </label>
            <label style={{ fontSize: "13px", color: "#94a3b8" }}>
              만료일
              <input
                type="date"
                value={expirationDate}
                onChange={(e) => setExpirationDate(e.target.value)}
                style={{ ...S.input, marginTop: "6px" }}
              />
            </label>
          </div>
          <button
            type="button"
            style={{ ...S.btn, opacity: running ? 0.6 : 1, maxWidth: "280px" }}
            disabled={running || !carriers.length}
            onClick={handleRun}
          >
            {running ? "등록 중…" : "지식 등록"}
          </button>
        </div>
      </section>

      {result ? (
        <>
          <section style={S.card}>
            <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
              등록 결과
            </h2>
            <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
              <div>manual_entry_id: {result.manualEntryId ?? "—"}</div>
              <div>등록상태: {result.ingestionStatus ?? "—"}</div>
              <div>entry_status: {result.entryStatus ?? "—"}</div>
              <div>created_at: {formatDate(result.createdAt)}</div>
            </div>
          </section>

          <section style={S.card}>
            <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
              Missing Information
            </h2>
            {!result.missingInformation?.length ? (
              <p style={{ margin: 0, color: "#64748b" }}>누락 코드 없음.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: "20px", color: "#cbd5e1", fontSize: "13px" }}>
                {result.missingInformation.map((code) => (
                  <li key={code}>
                    {missingLabel(code)} ({code})
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
