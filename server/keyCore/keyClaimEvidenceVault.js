/**
 * Evidence Vault — claim package (Slice 1) + Contract Package Slice.
 * Storage: profile_health.details_json.key_claim_evidence_items
 * KEY owns evidence; same Claude-first KEY explains. No Evidence Persona / second Claude.
 * Reuses customer_documents + Claim Guardian; never overwrites originals.
 * Never judges legal force / disclosure duty / OCR as confirmed fact.
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
  // Contract Package Slice — explicit originals / customer statements only.
  "application_disclosure",
  "explanation_consent",
  "terms_document",
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

/** Package subject for contract evidence (not a Claim Guardian case). */
export function contractPackageSubjectId({ entityId = null } = {}) {
  const eid = trim(entityId);
  return eid ? `contract_package:corporate:${eid}` : "contract_package:personal";
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
    // Never promote customer words to insurer_verified.
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
    // Contract package: never insurer_verified (no legal/OCR promotion).
    if (
      (evidence_type === "application_disclosure" ||
        evidence_type === "explanation_consent" ||
        evidence_type === "terms_document") &&
      verification_status === "insurer_verified"
    ) {
      verification_status =
        trim(row.source) === "customer_statement" ? "customer_reported" : "original";
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
    const document_version =
      trim(row.document_version) ||
      trim(metadata_json.document_version) ||
      null;
    if (document_version) metadata_json.document_version = document_version;
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
      document_version,
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
      // Preserve original capture / created; never clobber document_id / version / hash.
      document_id: prior.document_id || row.document_id,
      content_hash: prior.content_hash || row.content_hash,
      document_version: prior.document_version || row.document_version,
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

function docBlob(doc = null) {
  return `${trim(doc?.customer_hint_type) || ""} ${trim(doc?.original_filename) || ""} ${trim(doc?.doc_class) || ""} ${trim(doc?.label) || ""}`;
}

function guessDocLabel(doc = null, fallback = "서류") {
  const blob = docBlob(doc);
  if (/청약|고지/.test(blob)) return /고지/.test(blob) && !/청약/.test(blob) ? "고지사항" : "청약서·고지";
  if (/설명|동의/.test(blob)) return "설명·동의 기록";
  if (/약관/.test(blob)) return "약관";
  if (/진단/.test(blob)) return "진단서";
  if (/입퇴원|퇴원/.test(blob)) return "입퇴원확인서";
  if (/영수증|세부내역/.test(blob)) return "진료비영수증";
  if (/거절|부지급/.test(blob)) return "보험사거절안내";
  if (/지급|입금/.test(blob)) return "보험사지급안내";
  if (/보험사|안내|회신|답변/.test(blob)) return "보험사답변";
  return fallback;
}

/** Explicit contract doc class from filename/hint only — never OCR invent. */
export function classifyContractEvidenceType(doc = null) {
  const blob = docBlob(doc);
  if (/약관/.test(blob)) return "terms_document";
  if (/청약|고지/.test(blob)) return "application_disclosure";
  if (/설명\s*의무|상품\s*설명|동의\s*서|동의\s*기록|설명.?동의/.test(blob) || (/설명/.test(blob) && /동의/.test(blob))) {
    return "explanation_consent";
  }
  if (/동의/.test(blob) && !/보험사/.test(blob)) return "explanation_consent";
  return null;
}

function isInsurerResponseDoc(doc = null) {
  if (classifyContractEvidenceType(doc)) return false;
  const blob = docBlob(doc);
  return /보험사|거절|부지급|지급.?안내|심사.?결과|회신|답변/.test(blob);
}

/** Next document_version along supersedes chain for same type+label (+entity). */
export function nextDocumentVersion(existing = [], { claimCaseId, evidenceType, label, entityId = null } = {}) {
  const rows = normalizeClaimEvidenceItems(existing).filter(
    (e) =>
      e.claim_case_id === trim(claimCaseId) &&
      e.evidence_type === trim(evidenceType) &&
      e.label === trim(label) &&
      (trim(entityId) || null) === (e.entity_id || null),
  );
  if (!rows.length) return "1";
  let max = 0;
  for (const r of rows) {
    const n = Number(String(r.document_version || "").replace(/^v/i, ""));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return String(max + 1 || rows.length + 1);
}

/** Walk supersedes_id chain oldest→newest (history preserve). */
export function buildEvidenceSupersedesChain(items = [], headId = null) {
  const rows = normalizeClaimEvidenceItems(items);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const head = byId.get(trim(headId));
  if (!head) return [];
  const chain = [];
  let cur = head;
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift(cur);
    cur = cur.supersedes_id ? byId.get(cur.supersedes_id) : null;
  }
  return chain;
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

    const contractType = classifyContractEvidenceType(doc);
    const insurerDoc = !contractType && isInsurerResponseDoc(doc);
    const evidence_type = contractType
      ? contractType
      : insurerDoc
        ? "insurer_response"
        : "original_document";
    const label = guessDocLabel(
      doc,
      contractType === "terms_document"
        ? "약관"
        : contractType === "application_disclosure"
          ? "청약서·고지"
          : contractType === "explanation_consent"
            ? "설명·동의 기록"
            : insurerDoc
              ? "보험사답변"
              : "서류",
    );
    const priorHead = latestSameLabel(label, evidence_type);
    const supersedes_id = priorHead?.id || null;
    const document_version = nextDocumentVersion(
      [...existing, ...updates],
      { claimCaseId: claim_case_id, evidenceType: evidence_type, label, entityId: eid },
    );
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
      verification_status: insurerDoc ? "insurer_verified" : "original",
      content_hash,
      document_version,
      supersedes_id,
      label,
      metadata_json: {
        label,
        storage_path,
        byte_size: byteSize,
        original_filename: trim(doc?.original_filename),
        document_version,
        layer: contractType || "original_document",
        extract_separated: true,
        claude_interpretation_separated: true,
        ocr_not_confirmed_fact: true,
        legal_force_not_judged: true,
      },
      created_at: stampNow(now),
      updated_at: stampNow(now),
    });
  }
  return normalizeClaimEvidenceItems(updates, { now });
}

