/**
 * Payment Truth Map Slice 1 — assemble existing claim + evidence into one map.
 * Storage snapshot: profile_health.details_json.key_payment_truth_items
 * No new judgment / probability / insurer intent / cross-customer / second Claude.
 * Soft Hand context only; Claude explains freely.
 */

import {
  KEY_ACTIVE_CLAIM_CASES_FACT_PATH,
  normalizeKeyClaimCaseUpdates,
} from "../documentPolicyUploadPersist.js";
import {
  KEY_CLAIM_EVIDENCE_FACT_PATH,
  normalizeClaimEvidenceItems,
} from "./keyClaimEvidenceVault.js";

export const KEY_PAYMENT_TRUTH_FACT_PATH = "key_payment_truth_items";

export const PAYMENT_TRUTH_VERIFICATION = Object.freeze([
  "customer_reported",
  "insurer_verified",
  "unverified",
]);

const VERIFY_SET = new Set(PAYMENT_TRUTH_VERIFICATION);

function trim(v, max = 500) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
}

function stampNow(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
}

function uniqIds(list = []) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const id = trim(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Verbatim insurer reason only from explicit document metadata — never invent / OCR promote.
 */
export function extractReasonVerbatimFromEvidence(evidenceRow = null) {
  if (!evidenceRow || typeof evidenceRow !== "object") return null;
  if (trim(evidenceRow.evidence_type) !== "insurer_response") return null;
  if (!trim(evidenceRow.document_id)) return null;
  const meta =
    evidenceRow.metadata_json && typeof evidenceRow.metadata_json === "object"
      ? evidenceRow.metadata_json
      : {};
  return (
    trim(meta.reason_verbatim, 800) ||
    trim(meta.insurer_reason_verbatim, 800) ||
    trim(meta.denial_reason_verbatim, 800) ||
    trim(evidenceRow.reason_verbatim, 800) ||
    null
  );
}

export function derivePaymentTruthVerification({
  caseRow = null,
  outcomeEvidence = [],
  insurerEvidence = [],
} = {}) {
  const insurerVerifiedCase = caseRow?.insurer_verified === true;
  const hasInsurerDoc = (Array.isArray(insurerEvidence) ? insurerEvidence : []).some(
    (e) => trim(e.document_id) && e.verification_status === "insurer_verified",
  );
  const customerOutcome = (Array.isArray(outcomeEvidence) ? outcomeEvidence : []).some(
    (e) =>
      e.evidence_type === "payment_or_denial_outcome" &&
      (e.source === "customer_statement" || e.verification_status === "customer_reported"),
  );
  if (insurerVerifiedCase && hasInsurerDoc) return "insurer_verified";
  if (hasInsurerDoc && (caseRow?.status === "paid" || caseRow?.status === "denied")) {
    return "insurer_verified";
  }
  if (customerOutcome || caseRow?.status === "paid" || caseRow?.status === "denied") {
    // Paid/denied from customer words without insurer document stays customer_reported.
    if (!hasInsurerDoc) return "customer_reported";
  }
  if (customerOutcome) return "customer_reported";
  return "unverified";
}

/**
 * Assemble one Payment Truth Map row per claim case — no new facts invented.
 */
export function assemblePaymentTruthMap({
  cases = [],
  evidenceItems = [],
  customerId = null,
  now = new Date(),
} = {}) {
  const caseRows = normalizeKeyClaimCaseUpdates(cases);
  const evidence = normalizeClaimEvidenceItems(evidenceItems, { now });
  const out = [];

  for (const c of caseRows) {
    const claim_case_id = trim(c.claim_case_key);
    if (!claim_case_id) continue;
    const entity_id =
      String(c.claim_scope) === "corporate" ? trim(c.entity_id) : null;
    if (String(c.claim_scope) === "corporate" && !entity_id) continue;

    const pack = evidence.filter((e) => e.claim_case_id === claim_case_id);
    const submissions = pack.filter((e) => e.evidence_type === "claim_submission");
    const outcomes = pack.filter((e) => e.evidence_type === "payment_or_denial_outcome");
    const insurerResponses = pack.filter((e) => e.evidence_type === "insurer_response");

    const evidence_ids = uniqIds([
      ...pack.map((e) => e.id),
      ...uniqIds(c.source_document_ids || []).map((id) => `doc:${id}`),
    ]);

    const document_ids = uniqIds([
      ...pack.map((e) => e.document_id).filter(Boolean),
      ...(Array.isArray(c.source_document_ids) ? c.source_document_ids : []),
    ]);

    let reason_verbatim = null;
    for (const ir of insurerResponses) {
      reason_verbatim = extractReasonVerbatimFromEvidence(ir);
      if (reason_verbatim) break;
    }

    // Customer-stated reason — never copy into reason_verbatim.
    const customerOutcomeReason = outcomes
      .map((e) => trim(e.metadata_json?.utterance) || trim(e.label))
      .find(Boolean);
    const reason_customer_stated =
      trim(c.denial_reason) ||
      (outcomes.some((e) => e.source === "customer_statement")
        ? customerOutcomeReason
        : null);

    const verification_status = derivePaymentTruthVerification({
      caseRow: c,
      outcomeEvidence: outcomes,
      insurerEvidence: insurerResponses,
    });

    let outcome = null;
    if (c.status === "paid" || outcomes.some((e) => e.metadata_json?.outcome === "paid")) {
      outcome = "paid";
    } else if (
      c.status === "denied" ||
      outcomes.some((e) => e.metadata_json?.outcome === "denied")
    ) {
      outcome = "denied";
    } else if (outcomes.length) {
      outcome = "reported";
    }

    const submission = {
      present: submissions.length > 0 || Boolean(trim(c.submission_number)),
      submission_number: trim(c.submission_number),
      submission_date_text: trim(c.submission_date_text),
      evidence_ids: uniqIds(submissions.map((e) => e.id)),
      source:
        submissions[0]?.source ||
        (trim(c.submission_number) ? "claim_guardian" : null),
    };

    out.push({
      id: `ptm_${claim_case_id}`.slice(0, 120),
      customer_id: trim(customerId) || trim(c.customer_id),
      entity_id,
      claim_scope: entity_id ? "corporate" : "personal",
      claim_case_id,
      related_policies: Array.isArray(c.related_policies)
        ? c.related_policies.map((p) => trim(p)).filter(Boolean).slice(0, 12)
        : [],
      related_coverages: Array.isArray(c.related_coverages)
        ? c.related_coverages.map((p) => trim(p)).filter(Boolean).slice(0, 12)
        : [],
      claim_status: trim(c.status),
      submission,
      outcome,
      payout_amount_text: trim(c.payout_amount_text),
      insurer_response: {
        present: insurerResponses.length > 0,
        evidence_ids: uniqIds(insurerResponses.map((e) => e.id)),
        document_ids: uniqIds(insurerResponses.map((e) => e.document_id)),
      },
      reason_verbatim,
      // Keep customer-stated reason even when verbatim exists — never merge into verbatim.
      reason_customer_stated,
      evidence_ids,
      document_ids,
      verification_status: VERIFY_SET.has(verification_status)
        ? verification_status
        : "unverified",
      // Honesty flags — never auto-promote.
      insurer_verified_flag: c.insurer_verified === true,
      assembled_only: true,
      no_probability: true,
      no_insurer_intent: true,
      cross_customer_forbidden: true,
      created_at: stampNow(now),
      updated_at: stampNow(now),
      metadata_json: {
        layer: "payment_truth_map_slice1",
        note: "assembled_from_claim_and_evidence_no_new_judgment",
      },
    });
  }
  return out;
}

export function normalizePaymentTruthItems(raw = [], { now = new Date() } = {}) {
  const out = [];
  const nowIso = stampNow(now);
  for (const row of Array.isArray(raw) ? raw : []) {
    if (!row || typeof row !== "object") continue;
    const claim_case_id = trim(row.claim_case_id);
    if (!claim_case_id) continue;
    let verification_status = trim(row.verification_status) || "unverified";
    if (!VERIFY_SET.has(verification_status)) verification_status = "unverified";
    // Never keep reason_verbatim without a linked insurer document id.
    let reason_verbatim = trim(row.reason_verbatim, 800);
    const document_ids = uniqIds(row.document_ids);
    const insurerDocs = uniqIds(row.insurer_response?.document_ids);
    if (reason_verbatim && !insurerDocs.length && !document_ids.length) {
      reason_verbatim = null;
    }
    // Never promote customer_reported map rows to insurer_verified without flag+docs.
    if (
      verification_status === "insurer_verified" &&
      row.insurer_verified_flag !== true &&
      !insurerDocs.length
    ) {
      verification_status = row.reason_customer_stated
        ? "customer_reported"
        : "unverified";
    }
    out.push({
      id: trim(row.id) || `ptm_${claim_case_id}`.slice(0, 120),
      customer_id: trim(row.customer_id),
      entity_id: trim(row.entity_id),
      claim_scope: trim(row.claim_scope) || (trim(row.entity_id) ? "corporate" : "personal"),
      claim_case_id,
      related_policies: Array.isArray(row.related_policies)
        ? row.related_policies.map((p) => trim(p)).filter(Boolean).slice(0, 12)
        : [],
      related_coverages: Array.isArray(row.related_coverages)
        ? row.related_coverages.map((p) => trim(p)).filter(Boolean).slice(0, 12)
        : [],
      claim_status: trim(row.claim_status),
      submission:
        row.submission && typeof row.submission === "object"
          ? {
              present: row.submission.present === true,
              submission_number: trim(row.submission.submission_number),
              submission_date_text: trim(row.submission.submission_date_text),
              evidence_ids: uniqIds(row.submission.evidence_ids),
              source: trim(row.submission.source),
            }
          : { present: false, submission_number: null, submission_date_text: null, evidence_ids: [], source: null },
      outcome: trim(row.outcome),
      payout_amount_text: trim(row.payout_amount_text),
      insurer_response:
        row.insurer_response && typeof row.insurer_response === "object"
          ? {
              present: row.insurer_response.present === true,
              evidence_ids: uniqIds(row.insurer_response.evidence_ids),
              document_ids: uniqIds(row.insurer_response.document_ids),
            }
          : { present: false, evidence_ids: [], document_ids: [] },
      reason_verbatim,
      reason_customer_stated: trim(row.reason_customer_stated, 800),
      evidence_ids: uniqIds(row.evidence_ids),
      document_ids,
      verification_status,
      insurer_verified_flag: row.insurer_verified_flag === true,
      assembled_only: row.assembled_only !== false,
      no_probability: true,
      no_insurer_intent: true,
      cross_customer_forbidden: true,
      created_at: trim(row.created_at) || nowIso,
      updated_at: trim(row.updated_at) || nowIso,
      metadata_json:
        row.metadata_json && typeof row.metadata_json === "object"
          ? { ...row.metadata_json }
          : {},
    });
  }
  return out;
}

export function filterPaymentTruthByScope(
  items = [],
  { entityId = null, mode = "personal" } = {},
) {
  const rows = normalizePaymentTruthItems(items);
  const eid = trim(entityId);
  if (mode === "corporate") {
    if (!eid) return [];
    return rows.filter((r) => trim(r.entity_id) === eid);
  }
  if (mode === "both") {
    return rows.filter((r) => !r.entity_id || (eid && trim(r.entity_id) === eid));
  }
  return rows.filter((r) => !r.entity_id);
}

export function mergePaymentTruthItems(existing = [], incoming = [], { now = new Date() } = {}) {
  const map = new Map();
  for (const row of [
    ...normalizePaymentTruthItems(existing, { now }),
    ...normalizePaymentTruthItems(incoming, { now }),
  ]) {
    const key = `${trim(row.claim_case_id)}|${trim(row.entity_id) || "personal"}`;
    const prior = map.get(key);
    if (!prior) {
      map.set(key, row);
      continue;
    }
    map.set(key, {
      ...prior,
      ...row,
      created_at: prior.created_at || row.created_at,
      // Never invent verbatim on merge.
      reason_verbatim: row.reason_verbatim || prior.reason_verbatim,
      reason_customer_stated: row.reason_customer_stated || prior.reason_customer_stated,
      evidence_ids: uniqIds([...(prior.evidence_ids || []), ...(row.evidence_ids || [])]),
      document_ids: uniqIds([...(prior.document_ids || []), ...(row.document_ids || [])]),
      updated_at: stampNow(now),
      no_probability: true,
      no_insurer_intent: true,
      cross_customer_forbidden: true,
    });
  }
  return [...map.values()];
}

/**
 * Load persisted Payment Truth rows for KEY recall.
 * Distinguishes query_failed from empty miss (ROOT_05 / ROOT_06).
 * @returns {{ ok: boolean, status: 'hit'|'miss'|'query_failed'|'missing_scope', items: object[], error?: string|null }}
 */
export async function loadPaymentTruthItems({ supabase = null, customerId = null } = {}) {
  if (!supabase || !customerId) {
    return { ok: false, status: "missing_scope", items: [], error: null };
  }
  try {
    const { data, error } = await supabase
      .from("profile_health")
      .select("details_json")
      .eq("customer_id", customerId)
      .maybeSingle();
    if (error) {
      return {
        ok: false,
        status: "query_failed",
        items: [],
        error: String(error.message ?? error).slice(0, 200),
      };
    }
    const details =
      data?.details_json && typeof data.details_json === "object" ? data.details_json : {};
    const items = normalizePaymentTruthItems(details[KEY_PAYMENT_TRUTH_FACT_PATH]);
    return {
      ok: true,
      status: items.length > 0 ? "hit" : "miss",
      items,
      error: null,
    };
  } catch (err) {
    return {
      ok: false,
      status: "query_failed",
      items: [],
      error: String(err?.message ?? err).slice(0, 200),
    };
  }
}

/** Scope a Payment Truth brief to active claim cases (structural — no keyword classifier). */
export function scopePaymentTruthBriefToActiveClaims(brief = null, claimCases = []) {
  if (!brief || typeof brief !== "object") return null;
  const rows = Array.isArray(brief.rows) ? brief.rows : [];
  if (!rows.length) return null;
  const ids = new Set(
    (Array.isArray(claimCases) ? claimCases : [])
      .map((c) => String(c?.id ?? c?.claim_case_id ?? "").trim())
      .filter(Boolean),
  );
  if (!ids.size) return null;
  const scoped = rows.filter((r) => ids.has(String(r?.claim_case_id ?? "").trim()));
  if (!scoped.length) return null;
  return {
    ...brief,
    rows: scoped.slice(0, 12),
    item_count: scoped.length,
    note:
      brief.note ||
      "key_owns_payment_truth_map; soft_reference_only; scoped_to_active_claims",
  };
}

export async function persistPaymentTruthItems({
  supabase = null,
  customerId = null,
  truthUpdates = [],
} = {}) {
  const incoming = normalizePaymentTruthItems(truthUpdates);
  if (!supabase || !customerId || incoming.length === 0) {
    return {
      ok: false,
      attempted: Boolean(supabase && customerId && Array.isArray(truthUpdates) && truthUpdates.length),
      stored: 0,
      reason: !supabase ? "no_supabase" : !customerId ? "no_customer_id" : "no_updates",
    };
  }
  const { data: row, error: selectError } = await supabase
    .from("profile_health")
    .select("customer_id, details_json")
    .eq("customer_id", customerId)
    .maybeSingle();
  if (selectError) {
    return { ok: false, attempted: true, stored: 0, error: selectError.message };
  }
  const existingDetails =
    row?.details_json && typeof row.details_json === "object" ? row.details_json : {};
  const stamped = incoming.map((r) => ({ ...r, customer_id: customerId }));
  const merged = mergePaymentTruthItems(
    existingDetails[KEY_PAYMENT_TRUTH_FACT_PATH],
    stamped,
  );
  const nextDetails = {
    ...existingDetails,
    [KEY_PAYMENT_TRUTH_FACT_PATH]: merged,
  };
  if (!row?.customer_id) {
    const { error: insertError } = await supabase.from("profile_health").insert({
      customer_id: customerId,
      details_json: nextDetails,
      updated_at: new Date().toISOString(),
    });
    if (insertError) {
      return { ok: false, attempted: true, stored: 0, error: insertError.message };
    }
    return { ok: true, attempted: true, stored: stamped.length, item_count: merged.length };
  }
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
  return { ok: true, attempted: true, stored: stamped.length, item_count: merged.length };
}

export function buildPaymentTruthHandBrief(items = [], { now = new Date() } = {}) {
  const rows = normalizePaymentTruthItems(items, { now });
  return {
    rows: rows.slice(0, 12).map((r) => ({
      id: r.id,
      claim_case_id: r.claim_case_id,
      entity_id: r.entity_id,
      related_policies: r.related_policies,
      claim_status: r.claim_status,
      outcome: r.outcome,
      submission_present: r.submission?.present === true,
      insurer_response_present: r.insurer_response?.present === true,
      reason_verbatim: r.reason_verbatim,
      reason_customer_stated: r.reason_customer_stated,
      evidence_ids: r.evidence_ids,
      verification_status: r.verification_status,
    })),
    item_count: rows.length,
    packs_separated: true,
    note: "key_owns_payment_truth_map; soft_reference_only; no_probability_no_insurer_intent",
  };
}

export function softPaymentTruthContext(brief = null) {
  if (!brief || typeof brief !== "object") return null;
  return {
    payment_truth_map: {
      rows: Array.isArray(brief.rows) ? brief.rows : [],
      item_count: Number(brief.item_count) || 0,
      packs_separated: true,
      note: "soft_context_reference_only_not_answer_template; use verification_status honestly; never invent denial probability",
    },
  };
}

export { KEY_ACTIVE_CLAIM_CASES_FACT_PATH, KEY_CLAIM_EVIDENCE_FACT_PATH };
