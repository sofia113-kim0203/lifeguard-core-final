/**
 * KU-2a — KEY Work Order (execution authority gate).
 * Validates existence AND authority (Tom ⑥ — no forgery / reuse / expiry).
 */
import crypto from "node:crypto";

export const KEY_WORK_ORDER_SCHEMA_VERSION = "key-work-order-ku2a-v1";
export const WORK_ORDER_REJECT_REASON = "work_order_required";
export const WORK_ORDER_EXPIRED_REASON = "work_order_expired";
export const WORK_ORDER_FORGERY_REASON = "work_order_forgery";
export const WORK_ORDER_ALREADY_USED_REASON = "work_order_already_consumed";
export const WORK_ORDER_SCOPE_REASON = "work_order_scope_mismatch";

export const DEFAULT_KEY_WORK_ORDER_TTL_MS = 30 * 60 * 1000;

/**
 * Tom Work Order definition — KEY's delegation letter, not a bare token.
 * who (KEY) · what (scope) · why (reason/stage) · limit · TTL
 */
export function buildWorkOrderDirectives(dispatchPlan = null) {
  const rows = dispatchPlan?.factory_work_orders ?? [];
  return rows.map((row) => ({
    factory: String(row.factory ?? "").trim() || null,
    scope: row.scope ?? row.mode ?? null,
    reason: row.reason ?? row.role ?? "key_dispatch",
    limit: row.limit ?? null,
    stage: row.stage ?? null,
    ordered_by: "KEY",
  })).filter((row) => row.factory);
}

export function findWorkOrderDirective(record, factory) {
  const factoryKey = String(factory ?? "").trim();
  if (!factoryKey) return null;
  const directives = Array.isArray(record?.directives) ? record.directives : [];
  return directives.find((row) => row.factory === factoryKey) ?? null;
}

