import {
  assembleRidersFromCandidate,
  mergeCoverageSummary,
} from "./coverageRiderPopulation.js";
import {
  normalizeKeyCoverageBaselineFacts,
  mergeKeyCoverageBaselineFacts,
  keyValidateCoverageBaselineFacts,
  KEY_BASELINE_FACT_STATUSES,
} from "../src/lib/keyCoverageBaselineFacts.js";

export {
  normalizeKeyCoverageBaselineFacts,
  mergeKeyCoverageBaselineFacts,
  keyValidateCoverageBaselineFacts,
  KEY_BASELINE_FACT_STATUSES,
};

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
  // Policy Date Foundation — calendar dates only (never from period prose).
  "policy.renewal_date",
  "policy.maturity_date",
  "policy.effective_from",
  "renewal_date",
  "maturity_date",
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
 * Lightweight ownership check for KEY fact confirm — no Storage download.
 * Pass only when JWT customer owns document_id and deleted_at IS NULL.
 * Distinguishes lookup error vs missing/deleted/foreign row — both block persist.
 */
export async function assertOwnedActiveSourceDocument({
  supabase = null,
  customerId = null,
  documentId = null,
} = {}) {
  const cid = String(customerId ?? "").trim();
  const did = String(documentId ?? "").trim();
  if (!supabase || !cid || !did) {
    return {
      ok: false,
      reason: !did ? "no_active_document" : "ownership_or_deleted",
    };
  }
  try {
    const { data, error } = await supabase
      .from("customer_documents")
      .select("id")
      .eq("id", did)
      .eq("customer_id", cid)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) {
      return { ok: false, reason: "ownership_lookup_error" };
    }
    if (!data?.id) {
      return { ok: false, reason: "ownership_or_deleted" };
    }
    return { ok: true, reason: null };
  } catch {
    return { ok: false, reason: "ownership_lookup_error" };
  }
}

function countRejectedReasons(rejected = []) {
  const counts = {};
  for (const row of Array.isArray(rejected) ? rejected : []) {
    const reason = String(row?.reason ?? "unknown").trim() || "unknown";
    counts[reason] = (counts[reason] ?? 0) + 1;
  }
  return counts;
}

/** Trace-safe gate summary — no document_id, literals, or source text. */
export function buildKeyConfirmedFactGateTrace({
  attempted = false,
  accepted = [],
  rejected = [],
  ownership_ok = false,
  ownership_query_count = 0,
  active_document_present = false,
  ownership_reason = null,
} = {}) {
  const trace = {
    attempted: attempted === true,
    accepted_count: Array.isArray(accepted) ? accepted.length : 0,
    rejected_reason_counts: countRejectedReasons(rejected),
    ownership_ok: ownership_ok === true,
    ownership_query_count: Number(ownership_query_count) || 0,
    active_document_present: active_document_present === true,
  };
  if (ownership_reason != null && String(ownership_reason).trim()) {
    trace.ownership_reason = String(ownership_reason).trim();
  }
  return trace;
}

/**
 * KEY confirm gate before persistKeyConfirmedSourceFactsToPolicies.
 * Claude confirmation_source is ignored — KEY stamps key_claude_original_document
 * only on accepted rows. Does not rewrite customer_answer.
 * Rejected entries carry reason (+ fact_type when known) only — never document_id/literals.
 */
