/**
 * J-DESIGN-WIRING — Load stored insurance design into KEY context (read-only).
 * customer_visible_design from analysis_jobs only — no live recompute.
 */
import { countStoredFactoryRecords } from "./salesDirectorFactoryAudit.js";

function isNonEmptyPayload(value) {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(value);
}

/** Extract customer_visible_design only — never surface full insurance_design JSON. */
export function extractCustomerVisibleDesign(payload) {
  if (!isNonEmptyPayload(payload)) return null;
  const nested = payload.customer_visible_design;
  if (isNonEmptyPayload(nested)) return nested;
  if (payload.design_title || payload.priority_coverages || payload.design_summary) {
    return payload;
  }
  return null;
}

export function normalizeDesignForDirector(visible) {
  if (!isNonEmptyPayload(visible)) {
    return {
      design_title: null,
      design_summary: null,
      monthly_budget_range: null,
      priority_coverages: [],
      keep_existing_coverages: [],
      next_actions: [],
      pre_enrollment_cautions: [],
      disclaimer: null,
      record_count: 0,
    };
  }

  const priority_coverages = (visible.priority_coverages ?? []).filter(Boolean).slice(0, 2);
  const keep_existing_coverages = (visible.keep_existing_coverages ?? []).filter(Boolean);
  const next_actions = (visible.next_actions ?? []).filter(Boolean).slice(0, 4);
  const pre_enrollment_cautions = (visible.pre_enrollment_cautions ?? []).filter(Boolean).slice(0, 5);

  let record_count = priority_coverages.length;
  if (record_count === 0 && visible.design_summary) record_count = 1;
  if (record_count === 0 && keep_existing_coverages.length > 0) {
    record_count = keep_existing_coverages.length;
  }

  return {
    design_title: visible.design_title ?? null,
    design_summary: visible.design_summary ?? null,
    monthly_budget_range: visible.monthly_budget_range ?? null,
    priority_coverages,
    keep_existing_coverages,
    next_actions,
    pre_enrollment_cautions,
    disclaimer: visible.disclaimer ?? null,
    record_count,
  };
}

export function buildDesignContextFromPayload(payload, { jobId = null } = {}) {
  const visible = extractCustomerVisibleDesign(payload);
  const normalized = normalizeDesignForDirector(visible);
  const available =
    normalized.record_count > 0 ||
    (visible && countStoredFactoryRecords("design", payload) > 0);
  const loaded = available && normalized.record_count > 0;

  return {
    available,
    loaded,
    record_count: normalized.record_count,
    source: loaded ? "analysis_jobs" : null,
    job_id: jobId,
    design_title: normalized.design_title,
    design_summary: normalized.design_summary,
    monthly_budget_range: normalized.monthly_budget_range,
    priority_coverages: normalized.priority_coverages,
    keep_existing_coverages: normalized.keep_existing_coverages,
    next_actions: normalized.next_actions,
    pre_enrollment_cautions: normalized.pre_enrollment_cautions,
    disclaimer: normalized.disclaimer,
  };
}

export function buildEmptyDesignContext() {
  return {
    available: false,
    loaded: false,
    record_count: 0,
    source: null,
    job_id: null,
    design_title: null,
    design_summary: null,
    monthly_budget_range: null,
    priority_coverages: [],
    keep_existing_coverages: [],
    next_actions: [],
    pre_enrollment_cautions: [],
    disclaimer: null,
  };
}

export async function loadSalesDirectorInsuranceDesignContext(userSupabase, customerId) {
  if (!userSupabase || !customerId) {
    return buildEmptyDesignContext();
  }

  const { data, error } = await userSupabase
    .from("analysis_jobs")
    .select("id, status, result_json, created_at")
    .eq("customer_id", customerId)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return { ...buildEmptyDesignContext(), error: error.message };
  }

  for (const job of data ?? []) {
    const payload = job?.result_json?.insurance_design;
    const visible = extractCustomerVisibleDesign(payload);
    if (isNonEmptyPayload(visible)) {
      return buildDesignContextFromPayload(payload, { jobId: job.id ?? null });
    }
  }

  return buildEmptyDesignContext();
}
