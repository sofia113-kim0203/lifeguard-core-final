import { useState } from "react";
import {
  validateProductionDataFlow,
  loadProductionDataFlowValidationRun,
  loadProductionDataFlowValidationStages,
  PRODUCTION_VALIDATION_STATUS_LABELS,
  PRODUCTION_VALIDATION_STAGE_NAME_LABELS,
  PRODUCTION_VALIDATION_STAGE_STATUS_LABELS,
  PRODUCTION_VALIDATION_MISSING_LABELS,
} from "../lib/productionDataFlowValidation.js";

const FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

const SCOPE_OPTIONS = [
  { value: "full_pipeline", label: "전체 파이프라인 (full_pipeline)" },
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

function missingLabel(code) {
  return PRODUCTION_VALIDATION_MISSING_LABELS[code] ?? code;
}

function validationStatusLabel(status) {
  return PRODUCTION_VALIDATION_STATUS_LABELS[status] ?? status;
}

function stageNameLabel(name) {
  return PRODUCTION_VALIDATION_STAGE_NAME_LABELS[name] ?? name;
}

function stageStatusLabel(status) {
  return PRODUCTION_VALIDATION_STAGE_STATUS_LABELS[status] ?? status;
}

export default function AdminProductionDataFlowValidationPanel() {
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState("");
  const [validateResult, setValidateResult] = useState(null);
  const [run, setRun] = useState(null);
  const [stages, setStages] = useState([]);
  const [validationScope, setValidationScope] = useState("full_pipeline");

  const refreshRun = async (runId) => {
    const [runRow, stageRows] = await Promise.all([
      loadProductionDataFlowValidationRun(runId),
      loadProductionDataFlowValidationStages(runId),
    ]);
    setRun(runRow);
    setStages(stageRows);
  };

  const handleValidate = async () => {
    setValidating(true);
    setError("");
    setValidateResult(null);
    try {
      const data = await validateProductionDataFlow({ validationScope });
      setValidateResult(data);
      if (data.productionValidationRunId) {
        await refreshRun(data.productionValidationRunId);
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
          운영 데이터 흐름 검증
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: "15px", color: "#94a3b8", lineHeight: 1.55 }}>
          Lifeguard 파이프라인 전체 데이터 흐름 준비 상태를 검증합니다. 외부 API·Claude·Embedding 실행 없음.
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
            Validation Scope
            <select
              value={validationScope}
              onChange={(e) => setValidationScope(e.target.value)}
              style={{ ...S.input, marginTop: "6px" }}
            >
              {SCOPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            style={{ ...S.btn, opacity: validating ? 0.6 : 1, maxWidth: "280px" }}
            disabled={validating}
            onClick={handleValidate}
          >
            {validating ? "검증 중…" : "흐름 검증 실행"}
          </button>
        </div>
      </section>

      {run || validateResult ? (
        <section style={S.card}>
          <h2 style={{ margin: "0 0 12px", fontSize: "17px", fontWeight: 700, color: "#f8fafc" }}>
            검증 결과
          </h2>
          <div style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.7 }}>
            <div>Validation Scope: {run?.validation_scope ?? validationScope ?? "—"}</div>
            <div>
              Readiness Score: {run?.readiness_score ?? validateResult?.readinessScore ?? 0}%
            </div>
            <div>
              Completed Stages: {run?.completed_stages ?? validateResult?.completedStages ?? 0}
            </div>
            <div>Failed Stages: {run?.failed_stages ?? validateResult?.failedStages ?? 0}</div>
            <div>
              Validation Status:{" "}
              {validationStatusLabel(run?.validation_status ?? validateResult?.validationStatus)}
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
