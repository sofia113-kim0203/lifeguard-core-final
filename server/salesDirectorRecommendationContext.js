/**
 * P7-1 — Load stored recommendation into KEY context (read-only; customer_visible_top2 only).
 */
import { countStoredFactoryRecords } from "./salesDirectorFactoryAudit.js";

const TYPE_COMPACT = {
  add_coverage: "우선검토",
  prepare_documents: "서류준비",
  review_existing: "구조점검",
};

function isNonEmptyPayload(value) {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(value);
}

function compactType(item = {}) {
  const raw = item.recommendation_type ?? null;
  if (raw && TYPE_COMPACT[raw]) return TYPE_COMPACT[raw];
  return "우선검토";
}

function normalizeTop2Item(item = {}) {
  const label = String(item.coverage_label ?? "").trim();
  if (!label) return null;
  return {
    label,
    priority_type: compactType(item),
    signal: `${label}:${compactType(item)}`,
  };
}

export function extractRecommendationTop2Items(payload) {
  if (!isNonEmptyPayload(payload)) return [];
  const top2 = payload.customer_visible_top2 ?? [];
  if (!Array.isArray(top2)) return [];
  return top2.map(normalizeTop2Item).filter(Boolean).slice(0, 2);
}

export function normalizeRecommendationForDirector(payload) {
  const items = extractRecommendationTop2Items(payload);
  return {
    priority_labels: items.map((item) => item.label),
    priority_signals: items.map((item) => item.signal),
    priority_types: items.map((item) => item.priority_type),
    record_count: items.length || countStoredFactoryRecords("recommendation", payload),
  };
}

export function buildRecommendationContextFromPayload(payload, { jobId = null } = {}) {
  const normalized = normalizeRecommendationForDirector(payload);
  const available = normalized.record_count > 0;
  return {
    available,
    loaded: available,
    record_count: normalized.record_count,
    source: available ? "analysis_jobs" : null,
    job_id: jobId,
    priority_labels: normalized.priority_labels,
    priority_signals: normalized.priority_signals,
    priority_types: normalized.priority_types,
  };
}

export function buildEmptyRecommendationContext() {
  return {
    available: false,
    loaded: false,
    record_count: 0,
    source: null,
    job_id: null,
    priority_labels: [],
    priority_signals: [],
    priority_types: [],
  };
}

export async function loadSalesDirectorRecommendationContext(userSupabase, customerId) {
  if (!userSupabase || !customerId) {
    return buildEmptyRecommendationContext();
  }

  const { data, error } = await userSupabase
    .from("analysis_jobs")
    .select("id, status, result_json, created_at")
    .eq("customer_id", customerId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return { ...buildEmptyRecommendationContext(), error: error.message };
  }

  for (const job of data ?? []) {
    const payload = job?.result_json?.recommendation;
    const top2 = extractRecommendationTop2Items(payload);
    if (top2.length > 0 || isNonEmptyPayload(payload?.customer_visible_top2)) {
      return buildRecommendationContextFromPayload(payload, { jobId: job.id ?? null });
    }
  }

  return buildEmptyRecommendationContext();
}
