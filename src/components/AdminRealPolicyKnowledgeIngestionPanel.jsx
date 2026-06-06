import { useCallback, useEffect, useState } from "react";
import {
  loadCarriersForManualKnowledge,
  loadProductsForManualKnowledge,
  registerRealPolicySource,
  reviewRealPolicySource,
  loadRealPolicyKnowledgeSources,
  loadLatestReviewForSource,
  REAL_POLICY_SOURCE_TYPES,
  REAL_POLICY_SOURCE_TYPE_LABELS,
  REAL_POLICY_SOURCE_STATUS_LABELS,
  REAL_POLICY_REVIEW_STATUS_LABELS,
  REAL_POLICY_MISSING_LABELS,
} from "../lib/realPolicyKnowledgeIngestion.js";

const FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

const REVIEW_STATUSES = ["pending", "approved", "rejected"];

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
  return REAL_POLICY_MISSING_LABELS[code] ?? code;
}

function sourceTypeLabel(type) {
  return REAL_POLICY_SOURCE_TYPE_LABELS[type] ?? type;
}

function sourceStatusLabel(status) {
  return REAL_POLICY_SOURCE_STATUS_LABELS[status] ?? status;
}

function reviewStatusLabel(status) {
  return REAL_POLICY_REVIEW_STATUS_LABELS[status] ?? status;
}

