/**
 * KU-2a — KEY Work Order gate (Deno mirror of server/keyBrain/workOrder.js).
 */
export const WORK_ORDER_REJECT_REASON = "work_order_required";
export const WORK_ORDER_EXPIRED_REASON = "work_order_expired";
export const WORK_ORDER_FORGERY_REASON = "work_order_forgery";
export const WORK_ORDER_ALREADY_USED_REASON = "work_order_already_consumed";
export const KEY_WORK_ORDER_SCHEMA_VERSION = "key-work-order-ku2a-v1";

type MetadataJson = Record<string, unknown> | null | undefined;

type WorkOrderRecord = {
  schema_version?: string;
  work_order_id?: string;
  ordered_by?: string;
  document_id?: string;
  customer_id?: string;
  status?: string;
  expires_at?: string;
  used_by?: string[];
  directives?: Array<{ factory?: string }>;
};

export function isKeyUploadEntryActive(envValue: string | undefined): boolean {
  const raw = String(envValue ?? "").trim().toLowerCase();
  return raw === "active" || raw === "1";
}

function readKeyWorkOrder(metadataJson: MetadataJson): WorkOrderRecord | null {
  if (!metadataJson || typeof metadataJson !== "object") return null;
  const workOrder = (metadataJson as Record<string, unknown>).key_work_order;
  if (!workOrder || typeof workOrder !== "object") return null;
  return workOrder as WorkOrderRecord;
}

function isExpired(record: WorkOrderRecord, now = Date.now()): boolean {
  if (!record.expires_at) return false;
  const expiresAt = Date.parse(String(record.expires_at));
  return Number.isFinite(expiresAt) && now > expiresAt;
}

export function validateKeyWorkOrderGate(input: {
  workOrderId: string | undefined;
  documentId: string;
  customerId: string;
  metadataJson: MetadataJson;
  factory?: string | null;
}): { ok: true; ordered_by: "KEY"; record: WorkOrderRecord } | {
  ok: false;
  status: number;
  reason: string;
  message: string;
} {
  const workOrderId = String(input.workOrderId ?? "").trim();
  if (!workOrderId) {
    return {
      ok: false,
      status: 403,
      reason: WORK_ORDER_REJECT_REASON,
      message: "KEY Work Order required",
    };
  }

  const record = readKeyWorkOrder(input.metadataJson);
  if (!record) {
    return {
      ok: false,
      status: 403,
      reason: WORK_ORDER_REJECT_REASON,
      message: "KEY Work Order not found",
    };
  }

  if (String(record.work_order_id ?? "") !== workOrderId) {
    return {
      ok: false,
      status: 403,
      reason: WORK_ORDER_FORGERY_REASON,
      message: "KEY Work Order mismatch",
    };
  }

  if (!record.document_id || record.document_id !== input.documentId) {
    return {
      ok: false,
      status: 403,
      reason: WORK_ORDER_FORGERY_REASON,
      message: "KEY Work Order document mismatch",
    };
  }

  if (!record.customer_id || record.customer_id !== input.customerId) {
    return {
      ok: false,
      status: 403,
      reason: WORK_ORDER_FORGERY_REASON,
      message: "KEY Work Order customer mismatch",
    };
  }

  if (record.ordered_by !== "KEY") {
    return {
      ok: false,
      status: 403,
      reason: WORK_ORDER_FORGERY_REASON,
      message: "Work Order must be ordered by KEY",
    };
  }

  if (record.schema_version && record.schema_version !== KEY_WORK_ORDER_SCHEMA_VERSION) {
    return {
      ok: false,
      status: 403,
      reason: WORK_ORDER_FORGERY_REASON,
      message: "KEY Work Order schema invalid",
    };
  }

  if (isExpired(record)) {
    return {
      ok: false,
      status: 403,
      reason: WORK_ORDER_EXPIRED_REASON,
      message: "KEY Work Order expired",
    };
  }

  if (record.status === "consumed") {
    return {
      ok: false,
      status: 403,
      reason: WORK_ORDER_ALREADY_USED_REASON,
      message: "KEY Work Order already used",
    };
  }

  if (record.status !== "issued") {
    return {
      ok: false,
      status: 403,
      reason: WORK_ORDER_REJECT_REASON,
      message: "KEY Work Order not issuable",
    };
  }

  const factoryKey = input.factory ? String(input.factory).trim() : "";
  if (factoryKey) {
    const directiveRows = Array.isArray(record.directives) ? record.directives : [];
    const authorized = directiveRows.some((row) => row.factory === factoryKey);
    if (directiveRows.length > 0 && !authorized) {
      return {
        ok: false,
        status: 403,
        reason: "work_order_scope_mismatch",
        message: "KEY Work Order does not authorize this factory",
      };
    }
    if (Array.isArray(record.used_by) && record.used_by.includes(factoryKey)) {
      return {
        ok: false,
        status: 403,
        reason: WORK_ORDER_ALREADY_USED_REASON,
        message: "KEY Work Order already used for this factory",
      };
    }
  }

  return { ok: true, ordered_by: "KEY", record };
}

export function markWorkOrderFactoryUsed(metadataJson: MetadataJson, record: WorkOrderRecord, factory: string) {
  const factoryKey = String(factory ?? "").trim();
  const usedBy = Array.isArray(record.used_by) ? [...record.used_by] : [];
  if (factoryKey && !usedBy.includes(factoryKey)) {
    usedBy.push(factoryKey);
  }
  return {
    ...(metadataJson && typeof metadataJson === "object" ? metadataJson : {}),
    key_work_order: {
      ...record,
      used_by: usedBy,
      last_used_at: new Date().toISOString(),
      last_used_factory: factoryKey || null,
    },
  };
}
