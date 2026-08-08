/**
 * S3 TRACE BRIDGE — pure compact/omit mapping only.
 * No invent, no nested reconstruction, no derived counts.
 */

export const KEY_CONFIRMATION_TRACE_SCHEMA = "key_confirmation_trace_v1";

function asTrimmedId(value) {
  const id = String(value ?? "").trim();
  return id || null;
}

function asFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBooleanOrNull(value) {
  return typeof value === "boolean" ? value : null;
}

function uniqueDocIds(values) {
  if (!Array.isArray(values)) return null;
  const out = [];
  const seen = new Set();
  for (const raw of values) {
    const id = asTrimmedId(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out.length ? out : null;
}

/**
 * Compact an explicit key_confirmation_trace bag.
 * Absent fields are omitted — never inferred or zero-filled.
 */
export function buildKeyConfirmationTrace(input = {}) {
  const src = input && typeof input === "object" ? input : {};
  const trace = { schema: KEY_CONFIRMATION_TRACE_SCHEMA };

  const originalAttachmentCount = asFiniteNumber(src.original_attachment_count);
  if (originalAttachmentCount != null) {
    trace.original_attachment_count = originalAttachmentCount;
  }

  const currentTurnDocumentCount = asFiniteNumber(src.current_turn_document_count);
  if (currentTurnDocumentCount != null) {
    trace.current_turn_document_count = currentTurnDocumentCount;
  }

  const currentTurnDocumentIds = uniqueDocIds(src.current_turn_document_ids);
  if (currentTurnDocumentIds) {
    trace.current_turn_document_ids = currentTurnDocumentIds;
  }

  const sidecarPresent = asBooleanOrNull(src.sidecar_present);
  if (sidecarPresent != null) trace.sidecar_present = sidecarPresent;

  const sidecarOk = asBooleanOrNull(src.sidecar_ok);
  if (sidecarOk != null) trace.sidecar_ok = sidecarOk;

  const confirmedCount = asFiniteNumber(src.confirmed_source_facts_count);
  if (confirmedCount != null) {
    trace.confirmed_source_facts_count = confirmedCount;
  }

  const confirmedPromotion = asFiniteNumber(src.confirmed_promotion);
  if (confirmedPromotion != null) {
    trace.confirmed_promotion = confirmedPromotion;
  }

  const provenanceIds = uniqueDocIds(src.provenance_source_document_ids);
  if (provenanceIds) {
    trace.provenance_source_document_ids = provenanceIds;
  }

  if (
    src.confirmed_provenance_reason != null &&
    String(src.confirmed_provenance_reason).trim()
  ) {
    trace.confirmed_provenance_reason = String(src.confirmed_provenance_reason)
      .trim()
      .slice(0, 120);
  }

  const gateAttempted = asBooleanOrNull(src.gate_attempted);
  if (gateAttempted != null) trace.gate_attempted = gateAttempted;

  const gateAccepted = asFiniteNumber(src.gate_accepted_count);
  if (gateAccepted != null) trace.gate_accepted_count = gateAccepted;

  // Direct runtime field only — do not derive from rejected_reason_counts.
  const gateRejected = asFiniteNumber(src.gate_rejected_count);
  if (gateRejected != null) trace.gate_rejected_count = gateRejected;

  if (
    src.gate_rejected_reason_counts &&
    typeof src.gate_rejected_reason_counts === "object" &&
    !Array.isArray(src.gate_rejected_reason_counts)
  ) {
    const cleaned = {};
    for (const [key, value] of Object.entries(src.gate_rejected_reason_counts)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        cleaned[String(key).slice(0, 80)] = value;
      }
    }
    if (Object.keys(cleaned).length) {
      trace.gate_rejected_reason_counts = cleaned;
    }
  }

  const memoryCommitId = asTrimmedId(src.memory_commit_id);
  if (memoryCommitId) trace.memory_commit_id = memoryCommitId;

  if (src.memory_persist_status != null && String(src.memory_persist_status).trim()) {
    trace.memory_persist_status = String(src.memory_persist_status).trim().slice(0, 48);
  }

  return Object.keys(trace).length > 1 ? trace : null;
}

/**
 * Normalize an explicitly provided key_confirmation_trace only.
 * No nested sales_director_trace / one_key_core_trace reconstruction.
 */
export function extractKeyConfirmationTraceFromDonePayload(payload = null) {
  const p = payload && typeof payload === "object" ? payload : {};
  if (!p.key_confirmation_trace || typeof p.key_confirmation_trace !== "object") {
    return null;
  }
  return buildKeyConfirmationTrace(p.key_confirmation_trace);
}
