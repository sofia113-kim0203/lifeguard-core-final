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

/** Customer-card claim cases — stored in existing profile_health.details_json (no new table). */
export const KEY_ACTIVE_CLAIM_CASES_FACT_PATH = "key_active_claim_cases";

export const KEY_CLAIM_CASE_STATUSES = Object.freeze([
  "identified",
  "preparing",
  "ready_for_customer_submission",
  "submitted_by_customer",
  "under_review",
  "paid",
  "denied",
  "closed",
]);

export const KEY_CLAIM_ASSESSMENTS = Object.freeze([
  "claim_warranted",
  "claim_possible",
  "needs_policy_or_docs",
  "insufficient_evidence",
]);

const KEY_CLAIM_STATUS_SET = new Set(KEY_CLAIM_CASE_STATUSES);
const KEY_CLAIM_ASSESSMENT_SET = new Set(KEY_CLAIM_ASSESSMENTS);
const KEY_CLAIM_STATUS_NEEDS_EVIDENCE = new Set([
  "submitted_by_customer",
  "under_review",
  "paid",
  "denied",
]);

function normalizeClaimString(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s : null;
}

function normalizeClaimStringList(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const s = normalizeClaimString(typeof item === "string" ? item : item?.name ?? item?.label);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/**
 * Stable claim_case_key only — never invent a fresh UUID per turn.
 * Priority: explicit key → source_document_id+event_date → event_date+event_kind.
 */
export function resolveStableClaimCaseKey(row = {}) {
  const explicit = normalizeClaimString(row.claim_case_key);
  if (explicit) return explicit.slice(0, 180);

  const medical =
    row.medical_event && typeof row.medical_event === "object" ? row.medical_event : {};
  const docId = normalizeClaimString(
    medical.source_document_id ?? row.source_document_id,
  );
  const eventDate = normalizeClaimString(
    medical.event_date ??
      medical.surgery_date ??
      medical.diagnosis_date ??
      medical.admission_date ??
      row.event_date,
  );
  const eventKind = normalizeClaimString(
    medical.event_kind ?? medical.diagnosis_name ?? medical.surgery_name ?? row.event_kind,
  );

  if (docId && eventDate) return `doc:${docId}:date:${eventDate}`.slice(0, 180);
  if (eventDate && eventKind) return `date:${eventDate}:kind:${eventKind}`.slice(0, 180);
  return null;
}

function normalizeMedicalEvent(raw = null) {
  if (!raw || typeof raw !== "object") return null;
  const event = {
    diagnosis_name: normalizeClaimString(raw.diagnosis_name),
    diagnosis_code: normalizeClaimString(raw.diagnosis_code),
    diagnosis_certainty: normalizeClaimString(raw.diagnosis_certainty),
    event_kind: normalizeClaimString(raw.event_kind),
    surgery_name: normalizeClaimString(raw.surgery_name),
    diagnosis_date: normalizeClaimString(raw.diagnosis_date),
    surgery_date: normalizeClaimString(raw.surgery_date),
    admission_date: normalizeClaimString(raw.admission_date),
    discharge_date: normalizeClaimString(raw.discharge_date),
    event_date: normalizeClaimString(raw.event_date),
    facility_name: normalizeClaimString(raw.facility_name ?? raw.medical_facility),
    source_document_id: normalizeClaimString(raw.source_document_id),
  };
  if (raw.source_locator && typeof raw.source_locator === "object") {
    const loc = raw.source_locator;
    const source_locator = {
      ...(loc.page != null ? { page: loc.page } : {}),
      ...(loc.section != null ? { section: String(loc.section) } : {}),
      ...(loc.source_text != null ? { source_text: String(loc.source_text) } : {}),
    };
    if (Object.keys(source_locator).length) event.source_locator = source_locator;
  }
  const hasAny = Object.values(event).some((v) => v != null && v !== "");
  return hasAny ? event : null;
}

function normalizeAssessment(raw = null) {
  if (!raw) return null;
  if (typeof raw === "string") {
    const code = raw.trim().toLowerCase();
    if (!KEY_CLAIM_ASSESSMENT_SET.has(code)) return null;
    return { code, rationale: null, evidence_refs: [] };
  }
  if (typeof raw !== "object") return null;
  const code = normalizeClaimString(raw.code ?? raw.assessment)?.toLowerCase();
  if (!code || !KEY_CLAIM_ASSESSMENT_SET.has(code)) return null;
  return {
    code,
    rationale: normalizeClaimString(raw.rationale ?? raw.reason),
    evidence_refs: normalizeClaimStringList(raw.evidence_refs ?? raw.evidence ?? []),
  };
}

function normalizeClaimStatus(rawStatus, { priorStatus = null, evidence = [] } = {}) {
  const status = normalizeClaimString(rawStatus)?.toLowerCase();
  if (!status || !KEY_CLAIM_STATUS_SET.has(status)) {
    return priorStatus && KEY_CLAIM_STATUS_SET.has(priorStatus) ? priorStatus : "identified";
  }
  if (KEY_CLAIM_STATUS_NEEDS_EVIDENCE.has(status)) {
    const hasEvidence = Array.isArray(evidence) && evidence.length > 0;
    if (!hasEvidence) {
      // Do not advance on KEY speculation alone.
      if (priorStatus && KEY_CLAIM_STATUS_SET.has(priorStatus)) return priorStatus;
      return "preparing";
    }
  }
  return status;
}

export function normalizeKeyClaimCaseUpdates(rawUpdates = [], defaults = {}) {
  const rows = Array.isArray(rawUpdates) ? rawUpdates : [];
  const updatedAt =
    defaults.updated_at != null && String(defaults.updated_at).trim()
      ? String(defaults.updated_at).trim()
      : new Date().toISOString();
  const out = [];
  const seen = new Set();

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const claim_case_key = resolveStableClaimCaseKey(row);
    if (!claim_case_key) continue;
    if (seen.has(claim_case_key)) continue;
    seen.add(claim_case_key);

    const evidence = normalizeClaimStringList(row.evidence);
    const medical_event = normalizeMedicalEvent(row.medical_event);
    const assessment = normalizeAssessment(row.assessment);
    const status = normalizeClaimStatus(row.status, { evidence });

    out.push({
      claim_case_key,
      medical_event,
      related_policies: normalizeClaimStringList(row.related_policies),
      related_coverages: normalizeClaimStringList(row.related_coverages),
      assessment,
      required_documents: normalizeClaimStringList(row.required_documents),
      available_documents: normalizeClaimStringList(row.available_documents),
      missing_documents: normalizeClaimStringList(row.missing_documents),
      status,
      next_action: normalizeClaimString(row.next_action),
      evidence,
      updated_at: normalizeClaimString(row.updated_at) ?? updatedAt,
      card_source: "key_claude_claim_case",
    });
  }
  return out;
}