export function resolveKeyWorkOrderTtlMs(env = process.env) {
  const raw = Number(env.KEY_WORK_ORDER_TTL_MS ?? DEFAULT_KEY_WORK_ORDER_TTL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_KEY_WORK_ORDER_TTL_MS;
}

export function mintKeyWorkOrderId() {
  return `kwo_${crypto.randomUUID()}`;
}

export function buildKeyWorkOrderRecord({
  workOrderId,
  customerId,
  documentId,
  dispatchPlan = null,
  ttlMs = DEFAULT_KEY_WORK_ORDER_TTL_MS,
  issuedAt = new Date(),
} = {}) {
  const issued = issuedAt instanceof Date ? issuedAt : new Date(issuedAt);
  const directives = buildWorkOrderDirectives(dispatchPlan);
  return {
    schema_version: KEY_WORK_ORDER_SCHEMA_VERSION,
    work_order_id: workOrderId,
    ordered_by: "KEY",
    customer_id: customerId,
    document_id: documentId,
    status: "issued",
    issued_at: issued.toISOString(),
    expires_at: new Date(issued.getTime() + ttlMs).toISOString(),
    consumed_at: null,
    used_by: [],
    gate: "KU-2a",
    directives,
    factory_work_orders: dispatchPlan?.factory_work_orders ?? [],
  };
}

export function readKeyWorkOrderFromDocumentMetadata(metadataJson) {
  if (!metadataJson || typeof metadataJson !== "object") return null;
  const workOrder = metadataJson.key_work_order;
  if (!workOrder || typeof workOrder !== "object") return null;
  return workOrder;
}

export function isKeyWorkOrderExpired(record, now = Date.now()) {
  if (!record?.expires_at) return false;
  const expiresAt = Date.parse(String(record.expires_at));
  return Number.isFinite(expiresAt) && now > expiresAt;
}

export function validateKeyWorkOrder({
  workOrderId,
  documentId,
  customerId,
  metadataJson,
  factory = null,
  now = Date.now(),
} = {}) {
  const trimmedWorkOrderId = String(workOrderId ?? "").trim();
  if (!trimmedWorkOrderId) {
    return {
      ok: false,
      status: 403,
      reason: WORK_ORDER_REJECT_REASON,
      message: "KEY Work Order required",
      ordered_by: null,
    };
  }

  const record = readKeyWorkOrderFromDocumentMetadata(metadataJson);
  if (!record) {
    return {
      ok: false,
      status: 403,
      reason: WORK_ORDER_REJECT_REASON,
      message: "KEY Work Order not found",
      ordered_by: null,
    };
  }

  if (String(record.work_order_id ?? "") !== trimmedWorkOrderId) {
    return {
      ok: false,
      status: 403,
      reason: WORK_ORDER_FORGERY_REASON,
      message: "KEY Work Order mismatch",
      ordered_by: record.ordered_by ?? null,
    };
  }

  if (!record.document_id || record.document_id !== documentId) {
    return {
      ok: false,
      status: 403,
      reason: WORK_ORDER_FORGERY_REASON,
      message: "KEY Work Order document mismatch",
      ordered_by: record.ordered_by ?? null,
    };
  }

  if (!record.customer_id || record.customer_id !== customerId) {
    return {
      ok: false,
      status: 403,
      reason: WORK_ORDER_FORGERY_REASON,
      message: "KEY Work Order customer mismatch",
      ordered_by: record.ordered_by ?? null,
    };
  }

  if (record.ordered_by !== "KEY") {
    return {
      ok: false,
      status: 403,
      reason: WORK_ORDER_FORGERY_REASON,
      message: "Work Order must be ordered by KEY",
      ordered_by: record.ordered_by ?? null,
    };
  }

  if (record.schema_version && record.schema_version !== KEY_WORK_ORDER_SCHEMA_VERSION) {
    return {
      ok: false,
      status: 403,
      reason: WORK_ORDER_FORGERY_REASON,
      message: "KEY Work Order schema invalid",
      ordered_by: record.ordered_by ?? null,
    };
  }

  if (isKeyWorkOrderExpired(record, now)) {
    return {
      ok: false,
      status: 403,
      reason: WORK_ORDER_EXPIRED_REASON,
      message: "KEY Work Order expired",
      ordered_by: "KEY",
    };
  }

  if (record.status === "consumed") {
    return {
      ok: false,
      status: 403,
      reason: WORK_ORDER_ALREADY_USED_REASON,
      message: "KEY Work Order already used",
      ordered_by: "KEY",
    };
  }

  if (record.status !== "issued") {
    return {
      ok: false,
      status: 403,
      reason: WORK_ORDER_REJECT_REASON,
      message: "KEY Work Order not issuable",
      ordered_by: record.ordered_by ?? null,
    };
  }

  const factoryKey = factory ? String(factory).trim() : "";
  if (factoryKey) {
    const directive = findWorkOrderDirective(record, factoryKey);
    if (!directive) {
      return {
        ok: false,
        status: 403,
        reason: WORK_ORDER_SCOPE_REASON,
        message: "KEY Work Order does not authorize this factory",
        ordered_by: "KEY",
      };
    }
    if (Array.isArray(record.used_by) && record.used_by.includes(factoryKey)) {
      return {
        ok: false,
        status: 403,
        reason: WORK_ORDER_ALREADY_USED_REASON,
        message: "KEY Work Order already used for this factory",
        ordered_by: "KEY",
      };
    }
  }

  return { ok: true, record, ordered_by: "KEY", directive: factoryKey ? findWorkOrderDirective(record, factoryKey) : null };
}

export function markKeyWorkOrderFactoryUsed(record, factory) {
  const factoryKey = String(factory ?? "").trim();
  const usedBy = Array.isArray(record?.used_by) ? [...record.used_by] : [];
  if (factoryKey && !usedBy.includes(factoryKey)) {
    usedBy.push(factoryKey);
  }
  return {
    ...record,
    used_by: usedBy,
    last_used_at: new Date().toISOString(),
    last_used_factory: factoryKey || null,
  };
}

export function markKeyWorkOrderConsumed(record) {
  return {
    ...record,
    status: "consumed",
    consumed_at: new Date().toISOString(),
  };
}

export async function persistKeyWorkOrder(supabase, {
  documentId,
  customerId,
  workOrderRecord,
  existingMetadata = {},
} = {}) {
  const metadata_json = {
    ...existingMetadata,
    key_work_order: workOrderRecord,
  };

  const { error } = await supabase
    .from("customer_documents")
    .update({
      metadata_json,
      updated_at: new Date().toISOString(),
    })
    .eq("id", documentId)
    .eq("customer_id", customerId);

  if (error) {
    throw error;
  }

  return metadata_json;
}

export async function recordKeyWorkOrderFactoryUse(supabase, {
  documentId,
  customerId,
  metadataJson,
  workOrderId,
  factory,
} = {}) {
  const validation = validateKeyWorkOrder({
    workOrderId,
    documentId,
    customerId,
    metadataJson,
    factory,
  });

  if (!validation.ok) {
    return validation;
  }

  const updatedRecord = markKeyWorkOrderFactoryUsed(validation.record, factory);
  const metadata_json = {
    ...(metadataJson ?? {}),
    key_work_order: updatedRecord,
  };

  const { error } = await supabase
    .from("customer_documents")
    .update({
      metadata_json,
      updated_at: new Date().toISOString(),
    })
    .eq("id", documentId)
    .eq("customer_id", customerId);

  if (error) {
    return {
      ok: false,
      status: 500,
      reason: "work_order_use_record_failed",
      message: error.message,
      ordered_by: null,
    };
  }

  return { ok: true, record: updatedRecord, ordered_by: "KEY" };
}

export async function consumeKeyWorkOrder(supabase, {
  documentId,
  customerId,
  metadataJson,
  workOrderId,
} = {}) {
  const validation = validateKeyWorkOrder({
    workOrderId,
    documentId,
    customerId,
    metadataJson,
  });

  if (!validation.ok) {
    return validation;
  }

  const consumed = markKeyWorkOrderConsumed(validation.record);
  const metadata_json = {
    ...(metadataJson ?? {}),
    key_work_order: consumed,
  };

  const { error } = await supabase
    .from("customer_documents")
    .update({
      metadata_json,
      updated_at: new Date().toISOString(),
    })
    .eq("id", documentId)
    .eq("customer_id", customerId);

  if (error) {
    return {
      ok: false,
      status: 500,
      reason: "work_order_consume_failed",
      message: error.message,
      ordered_by: null,
    };
  }

  return { ok: true, record: consumed, ordered_by: "KEY" };
}

/**
 * Gate for factory entry points when KEY_UPLOAD_ENTRY=active.
 */
export function gateFactoryWithKeyWorkOrder({
  activeGateEnabled,
  workOrderId,
  documentId,
  customerId,
  metadataJson,
  factory = null,
} = {}) {
  if (!activeGateEnabled) {
    return { ok: true, gate: "off", ordered_by: null };
  }

  const validation = validateKeyWorkOrder({
    workOrderId,
    documentId,
    customerId,
    metadataJson,
    factory,
  });

  if (!validation.ok) {
    return {
      ...validation,
      gate: "active_rejected",
    };
  }

  return {
    ok: true,
    gate: "active_pass",
    ordered_by: "KEY",
    work_order_id: validation.record.work_order_id,
    record: validation.record,
  };
}
