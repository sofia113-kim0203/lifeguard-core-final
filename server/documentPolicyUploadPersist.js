import {
  assembleRidersFromCandidate,
  mergeCoverageSummary,
} from "./coverageRiderPopulation.js";

const EXTRACTOR_VERSION = "step4-ocr-policy-v3-multi";

function normalizeKeyPart(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function buildUploadExtractKey(documentId, fields = {}) {
  const parts = [
    String(documentId ?? "").trim(),
    normalizeKeyPart(fields.insurer_name),
    normalizeKeyPart(fields.product_name),
    normalizeKeyPart(fields.policy_number),
    fields.monthly_premium != null && fields.monthly_premium !== ""
      ? String(fields.monthly_premium)
      : "",
  ];
  return parts.join("|");
}

export function buildCoverageSummaryFromCandidate(documentId, candidate, existingSummary = null) {
  const fields = candidate.fields ?? {};
  const uploadExtractKey = buildUploadExtractKey(documentId, fields);
  const riders = assembleRidersFromCandidate(candidate);
  const context = {
    insurer_name: fields.insurer_name ?? null,
    product_name: fields.product_name ?? null,
    plan_name: fields.plan_name ?? fields.product_name ?? null,
  };

  return mergeCoverageSummary(
    existingSummary,
    {
      source_document_id: documentId,
      upload_extract_key: uploadExtractKey,
      extractor_version: EXTRACTOR_VERSION,
      extraction_confidence: candidate.confidence ?? null,
      extraction_tier: candidate.tier ?? "full",
      candidate_tier: candidate.candidate_tier ?? null,
      block_index: candidate.block_index ?? null,
      policyholder: fields.policyholder,
      insured: fields.insured,
      beneficiaries: Array.isArray(fields.beneficiaries) ? fields.beneficiaries : [],
      party_changes: Array.isArray(fields.party_changes) ? fields.party_changes : [],
      parties: {
        policyholder: fields.policyholder ?? null,
        insured: fields.insured ?? null,
        beneficiaries: Array.isArray(fields.beneficiaries) ? fields.beneficiaries : [],
        party_changes: Array.isArray(fields.party_changes) ? fields.party_changes : [],
        ...(fields.actual_premium_funder?.name
          ? { actual_premium_funder: fields.actual_premium_funder }
          : {}),
      },
      ...(fields.actual_premium_funder?.name
        ? { actual_premium_funder: fields.actual_premium_funder }
        : {}),
      payment_period: fields.payment_period,
      insurance_period: fields.insurance_period,
      coverage_name: fields.coverage_name,
      rider_name: fields.rider_name,
      coverage_amount: fields.coverage_amount,
      coverage_categories: fields.coverage_categories ?? [],
      detected_coverages: fields.detected_coverages ?? fields.coverage_categories ?? [],
      effective_from: fields.effective_from,
      policy_number: fields.policy_number ?? null,
      extracted_at: new Date().toISOString(),
      extraction_json: fields,
    },
    riders,
    context,
  );
}

export function buildPolicyRowFromCandidate(customerId, documentId, candidate, existingCoverageSummary = null) {
  const fields = candidate.fields ?? {};
  const coverageSummary = buildCoverageSummaryFromCandidate(documentId, candidate, existingCoverageSummary);

  return {
    customer_id: customerId,
    insurer_name: fields.insurer_name,
    product_name: fields.product_name,
    policy_type: fields.policy_type,
    monthly_premium: fields.monthly_premium,
    effective_from: fields.effective_from ?? null,
    coverage_summary: coverageSummary,
    source: "upload_extract",
    is_active: true,
    updated_at: new Date().toISOString(),
  };
}

export function resolveExistingPolicyForCandidate(existingRows, documentId, candidate, candidateCount) {
  const fields = candidate.fields ?? {};
  const uploadExtractKey = buildUploadExtractKey(documentId, fields);
  const activeRows = (existingRows ?? []).filter((row) => row.is_active !== false);

  const byKey = activeRows.find((row) => row.coverage_summary?.upload_extract_key === uploadExtractKey);
  if (byKey) return { row: byKey, upload_extract_key: uploadExtractKey };

  const legacyRows = activeRows.filter((row) => row.coverage_summary?.source_document_id === documentId);
  if (legacyRows.length === 1 && candidateCount === 1 && !legacyRows[0].coverage_summary?.upload_extract_key) {
    return { row: legacyRows[0], upload_extract_key: uploadExtractKey };
  }

  return { row: null, upload_extract_key: uploadExtractKey };
}

export function planRetiredPolicyIds(existingRows, documentId, activeKeys) {
  const keySet = new Set(activeKeys);
  return (existingRows ?? [])
    .filter((row) => row.is_active !== false)
    .filter((row) => row.coverage_summary?.source_document_id === documentId)
    .filter((row) => {
      const key = row.coverage_summary?.upload_extract_key;
      if (!key) return true;
      return !keySet.has(key);
    })
    .map((row) => row.id);
}

/**
 * KEY(Claude)-confirmed contract facts on the existing customer card
 * (profile_insurance_policies.coverage_summary JSONB). No new table/migration.
 * OCR must never own or wipe this list — see mergeCoverageSummary preserve.
 */
export const KEY_CONFIRMED_SOURCE_FACT_TYPES = Object.freeze([
  "policyholder",
  "insured",
  "beneficiary",
  "beneficiaries",
  "insurer",
  "insurer_name",
  "product_name",
  "premium",
  "monthly_premium",
  "coverage_name",
  "coverage_amount",
  "payment_period",
  "insurance_period",
  "effective_from",
  "change_date",
  "policy_number",
]);

const KEY_CONFIRMED_FACT_TYPE_SET = new Set(KEY_CONFIRMED_SOURCE_FACT_TYPES);

export function keyConfirmedSourceFactDedupeKey(fact = {}) {
  return [
    String(fact.fact_type ?? "").trim().toLowerCase(),
    String(fact.literal_value ?? "").trim(),
    String(fact.source_document_id ?? "").trim(),
  ].join("::");
}

export function normalizeKeyConfirmedSourceFacts(rawFacts = [], defaults = {}) {
  const rows = Array.isArray(rawFacts) ? rawFacts : [];
  const defaultDocId =
    defaults.source_document_id != null && String(defaults.source_document_id).trim()
      ? String(defaults.source_document_id).trim()
      : null;
  const confirmedAt =
    defaults.confirmed_at != null && String(defaults.confirmed_at).trim()
      ? String(defaults.confirmed_at).trim()
      : new Date().toISOString();
  const out = [];
  const seen = new Set();

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const fact_type = String(row.fact_type ?? "")
      .trim()
      .toLowerCase();
    if (!fact_type || !KEY_CONFIRMED_FACT_TYPE_SET.has(fact_type)) continue;
    if (row.literal_value == null || String(row.literal_value).trim() === "") continue;
    // Preserve original literal — never coerce (e.g. 9999세 stays 9999세).
    const literal_value = String(row.literal_value);
    const source_document_id =
      row.source_document_id != null && String(row.source_document_id).trim()
        ? String(row.source_document_id).trim()
        : defaultDocId;
    if (!source_document_id) continue;

    let source_locator = null;
    if (row.source_locator && typeof row.source_locator === "object") {
      const loc = row.source_locator;
      source_locator = {
        ...(loc.page != null ? { page: loc.page } : {}),
        ...(loc.section != null ? { section: String(loc.section) } : {}),
        ...(loc.table_row != null ? { table_row: String(loc.table_row) } : {}),
        ...(loc.row != null && loc.table_row == null ? { table_row: String(loc.row) } : {}),
        ...(loc.source_text != null ? { source_text: String(loc.source_text) } : {}),
      };
      if (Object.keys(source_locator).length === 0) source_locator = null;
    }

    const fact = {
      fact_type,
      literal_value,
      source_document_id,
      source_locator,
      confirmed_at:
        row.confirmed_at != null && String(row.confirmed_at).trim()
          ? String(row.confirmed_at).trim()
          : confirmedAt,
      confirmation_source: "key_claude_original_document",
    };
    const key = keyConfirmedSourceFactDedupeKey(fact);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(fact);
  }
  return out;
}

