/**
 * KEY Claim Guardian Slice 1A — post-answer claim intake sidecar.
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

const OPEN_CLAIM_STATUSES = new Set([
  "identified",
  "preparing",
  "ready_for_customer_submission",
  "submitted_by_customer",
  "under_review",
]);

function sha16(value = "") {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex").slice(0, 16);
}

/** Clear existing claim eligibility intent only — no soft keyword invention. */
export function isClearClaimIntakeQuestion(question = "") {
  const classification = classifyConsultationIntent(question);
  return classification?.intent === "claim_eligibility_check";
}

function resolveEventKind(question = "") {
  const topic = detectClaimTopic(question);
  const kind = topic?.topicKey ? String(topic.topicKey).trim() : "";
  return {
    event_kind: kind || "claim",
    label: topic?.label ? String(topic.label) : "보험금",
    required_documents: Array.isArray(topic?.documents) ? topic.documents : [],
  };
}

function findOpenCaseForKind(existingCases = [], eventKind = "") {
  const open = normalizeKeyClaimCaseUpdates(existingCases).filter((row) =>
    OPEN_CLAIM_STATUSES.has(String(row?.status ?? "")),
  );
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
  }
  // Single open case + clear claim re-ask → update that case (dedupe).
  if (open.length === 1) return open[0];
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

/**
 * Pure builder — no Claude, no payout judgment, no invented dates/diagnoses.
 */
export function buildKeyClaimIntakeUpdate({
  question = "",
  existingCases = [],
  attachedDocumentId = null,
  messageId = null,
  sessionId = null,
  now = null,
} = {}) {
  if (!isClearClaimIntakeQuestion(question)) {
    return {
      ok: false,
      reason: "not_clear_claim_intent",
      action: "skip",
      updates: [],
    };
  }

  const { event_kind, label, required_documents } = resolveEventKind(question);
  const prior = findOpenCaseForKind(existingCases, event_kind);
  const explicitKey =
    prior?.claim_case_key ||
    `customer_statement:kind:${event_kind}`;
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
  const docId = String(attachedDocumentId ?? "").trim();
  const priorDocs = Array.isArray(prior?.source_document_ids)
    ? prior.source_document_ids
    : [];
  const source_document_ids = [
    ...new Set([...priorDocs.map((d) => String(d)).filter(Boolean), ...(docId ? [docId] : [])]),
  ].slice(0, 24);

  const available_documents = Array.isArray(prior?.available_documents)
    ? [...prior.available_documents]
    : [];
  const required = required_documents.length
    ? required_documents
    : Array.isArray(prior?.required_documents)
      ? prior.required_documents
      : [];
  const missing_documents = required.filter((d) => !available_documents.includes(d));

  const updated_at =
    now instanceof Date
      ? now.toISOString()
      : typeof now === "string" && now.trim()
        ? now.trim()
        : new Date().toISOString();

  const evidence = [
    ...new Set([
      ...(Array.isArray(prior?.evidence) ? prior.evidence : []),
      `source:${KEY_CLAIM_INTAKE_SOURCE}`,
      `message_id:${source_message_id}`,
      ...(docId ? [`document_id:${docId}`] : []),
    ]),
  ].slice(0, 40);

  const status =
    prior && OPEN_CLAIM_STATUSES.has(String(prior.status))
      ? String(prior.status)
      : "identified";

  const update = {
    claim_case_key,
    medical_event: {
      event_kind,
      ...(prior?.medical_event && typeof prior.medical_event === "object"
        ? {
            // Keep only previously stored non-speculative fields; never invent new ones.
            ...(prior.medical_event.diagnosis_name
              ? { diagnosis_name: prior.medical_event.diagnosis_name }
              : {}),
            ...(prior.medical_event.surgery_name
              ? { surgery_name: prior.medical_event.surgery_name }
              : {}),
            ...(prior.medical_event.event_date
              ? { event_date: prior.medical_event.event_date }
              : {}),
            ...(prior.medical_event.admission_date
              ? { admission_date: prior.medical_event.admission_date }
              : {}),
            ...(prior.medical_event.surgery_date
              ? { surgery_date: prior.medical_event.surgery_date }
              : {}),
            ...(prior.medical_event.source_document_id
              ? { source_document_id: prior.medical_event.source_document_id }
              : {}),
          }
        : {}),
      event_kind,
    },
    related_policies: Array.isArray(prior?.related_policies) ? prior.related_policies : [],
    related_coverages: Array.isArray(prior?.related_coverages)
      ? prior.related_coverages
      : [],
    // Sidecar must not assess payout possibility.
    assessment: prior?.assessment ?? null,
    required_documents: required,
    available_documents,
    missing_documents,
    status,
    next_action:
      prior?.next_action ||
      `${label} 관련 청구 준비 — 필요 서류·약관 확인 (지급 확정 아님)`,
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
