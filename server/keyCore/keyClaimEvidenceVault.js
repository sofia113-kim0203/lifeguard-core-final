/**
 * Evidence Vault Slice 1 — claim evidence package for one claim case.
 * Storage: profile_health.details_json.key_claim_evidence_items
 * KEY owns evidence; same Claude-first KEY explains. No Evidence Persona / second Claude.
 * Reuses customer_documents + Claim Guardian; never overwrites originals.
 */

import {
  KEY_ACTIVE_CLAIM_CASES_FACT_PATH,
  normalizeKeyClaimCaseUpdates,
} from "../documentPolicyUploadPersist.js";

export const KEY_CLAIM_EVIDENCE_FACT_PATH = "key_claim_evidence_items";

export const EVIDENCE_TYPES = Object.freeze([
  "original_document",
  "customer_statement",
  "claim_submission",
  "insurer_response",
  "payment_or_denial_outcome",
]);

export const VERIFICATION_STATUSES = Object.freeze([
  "original",
  "customer_reported",
  "insurer_verified",
  "unverified",
]);

export const EVIDENCE_SOURCES = Object.freeze([
  "customer_statement",
  "uploaded_document",
  "document_evidence",
  "claim_guardian",
  "confirmed_system_record",
]);

const TYPE_SET = new Set(EVIDENCE_TYPES);
const VERIFY_SET = new Set(VERIFICATION_STATUSES);
const SOURCE_SET = new Set(EVIDENCE_SOURCES);