export function mergeKeyConfirmedSourceFacts(existing = [], incoming = []) {
  const map = new Map();
  for (const fact of [
    ...normalizeKeyConfirmedSourceFacts(existing),
    ...normalizeKeyConfirmedSourceFacts(incoming),
  ]) {
    map.set(keyConfirmedSourceFactDedupeKey(fact), fact);
  }
  return [...map.values()];
}

/**
 * After customer answer is sealed — store KEY-confirmed facts only.
 * Failures must not rewrite the answer or call Claude again.
 */
export async function persistKeyConfirmedSourceFactsToPolicies({
  supabase = null,
  customerId = null,
  facts = [],
} = {}) {
  const normalized = normalizeKeyConfirmedSourceFacts(facts);
  if (!supabase || !customerId || normalized.length === 0) {
    return {
      ok: false,
      attempted: Boolean(supabase && customerId && Array.isArray(facts) && facts.length),
      reason: !supabase
        ? "no_supabase"
        : !customerId
          ? "no_customer_id"
          : normalized.length === 0
            ? "no_valid_facts"
            : "skip",
      stored: 0,
      updated_policy_ids: [],
    };
  }

  const byDoc = new Map();
  for (const fact of normalized) {
    const list = byDoc.get(fact.source_document_id) ?? [];
    list.push(fact);
    byDoc.set(fact.source_document_id, list);
  }

  const updated_policy_ids = [];
  let stored = 0;
  const errors = [];

  for (const [documentId, docFacts] of byDoc.entries()) {
    const { data: rows, error: selectError } = await supabase
      .from("profile_insurance_policies")
      .select("id, coverage_summary, is_active")
      .eq("customer_id", customerId)
      .eq("is_active", true);

    if (selectError) {
      errors.push({ document_id: documentId, stage: "select", message: selectError.message });
      continue;
    }

    const matches = (rows ?? []).filter(
      (row) => row?.coverage_summary?.source_document_id === documentId,
    );
    if (matches.length === 0) {
      errors.push({ document_id: documentId, stage: "match", message: "no_policy_row_for_document" });
      continue;
    }

    for (const row of matches) {
      const existingSummary =
        row.coverage_summary && typeof row.coverage_summary === "object"
          ? row.coverage_summary
          : {};
      const mergedFacts = mergeKeyConfirmedSourceFacts(
        existingSummary.key_confirmed_source_facts,
        docFacts,
      );
      const nextSummary = {
        ...existingSummary,
        key_confirmed_source_facts: mergedFacts,
      };
      const { error: updateError } = await supabase
        .from("profile_insurance_policies")
        .update({
          coverage_summary: nextSummary,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .eq("customer_id", customerId);

      if (updateError) {
        errors.push({
          document_id: documentId,
          policy_id: row.id,
          stage: "update",
          message: updateError.message,
        });
        continue;
      }
      updated_policy_ids.push(row.id);
      stored += docFacts.length;
    }
  }

  return {
    ok: errors.length === 0 && updated_policy_ids.length > 0,
    attempted: true,
    stored,
    updated_policy_ids,
    errors,
  };
}

export { EXTRACTOR_VERSION };
