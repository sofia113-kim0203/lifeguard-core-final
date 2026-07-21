/**
 * KEY Claim Guardian Slice 1A/1B/1C — intake + preparation + outcome sidecar.
 * Claude customer answer stays untouched (tools=0, single provider call).
 * KEY owns open claim cases via existing persistKeyActiveClaimCases.
 */
import { createHash } from "node:crypto";
import { classifyConsultationIntent } from "../intentGateLayer.js";
import { detectClaimTopic } from "../claimBridgeLayer.js";
import {
  normalizeKeyClaimCaseUpdates,
  mergeKeyActiveClaimCases,
  persistKeyActiveClaimCases,
  resolveStableClaimCaseKey,
} from "../documentPolicyUploadPersist.js";

export const KEY_CLAIM_INTAKE_SOURCE = "customer_statement";
export const KEY_CLAIM_UPLOAD_SOURCE = "uploaded_document";
export const KEY_CLAIM_SYSTEM_SOURCE = "confirmed_system_record";

const OPEN_CLAIM_STATUSES = new Set([
  "identified",
  "preparing",
  "ready_for_customer_submission",
  "submitted_by_customer",
  "under_review",
]);

/** Cases that can still receive submission / review / outcome updates. */
const OUTCOME_TRACKABLE_STATUSES = new Set([
  "identified",
  "preparing",
  "ready_for_customer_submission",
  "submitted_by_customer",
  "under_review",
]);

const OUTCOME_SUBMITTED_RE =
  /보험사에\s*접수|청구\s*접수|접수해\s*뒀|접수해\s*놓|접수했|접수\s*완료|접수했어/;
const OUTCOME_REVIEW_RE =
  /심사\s*중|심사하고\s*있|심사\s*받|심사하(다|고|는|래|래요|대요)/;
const OUTCOME_PAID_RE =
  /지급됐|지급\s*됐|보험금이\s*(지급|나왔|입금)|보험금\s*받았|입금됐|지급받았|지급됐어/;
const OUTCOME_DENIED_RE =
  /거절됐|거절\s*됐|청구를\s*거절|지급\s*거절|반려됐|거절됐어|거절했어/;
const OUTCOME_UNCLEAR_RE =
  /아직\s*연락이\s*없|잘\s*안\s*된\s*것\s*같|소식\s*없|답이\s*없|결과가\s*없/;
const DENIAL_REASON_UNKNOWN_RE =
  /이유는\s*아직\s*몰라|왜인지는\s*몰라|이유는\s*모르|사유는\s*아직/;
const PAYOUT_AMOUNT_RE = /(\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*만?\s*원)/;
const SUBMISSION_NUMBER_RE =
  /접수\s*번호\s*[:：]?\s*([A-Za-z0-9-]{4,40})|번호\s*[:：]?\s*([A-Za-z0-9-]{4,40})/;
const SUBMISSION_DATE_RE =
  /(\d{4}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}월\s*\d{1,2}일)\s*(?:에\s*)?접수/;

/** Canonical labels the customer may name — never invent beyond these aliases. */
export const CLAIM_PREP_DOCUMENT_ALIASES = Object.freeze([
  Object.freeze({
    canonical: "진단서",
    patterns: [/진단서/],
  }),
  Object.freeze({
    canonical: "입퇴원확인서",
    patterns: [/입퇴원\s*확인서/, /입퇴원확인서/, /입·?\s*퇴원\s*확인서/],
  }),
  Object.freeze({
    canonical: "수술확인서",
    patterns: [/수술\s*확인서/, /수술확인서/, /수술\s*기록/, /수술기록/],
  }),
  Object.freeze({
    canonical: "의료비영수증",
    patterns: [/의료비\s*영수증/, /진료비\s*영수증/, /영수증/],
  }),
  Object.freeze({
    canonical: "보험증권",
    patterns: [/보험증권/, /가입확인서/],
  }),
  Object.freeze({
    canonical: "암진단서",
    patterns: [/암\s*진단서/],
  }),
  Object.freeze({
    canonical: "조직검사결과",
    patterns: [/조직검사/],
  }),
]);

const PREP_VERB_RE = /준비했|준비돼|준비되|준비했어|챙겼|챙겨\s*뒀|마련했|받아\s*뒀|받아\s*놓/;

function sha16(value = "") {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex").slice(0, 16);
}

function stampNow(now = null) {
  if (now instanceof Date) return now.toISOString();
  if (typeof now === "string" && now.trim()) return now.trim();
  return new Date().toISOString();
}

