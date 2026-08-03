/**
 * R17 — Memory cron/worker KEY Upload Entry + Work Order authority.
 * When KEY_UPLOAD_ENTRY=active: no document/memory mutation without a valid KEY WO.
 * Never writes customer_conversations. Never rewrites sealed KEY answers.
 */
import {
  getKeyUploadEntryMode,
  isKeyUploadEntryActiveEnabled,
  KEY_UPLOAD_ENTRY_MODES,
} from "./uploadEntryFlags.js";
import {
  gateFactoryWithKeyWorkOrder,
  readKeyWorkOrderFromDocumentMetadata,
} from "./workOrder.js";

export const MEMORY_BUILDER_FACTORY = "memory_builder";

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function resolveMemoryJobDocumentId(job = {}) {
  const payload = asObject(job.payload_json ?? job.payload);
  const fromPayload = String(payload.document_id ?? "").trim();
  if (fromPayload) return fromPayload;
  const sourceRef = String(job.source_ref ?? "").trim();
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      sourceRef,
    )
  ) {
    return sourceRef;
  }
  return null;
}

export function resolveMemoryJobWorkOrderId(job = {}, metadataJson = null) {
  const payload = asObject(job.payload_json ?? job.payload);
  const fromPayload = String(payload.work_order_id ?? "").trim();
  if (fromPayload) return fromPayload;
  const record = readKeyWorkOrderFromDocumentMetadata(metadataJson);
  return String(record?.work_order_id ?? "").trim() || null;
}

export function isMemoryBuilderAlreadyCompleted(metadataJson = null) {
  const meta = asObject(metadataJson);
  const status = String(meta.memory_builder_status ?? "").trim().toLowerCase();
  if (status === "completed" || status === "done") return true;
  if (meta.memory_builder_completed_at) return true;
  const used = Array.isArray(meta.key_work_order?.used_by)
    ? meta.key_work_order.used_by
    : [];
  return used.some((row) => String(row?.factory ?? "") === MEMORY_BUILDER_FACTORY);
}

/**
 * Pure gate decision for memory_builder cron/worker jobs.
 * Callers load document metadata when document_id is present.
 */
export function decideMemoryCronAuthority({
  env = process.env,
  job = null,
  documentRow = null,
} = {}) {
  const mode = getKeyUploadEntryMode(env);
  if (!isKeyUploadEntryActiveEnabled(env)) {
    return {
      ok: true,
      gate: mode === KEY_UPLOAD_ENTRY_MODES.SHADOW ? "shadow" : "off",
      run_rebuild: true,
      mutation_allowed: true,
      reason: null,
    };
  }

  const customerId = String(job?.customer_id ?? "").trim();
  if (!customerId) {
    return {
      ok: false,
      gate: "active_rejected",
      run_rebuild: false,
      mutation_allowed: false,
      reason: "customer_id_required",
    };
  }

  const documentId = resolveMemoryJobDocumentId(job);
  if (!documentId) {
    // Customer-wide memory cron without a document WO must not mutate facts.
    return {
      ok: true,
      gate: "active_skip_no_document_wo",
      run_rebuild: false,
      mutation_allowed: false,
      reason: "work_order_required_for_memory_mutation",
      skip: true,
    };
  }

  if (!documentRow) {
    return {
      ok: false,
      gate: "active_rejected",
      run_rebuild: false,
      mutation_allowed: false,
      reason: "document_not_found",
      document_id: documentId,
    };
  }

  if (String(documentRow.customer_id ?? "") !== customerId) {
    return {
      ok: false,
      gate: "active_rejected",
      run_rebuild: false,
      mutation_allowed: false,
      reason: "document_customer_mismatch",
      document_id: documentId,
    };
  }

  if (isMemoryBuilderAlreadyCompleted(documentRow.metadata_json)) {
    return {
      ok: true,
      gate: "active_skip_already_completed",
      run_rebuild: false,
      mutation_allowed: false,
      reason: "memory_builder_already_completed",
      skip: true,
      document_id: documentId,
    };
  }

  const workOrderId = resolveMemoryJobWorkOrderId(job, documentRow.metadata_json);
  const gate = gateFactoryWithKeyWorkOrder({
    activeGateEnabled: true,
    workOrderId,
    documentId,
    customerId,
    metadataJson: documentRow.metadata_json,
    factory: MEMORY_BUILDER_FACTORY,
  });

  if (!gate.ok) {
    return {
      ok: false,
      gate: gate.gate ?? "active_rejected",
      run_rebuild: false,
      mutation_allowed: false,
      reason: gate.reason ?? "work_order_required",
      document_id: documentId,
      work_order_id: workOrderId,
    };
  }

  return {
    ok: true,
    gate: "active_pass",
    run_rebuild: true,
    mutation_allowed: true,
    reason: null,
    document_id: documentId,
    work_order_id: gate.work_order_id ?? workOrderId,
    record: gate.record ?? null,
  };
}

export function buildMemoryBuilderCompletedMetadataPatch({
  metadataJson = null,
  workOrderId = null,
  completedAt = new Date().toISOString(),
} = {}) {
  const meta = { ...asObject(metadataJson) };
  meta.memory_builder_status = "completed";
  meta.memory_builder_completed_at = completedAt;
  if (workOrderId) meta.memory_builder_work_order_id = workOrderId;
  return meta;
}