export default function AdminRealPolicyKnowledgeIngestionPanel() {
  const [carriers, setCarriers] = useState([]);
  const [products, setProducts] = useState([]);
  const [sources, setSources] = useState([]);
  const [reviewMap, setReviewMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState("");
  const [registerResult, setRegisterResult] = useState(null);
  const [reviewResult, setReviewResult] = useState(null);

  const [carrierId, setCarrierId] = useState("");
  const [productId, setProductId] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [sourceType, setSourceType] = useState("policy_terms");
  const [sourceFileReference, setSourceFileReference] = useState("");
  const [sourceVersion, setSourceVersion] = useState("");
  const [sourceNotes, setSourceNotes] = useState("");

  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [reviewStatus, setReviewStatus] = useState("approved");
  const [reviewNotes, setReviewNotes] = useState("");

  const loadSources = useCallback(async () => {
    try {
      const rows = await loadRealPolicyKnowledgeSources();
      setSources(rows);
      const reviews = {};
      await Promise.all(
        rows.map(async (row) => {
          const review = await loadLatestReviewForSource(row.id);
          reviews[row.id] = review;
        }),
      );
      setReviewMap(reviews);
      if (rows.length && !selectedSourceId) {
        setSelectedSourceId(rows[0].id);
      }
    } catch (err) {
      setError(err.message);
      setSources([]);
      setReviewMap({});
    }
  }, [selectedSourceId]);

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

  useEffect(() => {
    loadCarriers();
  }, [loadCarriers]);

  useEffect(() => {
    loadSources();
  }, [loadSources]);

  useEffect(() => {
    if (!carrierId) {
      setProducts([]);
      setProductId("");
      return;
    }
    loadProductsForManualKnowledge(carrierId)
      .then((rows) => {
        setProducts(rows);
        setProductId(rows[0]?.id ?? "");
      })
      .catch((err) => setError(err.message));
  }, [carrierId]);

  const selectedCarrier = carriers.find((row) => row.id === carrierId) ?? null;
  const selectedProduct = products.find((row) => row.id === productId) ?? null;
  const selectedSource = sources.find((row) => row.id === selectedSourceId) ?? null;
  const selectedReview = selectedSourceId ? reviewMap[selectedSourceId] ?? null : null;

  const handleRegister = async () => {
    if (!carrierId) {
      setError("보험사를 선택해 주세요.");
      return;
    }
    if (!sourceName.trim()) {
      setError("자료명을 입력해 주세요.");
      return;
    }
    if (!sourceFileReference.trim()) {
      setError("파일 참조를 입력해 주세요.");
      return;
    }
    if (!sourceVersion.trim()) {
      setError("버전을 입력해 주세요.");
      return;
    }
    setRegistering(true);
    setError("");
    setRegisterResult(null);
    try {
      const data = await registerRealPolicySource({
        carrierId,
        productId: productId || null,
        sourceName,
        sourceType,
        sourceFileReference,
        sourceVersion,
        sourceNotes,
      });
      setRegisterResult(data);
      await loadSources();
    } catch (err) {
      setError(err.message);
    } finally {
      setRegistering(false);
    }
  };

  const handleReview = async () => {
    if (!selectedSourceId) {
      setError("검토할 자료를 선택해 주세요.");
      return;
    }
    setReviewing(true);
    setError("");
    setReviewResult(null);
    try {
      const data = await reviewRealPolicySource({
        policySourceId: selectedSourceId,
        reviewStatus,
        reviewNotes,
      });
      setReviewResult(data);
      await loadSources();
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
          실제 약관 자료 관리
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: "15px", color: "#94a3b8", lineHeight: 1.55 }}>
          삼성·메리츠 등 실제 약관 PDF, 상품설명서, 인수지침서 파일을 등록합니다. OCR·임베딩·Claude 실행 없음.
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
          실제 자료 등록
        </h2>
        <div style={{ display: "grid", gap: "12px", maxWidth: "720px" }}>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Carrier
            <select
              value={carrierId}
              onChange={(e) => setCarrierId(e.target.value)}
              disabled={loading}
              style={{ ...S.input, marginTop: "6px" }}
            >
              {carriers.length === 0 ? (
                <option value="">등록된 보험사 없음</option>
              ) : (
                carriers.map((carrier) => (
                  <option key={carrier.id} value={carrier.id}>
                    {carrier.carrier_name ?? carrier.id}
                  </option>
                ))
              )}
            </select>
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Product
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              disabled={loading || !carrierId}
              style={{ ...S.input, marginTop: "6px" }}
            >
              <option value="">(선택 안 함)</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.product_name ?? product.id}
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Source Name
            <input
              type="text"
              value={sourceName}
              onChange={(e) => setSourceName(e.target.value)}
              placeholder="예: 삼성생명 암보험 약관 2025"
              style={{ ...S.input, marginTop: "6px" }}
            />
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Source Type
            <select
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value)}
              style={{ ...S.input, marginTop: "6px" }}
            >
              {REAL_POLICY_SOURCE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {sourceTypeLabel(type)}
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            File Reference
            <input
              type="text"
              value={sourceFileReference}
              onChange={(e) => setSourceFileReference(e.target.value)}
              placeholder="policy-pdfs/carrier/product/file.pdf"
              style={{ ...S.input, marginTop: "6px" }}
            />
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Version
            <input
              type="text"
              value={sourceVersion}
              onChange={(e) => setSourceVersion(e.target.value)}
              placeholder="예: 2025-03"
              style={{ ...S.input, marginTop: "6px" }}
            />
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Notes
            <textarea
              value={sourceNotes}
              onChange={(e) => setSourceNotes(e.target.value)}
              rows={3}
              style={{ ...S.input, marginTop: "6px", resize: "vertical" }}
            />
          </label>
          <button
            type="button"
            style={{ ...S.btn, opacity: registering ? 0.6 : 1, maxWidth: "280px" }}
            disabled={registering || loading || !carrierId}
            onClick={handleRegister}
          >
            {registering ? "등록 중…" : "실제 자료 등록"}
          </button>
        </div>
      </section>

      {registerResult ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            등록 결과
          </h2>
          <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
            <div>Policy Source ID: {registerResult.policySourceId ?? "—"}</div>
            <div>Status: {sourceStatusLabel(registerResult.sourceStatus)}</div>
            {registerResult.missingInformation?.length ? (
              <div>
                Missing Information:{" "}
                {registerResult.missingInformation.map(missingLabel).join(", ")}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section style={S.card}>
        <h2 style={{ margin: "0 0 16px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
          검토
        </h2>
        <div style={{ display: "grid", gap: "12px", maxWidth: "720px" }}>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Source
            <select
              value={selectedSourceId}
              onChange={(e) => setSelectedSourceId(e.target.value)}
              style={{ ...S.input, marginTop: "6px" }}
            >
              {sources.length === 0 ? (
                <option value="">등록된 자료 없음</option>
              ) : (
                sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.source_name} ({sourceStatusLabel(source.source_status)})
                  </option>
                ))
              )}
            </select>
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Review Status
            <select
              value={reviewStatus}
              onChange={(e) => setReviewStatus(e.target.value)}
              style={{ ...S.input, marginTop: "6px" }}
            >
              {REVIEW_STATUSES.filter((status) => status !== "pending").map((status) => (
                <option key={status} value={status}>
                  {reviewStatusLabel(status)}
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Review Notes
            <textarea
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              rows={3}
              style={{ ...S.input, marginTop: "6px", resize: "vertical" }}
            />
          </label>
          <button
            type="button"
            style={{
              ...S.btn,
              opacity: reviewing ? 0.6 : 1,
              maxWidth: "280px",
              background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
            }}
            disabled={reviewing || !selectedSourceId}
            onClick={handleReview}
          >
            {reviewing ? "검토 중…" : "검토 저장"}
          </button>
        </div>
      </section>

      {reviewResult ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            검토 결과
          </h2>
          <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
            <div>Review ID: {reviewResult.reviewId ?? "—"}</div>
            <div>Source Status: {sourceStatusLabel(reviewResult.sourceStatus)}</div>
            <div>Review Status: {reviewStatusLabel(reviewResult.reviewStatus)}</div>
          </div>
        </section>
      ) : null}

      {sources.length ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            등록된 자료 ({sources.length})
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {sources.map((source) => {
              const review = reviewMap[source.id] ?? null;
              return (
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
                  <div style={{ fontWeight: 600 }}>{source.source_name}</div>
                  <div style={{ marginTop: "6px", color: "#94a3b8", lineHeight: 1.6 }}>
                    <div>Carrier: {source.carrier?.carrier_name ?? selectedCarrier?.carrier_name ?? "—"}</div>
                    <div>Product: {source.product?.product_name ?? selectedProduct?.product_name ?? "—"}</div>
                    <div>Source Type: {sourceTypeLabel(source.source_type)}</div>
                    <div>Version: {source.source_version}</div>
                    <div>Status: {sourceStatusLabel(source.source_status)}</div>
                    <div>Review Status: {reviewStatusLabel(review?.review_status ?? "pending")}</div>
                    <div>Uploaded By: {source.uploaded_by ?? "—"}</div>
                    <div>File Reference: {source.source_file_reference}</div>
                    {source.source_notes ? <div>Notes: {source.source_notes}</div> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
