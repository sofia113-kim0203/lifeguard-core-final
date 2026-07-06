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
  if (
    payload.priority_coverages ||
    payload.plan_step_codes ||
    payload.design_reason_codes ||
    payload.priority_coverage_categories
  ) {
    return payload;
  }
  return null;
}

export function normalizeDesignForDirector(visible, payload = null) {
  if (!isNonEmptyPayload(visible)) {
    return {
      design_priority: null,
      design_reason_codes: [],
      plan_step_codes: [],
      budget_band_code: null,
      budget_min: null,
      budget_max: null,
      priority_coverage_categories: [],
      priority_coverages: [],
      keep_existing_coverages: [],
      pre_enrollment_caution_codes: [],
      required_document_codes: [],
      record_count: 0,
    };
  }

  const priority_coverages = (visible.priority_coverages ?? []).filter(Boolean).slice(0, 2);
  const keep_existing_coverages = (visible.keep_existing_coverages ?? []).filter(Boolean);
  const plan_step_codes = (visible.plan_step_codes ?? []).filter(Boolean).slice(0, 4);
  const pre_enrollment_caution_codes = (visible.pre_enrollment_caution_codes ?? []).filter(Boolean).slice(0, 5);

  let record_count = priority_coverages.length;
  if (record_count === 0 && plan_step_codes.length > 0) record_count = 1;
  if (record_count === 0 && keep_existing_coverages.length > 0) {
    record_count = keep_existing_coverages.length;
  }

  const design_priority =
    payload?.insurance_design?.design_priority ?? payload?.design_priority ?? visible.design_priority ?? null;

  return {
    design_priority,
    design_reason_codes: visible.design_reason_codes ?? [],
    plan_step_codes,
    budget_band_code: visible.budget_band_code ?? null,
    budget_min: visible.budget_min ?? null,
    budget_max: visible.budget_max ?? null,
    priority_coverage_categories: visible.priority_coverage_categories ?? [],
    priority_coverages,
    keep_existing_coverages,
    pre_enrollment_caution_codes,
    required_document_codes: visible.required_document_codes ?? [],
    record_count,
  };
}

export function buildDesignContextFromPayload(payload, { jobId = null } = {}) {
  const visible = extractCustomerVisibleDesign(payload);
  const normalized = normalizeDesignForDirector(visible, payload);
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
    design_priority: normalized.design_priority,
    design_reason_codes: normalized.design_reason_codes,
    plan_step_codes: normalized.plan_step_codes,
    budget_band_code: normalized.budget_band_code,
    budget_min: normalized.budget_min,
    budget_max: normalized.budget_max,
    priority_coverage_categories: normalized.priority_coverage_categories,
    priority_coverages: normalized.priority_coverages,
    keep_existing_coverages: normalized.keep_existing_coverages,
    pre_enrollment_caution_codes: normalized.pre_enrollment_caution_codes,
    required_document_codes: normalized.required_document_codes,
  };
}

export function buildEmptyDesignContext() {
  return {
    available: false,
    loaded: false,
    record_count: 0,
    source: null,
    job_id: null,
    design_priority: null,
    design_reason_codes: [],
    plan_step_codes: [],
    budget_band_code: null,
    budget_min: null,
    budget_max: null,
    priority_coverage_categories: [],
    priority_coverages: [],
    keep_existing_coverages: [],
    pre_enrollment_caution_codes: [],
    required_document_codes: [],
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