function normalizeDocLabel(value = "") {
  return String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/·/g, "")
    .toLowerCase();
}

export function documentLabelsMatch(a = "", b = "") {
  const left = normalizeDocLabel(a);
  const right = normalizeDocLabel(b);
  if (!left || !right) return false;
  if (left === right) return true;
  // Resolve both through aliases (specific first) so 진단서 ≠ 암진단서.
  return resolveCanonicalDocLabel(a) === resolveCanonicalDocLabel(b);
}

/** Prefer longer/more specific alias (암진단서 before 진단서). */
export function resolveCanonicalDocLabel(label = "") {
  const text = String(label ?? "").trim();
  if (!text) return "";
  const ordered = [...CLAIM_PREP_DOCUMENT_ALIASES].sort(
    (a, b) => b.canonical.length - a.canonical.length,
  );
  for (const row of ordered) {
    if (row.patterns.some((re) => re.test(text))) return row.canonical;
  }
  return normalizeDocLabel(text);
}

function preparedMatchesPool(preparedCanonical = "", poolItem = "") {
  const prepared = String(preparedCanonical ?? "").trim();
  if (!prepared) return false;
  return resolveCanonicalDocLabel(poolItem) === prepared;
}

function scoreOpenCaseForPreparedDocs(row = null, preparedDocs = []) {
  if (!row || !preparedDocs.length) return 0;
  const pool = [
    ...(Array.isArray(row.missing_documents) ? row.missing_documents : []),
    ...(Array.isArray(row.required_documents) ? row.required_documents : []),
    ...(Array.isArray(row.available_documents) ? row.available_documents : []),
  ];
  let score = 0;
  for (const p of preparedDocs) {
    if (pool.some((item) => preparedMatchesPool(p, item))) score += 1;
  }
  return score;
}