/**
 * Contract package from uploaded docs without inventing claim cases.
 * Uses contract_package:personal|corporate:{entityId} as package subject.
 */
export function buildContractPackageEvidenceFromDocs({
  documents = [],
  existingEvidence = [],
  customerId = null,
  entityId = null,
  now = new Date(),
} = {}) {
  const eid = trim(entityId);
  const claim_case_id = contractPackageSubjectId({ entityId: eid });
  const fauxCase = {
    claim_case_key: claim_case_id,
    claim_scope: eid ? "corporate" : "personal",
    entity_id: eid,
  };
  const contractDocs = (Array.isArray(documents) ? documents : []).filter((d) =>
    classifyContractEvidenceType(d),
  );
  return buildOriginalDocumentEvidenceFromDocs({
    claimCase: fauxCase,
    documents: contractDocs,
    existingEvidence,
    customerId,
    now,
  });
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

/** Explicit customer evidence statement (not claim submit / payout). */
export function isCustomerEvidenceStatementUtterance(question = "") {
  const text = String(question ?? "").trim();
  if (!text) return false;
  if (isClaimSubmissionUtterance(text) || isPaymentOutcomeUtterance(text) || isDenialOutcomeUtterance(text)) {
    return false;
  }
  return /(진술|사실이야|고지\s*받았|설명\s*들었|동의\s*했|내가\s*말했던|증거로|기록해|정정하|아니라\s*.{0,20}이(?:야|에요)|수정하(?:면|려|고))/.test(
    text,
  );
}

export function isStatementCorrectionUtterance(question = "") {
  const text = String(question ?? "").trim();
  return /(정정|수정하|아니라)/.test(text);
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
 * customer_statement may bind to open claim or contract_package subject.
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
  const needsClaim =
    isClaimSubmissionUtterance(text) ||
    isPaymentOutcomeUtterance(text) ||
    isDenialOutcomeUtterance(text);
  if (needsClaim && !claim) {
    return { ok: false, reason: "no_open_claim", action: "skip", updates: [] };
  }

  const eid = claim
    ? String(claim.claim_scope) === "corporate"
      ? trim(claim.entity_id) || trim(entityId)
      : null
    : trim(entityId);
  if (claim && String(claim.claim_scope) === "corporate" && !eid) {
    return { ok: false, reason: "corporate_missing_entity", action: "skip", updates: [] };
  }

  const claim_case_id = claim
    ? trim(claim.claim_case_key)
    : contractPackageSubjectId({ entityId: eid });

  const msg = trim(messageId) || `evmsg_${Date.now().toString(36)}`;
  const updates = [];
  const existing = normalizeClaimEvidenceItems(existingEvidence, { now });

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
      document_version: null,
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
      document_version: null,
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

  if (isCustomerEvidenceStatementUtterance(text)) {
    const label = "고객 증거 진술";
    const priors = existing
      .filter(
        (e) =>
          e.evidence_type === "customer_statement" &&
          e.claim_case_id === claim_case_id &&
          (e.entity_id || null) === (eid || null) &&
          e.label === label,
      )
      .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
    const priorHead = priors.length ? priors[priors.length - 1] : null;
    const correcting = isStatementCorrectionUtterance(text);
    const document_version = nextDocumentVersion(
      [...existing, ...updates],
      {
        claimCaseId: claim_case_id,
        evidenceType: "customer_statement",
        label,
        entityId: eid,
      },
    );
    updates.push({
      id: `ev_customer_statement_${claim_case_id}_${msg}`.slice(0, 120),
      customer_id: trim(customerId),
      entity_id: eid,
      claim_case_id,
      evidence_type: "customer_statement",
      document_id: null,
      source_message_id: msg,
      source: "customer_statement",
      captured_at: stampNow(now),
      submitted_at: null,
      received_at: null,
      verification_status: "customer_reported",
      content_hash: null,
      document_version,
      // Preserve prior row; new row points to previous head when one exists.
      supersedes_id: priorHead?.id || null,
      label,
      metadata_json: {
        label,
        utterance: text.slice(0, 200),
        document_version,
        correction: Boolean(correcting && priorHead),
        chained_to_prior: Boolean(priorHead),
        insurer_verified: false,
        legal_force_not_judged: true,
      },
      created_at: stampNow(now),
      updated_at: stampNow(now),
    });
  }

  if (!updates.length) {
    return { ok: false, reason: "not_evidence_utterance", action: "skip", updates: [] };
  }

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
 * Hand brief per claim + contract packages — soft context only.
 * Does not advance Claim Guardian status or judge legal force.
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
    briefs.push(packageBriefFromItems(items, {
      key,
      claim_scope: c.claim_scope === "corporate" ? "corporate" : "personal",
      entity_id: c.entity_id ?? null,
      status: c.status ?? null,
      missing: Array.isArray(c.missing_documents) ? c.missing_documents.slice(0, 12) : [],
      next_action: typeof c.next_action === "string" ? c.next_action.slice(0, 200) : null,
      note: "evidence_package_claim_slice1",
    }));
  }
  // Contract packages present in vault but not Claim Guardian cases.
  const contractKeys = [
    ...new Set(
      items
        .filter((e) => String(e.claim_case_id || "").startsWith("contract_package:"))
        .map((e) => e.claim_case_id),
    ),
  ].slice(0, 8);
  for (const key of contractKeys) {
    if (briefs.some((b) => b.claim_case_id === key)) continue;
    const sample = items.find((e) => e.claim_case_id === key);
    briefs.push(packageBriefFromItems(items, {
      key,
      claim_scope: sample?.entity_id ? "corporate" : "personal",
      entity_id: sample?.entity_id ?? null,
      status: "contract_package",
      missing: [],
      next_action: null,
      note: "evidence_package_contract_slice",
    }));
  }
  return {
    packages: briefs,
    item_count: items.length,
    packs_separated: true,
    note: "key_owns_claim_evidence; claude_explains_only; no_legal_judgment",
  };
}

