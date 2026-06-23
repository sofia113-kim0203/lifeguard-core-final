/**
 * P7-1 — Load stored coverage gap into Sales Director context (signals only, not readout).
 */
import { countStoredFactoryRecords } from "./salesDirectorFactoryAudit.js";

const CATEGORY_LABELS = {
  cancer: "암",
  brain: "뇌혈관",
  heart: "심혈관",
  surgery: "수술비",
  hospitalization: "입원비",
  medical_expense: "실손",
  death: "사망",
  disability: "장해",
  driver: "운전자",
  dental: "치아",
  dementia_care: "치매/간병",
  family_protection: "가족 보장",
  corporate_group: "법인/단체",
};

const GAP_LEVEL_ORDER = { critical: 0, high: 1, medium: 2, low: 3, sufficient: 4 };

function isNonEmptyPayload(value) {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(value);
}

function labelFor(item = {}) {
  return (
    item.coverage_label ??
    CATEGORY_LABELS[item.coverage_type ?? item.coverage_category] ??
    item.coverage_type ??
    item.coverage_category ??
    "기타"
  );
}

function compactStatus(item = {}) {
  const gapLevel = item.gap_level ?? null;
  const status = item.current_status ?? item.status ?? null;
  if (gapLevel === "critical" || gapLevel === "high") return "부족";
  if (gapLevel === "sufficient") return "유지";
  if (gapLevel === "medium") return "점검";
  if (status === "missing") return "공백";
  if (status === "insufficient") return "부족";
  if (status === "adequate" || status === "held") return "유지";
  if (status === "duplicate") return "중복";
  if (status === "unknown" || status === "not_evaluated") return "미확인";
  return "미확인";
}

function concernRank(item = {}) {
  const gapLevel = item.gap_level ?? null;
  const status = item.current_status ?? item.status ?? null;
  if (gapLevel === "critical") return 0;
  if (gapLevel === "high") return 1;
  if (status === "missing") return 2;
  if (status === "insufficient" || gapLevel === "medium") return 3;
  return 99;
}

export function extractCoverageGapItems(payload) {
  if (!isNonEmptyPayload(payload)) return [];

  if (Array.isArray(payload.items) && payload.items.length > 0) {
    return payload.items.map((item) => ({
      label: labelFor(item),
      status: compactStatus(item),
      gap_level: item.gap_level ?? null,
      raw_status: item.current_status ?? item.status ?? null,
    }));
  }

  if (Array.isArray(payload.coverage_gaps) && payload.coverage_gaps.length > 0) {
    return payload.coverage_gaps.map((item) => ({
      label: labelFor(item),
      status: compactStatus(item),
      gap_level: item.gap_level ?? null,
      raw_status: item.status ?? null,
    }));
  }

  if (Array.isArray(payload.top_gaps) && payload.top_gaps.length > 0) {
    return payload.top_gaps.map((item) => ({
      label: labelFor(item),
      status: compactStatus(item),
      gap_level: item.gap_level ?? null,
      raw_status: item.current_status ?? item.status ?? null,
    }));
  }

  return [];
}

export function normalizeCoverageGapForDirector(payload) {
  const items = extractCoverageGapItems(payload);
  const signals = items.map((item) => `${item.label}:${item.status}`);
  const concerns = items
    .filter((item) => ["부족", "공백", "점검", "중복"].includes(item.status))
    .sort((left, right) => concernRank(left) - concernRank(right))
    .map((item) => item.label);
  const maintained = items
    .filter((item) => item.status === "유지")
    .map((item) => item.label);

  return {
    signals,
    top_concerns: [...new Set(concerns)].slice(0, 3),
    maintained: [...new Set(maintained)].slice(0, 3),
    overall_severity: payload?.overall_risk ?? payload?.overall_severity ?? null,
    gap_score: payload?.gap_score ?? null,
    record_count: items.length || countStoredFactoryRecords("coverage_gap", payload),
  };
}

export function buildCoverageGapDirectorContextLines(coverageGapContext = null) {
  if (!coverageGapContext?.loaded || !coverageGapContext.signals?.length) return [];
  const lines = [`Gap(내부): ${coverageGapContext.signals.slice(0, 5).join(" | ")}`];
  if (coverageGapContext.top_concerns?.length) {
    lines.push(`우선관심:${coverageGapContext.top_concerns.join(",")}`);
  }
  if (coverageGapContext.maintained?.length) {
    lines.push(`유지:${coverageGapContext.maintained.join(",")}`);
  }
  return lines;
}

export function buildCoverageGapContextFromPayload(payload, { jobId = null } = {}) {
  const normalized = normalizeCoverageGapForDirector(payload);
  const available = normalized.record_count > 0 || isNonEmptyPayload(payload);
  return {
    available,
    loaded: available,
    record_count: normalized.record_count,
    source: available ? "analysis_jobs" : null,
    job_id: jobId,
    signals: normalized.signals,
    top_concerns: normalized.top_concerns,
    maintained: normalized.maintained,
    overall_severity: normalized.overall_severity,
    gap_score: normalized.gap_score,
  };
}

export function buildEmptyCoverageGapContext() {
  return {
    available: false,
    loaded: false,
    record_count: 0,
    source: null,
    job_id: null,
    signals: [],
    top_concerns: [],
    maintained: [],
    overall_severity: null,
    gap_score: null,
  };
}

export async function loadSalesDirectorCoverageGapContext(userSupabase, customerId) {
  if (!userSupabase || !customerId) {
    return buildEmptyCoverageGapContext();
  }

  const { data, error } = await userSupabase
    .from("analysis_jobs")
    .select("id, status, result_json, created_at")
    .eq("customer_id", customerId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return { ...buildEmptyCoverageGapContext(), error: error.message };
  }

  for (const job of data ?? []) {
    const payload = job?.result_json?.coverage_gap;
    if (isNonEmptyPayload(payload)) {
      return buildCoverageGapContextFromPayload(payload, { jobId: job.id ?? null });
    }
  }

  return buildEmptyCoverageGapContext();
}
