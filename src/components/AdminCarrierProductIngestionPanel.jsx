import { useState } from "react";
import {
  prepareCarrierProductIngestion,
  CARRIER_PRODUCT_INGESTION_MISSING_LABELS,
} from "../lib/carrierProductIngestion.js";

const FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

const EXAMPLE_SOURCES = [
  { name: "보험사 약관 PDF", reference: "carrier_terms:upload_batch_001" },
  { name: "상품 안내서", reference: "product_guide:manual_import" },
  { name: "인수지침 문서", reference: "underwriting_guide:2026_q1" },
];

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
  return CARRIER_PRODUCT_INGESTION_MISSING_LABELS[code] ?? code;
}

export default function AdminCarrierProductIngestionPanel() {
  const [sourceName, setSourceName] = useState("");
  const [sourceReference, setSourceReference] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const handleRun = async () => {
    if (!sourceName.trim()) {
      setError("소스 이름을 입력해 주세요.");
      return;
    }
    if (!sourceReference.trim()) {
      setError("소스 참조를 입력해 주세요.");
      return;
    }
    setRunning(true);
    setError("");
    setResult(null);
    try {
      const data = await prepareCarrierProductIngestion({
        sourceName,
        sourceReference,
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
          보험사/상품 데이터 적재 준비
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: "15px", color: "#94a3b8", lineHeight: 1.55 }}>
          실데이터 적재 추적만 준비합니다. 가짜 보험사·상품 생성 없음.
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
            Source Name
            <input
              type="text"
              value={sourceName}
              onChange={(e) => setSourceName(e.target.value)}
              style={{ ...S.input, marginTop: "6px" }}
            />
          </label>
          <label style={{ fontSize: "13px", color: "#94a3b8" }}>
            Source Reference
            <input
              type="text"
              value={sourceReference}
              onChange={(e) => setSourceReference(e.target.value)}
              style={{ ...S.input, marginTop: "6px" }}
            />
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {EXAMPLE_SOURCES.map((src) => (
              <button
                key={src.reference}
                type="button"
                onClick={() => {
                  setSourceName(src.name);
                  setSourceReference(src.reference);
                }}
                style={{
                  padding: "6px 10px",
                  borderRadius: "8px",
                  border: "1px solid rgba(148, 163, 184, 0.2)",
                  background: "rgba(15, 23, 42, 0.5)",
                  color: "#94a3b8",
                  fontSize: "12px",
                  cursor: "pointer",
                  fontFamily: FONT,
                }}
              >
                {src.name}
              </button>
            ))}
          </div>
          <button
            type="button"
            style={{ ...S.btn, opacity: running ? 0.6 : 1, maxWidth: "280px" }}
            disabled={running}
            onClick={handleRun}
          >
            {running ? "준비 중…" : "적재 준비 실행"}
          </button>
        </div>
      </section>

      {result ? (
        <>
          <section style={S.card}>
            <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
              요약
            </h2>
            <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
              <div>ingestion_run_id: {result.ingestionRunId ?? "—"}</div>
              <div>Source Name: {result.sourceName}</div>
              <div>Source Reference: {result.sourceReference}</div>
              <div>Ingestion Status: {result.ingestionStatus ?? "—"}</div>
              <div>Carrier Count: {result.carrierCount ?? 0}</div>
              <div>Product Count: {result.productCount ?? 0}</div>
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

          <section style={S.card}>
            <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
              Ingestion Context Preview
            </h2>
            <pre
              style={{
                margin: 0,
                padding: "14px",
                borderRadius: "10px",
                background: "rgba(15, 23, 42, 0.85)",
                border: "1px solid rgba(148, 163, 184, 0.12)",
                fontSize: "11px",
                color: "#cbd5e1",
                overflow: "auto",
                maxHeight: "520px",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontFamily: "ui-monospace, monospace",
              }}
            >
              {JSON.stringify(result.ingestionContext ?? result.raw, null, 2)}
            </pre>
          </section>
        </>
      ) : null}
    </div>
  );
}
