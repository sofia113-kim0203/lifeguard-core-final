/**
 * Pure corporate list payload mappers (Node unit-test safe).
 */
import { CORPORATE_LIST_FAILED_CUSTOMER_TEXT } from "./chatActiveEntity.js";

export function normalizeCorporateEntityListItem(row = null) {
  if (!row || typeof row !== "object") return null;
  const entityId = String(row.entity_id ?? "").trim();
  if (!entityId) return null;
  return {
    entity_id: entityId,
    display_name: String(row.display_name ?? "").trim() || "법인",
    membership_role_display: String(row.membership_role_display ?? "").trim() || null,
  };
}

export function mapCorporateEntitiesPayload(payload = {}) {
  const ok = payload?.ok === true;
  const listStatus = String(payload?.list_status ?? (ok ? "ok" : "error")).trim();
  const entities = (Array.isArray(payload?.entities) ? payload.entities : [])
    .map((row) => normalizeCorporateEntityListItem(row))
    .filter(Boolean);

  if (!ok) {
    return {
      ok: false,
      listStatus: "error",
      entities: [],
      customerMessage:
        String(payload?.customer_message ?? "").trim() || CORPORATE_LIST_FAILED_CUSTOMER_TEXT,
    };
  }

  return {
    ok: true,
    listStatus: entities.length === 0 ? "empty" : listStatus === "empty" ? "empty" : "ok",
    entities,
    customerMessage: null,
  };
}
