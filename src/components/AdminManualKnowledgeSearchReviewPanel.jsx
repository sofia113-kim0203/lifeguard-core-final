import { useCallback, useEffect, useState } from "react";
import {
  loadCarriersForManualKnowledge,
  loadProductsForManualKnowledge,
  searchManualKnowledge,
  markManualKnowledgeReview,
  MANUAL_KNOWLEDGE_ENTRY_TYPE_LABELS,
  MANUAL_KNOWLEDGE_REVIEW_STATUS_LABELS,
  MANUAL_KNOWLEDGE_SEARCH_MISSING_LABELS,
} from "../lib/manualKnowledgeSearchReview.js";

const FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

const ENTRY_TYPES = ["", ...Object.keys(MANUAL_KNOWLEDGE_ENTRY_TYPE_LABELS)];
const REVIEW_STATUSES = Object.keys(MANUAL_KNOWLEDGE_REVIEW_STATUS_LABELS);

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
  return MANUAL_KNOWLEDGE_SEARCH_MISSING_LABELS[code] ?? code;
}

function reviewLabel(status) {
  return MANUAL_KNOWLEDGE_REVIEW_STATUS_LABELS[status] ?? status;
}

export default function AdminManualKnowledgeSearchReviewPanel() {
  const [carriers, setCarriers] = useState([]);
  const [products, setProducts] = useState([]);
  const [carrierId, setCarrierId] = useState("");
  const [productId, setProductId] = useState("");
  const [entryType, setEntryType] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState("");
  const [searchResult, setSearchResult] = useState(null);
  const [selectedEntryId, setSelectedEntryId] = useState("");
  const [reviewStatus, setReviewStatus] = useState("pending_review");
  const [reviewNote, setReviewNote] = useState("");
  const [reviewResult, setReviewResult] = useState(null);

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

  const handleSearch = async () => {
    setSearching(true);
    setError("");
    setSearchResult(null);
    setReviewResult(null);
    setSelectedEntryId("");
    try {
      const data = await searchManualKnowledge({
        query,
        carrierId: carrierId || null,
        productId: productId || null,
        entryType: entryType || null,
      });
      setSearchResult(data);
      if (data.results?.length) {
        setSelectedEntryId(data.results[0].manual_entry_id);
        setReviewStatus(data.results[0].review_status ?? "pending_review");
        setReviewNote(data.results[0].review_note ?? "");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  };

  const handleSelectEntry = (entry) => {
    setSelectedEntryId(entry.manual_entry_id);
    setReviewStatus(entry.review_status ?? "pending_review");
    setReviewNote(entry.review_note ?? "");
    setReviewResult(null);
  };

  const handleReview = async () => {
    if (!selectedEntryId) {
      setError("검토할 지식 항목을 선택해 주세요.");
      return;
    }
    setReviewing(true);
    setError("");
    setReviewResult(null);
    try {
      const data = await markManualKnowledgeReview({
        manualEntryId: selectedEntryId,
        reviewStatus,
        reviewNote,
      });
      setReviewResult(data);
      const refreshed = await searchManualKnowledge({
        query,
        carrierId: carrierId || null,
        productId: productId || null,
        entryType: entryType || null,
      });
      setSearchResult(refreshed);
    } catch (err) {
      setError(err.message);
    } finally {
      setReviewing(false);
    }
  };

  return (
    <div style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#f8fafc" }}>
          수작업 지식 검색/검토
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: "15px", color: "#94a3b8", lineHeight: 1.55 }}>
          등록된 수작업 지식만 검색·검토합니다. RAG 준비용 검토이며 보험 승인/거절 아님.
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
            검색어
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ ...S.input, marginTop: "6px" }}
            />
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            보험사
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
            상품
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
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            지식 유형
            <select
              value={entryType}
              onChange={(e) => setEntryType(e.target.value)}
              style={{ ...S.input, marginTop: "6px" }}
            >
              <option value="">(전체)</option>
              {ENTRY_TYPES.filter(Boolean).map((type) => (
                <option key={type} value={type}>
                  {MANUAL_KNOWLEDGE_ENTRY_TYPE_LABELS[type]} ({type})
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
            {searching ? "검색 중…" : "검색 실행"}
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
                {searchResult.results.map((entry) => {
                  const selected = selectedEntryId === entry.manual_entry_id;
                  return (
                    <button
                      key={entry.manual_entry_id}
                      type="button"
                      onClick={() => handleSelectEntry(entry)}
                      style={{
                        textAlign: "left",
                        padding: "14px",
                        borderRadius: "10px",
                        border: selected
                          ? "1px solid rgba(59, 130, 246, 0.45)"
                          : "1px solid rgba(148, 163, 184, 0.15)",
                        background: selected
                          ? "rgba(37, 99, 235, 0.2)"
                          : "rgba(15, 23, 42, 0.5)",
                        color: "#e2e8f0",
                        cursor: "pointer",
                        fontFamily: FONT,
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: "14px" }}>{entry.title}</div>
                      <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "4px" }}>
                        {entry.carrier_name ?? "—"} · {entry.product_name ?? "—"} ·{" "}
                        {MANUAL_KNOWLEDGE_ENTRY_TYPE_LABELS[entry.entry_type] ?? entry.entry_type}
                      </div>
                      <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
                        검토상태: {reviewLabel(entry.review_status)}
                      </div>
                      {entry.content_preview ? (
                        <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "6px" }}>
                          {entry.content_preview}
                        </div>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
            {searchResult.missingInformation?.includes("no_search_results") ? (
              <p style={{ margin: "12px 0 0", color: "#64748b", fontSize: "13px" }}>
                {missingLabel("no_search_results")}
              </p>
            ) : null}
          </section>

          <section style={S.card}>
            <h2 style={{ margin: "0 0 16px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
              검토
            </h2>
            <div style={{ display: "grid", gap: "12px", maxWidth: "720px" }}>
              <label style={{ fontSize: "13px", color: "#94a3b8" }}>
                선택 항목 ID
                <input
                  type="text"
                  value={selectedEntryId}
                  readOnly
                  style={{ ...S.input, marginTop: "6px" }}
                />
              </label>
              <label style={{ fontSize: "13px", color: "#94a3b8" }}>
                검토상태
                <select
                  value={reviewStatus}
                  onChange={(e) => setReviewStatus(e.target.value)}
                  style={{ ...S.input, marginTop: "6px" }}
                >
                  {REVIEW_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {reviewLabel(status)} ({status})
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: "13px", color: "#94a3b8" }}>
                검토메모
                <textarea
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  rows={4}
                  style={{ ...S.input, marginTop: "6px", resize: "vertical" }}
                />
              </label>
              <button
                type="button"
                style={{ ...S.btn, opacity: reviewing ? 0.6 : 1, maxWidth: "280px" }}
                disabled={reviewing || !selectedEntryId}
                onClick={handleReview}
              >
                {reviewing ? "저장 중…" : "검토 저장"}
              </button>
            </div>
          </section>

          {reviewResult ? (
            <section style={S.card}>
              <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
                검토 결과
              </h2>
              <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
                <div>review_queue_id: {reviewResult.reviewQueueId ?? "—"}</div>
                <div>검토상태: {reviewLabel(reviewResult.reviewStatus)}</div>
                <div>검토메모: {reviewResult.reviewNote || "—"}</div>
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