function packageBriefFromItems(items, {
  key,
  claim_scope,
  entity_id,
  status,
  missing,
  next_action,
  note,
}) {
  const pack = items.filter((e) => e.claim_case_id === key);
  const held = pack.filter((e) => e.evidence_type === "original_document");
  const submitted = pack.filter((e) => e.evidence_type === "claim_submission");
  const insurer = pack.filter((e) => e.evidence_type === "insurer_response");
  const outcomes = pack.filter((e) => e.evidence_type === "payment_or_denial_outcome");
  const statements = pack.filter((e) => e.evidence_type === "customer_statement");
  const application = pack.filter((e) => e.evidence_type === "application_disclosure");
  const explanation = pack.filter((e) => e.evidence_type === "explanation_consent");
  const terms = pack.filter((e) => e.evidence_type === "terms_document");
  return {
    claim_case_id: key,
    claim_scope,
    entity_id,
    status,
    held_evidence: held.map(briefItem).slice(0, 12),
    missing_evidence_labels: missing,
    submitted_evidence: submitted.map(briefItem).slice(0, 8),
    insurer_evidence: insurer.map(briefItem).slice(0, 8),
    outcome_evidence: outcomes.map(briefItem).slice(0, 8),
    statement_evidence: statements.map(briefItem).slice(0, 8),
    application_disclosure_evidence: application.map(briefItem).slice(0, 8),
    explanation_consent_evidence: explanation.map(briefItem).slice(0, 8),
    terms_document_evidence: terms.map(briefItem).slice(0, 8),
    next_action,
    note,
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
    document_version: e.document_version,
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
