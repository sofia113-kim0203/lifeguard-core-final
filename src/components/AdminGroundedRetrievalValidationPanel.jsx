import { useCallback, useEffect, useState } from "react";
import {
  loadCarriersForManualKnowledge,
  loadProductsForManualKnowledge,
  validateGroundedRetrieval,
  loadGroundedRetrievalValidationRun,
  loadGroundedRetrievalValidationStages,
  VALIDATION_STATUS_LABELS,
  VALIDATION_STAGE_NAME_LABELS,
  VALIDATION_STAGE_STATUS_LABELS,
  VALIDATION_MISSING_LABELS,
} from "../lib/groundedRetrievalValidation.js";

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
  return VALIDATION_MISSING_LABELS[code] ?? code;
}

function validationStatusLabel(status) {
  return VALIDATION_STATUS_LABELS[status] ?? status;
}

function stageNameLabel(name) {
  return VALIDATION_STAGE_NAME_LABELS[name] ?? name;
}

function stageStatusLabel(status) {
  return VALIDATION_STAGE_STATUS_LABELS[status] ?? status;
}

export default function AdminGroundedRetrievalValidationPanel() {
  const [carriers, setCarriers] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState("");
  const [validateResult, setValidateResult] = useState(null);
  const [run, setRun] = useState(null);
  const [stages, setStages] = useState([]);

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

  useEffect(() => {
    loadCarriers();
  }, [loadCarriers]);

  useEffect(() => {
    if (!carrierId) {
      setProducts([]);
      setProductId("");
      return;
    }
    loadProductsForManualKnowledge(carrierId)
      .then((rows) => {
        setProducts(rows);
        if (rows.length) {
          setProductId((current) => current || rows[0].id);
        } else {
          setProductId("");
        }
      })
      .catch((err) => {
        setError(err.message);
        setProducts([]);
      });
  }, [carrierId]);

  const selectedCarrier = carriers.find((row) => row.id === carrierId) ?? null;
  const selectedProduct = products.find((row) => row.id === productId) ?? null;

  const refreshRun = async (runId) => {
    const [runRow, stageRows] = await Promise.all([
      loadGroundedRetrievalValidationRun(runId),
      loadGroundedRetrievalValidationStages(runId),
    ]);
    setRun(runRow);
    setStages(stageRows);
  };

  const handleValidate = async () => {
    if (!query.trim()) {
      setError("Query를 입력해 주세요.");
      return;
    }
    setValidating(true);
    setError("");
    setValidateResult(null);
    try {
      const data = await validateGroundedRetrieval({
        query,
        carrierId: carrierId || null,
        productId: productId || null,
      });
      setValidateResult(data);
      if (data.validationRunId) {
        await refreshRun(data.validationRunId);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setValidating(false);
    }
  };

  const missingInfo = [
    ...(Array.isArray(run?.missing_information) ? run.missing_information : []),
    ...(validateResult?.missingInformation ?? []),
  ].filter((value, index, arr) => arr.indexOf(value) === index);

  return (
    <div style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#f8fafc" }}>
          Grounded Retrieval 검증
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: "15px", color: "#94a3b8", lineHeight: 1.55 }}>
          정책 Query부터 Grounding Context·Claude 실행 준비까지 검색 체인을 검증합니다. Claude 직접 호출·심사/추천 결정 없음.
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
          검증 실행
        </h2>
        <div style={{ display: "grid", gap: "12px", maxWidth: "720px" }}>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Query
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="예: 암 진단비 보장 범위"
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
              <option value="">전체</option>
              {carriers.map((carrier) => (
                <option key={carrier.id} value={carrier.id}>
                  {carrier.carrier_name ?? carrier.id}
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
              <option value="">전체</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.product_name ?? product.id}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            style={{ ...S.btn, opacity: validating ? 0.6 : 1, maxWidth: "280px" }}
            disabled={validating || loading}
            onClick={handleValidate}
          >
            {validating ? "검증 중…" : "검증 실행"}
          </button>
        </div>
      </section>

      {run || validateResult ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            검증 결과
          </h2>
          <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
            <div>Query: {run?.query ?? query ?? "—"}</div>
            <div>Carrier: {selectedCarrier?.carrier_name ?? run?.carrier_id ?? "전체"}</div>
            <div>Product: {selectedProduct?.product_name ?? run?.product_id ?? "전체"}</div>
            <div>
              Validation Status:{" "}
              {validationStatusLabel(run?.validation_status ?? validateResult?.validationStatus)}
            </div>
            <div>
              Vector Result Count: {run?.vector_result_count ?? validateResult?.vectorResultCount ?? 0}
            </div>
            <div>
              Grounding Source Count:{" "}
              {run?.grounding_source_count ?? validateResult?.groundingSourceCount ?? 0}
            </div>
            <div>
              Claude Ready:{" "}
              {(run?.claude_ready ?? validateResult?.claudeReady) ? "예" : "아니오"}
            </div>
            {missingInfo.length ? (
              <div style={{ marginTop: "8px" }}>
                Missing Information: {missingInfo.map(missingLabel).join(", ")}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {stages.length ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            Stage Results ({stages.length})
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {stages.map((stage) => (
              <div
                key={stage.id}
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
                  {stageNameLabel(stage.stage_name)} · {stageStatusLabel(stage.stage_status)}
                </div>
                {Array.isArray(stage.missing_information) && stage.missing_information.length ? (
                  <div style={{ marginTop: "4px", color: "#94a3b8" }}>
                    Missing: {stage.missing_information.map(missingLabel).join(", ")}
                  </div>
                ) : null}
                {stage.error_message ? (
                  <div style={{ marginTop: "4px", color: "#f87171" }}>
                    Error: {stage.error_message}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