export function mergeKeyActiveClaimCases(existing = [], incoming = []) {
  const map = new Map();
  for (const row of [
    ...normalizeKeyClaimCaseUpdates(existing),
    ...normalizeKeyClaimCaseUpdates(incoming),
  ]) {
    const prior = map.get(row.claim_case_key);
    if (!prior) {
      map.set(row.claim_case_key, row);
      continue;
    }
    const evidence = [
      ...new Set([...(prior.evidence ?? []), ...(row.evidence ?? [])]),
    ];
    const status = normalizeClaimStatus(row.status, {
      priorStatus: prior.status,
      evidence,
    });
    map.set(row.claim_case_key, {
      ...prior,
      ...row,
      medical_event: row.medical_event ?? prior.medical_event,
      related_policies: row.related_policies?.length
        ? row.related_policies
        : prior.related_policies,
      related_coverages: row.related_coverages?.length
        ? row.related_coverages
        : prior.related_coverages,
      assessment: row.assessment ?? prior.assessment,
      required_documents: row.required_documents?.length
        ? row.required_documents
        : prior.required_documents,
      available_documents: [
        ...new Set([
          ...(prior.available_documents ?? []),
          ...(row.available_documents ?? []),
        ]),
      ],
      missing_documents: row.missing_documents?.length
        ? row.missing_documents
        : prior.missing_documents,
      status,
      evidence,
      updated_at: row.updated_at ?? prior.updated_at,
    });
  }
  return [...map.values()];
}

export async function loadKeyActiveClaimCases({ supabase = null, customerId = null } = {}) {
  if (!supabase || !customerId) return [];
  const { data, error } = await supabase
    .from("profile_health")
    .select("details_json")
    .eq("customer_id", customerId)
    .maybeSingle();
  if (error || !data) return [];
  const details =
    data.details_json && typeof data.details_json === "object" ? data.details_json : {};
  return normalizeKeyClaimCaseUpdates(details[KEY_ACTIVE_CLAIM_CASES_FACT_PATH]);
}

/** True when a claim case is clearly sourced from this upload document. */
export function claimCaseReferencesSourceDocument(row = null, documentId = null) {
  const did = String(documentId ?? "").trim();
  if (!did || !row || typeof row !== "object") return false;
  const medical =
    row.medical_event && typeof row.medical_event === "object" ? row.medical_event : {};
  if (String(medical.source_document_id ?? "").trim() === did) return true;
  if (String(row.source_document_id ?? "").trim() === did) return true;
  const key = String(row.claim_case_key ?? "").trim();
  if (key.startsWith(`doc:${did}:`)) return true;
  return false;
}