/** Pick one open case for prep/attach without mixing unrelated events. */
export function pickOpenCaseForPreparation({
  existingCases = [],
  preparedDocs = [],
  topicKey = null,
} = {}) {
  const open = listOpenCases(existingCases);
  if (!open.length) return null;
  if (topicKey) {
    const byKind = findOpenCaseForKind(existingCases, topicKey, {
      allowSingleFallback: false,
    });
    if (byKind) return byKind;
  }
  if (open.length === 1) return open[0];
  if (preparedDocs.length) {
    const scored = open
      .map((row) => ({ row, score: scoreOpenCaseForPreparedDocs(row, preparedDocs) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return String(b.row.updated_at ?? "").localeCompare(String(a.row.updated_at ?? ""));
      });
    if (scored.length === 1) return scored[0].row;
    if (scored.length > 1 && scored[0].score > scored[1].score) return scored[0].row;
  }
  const preparing = open.filter((row) => String(row.status) === "preparing");
  if (preparing.length === 1) return preparing[0];
  // Attach / prep with no unique doc signal — most recently updated open case only.
  const sorted = [...open].sort((a, b) =>
    String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")),
  );
  return preparedDocs.length || topicKey ? null : sorted[0] ?? null;
}

/** Clear existing claim eligibility intent only — no soft keyword invention. */
export function isClearClaimIntakeQuestion(question = "") {
  const classification = classifyConsultationIntent(question);
  return classification?.intent === "claim_eligibility_check";
}

/**
 * Customer-stated prepared documents only. Empty if no prep verb or no known alias.
 */
export function extractPreparedDocumentsFromUtterance(question = "") {
  const text = String(question ?? "").trim();
  if (!text || !PREP_VERB_RE.test(text)) return [];
  const found = [];
  const seen = new Set();
  for (const row of CLAIM_PREP_DOCUMENT_ALIASES) {
    if (!row.patterns.some((re) => re.test(text))) continue;
    if (seen.has(row.canonical)) continue;
    seen.add(row.canonical);
    found.push(row.canonical);
  }
  return found;
}

export function isClaimPreparationUtterance(question = "") {
  return extractPreparedDocumentsFromUtterance(question).length > 0;
}

/**
 * Detect clear claim lifecycle outcome from customer utterance only.
 * Returns null when unclear / no advancement.
 */
export function detectClaimOutcomeSignal(question = "") {
  const text = String(question ?? "").trim();
  if (!text) return null;

  // Terminal outcomes first.
  if (OUTCOME_DENIED_RE.test(text)) {
    const denial_reason = DENIAL_REASON_UNKNOWN_RE.test(text)
      ? "unknown"
      : null;
    return {
      kind: "denied",
      status: "denied",
      denial_reason,
      next_action: denial_reason === "unknown" ? "거절 사유 확인" : "결과 기록 유지",
    };
  }
  if (OUTCOME_PAID_RE.test(text)) {
    const amountMatch = text.match(PAYOUT_AMOUNT_RE);
    return {
      kind: "paid",
      status: "paid",
      payout_amount_text: amountMatch ? amountMatch[1].replace(/\s+/g, "") : null,
      next_action: "결과 기록 유지",
    };
  }
  if (OUTCOME_REVIEW_RE.test(text)) {
    return {
      kind: "under_review",
      status: "under_review",
      next_action: "결과 확인",
    };
  }
  if (OUTCOME_SUBMITTED_RE.test(text)) {
    const numMatch = text.match(SUBMISSION_NUMBER_RE);
    const dateMatch = text.match(SUBMISSION_DATE_RE);
    return {
      kind: "submitted_by_customer",
      status: "submitted_by_customer",
      submission_number: numMatch ? String(numMatch[1] || numMatch[2] || "").trim() || null : null,
      submission_date_text: dateMatch ? String(dateMatch[1]).trim() : null,
      next_action: "심사·결과 확인",
    };
  }
  if (OUTCOME_UNCLEAR_RE.test(text)) {
    return {
      kind: "unclear_wait",
      status: null,
      next_action: "결과 확인",
    };
  }
  return null;
}

function listOutcomeTrackableCases(existingCases = []) {
  return normalizeKeyClaimCaseUpdates(existingCases).filter((row) =>
    OUTCOME_TRACKABLE_STATUSES.has(String(row?.status ?? "")),
  );
}

function pickOpenCaseForOutcome(existingCases = [], topicKey = null) {
  const open = listOutcomeTrackableCases(existingCases);
  if (!open.length) return null;
  if (topicKey) {
    const byKind = findOpenCaseForKind(existingCases, topicKey, {
      allowSingleFallback: false,
    });
    if (byKind && OUTCOME_TRACKABLE_STATUSES.has(String(byKind.status))) {
      return byKind;
    }
  }
  if (open.length === 1) return open[0];
  const progressing = open.filter((row) =>
    ["preparing", "submitted_by_customer", "under_review"].includes(
      String(row.status),
    ),
  );
  if (progressing.length === 1) return progressing[0];
  // Multiple trackable without unique event signal — do not guess.
  return null;
}

function resolveEventKind(question = "") {
  const topic = detectClaimTopic(question);
  const kind = topic?.topicKey ? String(topic.topicKey).trim() : "";
  return {
    event_kind: kind || "claim",
    label: topic?.label ? String(topic.label) : "보험금",
    required_documents: Array.isArray(topic?.documents) ? topic.documents : [],
    topicKey: topic?.topicKey ?? null,
  };
}

function listOpenCases(existingCases = []) {
  return normalizeKeyClaimCaseUpdates(existingCases).filter((row) =>
    OPEN_CLAIM_STATUSES.has(String(row?.status ?? "")),
  );
}

/**
 * Find open case for a kind. Never mix a clear different event into another case.
 * Single-open fallback only when kind is generic ("claim") or unset.
 */
export function findOpenCaseForKind(
  existingCases = [],
  eventKind = "",
  { allowSingleFallback = true } = {},
) {
  const open = listOpenCases(existingCases);
  if (!open.length) return null;
  const kind = String(eventKind ?? "").trim();
  if (kind) {
    const byKind = open.find((row) => {
      const medical =
        row.medical_event && typeof row.medical_event === "object"
          ? row.medical_event
          : {};
      if (String(medical.event_kind ?? "").trim() === kind) return true;
      return String(row.claim_case_key ?? "").includes(`kind:${kind}`);
    });
    if (byKind) return byKind;
    // Clear topic that didn't match any open case — do not steal another event.
    if (kind !== "claim") return null;
  }
  if (allowSingleFallback && open.length === 1) return open[0];
  return null;
}

function buildSourceMessageId({ messageId = null, question = "", sessionId = null } = {}) {
  const explicit = String(messageId ?? "").trim();
  if (explicit) return explicit.slice(0, 180);
  const sid = String(sessionId ?? "").trim();
  const qHash = sha16(String(question ?? "").trim());
  if (sid) return `session:${sid}:utterance:${qHash}`.slice(0, 180);
  return `utterance:${qHash}`.slice(0, 180);
}

function preserveMedicalEvent(prior = null, eventKind = null) {
  const medical =
    prior?.medical_event && typeof prior.medical_event === "object"
      ? prior.medical_event
      : {};
  const kind =
    eventKind ||
    (medical.event_kind != null ? String(medical.event_kind) : null) ||
    "claim";
  return {
    event_kind: kind,
    ...(medical.diagnosis_name ? { diagnosis_name: medical.diagnosis_name } : {}),
    ...(medical.surgery_name ? { surgery_name: medical.surgery_name } : {}),
    ...(medical.event_date ? { event_date: medical.event_date } : {}),
    ...(medical.admission_date ? { admission_date: medical.admission_date } : {}),
    ...(medical.surgery_date ? { surgery_date: medical.surgery_date } : {}),
    ...(medical.source_document_id
      ? { source_document_id: medical.source_document_id }
      : {}),
  };
}

function removePreparedFromMissing(missing = [], prepared = []) {
  return (Array.isArray(missing) ? missing : []).filter(
    (item) => !prepared.some((p) => preparedMatchesPool(p, item)),
  );
}

function mergeAvailable(priorAvailable = [], prepared = []) {
  const out = [];
  const seen = new Set();
  for (const item of [...(priorAvailable || []), ...(prepared || [])]) {
    const label = String(item ?? "").trim();
    if (!label) continue;
    const key = normalizeDocLabel(label);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

/**
 * Single next_action from remaining missing / readiness. No insurer filing certainty.
 */
export function resolveClaimNextAction({
  missing_documents = [],
  required_documents = [],
  available_documents = [],
  prior_next_action = null,
} = {}) {
  const missing = Array.isArray(missing_documents) ? missing_documents.filter(Boolean) : [];
  if (missing.length) {
    const first = String(missing[0]);
    if (/증권|가입확인/.test(first)) return "보험증권 확인";
    return `${first} 준비`;
  }
  const required = Array.isArray(required_documents) ? required_documents : [];
  const available = Array.isArray(available_documents) ? available_documents : [];
  if (required.length > 0 && missing.length === 0) {
    return "보험사 접수 필요";
  }
  if (available.length > 0 && required.length === 0) {
    return "보험사 접수 필요";
  }
  const prior = String(prior_next_action ?? "").trim();
  return prior || "필요 서류 확인";
}

function finalizeNormalized(update, updated_at) {
  const normalized = normalizeKeyClaimCaseUpdates([update], { updated_at });
  if (!normalized.length) {
    return {
      ok: false,
      reason: "normalize_empty",
      action: "skip",
      updates: [],
    };
  }
  return null;
}

function buildPreparationUpdate({
  question = "",
  existingCases = [],
  preparedDocs = [],
  attachedDocumentId = null,
  messageId = null,
  sessionId = null,
  now = null,
} = {}) {
  const open = listOpenCases(existingCases);
  if (!open.length) {
    return {
      ok: false,
      reason: "no_open_claim_case",
      action: "skip",
      updates: [],
    };
  }
  const { topicKey } = resolveEventKind(question);
  const prior = pickOpenCaseForPreparation({
    existingCases,
    preparedDocs,
    topicKey,
  });
  if (!prior) {
    return {
      ok: false,
      reason: open.length > 1 ? "ambiguous_open_claim_case" : "no_matching_open_case",
      action: "skip",
      updates: [],
    };
  }

  const updated_at = stampNow(now);
  const source_message_id = buildSourceMessageId({ messageId, question, sessionId });
  const docId = String(attachedDocumentId ?? "").trim();
  const required = Array.isArray(prior.required_documents)
    ? [...prior.required_documents]
    : [];
  const available_documents = mergeAvailable(prior.available_documents, preparedDocs);
  const priorMissing = Array.isArray(prior.missing_documents)
    ? prior.missing_documents
    : required;
  const missing_documents = removePreparedFromMissing(priorMissing, preparedDocs).filter(
    (item) => !available_documents.some((a) => documentLabelsMatch(a, item)),
  );
  const next_action = resolveClaimNextAction({
    missing_documents,
    required_documents: required,
    available_documents,
    prior_next_action: prior.next_action,
  });

  const evidence = [
    ...new Set([
      ...(Array.isArray(prior.evidence) ? prior.evidence : []),
      `source:${KEY_CLAIM_INTAKE_SOURCE}`,
      `message_id:${source_message_id}`,
      ...preparedDocs.map((d) => `prepared_document:${d}`),
      ...(docId
        ? [`source:${KEY_CLAIM_UPLOAD_SOURCE}`, `document_id:${docId}`, "document_content:unverified"]
        : []),
    ]),
  ].slice(0, 40);

  const source_document_ids = [
    ...new Set([
      ...(Array.isArray(prior.source_document_ids) ? prior.source_document_ids : []),
      ...(docId ? [docId] : []),
    ]),
  ].slice(0, 24);

  const status =
    String(prior.status) === "identified" || !OPEN_CLAIM_STATUSES.has(String(prior.status))
      ? "preparing"
      : String(prior.status);

  const update = {
    claim_case_key: prior.claim_case_key,
    medical_event: preserveMedicalEvent(prior),
    related_policies: Array.isArray(prior.related_policies) ? prior.related_policies : [],
    related_coverages: Array.isArray(prior.related_coverages) ? prior.related_coverages : [],
    assessment: prior.assessment ?? null,
    required_documents: required,
    available_documents,
    missing_documents,
    status,
    next_action,
    evidence,
    source: KEY_CLAIM_INTAKE_SOURCE,
    source_message_id,
    source_document_ids,
    updated_at,
  };

  const fail = finalizeNormalized(update, updated_at);
  if (fail) return fail;
  const normalized = normalizeKeyClaimCaseUpdates([update], { updated_at });
  return {
    ok: true,
    reason: "updated_preparation",
    action: "update",
    updates: normalized,
    claim_case_key: prior.claim_case_key,
  };
}

function buildOutcomeUpdate({
  question = "",
  existingCases = [],
  outcome = null,
  attachedDocumentId = null,
  messageId = null,
  sessionId = null,
  now = null,
} = {}) {
  if (!outcome || typeof outcome !== "object") {
    return { ok: false, reason: "no_outcome_signal", action: "skip", updates: [] };
  }
  const { topicKey } = resolveEventKind(question);
  const prior = pickOpenCaseForOutcome(existingCases, topicKey);
  const trackable = listOutcomeTrackableCases(existingCases);
  if (!prior) {
    return {
      ok: false,
      reason: trackable.length === 0 ? "no_open_claim_case" : "ambiguous_open_claim_case",
      action: "skip",
      updates: [],
    };
  }

  const updated_at = stampNow(now);
  const source_message_id = buildSourceMessageId({ messageId, question, sessionId });
  const docId = String(attachedDocumentId ?? "").trim();
  const source_document_ids = [
    ...new Set([
      ...(Array.isArray(prior.source_document_ids) ? prior.source_document_ids : []),
      ...(docId ? [docId] : []),
    ]),
  ].slice(0, 24);

  // Unclear wait — keep status; only refresh next_action when clear single case.
  if (outcome.kind === "unclear_wait") {
    const evidence = [
      ...new Set([
        ...(Array.isArray(prior.evidence) ? prior.evidence : []),
        `source:${KEY_CLAIM_INTAKE_SOURCE}`,
        `message_id:${source_message_id}`,
        "outcome_signal:unclear_wait",
      ]),
    ].slice(0, 40);
    const update = {
      claim_case_key: prior.claim_case_key,
      medical_event: preserveMedicalEvent(prior),
      related_policies: Array.isArray(prior.related_policies) ? prior.related_policies : [],
      related_coverages: Array.isArray(prior.related_coverages)
        ? prior.related_coverages
        : [],
      assessment: prior.assessment ?? null,
      required_documents: Array.isArray(prior.required_documents)
        ? prior.required_documents
        : [],
      available_documents: Array.isArray(prior.available_documents)
        ? prior.available_documents
        : [],
      missing_documents: Array.isArray(prior.missing_documents)
        ? prior.missing_documents
        : [],
      status: prior.status,
      next_action: outcome.next_action || "결과 확인",
      evidence,
      source: KEY_CLAIM_INTAKE_SOURCE,
      source_message_id,
      source_document_ids,
      insurer_verified: false,
      denial_reason: prior.denial_reason ?? null,
      payout_amount_text: prior.payout_amount_text ?? null,
      submission_number: prior.submission_number ?? null,
      submission_date_text: prior.submission_date_text ?? null,
      updated_at,
    };
    const normalized = normalizeKeyClaimCaseUpdates([update], { updated_at });
    if (!normalized.length) {
      return { ok: false, reason: "normalize_empty", action: "skip", updates: [] };
    }
    return {
      ok: true,
      reason: "outcome_unclear_keep_status",
      action: "update",
      updates: normalized,
      claim_case_key: prior.claim_case_key,
    };
  }

  const status = String(outcome.status);
  const evidence = [
    ...new Set([
      ...(Array.isArray(prior.evidence) ? prior.evidence : []),
      `source:${KEY_CLAIM_INTAKE_SOURCE}`,
      `message_id:${source_message_id}`,
      `outcome_status:${status}`,
      "outcome_source:customer_statement",
      "insurer_verified:false",
      ...(docId
        ? [
            `source:${KEY_CLAIM_UPLOAD_SOURCE}`,
            `document_id:${docId}`,
            "document_content:unverified",
          ]
        : []),
      ...(outcome.denial_reason
        ? [`denial_reason:${outcome.denial_reason}`]
        : []),
      ...(outcome.payout_amount_text
        ? [`payout_amount:${outcome.payout_amount_text}`]
        : []),
      ...(outcome.submission_number
        ? [`submission_number:${outcome.submission_number}`]
        : []),
      ...(outcome.submission_date_text
        ? [`submission_date:${outcome.submission_date_text}`]
        : []),
    ]),
  ].slice(0, 40);

  const update = {
    claim_case_key: prior.claim_case_key,
    medical_event: preserveMedicalEvent(prior),
    related_policies: Array.isArray(prior.related_policies) ? prior.related_policies : [],
    related_coverages: Array.isArray(prior.related_coverages)
      ? prior.related_coverages
      : [],
    assessment: prior.assessment ?? null,
    required_documents: Array.isArray(prior.required_documents)
      ? prior.required_documents
      : [],
    available_documents: Array.isArray(prior.available_documents)
      ? prior.available_documents
      : [],
    missing_documents: Array.isArray(prior.missing_documents)
      ? prior.missing_documents
      : [],
    status,
    next_action: outcome.next_action || prior.next_action || "결과 확인",
    evidence,
    source: KEY_CLAIM_INTAKE_SOURCE,
    source_message_id,
    source_document_ids,
    insurer_verified: false,
    denial_reason:
      status === "denied"
        ? outcome.denial_reason || prior.denial_reason || "unknown"
        : prior.denial_reason ?? null,
    payout_amount_text:
      status === "paid"
        ? outcome.payout_amount_text || prior.payout_amount_text || null
        : prior.payout_amount_text ?? null,
    submission_number:
      outcome.submission_number || prior.submission_number || null,
    submission_date_text:
      outcome.submission_date_text || prior.submission_date_text || null,
    updated_at,
  };

  const normalized = normalizeKeyClaimCaseUpdates([update], { updated_at });
  if (!normalized.length) {
    return { ok: false, reason: "normalize_empty", action: "skip", updates: [] };
  }
  // Evidence must allow status advance (KEY_CLAIM_STATUS_NEEDS_EVIDENCE).
  if (normalized[0].status !== status) {
    return {
      ok: false,
      reason: "outcome_status_blocked_no_evidence",
      action: "skip",
      updates: [],
    };
  }
  return {
    ok: true,
    reason: `outcome_${outcome.kind}`,
    action: "update",
    updates: normalized,
    claim_case_key: prior.claim_case_key,
  };
}

function buildAttachEvidenceUpdate({
  question = "",
  existingCases = [],
  attachedDocumentId = null,
  messageId = null,
  sessionId = null,
  now = null,
} = {}) {
  const docId = String(attachedDocumentId ?? "").trim();
  if (!docId) {
    return { ok: false, reason: "no_attached_document", action: "skip", updates: [] };
  }
  const open = listOpenCases(existingCases);
  if (!open.length) {
    return {
      ok: false,
      reason: "no_open_claim_case",
      action: "skip",
      updates: [],
    };
  }
  const prior =
    pickOpenCaseForPreparation({
      existingCases,
      preparedDocs: [],
      topicKey: null,
    }) || (open.length === 1 ? open[0] : null);
  if (!prior) {
    return {
      ok: false,
      reason: "ambiguous_open_claim_case",
      action: "skip",
      updates: [],
    };
  }
  const updated_at = stampNow(now);
  const source_message_id = buildSourceMessageId({ messageId, question, sessionId });
  const source_document_ids = [
    ...new Set([
      ...(Array.isArray(prior.source_document_ids) ? prior.source_document_ids : []),
      docId,
    ]),
  ].slice(0, 24);
  const evidence = [
    ...new Set([
      ...(Array.isArray(prior.evidence) ? prior.evidence : []),
      `source:${KEY_CLAIM_UPLOAD_SOURCE}`,
      `document_id:${docId}`,
      "document_content:unverified",
      `message_id:${source_message_id}`,
    ]),
  ].slice(0, 40);

  const update = {
    claim_case_key: prior.claim_case_key,
    medical_event: preserveMedicalEvent(prior),
    related_policies: Array.isArray(prior.related_policies) ? prior.related_policies : [],
    related_coverages: Array.isArray(prior.related_coverages) ? prior.related_coverages : [],
    assessment: prior.assessment ?? null,
    required_documents: Array.isArray(prior.required_documents)
      ? prior.required_documents
      : [],
    available_documents: Array.isArray(prior.available_documents)
      ? prior.available_documents
      : [],
    missing_documents: Array.isArray(prior.missing_documents)
      ? prior.missing_documents
      : [],
    status: prior.status,
    next_action: prior.next_action,
    evidence,
    source: prior.source || KEY_CLAIM_INTAKE_SOURCE,
    source_message_id,
    source_document_ids,
    updated_at,
  };

  const normalized = normalizeKeyClaimCaseUpdates([update], { updated_at });
  if (!normalized.length) {
    return { ok: false, reason: "normalize_empty", action: "skip", updates: [] };
  }
  return {
    ok: true,
    reason: "linked_uploaded_document",
    action: "update",
    updates: normalized,
    claim_case_key: prior.claim_case_key,
  };
}

/**
 * Pure builder — no Claude, no payout judgment, no invented dates/diagnoses.
 * Slice 1B: preparation updates + attach evidence link on open cases.
 */
export function buildKeyClaimIntakeUpdate({
  question = "",
  existingCases = [],
  attachedDocumentId = null,
  messageId = null,
  sessionId = null,
  now = null,
} = {}) {
  const preparedDocs = extractPreparedDocumentsFromUtterance(question);
  const isIntake = isClearClaimIntakeQuestion(question);
  const docId = String(attachedDocumentId ?? "").trim();
  const outcome = detectClaimOutcomeSignal(question);

  // Slice 1C — submission / review / paid / denied / unclear wait (never create).
  if (outcome && !isIntake) {
    return buildOutcomeUpdate({
      question,
      existingCases,
      outcome,
      attachedDocumentId: docId || null,
      messageId,
      sessionId,
      now,
    });
  }

  // Preparation path — update open case only; never create.
  if (preparedDocs.length > 0 && !isIntake) {
    return buildPreparationUpdate({
      question,
      existingCases,
      preparedDocs,
      attachedDocumentId: docId || null,
      messageId,
      sessionId,
      now,
    });
  }

  // Attach-only on a single open case — link id, do not invent doc type / verified content.
  if (!isIntake && docId) {
    return buildAttachEvidenceUpdate({
      question,
      existingCases,
      attachedDocumentId: docId,
      messageId,
      sessionId,
      now,
    });
  }

  if (!isIntake) {
    return {
      ok: false,
      reason: "not_clear_claim_intent",
      action: "skip",
      updates: [],
    };
  }

  const { event_kind, label, required_documents, topicKey } = resolveEventKind(question);
  const prior = findOpenCaseForKind(existingCases, event_kind, {
    // Clear different event must not update an unrelated single open case.
    allowSingleFallback: !topicKey || event_kind === "claim",
  });

  // Different clear event with no matching open case → new case (do not mix).
  // Unclear generic claim with multiple open cases → skip create.
  if (!prior && listOpenCases(existingCases).length > 1 && (!topicKey || event_kind === "claim")) {
    return {
      ok: false,
      reason: "ambiguous_open_claim_case",
      action: "skip",
      updates: [],
    };
  }

  const explicitKey =
    prior?.claim_case_key || `customer_statement:kind:${event_kind}`;
  const claim_case_key = resolveStableClaimCaseKey({
    claim_case_key: explicitKey,
  });
  if (!claim_case_key) {
    return {
      ok: false,
      reason: "no_stable_claim_case_key",
      action: "skip",
      updates: [],
    };
  }

  const source_message_id = buildSourceMessageId({ messageId, question, sessionId });
  const priorDocs = Array.isArray(prior?.source_document_ids)
    ? prior.source_document_ids
    : [];
  const source_document_ids = [
    ...new Set([...priorDocs.map((d) => String(d)).filter(Boolean), ...(docId ? [docId] : [])]),
  ].slice(0, 24);

  const preparedOnIntake = extractPreparedDocumentsFromUtterance(question);
  const available_documents = mergeAvailable(
    Array.isArray(prior?.available_documents) ? prior.available_documents : [],
    preparedOnIntake,
  );
  const required = required_documents.length
    ? required_documents
    : Array.isArray(prior?.required_documents)
      ? prior.required_documents
      : [];
  const baseMissing = Array.isArray(prior?.missing_documents)
    ? prior.missing_documents
    : required;
  const missing_documents = removePreparedFromMissing(baseMissing, preparedOnIntake).filter(
    (item) => !available_documents.some((a) => documentLabelsMatch(a, item)),
  );

  const updated_at = stampNow(now);

  const evidence = [
    ...new Set([
      ...(Array.isArray(prior?.evidence) ? prior.evidence : []),
      `source:${KEY_CLAIM_INTAKE_SOURCE}`,
      `message_id:${source_message_id}`,
      ...(docId
        ? [`source:${KEY_CLAIM_UPLOAD_SOURCE}`, `document_id:${docId}`, "document_content:unverified"]
        : []),
      ...preparedOnIntake.map((d) => `prepared_document:${d}`),
    ]),
  ].slice(0, 40);

  let status =
    prior && OPEN_CLAIM_STATUSES.has(String(prior.status))
      ? String(prior.status)
      : "identified";
  if (preparedOnIntake.length && status === "identified") status = "preparing";

  const next_action = resolveClaimNextAction({
    missing_documents,
    required_documents: required,
    available_documents,
    prior_next_action:
      prior?.next_action ||
      `${label} 관련 청구 준비 — 필요 서류·약관 확인 (지급 확정 아님)`,
  });

  const update = {
    claim_case_key,
    medical_event: preserveMedicalEvent(prior, event_kind),
    related_policies: Array.isArray(prior?.related_policies) ? prior.related_policies : [],
    related_coverages: Array.isArray(prior?.related_coverages)
      ? prior.related_coverages
      : [],
    assessment: prior?.assessment ?? null,
    required_documents: required,
    available_documents,
    missing_documents,
    status,
    next_action,
    evidence,
    source: KEY_CLAIM_INTAKE_SOURCE,
    source_message_id,
    source_document_ids,
    updated_at,
  };

  const normalized = normalizeKeyClaimCaseUpdates([update], { updated_at });
  if (!normalized.length) {
    return {
      ok: false,
      reason: "normalize_empty",
      action: "skip",
      updates: [],
    };
  }

  return {
    ok: true,
    reason: prior ? "updated_open_case" : "created_open_case",
    action: prior ? "update" : "create",
    updates: normalized,
    claim_case_key,
  };
}

/**
 * Post-answer intake — failures never throw to rewrite customer text.
 */
export async function runKeyClaimIntakeSidecar({
  question = "",
  existingCases = [],
  attachedDocumentId = null,
  messageId = null,
  sessionId = null,
  customerId = null,
  supabase = null,
  now = null,
  persistImpl = persistKeyActiveClaimCases,
} = {}) {
  const built = buildKeyClaimIntakeUpdate({
    question,
    existingCases,
    attachedDocumentId,
    messageId,
    sessionId,
    now,
  });
  if (!built.ok) {
    return {
      attempted: false,
      ok: false,
      reason: built.reason,
      action: "skip",
      stored: 0,
      updates: [],
      persist: { attempted: false, ok: false, stored: 0 },
    };
  }

  if (!supabase || !customerId) {
    return {
      attempted: true,
      ok: false,
      reason: !supabase ? "no_supabase" : "no_customer_id",
      action: built.action,
      stored: 0,
      updates: built.updates,
      claim_case_key: built.claim_case_key,
      persist: { attempted: false, ok: false, stored: 0 },
    };
  }

  try {
    const persist = await persistImpl({
      supabase,
      customerId,
      claimCaseUpdates: built.updates,
    });
    return {
      attempted: true,
      ok: persist?.ok === true,
      reason: built.reason,
      action: built.action,
      stored: Number(persist?.stored ?? 0) || 0,
      case_count: persist?.case_count ?? null,
      updates: built.updates,
      claim_case_key: built.claim_case_key,
      persist: persist ?? { attempted: true, ok: false, stored: 0 },
      merged_preview_count: mergeKeyActiveClaimCases(existingCases, built.updates)
        .length,
    };
  } catch (err) {
    return {
      attempted: true,
      ok: false,
      reason: "persist_threw",
      action: built.action,
      stored: 0,
      updates: built.updates,
      claim_case_key: built.claim_case_key,
      error: String(err?.message ?? err).slice(0, 200),
      persist: { attempted: true, ok: false, stored: 0 },
    };
  }
}