function trim(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function stampNow(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
}

function ymdLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Weak integrity from known metadata only — never invent for missing files. */
export function deriveContentHashHint({ documentId = null, byteSize = null, storagePath = null } = {}) {
  const id = trim(documentId);
  if (!id) return null;
  const size = Number.isFinite(Number(byteSize)) ? String(byteSize) : "";
  const path = trim(storagePath) || "";
  if (!size && !path) return `doc:${id}:meta_incomplete`;
  return `doc:${id}:sz:${size || "na"}:path:${path ? "set" : "na"}`;
}

export function normalizeClaimEvidenceItems(raw = [], { now = new Date() } = {}) {
  const out = [];
  const nowIso = stampNow(now);
  for (const row of Array.isArray(raw) ? raw : []) {
    if (!row || typeof row !== "object") continue;
    const evidence_type = trim(row.evidence_type);
    if (!TYPE_SET.has(evidence_type)) continue;
    const claim_case_id = trim(row.claim_case_id) || trim(row.claim_case_key);
    if (!claim_case_id) continue;
    let verification_status = trim(row.verification_status) || "unverified";
    if (!VERIFY_SET.has(verification_status)) verification_status = "unverified";
    // Never promote customer_statement / claim_submission / payment utterance to insurer_verified.
    if (
      (evidence_type === "customer_statement" ||
        evidence_type === "claim_submission" ||
        (evidence_type === "payment_or_denial_outcome" &&
          trim(row.source) === "customer_statement")) &&
      verification_status === "insurer_verified"
    ) {
      verification_status = "customer_reported";
    }
    // insurer_verified only when original insurer document is linked.
    if (
      verification_status === "insurer_verified" &&
      evidence_type === "insurer_response" &&
      !trim(row.document_id)
    ) {
      verification_status = "customer_reported";
    }
    let source = trim(row.source) || "claim_guardian";
    if (!SOURCE_SET.has(source)) source = "claim_guardian";
    const entity_id = trim(row.entity_id);
    const document_id = trim(row.document_id);
    const id =
      trim(row.id) ||
      `ev_${evidence_type}_${claim_case_id}_${document_id || trim(row.source_message_id) || "x"}`.slice(
        0,
        120,
      );
    const metadata_json =
      row.metadata_json && typeof row.metadata_json === "object" ? { ...row.metadata_json } : {};
    out.push({
      id,
      customer_id: trim(row.customer_id),
      entity_id,
      claim_case_id,
      evidence_type,
      document_id,
      source_message_id: trim(row.source_message_id),
      source,
      captured_at: trim(row.captured_at) || nowIso,
      submitted_at: trim(row.submitted_at),
      received_at: trim(row.received_at),
      verification_status,
      content_hash: trim(row.content_hash),
      supersedes_id: trim(row.supersedes_id),
      label: trim(row.label) || trim(metadata_json.label) || evidence_type,
      metadata_json,
      created_at: trim(row.created_at) || nowIso,
      updated_at: trim(row.updated_at) || nowIso,
    });
  }
  return out;
}

function evidenceDedupeKey(row) {
  return [
    trim(row.claim_case_id),
    trim(row.evidence_type),
    trim(row.document_id) || trim(row.source_message_id) || trim(row.id),
    trim(row.entity_id) || "personal",
  ].join("|");
}

/**
 * Merge evidence. Never overwrite prior rows in place — same key updates metadata only.
 * New document_id for same type+label → keep both; caller sets supersedes_id.
 */
export function mergeClaimEvidenceItems(existing = [], incoming = [], { now = new Date() } = {}) {
  const map = new Map();
  for (const row of [
    ...normalizeClaimEvidenceItems(existing, { now }),
    ...normalizeClaimEvidenceItems(incoming, { now }),
  ]) {
    const key = evidenceDedupeKey(row);
    const prior = map.get(key);
    if (!prior) {
      map.set(key, row);
      continue;
    }
    map.set(key, {
      ...prior,
      ...row,
      // Preserve original capture / created; never clobber document_id.
      document_id: prior.document_id || row.document_id,
      content_hash: prior.content_hash || row.content_hash,
      created_at: prior.created_at || row.created_at,
      captured_at: prior.captured_at || row.captured_at,
      supersedes_id: row.supersedes_id || prior.supersedes_id,
      // verification: never upgrade customer_reported → insurer_verified via merge alone
      verification_status: (() => {
        if (prior.verification_status === "insurer_verified") return "insurer_verified";
        if (row.verification_status === "insurer_verified" && row.document_id) {
          return "insurer_verified";
        }
        if (
          prior.verification_status === "original" ||
          row.verification_status === "original"
        ) {
          return "original";
        }
        return row.verification_status || prior.verification_status;
      })(),
      updated_at: stampNow(now),
    });
  }
  return [...map.values()];
}

export function filterClaimEvidenceByScope(
  items = [],
  { entityId = null, mode = "personal" } = {},
) {
  const rows = normalizeClaimEvidenceItems(items);
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

export async function loadClaimEvidenceItems({ supabase = null, customerId = null } = {}) {
  if (!supabase || !customerId) return [];
  const { data, error } = await supabase
    .from("profile_health")
    .select("details_json")
    .eq("customer_id", customerId)
    .maybeSingle();
  if (error || !data) return [];
  const details =
    data.details_json && typeof data.details_json === "object" ? data.details_json : {};
  return normalizeClaimEvidenceItems(details[KEY_CLAIM_EVIDENCE_FACT_PATH]);
}

export async function persistClaimEvidenceItems({
  supabase = null,
  customerId = null,
  evidenceUpdates = [],
} = {}) {
  const incoming = normalizeClaimEvidenceItems(evidenceUpdates);
  if (!supabase || !customerId || incoming.length === 0) {
    return {
      ok: false,
      attempted: Boolean(supabase && customerId && Array.isArray(evidenceUpdates) && evidenceUpdates.length),
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
  const merged = mergeClaimEvidenceItems(
    existingDetails[KEY_CLAIM_EVIDENCE_FACT_PATH],
    stamped,
  );
  const nextDetails = {
    ...existingDetails,
    [KEY_CLAIM_EVIDENCE_FACT_PATH]: merged,
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

function pickOpenClaim(existingCases = [], { entityId = null } = {}) {
  const eid = trim(entityId);
  const open = new Set([
    "identified",
    "preparing",
    "ready_for_customer_submission",
    "submitted_by_customer",
    "under_review",
    "paid",
    "denied",
  ]);
  const rows = normalizeKeyClaimCaseUpdates(existingCases).filter((c) => {
    if (!open.has(String(c.status))) return false;
    if (eid) {
      return String(c.claim_scope) === "corporate" && trim(c.entity_id) === eid;
    }
    return String(c.claim_scope ?? "personal") !== "corporate" && !trim(c.entity_id);
  });
  if (!rows.length) return null;
  const surgery = rows.find((c) => String(c.claim_case_key || "").includes("surgery"));
  return surgery || rows[0];
}

function guessDocLabel(doc = null, fallback = "서류") {
  const hint = trim(doc?.customer_hint_type) || trim(doc?.doc_class) || "";
  const name = trim(doc?.original_filename) || "";
  const blob = `${hint} ${name}`;
  if (/진단/.test(blob)) return "진단서";
  if (/입퇴원|퇴원/.test(blob)) return "입퇴원확인서";
  if (/영수증|세부내역/.test(blob)) return "진료비영수증";
  if (/거절|부지급/.test(blob)) return "보험사거절안내";
  if (/지급|입금/.test(blob)) return "보험사지급안내";
  if (/보험사|안내|회신|답변/.test(blob)) return "보험사답변";
  return fallback;
}

function isInsurerResponseDoc(doc = null) {
  const blob = `${trim(doc?.customer_hint_type) || ""} ${trim(doc?.original_filename) || ""} ${trim(doc?.doc_class) || ""}`;
  return /보험사|거절|부지급|지급.?안내|심사.?결과|회신|답변/.test(blob);
}

/**
 * Link uploaded customer_documents into claim evidence package (no overwrite).
 * documentsMeta: Map or array of { id, storage_path, metadata_json, original_filename, ... }
 */
export function buildOriginalDocumentEvidenceFromDocs({
  claimCase = null,
  documents = [],
  existingEvidence = [],
  customerId = null,
  now = new Date(),
} = {}) {
  const claim = claimCase && typeof claimCase === "object" ? claimCase : null;
  const claim_case_id = trim(claim?.claim_case_key);
  if (!claim_case_id) return [];
  const eid =
    String(claim.claim_scope) === "corporate" ? trim(claim.entity_id) : null;
  if (String(claim.claim_scope) === "corporate" && !eid) return [];

  const existing = normalizeClaimEvidenceItems(existingEvidence, { now });
  const byDoc = new Map(
    existing
      .filter((e) => e.document_id)
      .map((e) => [e.document_id, e]),
  );
  const latestSameLabel = (label, type) => {
    const rows = existing
      .filter(
        (e) =>
          e.claim_case_id === claim_case_id &&
          e.evidence_type === type &&
          e.label === label,
      )
      .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
    return rows.length ? rows[rows.length - 1] : null;
  };

  const updates = [];
  for (const doc of Array.isArray(documents) ? documents : []) {
    const document_id = trim(doc?.id);
    if (!document_id) continue;
    if (byDoc.has(document_id)) continue; // already vaulted — never rewrite original

    const insurerDoc = isInsurerResponseDoc(doc);
    const evidence_type = insurerDoc ? "insurer_response" : "original_document";
    const label = guessDocLabel(doc, insurerDoc ? "보험사답변" : "서류");
    const priorHead = latestSameLabel(label, evidence_type);
    const supersedes_id = priorHead?.id || null;
    const byteSize = doc?.metadata_json?.byte_size ?? doc?.byte_size ?? null;
    const storage_path = trim(doc?.storage_path);
    const content_hash = deriveContentHashHint({
      documentId: document_id,
      byteSize,
      storagePath: storage_path,
    });

    updates.push({
      id: `ev_${evidence_type}_${claim_case_id}_${document_id}`.slice(0, 120),
      customer_id: trim(customerId),
      entity_id: eid,
      claim_case_id,
      evidence_type,
      document_id,
      source_message_id: null,
      source: "uploaded_document",
      captured_at: trim(doc?.created_at) || stampNow(now),
      submitted_at: null,
      received_at: insurerDoc ? trim(doc?.created_at) || stampNow(now) : null,
      verification_status: insurerDoc
        ? "insurer_verified"
        : "original",
      content_hash,
      supersedes_id,
      label,
      metadata_json: {
        label,
        storage_path,
        byte_size: byteSize,
        original_filename: trim(doc?.original_filename),
        layer: "original_document",
        extract_separated: true,
        claude_interpretation_separated: true,
      },
      created_at: stampNow(now),
      updated_at: stampNow(now),
    });
  }
  return normalizeClaimEvidenceItems(updates, { now });
}

/**
 * Sync vault rows from Claim Guardian case document links (existing spine reuse).
 */
export function syncClaimEvidenceFromCases({
  cases = [],
  documents = [],
  existingEvidence = [],
  customerId = null,
  now = new Date(),
} = {}) {
  const docById = new Map(
    (Array.isArray(documents) ? documents : [])
      .filter((d) => trim(d?.id))
      .map((d) => [trim(d.id), d]),
  );
  const updates = [];
  for (const c of normalizeKeyClaimCaseUpdates(cases)) {
    const ids = Array.isArray(c.source_document_ids) ? c.source_document_ids : [];
    const docs = ids.map((id) => docById.get(trim(id)) || { id }).filter((d) => trim(d.id));
    updates.push(
      ...buildOriginalDocumentEvidenceFromDocs({
        claimCase: c,
        documents: docs,
        existingEvidence: [...existingEvidence, ...updates],
        customerId,
        now,
      }),
    );
  }
  return updates;
}

export function isClaimSubmissionUtterance(question = "") {
  const text = String(question ?? "").trim();
  return /(제출했|접수했|보냈(?:어|어요)|보험사에\s*.{0,12}제출)/.test(text);
}

export function isPaymentOutcomeUtterance(question = "") {
  const text = String(question ?? "").trim();
  return /(지급됐|입금됐|보험금.{0,8}받았|지급\s*완료)/.test(text);
}

export function isDenialOutcomeUtterance(question = "") {
  const text = String(question ?? "").trim();
  return /(거절됐|부지급|지급\s*안\s*됐|반려됐)/.test(text);
}

/** Parse "오늘" / absolute date for submitted_at — never invent insurer receipt. */
export function parseStatedSubmissionTime(question = "", { now = new Date() } = {}) {
  const text = String(question ?? "").trim();
  const base = now instanceof Date ? now : new Date(now);
  if (!text || !Number.isFinite(base.getTime())) {
    return { submitted_at: null, reason: "none" };
  }
  if (/오늘/.test(text)) {
    return { submitted_at: `${ymdLocal(base)}T12:00:00.000Z`, reason: "today_stated" };
  }
  const abs = text.match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (abs) {
    const due = `${abs[1]}-${String(abs[2]).padStart(2, "0")}-${String(abs[3]).padStart(2, "0")}`;
    return { submitted_at: `${due}T12:00:00.000Z`, reason: "absolute_stated" };
  }
  const md = text.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (md) {
    const due = `${base.getFullYear()}-${String(md[1]).padStart(2, "0")}-${String(md[2]).padStart(2, "0")}`;
    return { submitted_at: `${due}T12:00:00.000Z`, reason: "month_day_stated" };
  }
  return { submitted_at: null, reason: "no_explicit_time" };
}

function extractPayoutAmountText(question = "") {
  const m = String(question ?? "").match(/(\d{1,3}(?:,\d{3})+|\d+)\s*만?\s*원/);
  return m ? m[0].replace(/\s+/g, "") : null;
}

/**
 * Utterance → claim_submission / payment_or_denial_outcome / customer_statement.
 * Never marks insurer_verified from customer words alone.
 */
export function buildClaimEvidenceUpdatesFromUtterance({
  question = "",
  existingCases = [],
  existingEvidence = [],
  customerId = null,
  entityId = null,
  messageId = null,
  now = new Date(),
} = {}) {
  const text = String(question ?? "").trim();
  if (!text) return { ok: false, reason: "empty", action: "skip", updates: [] };

  const claim = pickOpenClaim(existingCases, { entityId });
  if (!claim) return { ok: false, reason: "no_open_claim", action: "skip", updates: [] };

  const claim_case_id = trim(claim.claim_case_key);
  const eid =
    String(claim.claim_scope) === "corporate" ? trim(claim.entity_id) || trim(entityId) : null;
  if (String(claim.claim_scope) === "corporate" && !eid) {
    return { ok: false, reason: "corporate_missing_entity", action: "skip", updates: [] };
  }

  const msg = trim(messageId) || `evmsg_${Date.now().toString(36)}`;
  const updates = [];

  if (isClaimSubmissionUtterance(text)) {
    const when = parseStatedSubmissionTime(text, { now });
    updates.push({
      id: `ev_claim_submission_${claim_case_id}_${msg}`.slice(0, 120),
      customer_id: trim(customerId),
      entity_id: eid,
      claim_case_id,
      evidence_type: "claim_submission",
      document_id: null,
      source_message_id: msg,
      source: "customer_statement",
      captured_at: stampNow(now),
      submitted_at: when.submitted_at,
      received_at: null,
      verification_status: "customer_reported",
      content_hash: null,
      supersedes_id: null,
      label: "고객 제출 진술",
      metadata_json: {
        label: "고객 제출 진술",
        time_reason: when.reason,
        not_insurer_receipt: true,
        utterance: text.slice(0, 120),
      },
      created_at: stampNow(now),
      updated_at: stampNow(now),
    });
  }

  if (isPaymentOutcomeUtterance(text) || isDenialOutcomeUtterance(text)) {
    const denied = isDenialOutcomeUtterance(text);
    const amount = denied ? null : extractPayoutAmountText(text);
    updates.push({
      id: `ev_outcome_${claim_case_id}_${msg}`.slice(0, 120),
      customer_id: trim(customerId),
      entity_id: eid,
      claim_case_id,
      evidence_type: "payment_or_denial_outcome",
      document_id: null,
      source_message_id: msg,
      source: "customer_statement",
      captured_at: stampNow(now),
      submitted_at: null,
      received_at: null,
      verification_status: "customer_reported",
      content_hash: null,
      supersedes_id: null,
      label: denied ? "거절 결과 (고객 진술)" : "지급 결과 (고객 진술)",
      metadata_json: {
        label: denied ? "거절 결과" : "지급 결과",
        outcome: denied ? "denied" : "paid",
        payout_amount_text: amount,
        insurer_verified: false,
        utterance: text.slice(0, 120),
      },
      created_at: stampNow(now),
      updated_at: stampNow(now),
    });
  }

  if (!updates.length) {
    return { ok: false, reason: "not_evidence_utterance", action: "skip", updates: [] };
  }

  // Avoid duplicate message rows
  const existing = normalizeClaimEvidenceItems(existingEvidence, { now });
  const filtered = updates.filter(
    (u) => !existing.some((e) => e.id === u.id || e.source_message_id === u.source_message_id),
  );
  if (!filtered.length) {
    return { ok: false, reason: "already_recorded", action: "skip", updates: [] };
  }

  return {
    ok: true,
    reason: filtered[0].evidence_type,
    action: "create",
    updates: normalizeClaimEvidenceItems(filtered, { now }),
  };
}

/**
 * Hand brief per claim — held / missing / submitted / insurer / outcome + verification.
 * Does not advance Claim Guardian status.
 */
export function buildClaimEvidenceHandBrief({
  cases = [],
  evidenceItems = [],
  now = new Date(),
} = {}) {
  const items = normalizeClaimEvidenceItems(evidenceItems, { now });
  const briefs = [];
  for (const c of normalizeKeyClaimCaseUpdates(cases).slice(0, 8)) {
    const key = trim(c.claim_case_key);
    if (!key) continue;
    const pack = items.filter((e) => e.claim_case_id === key);
    const held = pack.filter((e) => e.evidence_type === "original_document");
    const submitted = pack.filter((e) => e.evidence_type === "claim_submission");
    const insurer = pack.filter((e) => e.evidence_type === "insurer_response");
    const outcomes = pack.filter((e) => e.evidence_type === "payment_or_denial_outcome");
    const statements = pack.filter((e) => e.evidence_type === "customer_statement");
    const missing = Array.isArray(c.missing_documents) ? c.missing_documents.slice(0, 12) : [];
    briefs.push({
      claim_case_id: key,
      claim_scope: c.claim_scope === "corporate" ? "corporate" : "personal",
      entity_id: c.entity_id ?? null,
      status: c.status ?? null,
      held_evidence: held.map(briefItem).slice(0, 12),
      missing_evidence_labels: missing,
      submitted_evidence: submitted.map(briefItem).slice(0, 8),
      insurer_evidence: insurer.map(briefItem).slice(0, 8),
      outcome_evidence: outcomes.map(briefItem).slice(0, 8),
      statement_evidence: statements.map(briefItem).slice(0, 8),
      next_action: typeof c.next_action === "string" ? c.next_action.slice(0, 200) : null,
      note: "evidence_package_claim_slice1",
    });
  }
  return {
    packages: briefs,
    item_count: items.length,
    packs_separated: true,
    note: "key_owns_claim_evidence; claude_explains_only",
  };
}

function briefItem(e) {
  return {
    id: e.id,
    evidence_type: e.evidence_type,
    label: e.label,
    document_id: e.document_id,
    verification_status: e.verification_status,
    source: e.source,
    captured_at: e.captured_at,
    submitted_at: e.submitted_at,
    received_at: e.received_at,
    supersedes_id: e.supersedes_id,
    content_hash: e.content_hash,
  };
}

export function softClaimEvidenceContext(brief = null) {
  if (!brief || typeof brief !== "object") return null;
  return {
    claim_evidence: {
      packages: Array.isArray(brief.packages) ? brief.packages : [],
      item_count: Number(brief.item_count) || 0,
      packs_separated: brief.packs_separated === true,
      note: "soft_context_reference_only_do_not_invent_missing_insurer_docs",
    },
  };
}

/** Re-export path constant used by soft-delete / tests. */
export { KEY_ACTIVE_CLAIM_CASES_FACT_PATH };