/** Drop claim cases whose only clear provenance is the deleted document. */
export function filterKeyActiveClaimCasesExcludingSourceDocument(
  cases = [],
  documentId = null,
) {
  const did = String(documentId ?? "").trim();
  if (!did) return normalizeKeyClaimCaseUpdates(cases);
  return normalizeKeyClaimCaseUpdates(cases).filter(
    (row) => !claimCaseReferencesSourceDocument(row, did),
  );
}

/**
 * After source document soft-delete — remove clearly document-sourced claim cases
 * from customer-card JSON. Does not invent replacements.
 */
export async function removeKeyActiveClaimCasesForSourceDocument({
  supabase = null,
  customerId = null,
  documentId = null,
} = {}) {
  const did = String(documentId ?? "").trim();
  if (!supabase || !customerId || !did) {
    return {
      ok: false,
      attempted: false,
      removed: 0,
      reason: !supabase ? "no_supabase" : !customerId ? "no_customer_id" : "no_document_id",
    };
  }

  const { data: row, error: selectError } = await supabase
    .from("profile_health")
    .select("customer_id, details_json")
    .eq("customer_id", customerId)
    .maybeSingle();

  if (selectError) {
    return { ok: false, attempted: true, removed: 0, error: selectError.message };
  }
  if (!row?.customer_id) {
    return { ok: true, attempted: true, removed: 0, reason: "no_profile_health_row" };
  }

  const existingDetails =
    row.details_json && typeof row.details_json === "object" ? row.details_json : {};
  const existing = normalizeKeyClaimCaseUpdates(
    existingDetails[KEY_ACTIVE_CLAIM_CASES_FACT_PATH],
  );
  const next = filterKeyActiveClaimCasesExcludingSourceDocument(existing, did);
  const removed = Math.max(0, existing.length - next.length);
  if (removed === 0) {
    return { ok: true, attempted: true, removed: 0, case_count: existing.length };
  }

  const nextDetails = {
    ...existingDetails,
    [KEY_ACTIVE_CLAIM_CASES_FACT_PATH]: next,
  };
  const { error: updateError } = await supabase
    .from("profile_health")
    .update({
      details_json: nextDetails,
      updated_at: new Date().toISOString(),
    })
    .eq("customer_id", customerId);

  if (updateError) {
    return { ok: false, attempted: true, removed: 0, error: updateError.message };
  }
  return { ok: true, attempted: true, removed, case_count: next.length };
}

/**
 * Persist KEY claim-case updates into existing customer card JSON.
 * Failures must not rewrite the customer answer.
 */
export async function persistKeyActiveClaimCases({
  supabase = null,
  customerId = null,
  claimCaseUpdates = [],
} = {}) {
  const incoming = normalizeKeyClaimCaseUpdates(claimCaseUpdates);
  if (!supabase || !customerId || incoming.length === 0) {
    return {
      ok: false,
      attempted: Boolean(
        supabase && customerId && Array.isArray(claimCaseUpdates) && claimCaseUpdates.length,
      ),
      reason: !supabase
        ? "no_supabase"
        : !customerId
          ? "no_customer_id"
          : incoming.length === 0
            ? "no_stable_claim_case_key"
            : "skip",
      stored: 0,
    };
  }

  const { data: row, error: selectError } = await supabase
    .from("profile_health")
    .select("customer_id, details_json")
    .eq("customer_id", customerId)
    .maybeSingle();

  if (selectError) {
    return {
      ok: false,
      attempted: true,
      stored: 0,
      error: selectError.message,
    };
  }

  const existingDetails =
    row?.details_json && typeof row.details_json === "object" ? row.details_json : {};
  const merged = mergeKeyActiveClaimCases(
    existingDetails[KEY_ACTIVE_CLAIM_CASES_FACT_PATH],
    incoming,
  );
  const nextDetails = {
    ...existingDetails,
    [KEY_ACTIVE_CLAIM_CASES_FACT_PATH]: merged,
  };

  if (row?.customer_id) {
    const { error: updateError } = await supabase
      .from("profile_health")
      .update({
        details_json: nextDetails,
        updated_at: new Date().toISOString(),
      })
      .eq("customer_id", customerId);
    if (updateError) {
      return { ok: false, attempted: true, stored: 0, error: updateError.message };
    }
  } else {
    const { error: insertError } = await supabase.from("profile_health").insert({
      customer_id: customerId,
      details_json: nextDetails,
      source: "update",
    });
    if (insertError) {
      return { ok: false, attempted: true, stored: 0, error: insertError.message };
    }
  }

  return {
    ok: true,
    attempted: true,
    stored: incoming.length,
    case_count: merged.length,
  };
}

export { EXTRACTOR_VERSION };