export function selectKeyConfirmableSourceFacts({
  facts = [],
  activeDocumentId = null,
  ownedActiveDocumentId = null,
  ownershipFailed = false,
  ownershipFailReason = null,
} = {}) {
  const rows = Array.isArray(facts) ? facts : [];
  const activeId = String(activeDocumentId ?? "").trim() || null;
  const ownedId = String(ownedActiveDocumentId ?? "").trim() || null;
  const rejected = [];
  const accepted = [];

  const pushReject = (reason, fact_type = null) => {
    const entry = { reason: String(reason) };
    if (fact_type != null && String(fact_type).trim()) {
      entry.fact_type = String(fact_type).trim().toLowerCase();
    }
    rejected.push(entry);
  };

  if (!activeId) {
    for (const row of rows) {
      if (row == null || typeof row !== "object" || Array.isArray(row)) {
        pushReject("invalid_fact_shape");
        continue;
      }
      pushReject("no_active_document", row.fact_type ?? null);
    }
    return {
      accepted: [],
      rejected,
      ownership_ok: false,
      active_document_present: false,
    };
  }

  if (ownershipFailed === true || !ownedId || ownedId !== activeId) {
    const failReason =
      ownershipFailReason === "ownership_lookup_error"
        ? "ownership_lookup_error"
        : "ownership_or_deleted";
    for (const row of rows) {
      if (row == null || typeof row !== "object" || Array.isArray(row)) {
        pushReject("invalid_fact_shape");
        continue;
      }
      pushReject(failReason, row.fact_type ?? null);
    }
    return {
      accepted: [],
      rejected,
      ownership_ok: false,
      active_document_present: true,
    };
  }

  const seen = new Set();
  const confirmedAt = new Date().toISOString();
  for (const row of rows) {
    if (row == null || typeof row !== "object" || Array.isArray(row)) {
      pushReject("invalid_fact_shape");
      continue;
    }
    const fact_type = String(row.fact_type ?? "")
      .trim()
      .toLowerCase();
    if (!fact_type || !KEY_CONFIRMED_FACT_TYPE_SET.has(fact_type)) {
      pushReject("unsupported_fact_type", fact_type || row?.fact_type || null);
      continue;
    }
    if (row.literal_value == null || String(row.literal_value).trim() === "") {
      pushReject("empty_literal_value", fact_type);
      continue;
    }
    if (row.source_document_id == null || !String(row.source_document_id).trim()) {
      pushReject("missing_source_document_id", fact_type);
      continue;
    }
    const source_document_id = String(row.source_document_id).trim();
    if (source_document_id !== activeId) {
      pushReject("source_document_mismatch", fact_type);
      continue;
    }

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
      literal_value: String(row.literal_value),
      source_document_id: activeId,
      source_locator,
      confirmed_at:
        row.confirmed_at != null && String(row.confirmed_at).trim()
          ? String(row.confirmed_at).trim()
          : confirmedAt,
      // KEY server stamp — never trust Claude-supplied confirmation_source.
      confirmation_source: "key_claude_original_document",
    };
    const key = keyConfirmedSourceFactDedupeKey(fact);
    if (seen.has(key)) {
      pushReject("duplicate_fact", fact_type);
      continue;
    }
    seen.add(key);
    accepted.push(fact);
  }

  return {
    accepted,
    rejected,
    ownership_ok: true,
    active_document_present: true,
  };
}

/**
 * Full KEY confirm path used by Claude-first: ownership query only when rawFacts > 0.
 * Returns accepted facts + trace-safe gate (no document_id strings).
 */
export async function resolveKeyConfirmableFactsForPersist({
  supabase = null,
  customerId = null,
  activeDocumentId = null,
  facts = [],
} = {}) {
  const rawFacts = Array.isArray(facts) ? facts : [];
  const activeId = String(activeDocumentId ?? "").trim() || null;
  const activePresent = Boolean(activeId);

  if (rawFacts.length === 0) {
    return {
      accepted: [],
      gate: buildKeyConfirmedFactGateTrace({
        attempted: false,
        accepted: [],
        rejected: [],
        ownership_ok: false,
        ownership_query_count: 0,
        active_document_present: activePresent,
      }),
    };
  }

  if (!activeId) {
    const gated = selectKeyConfirmableSourceFacts({
      facts: rawFacts,
      activeDocumentId: null,
      ownedActiveDocumentId: null,
      ownershipFailed: false,
    });
    return {
      accepted: gated.accepted,
      gate: buildKeyConfirmedFactGateTrace({
        attempted: true,
        accepted: gated.accepted,
        rejected: gated.rejected,
        ownership_ok: false,
        ownership_query_count: 0,
        active_document_present: false,
      }),
    };
  }

  const owned = await assertOwnedActiveSourceDocument({
    supabase,
    customerId,
    documentId: activeId,
  });
  const gated = selectKeyConfirmableSourceFacts({
    facts: rawFacts,
    activeDocumentId: activeId,
    ownedActiveDocumentId: owned.ok === true ? activeId : null,
    ownershipFailed: owned.ok !== true,
    ownershipFailReason: owned.reason ?? null,
  });
  return {
    accepted: gated.accepted,
    gate: buildKeyConfirmedFactGateTrace({
      attempted: true,
      accepted: gated.accepted,
      rejected: gated.rejected,
      ownership_ok: owned.ok === true,
      ownership_query_count: 1,
      active_document_present: true,
      ownership_reason: owned.ok === true ? null : owned.reason,
    }),
  };
}

