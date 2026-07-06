/**
 * P7-1 — Load stored underwriting_risk into KEY context (read-only; no engine recompute).
 */
import { countStoredFactoryRecords } from "./salesDirectorFactoryAudit.js";

const HEALTH_RISK_LABELS = {
  hypertension: "고혈압",
  diabetes: "당뇨",
  hyperlipidemia: "고지혈증",
  cancer_history: "암 이력",
  cardiovascular: "심장질환",
  cerebrovascular: "뇌혈관질환",
  surgery_history: "수술 이력",
  hospitalization_history: "입원 이력",
  medication_history: "투약 이력",
  recent_diagnosis: "최근 진단",
  vague_health: "건강정보",
};

const UNDERWRITING_STATUS_COMPACT = {
  likely_standard: "표준",
  likely_surcharge: "할증검토",
  likely_exclusion: "부담보검토",
  likely_additional_review: "추가확인",
  likely_decline: "심사필요",
};

function isNonEmptyPayload(value) {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(value);
}

function labelForHealthRisk(item = {}) {
  return (
    item.label ??
    HEALTH_RISK_LABELS[item.risk_type] ??
    item.risk_type ??
    "건강"
  );
}

function compactHealthStatus(item = {}) {
  const status = item.status ?? item.severity ?? null;
  if (status === "high" || status === "critical") return "심사필요";
  if (status === "medium") return "추가확인";
  if (status === "low") return "점검";
  if (status === "unknown") return "미확인";
  if (status === "none") return null;
  return "확인필요";
}

function compactUnderwritingStatus(item = {}) {
  const status = item.underwriting_status ?? null;
  if (status && UNDERWRITING_STATUS_COMPACT[status]) {
    return UNDERWRITING_STATUS_COMPACT[status];
  }
  return compactHealthStatus(item) ?? "확인필요";
}

export function extractUnderwritingRiskItems(payload) {
  if (!isNonEmptyPayload(payload)) return [];

  const healthItems = (payload.health_risk_items ?? [])
    .filter((item) => item && item.status !== "none")
    .map((item) => ({
      label: labelForHealthRisk(item),
      status: compactHealthStatus(item) ?? "확인필요",
      source: "health_risk",
    }));

  if (healthItems.length > 0) return healthItems;

  const reviewBuckets = [
    payload.likely_additional_review,
    payload.likely_surcharge,
    payload.likely_exclusion,
    payload.likely_decline,
    payload.likely_standard,
    payload.items,
  ];

  for (const bucket of reviewBuckets) {
    if (!Array.isArray(bucket) || bucket.length === 0) continue;
    return bucket.map((item) => ({
      label: item.coverage_label ?? labelForHealthRisk(item),
      status: compactUnderwritingStatus(item),
      source: "underwriting_item",
    }));
  }

  return [];
}

export function normalizeUnderwritingRiskForDirector(payload) {
  const items = extractUnderwritingRiskItems(payload);
  const signals = items.map((item) => `${item.label}:${item.status}`);
  const review_flags = items
    .filter((item) => ["심사필요", "추가확인", "할증검토", "부담보검토"].includes(item.status))
    .map((item) => item.label);
  const health_topics = [...new Set(items.map((item) => item.label))].slice(0, 5);

  const riskScoreRaw = payload?.risk_score;
  const risk_score =
    typeof riskScoreRaw === "number" && Number.isFinite(riskScoreRaw)
      ? riskScoreRaw
      : Number(riskScoreRaw) || 0;

  return {
    signals,
    review_flags: [...new Set(review_flags)].slice(0, 3),
    health_topics,
    risk_score,
    overall_underwriting_risk: payload?.overall_underwriting_risk ?? null,
    overall_severity: payload?.overall_underwriting_risk ?? null,
    record_count:
      items.length ||
      (payload?.health_risk_items?.length ?? 0) ||
      countStoredFactoryRecords("underwriting", payload),
  };
}

export function buildUnderwritingRiskContextFromPayload(payload, { jobId = null } = {}) {
  const normalized = normalizeUnderwritingRiskForDirector(payload);
  const available = normalized.record_count > 0 || isNonEmptyPayload(payload);
  return {
    available,
    loaded: available,
    record_count: normalized.record_count,
    source: available ? "analysis_jobs" : null,
    job_id: jobId,
    signals: normalized.signals,
    review_flags: normalized.review_flags,
    health_topics: normalized.health_topics,
    risk_score: normalized.risk_score,
    overall_underwriting_risk: normalized.overall_underwriting_risk,
    overall_severity: normalized.overall_severity,
  };
}

export function buildEmptyUnderwritingRiskContext() {
  return {
    available: false,
    loaded: false,
    record_count: 0,
    source: null,
    job_id: null,
    signals: [],
    review_flags: [],
    health_topics: [],
    risk_score: 0,
    overall_underwriting_risk: null,
    overall_severity: null,
  };
}

export async function loadSalesDirectorUnderwritingRiskContext(userSupabase, customerId) {
  if (!userSupabase || !customerId) {
    return buildEmptyUnderwritingRiskContext();
  }

  const { data, error } = await userSupabase
    .from("analysis_jobs")
    .select("id, status, result_json, created_at")
    .eq("customer_id", customerId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return { ...buildEmptyUnderwritingRiskContext(), error: error.message };
  }

  for (const job of data ?? []) {
    const payload = job?.result_json?.underwriting_risk;
    if (isNonEmptyPayload(payload)) {
      return buildUnderwritingRiskContextFromPayload(payload, { jobId: job.id ?? null });
    }
  }

  return buildEmptyUnderwritingRiskContext();
}