function literalFactValue(docFacts, ...types) {
  const set = new Set(types.map((t) => String(t).toLowerCase()));
  for (const fact of docFacts ?? []) {
    if (set.has(String(fact?.fact_type ?? "").toLowerCase())) {
      const v = String(fact.literal_value ?? "").trim();
      if (v) return v;
    }
  }
  return null;
}

function parsePremiumLiteral(raw) {
  if (raw == null) return null;
  const digits = String(raw).replace(/[^\d.]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Build / refresh policy card fields from KEY-confirmed facts.
 * C: insured/policyholder stay under coverage_summary.parties (document subjects) —
 * never written to customer_profiles.
 */
export function buildPolicyFieldsFromKeyConfirmedFacts(documentId, docFacts = [], existingSummary = null) {
  const mergedFacts = mergeKeyConfirmedSourceFacts(
    existingSummary?.key_confirmed_source_facts,
    docFacts,
  );
  const insurer =
    literalFactValue(mergedFacts, "insurer_name", "insurer") ??
    existingSummary?.insurer_name ??
    null;
  const product =
    literalFactValue(mergedFacts, "product_name") ?? existingSummary?.product_name ?? null;
  const premiumLiteral = literalFactValue(mergedFacts, "monthly_premium", "premium");
  const monthlyPremium =
    parsePremiumLiteral(premiumLiteral) ??
    (existingSummary?.monthly_premium != null ? Number(existingSummary.monthly_premium) : null);
  const policyholder = literalFactValue(mergedFacts, "policyholder");
  const insured = literalFactValue(mergedFacts, "insured");
  const existingParties =
    existingSummary?.parties && typeof existingSummary.parties === "object"
      ? existingSummary.parties
      : {};

  const coverage_summary = {
    ...(existingSummary && typeof existingSummary === "object" ? existingSummary : {}),
    source_document_id: documentId,
    key_confirmed_source_facts: mergedFacts,
    // Document contract parties — not logged-in customer profile fields.
    policyholder: policyholder ?? existingSummary?.policyholder ?? null,
    insured: insured ?? existingSummary?.insured ?? null,
    parties: {
      ...existingParties,
      policyholder: policyholder ?? existingParties.policyholder ?? null,
      insured: insured ?? existingParties.insured ?? null,
      subject_scope: "document_contract",
    },
    key_confirmed_subject_scope: "document_contract_not_customer_profile",
  };

  return {
    insurer_name: insurer,
    product_name: product,
    monthly_premium: monthlyPremium != null && Number.isFinite(monthlyPremium) ? monthlyPremium : null,
    coverage_summary,
    // DB CHECK: profile_insurance_policies.source IN (signup|upload_extract|manual|import).
    // KEY provenance stays in coverage_summary.key_confirmed_source_facts / confirmation_source.
    source: "manual",
    is_active: true,
    updated_at: new Date().toISOString(),
  };
}

/**
 * After customer answer is sealed — store KEY-confirmed facts only.
 * Failures must not rewrite the answer or call Claude again.
 * D: if no policy row exists for the document_id, create one linked to that document.
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
  const created_policy_ids = [];

  for (const [documentId, docFacts] of byDoc.entries()) {
    const { data: rows, error: selectError } = await supabase
      .from("profile_insurance_policies")
      .select("id, coverage_summary, is_active, insurer_name, product_name, monthly_premium")
      .eq("customer_id", customerId)
      .eq("is_active", true);

    if (selectError) {
      errors.push({ document_id: documentId, stage: "select", message: selectError.message });
      continue;
    }

    let matches = (rows ?? []).filter(
      (row) => row?.coverage_summary?.source_document_id === documentId,
    );

    if (matches.length === 0) {
      const fields = buildPolicyFieldsFromKeyConfirmedFacts(documentId, docFacts, null);
      const insertRow = {
        customer_id: customerId,
        insurer_name: fields.insurer_name,
        product_name: fields.product_name,
        monthly_premium: fields.monthly_premium,
        coverage_summary: fields.coverage_summary,
        source: fields.source,
        is_active: true,
        updated_at: fields.updated_at,
      };
      const { data: inserted, error: insertError } = await supabase
        .from("profile_insurance_policies")
        .insert(insertRow)
        .select("id")
        .single();
      if (insertError) {
        errors.push({
          document_id: documentId,
          stage: "insert",
          message: insertError.message,
        });
        continue;
      }
      if (inserted?.id) {
        created_policy_ids.push(inserted.id);
        updated_policy_ids.push(inserted.id);
        stored += docFacts.length;
      }
      continue;
    }

    for (const row of matches) {
      const existingSummary =
        row.coverage_summary && typeof row.coverage_summary === "object"
          ? row.coverage_summary
          : {};
      const fields = buildPolicyFieldsFromKeyConfirmedFacts(documentId, docFacts, {
        ...existingSummary,
        insurer_name: row.insurer_name,
        product_name: row.product_name,
        monthly_premium: row.monthly_premium,
      });
      const { error: updateError } = await supabase
        .from("profile_insurance_policies")
        .update({
          insurer_name: fields.insurer_name ?? row.insurer_name ?? null,
          product_name: fields.product_name ?? row.product_name ?? null,
          monthly_premium:
            fields.monthly_premium != null ? fields.monthly_premium : row.monthly_premium ?? null,
          coverage_summary: fields.coverage_summary,
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
    created_policy_ids,
    errors,
  };
}

/**
 * After customer answer is sealed — KEY-validate Claude baseline analysis and store.
 * Never auto-verifies; never rewrites the customer answer; does not touch key_confirmed_source_facts.
 */
export async function persistKeyCoverageBaselineFactsToPolicies({
  supabase = null,
  customerId = null,
  facts = [],
  ownedDocumentIds = null,
} = {}) {
  const proposed = normalizeKeyCoverageBaselineFacts(facts);
  if (!supabase || !customerId || proposed.length === 0) {
    return {
      ok: false,
      attempted: Boolean(supabase && customerId && Array.isArray(facts) && facts.length),
      reason: !supabase
        ? "no_supabase"
        : !customerId
          ? "no_customer_id"
          : proposed.length === 0
            ? "no_valid_facts"
            : "skip",
      stored: 0,
      updated_policy_ids: [],
    };
  }

  const owned =
    ownedDocumentIds != null
      ? new Set([...ownedDocumentIds].map((id) => String(id).trim()).filter(Boolean))
      : new Set(proposed.map((f) => f.source_document_id).filter(Boolean));

  const byDoc = new Map();
  for (const fact of proposed) {
    if (!fact.source_document_id) continue;
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
      if (existingSummary.retired_reason) {
        errors.push({
          document_id: documentId,
          policy_id: row.id,
          stage: "retired",
          message: "retired_policy_skipped",
        });
        continue;
      }

      const existingFacts = Array.isArray(existingSummary.key_coverage_baseline_facts)
        ? existingSummary.key_coverage_baseline_facts
        : [];
      const validated = keyValidateCoverageBaselineFacts(docFacts, {
        // Policy row match under customer_id already proves document linkage.
        ownedDocumentIds: owned.size ? owned : [documentId],
        existingFacts,
        retiredPolicyDocumentIds: [],
      });
      const mergedFacts = mergeKeyCoverageBaselineFacts(existingFacts, validated);
      const nextSummary = {
        ...existingSummary,
        key_coverage_baseline_facts: mergedFacts,
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
      stored += validated.length;
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

/** Slice 3 — personal stays default; corporate requires entity_id. */
export const KEY_CLAIM_SCOPES = Object.freeze(["personal", "corporate"]);

const KEY_CLAIM_STATUS_SET = new Set(KEY_CLAIM_CASE_STATUSES);
const KEY_CLAIM_ASSESSMENT_SET = new Set(KEY_CLAIM_ASSESSMENTS);
const KEY_CLAIM_SCOPE_SET = new Set(KEY_CLAIM_SCOPES);
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

/** Terminal outcomes — never regress to open/intake statuses via merge. */
const KEY_CLAIM_TERMINAL_STATUSES = new Set(["paid", "denied", "closed"]);

function normalizeClaimStatus(rawStatus, { priorStatus = null, evidence = [] } = {}) {
  const prior =
    priorStatus && KEY_CLAIM_STATUS_SET.has(String(priorStatus).toLowerCase())
      ? String(priorStatus).toLowerCase()
      : null;
  const status = normalizeClaimString(rawStatus)?.toLowerCase();
  if (!status || !KEY_CLAIM_STATUS_SET.has(status)) {
    return prior || "identified";
  }
  // Seat F / Claim honesty — paid|denied|closed must not rewind to identified/preparing/etc.
  if (prior && KEY_CLAIM_TERMINAL_STATUSES.has(prior) && !KEY_CLAIM_TERMINAL_STATUSES.has(status)) {
    return prior;
  }
  if (KEY_CLAIM_STATUS_NEEDS_EVIDENCE.has(status)) {
    const hasEvidence = Array.isArray(evidence) && evidence.length > 0;
    if (!hasEvidence) {
      // Do not advance on KEY speculation alone.
      if (prior) return prior;
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

    const sourceRaw = normalizeClaimString(row.source)?.toLowerCase();
    const source =
      sourceRaw === "customer_statement" ||
      sourceRaw === "uploaded_document" ||
      sourceRaw === "confirmed_system_record" ||
      sourceRaw === "insurer_or_system" ||
      sourceRaw === "result_document"
        ? sourceRaw
        : null;
    const source_message_id = normalizeClaimString(row.source_message_id);
    const source_document_ids = normalizeClaimStringList(
      row.source_document_ids ?? row.attached_document_ids,
    );
    // Slice 1C — outcome honesty fields (never invent insurer_verified=true here).
    const insurer_verified = row.insurer_verified === true;
    const denial_reason = normalizeClaimString(row.denial_reason);
    const payout_amount_text = normalizeClaimString(
      row.payout_amount_text ?? row.payout_amount,
    );
    const submission_number = normalizeClaimString(row.submission_number);
    const submission_date_text = normalizeClaimString(
      row.submission_date_text ?? row.submission_date,
    );

    // Slice 3 — claim_scope + entity_id (corporate requires entity_id; else drop).
    const scopeRaw = normalizeClaimString(row.claim_scope)?.toLowerCase();
    let claim_scope =
      scopeRaw && KEY_CLAIM_SCOPE_SET.has(scopeRaw) ? scopeRaw : "personal";
    let entity_id = normalizeClaimString(row.entity_id);
    if (claim_scope === "corporate") {
      if (!entity_id) continue;
    } else {
      claim_scope = "personal";
      entity_id = null;
    }

    out.push({
      claim_case_key,
      claim_scope,
      entity_id,
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
      source,
      source_message_id,
      source_document_ids,
      insurer_verified,
      denial_reason,
      payout_amount_text,
      submission_number,
      submission_date_text,
      updated_at: normalizeClaimString(row.updated_at) ?? updatedAt,
      card_source: "key_claude_claim_case",
    });
  }
  return out;
}

/**
 * Slice 3 — never mix personal and corporate cases in Hand / sidecar pickers.
 * personal: rows without corporate scope (legacy null scope → personal).
 * corporate: exact entity_id match only.
 */
export function filterKeyActiveClaimCasesByScope(
  cases = [],
  { claim_scope = "personal", entity_id = null } = {},
) {
  const rows = normalizeKeyClaimCaseUpdates(cases);
  const scope = String(claim_scope ?? "personal").trim().toLowerCase();
  if (scope === "corporate") {
    const eid = String(entity_id ?? "").trim();
    if (!eid) return [];
    return rows.filter(
      (row) =>
        row.claim_scope === "corporate" && String(row.entity_id ?? "") === eid,
    );
  }
  return rows.filter(
    (row) => row.claim_scope !== "corporate" || !row.entity_id,
  );
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
      // Empty array is meaningful (all prepared) — do not keep stale missing.
      missing_documents: Array.isArray(row.missing_documents)
        ? row.missing_documents
        : prior.missing_documents,
      status,
      evidence,
      source: row.source ?? prior.source ?? null,
      source_message_id: row.source_message_id ?? prior.source_message_id ?? null,
      source_document_ids: [
        ...new Set([
          ...(prior.source_document_ids ?? []),
          ...(row.source_document_ids ?? []),
        ]),
      ],
      next_action:
        row.next_action != null && String(row.next_action).trim()
          ? row.next_action
          : prior.next_action,
      insurer_verified:
        row.insurer_verified === true || prior.insurer_verified === true,
      denial_reason: row.denial_reason ?? prior.denial_reason ?? null,
      payout_amount_text:
        row.payout_amount_text ?? prior.payout_amount_text ?? null,
      submission_number: row.submission_number ?? prior.submission_number ?? null,
      submission_date_text:
        row.submission_date_text ?? prior.submission_date_text ?? null,
      claim_scope:
        row.claim_scope === "corporate" || prior.claim_scope === "corporate"
          ? "corporate"
          : "personal",
      entity_id:
        row.claim_scope === "corporate" || prior.claim_scope === "corporate"
          ? row.entity_id ?? prior.entity_id ?? null
          : null,
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
