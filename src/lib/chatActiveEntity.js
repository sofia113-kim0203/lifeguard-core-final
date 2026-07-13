/**
 * Conversation active corporate entity (Slice 2 Hand) — selection hint only.
 * Server re-validates membership every request; client never trusts role/auth flags.
 */

export const CORPORATE_AUTH_FAILED_CUSTOMER_TEXT =
  "이 법인의 정보를 확인할 권한이 확인되지 않았습니다.";

export const CORPORATE_LIST_FAILED_CUSTOMER_TEXT =
  "법인 목록을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.";

/** Selection hint for home KEY requests — never includes role / authorization. */
export function normalizeActiveEntity(input = null) {
  if (!input || typeof input !== "object") return null;
  const entityType = String(
    input.active_entity_type ?? input.entity_type ?? "",
  )
    .trim()
    .toLowerCase();
  const entityId = String(input.active_entity_id ?? input.entity_id ?? "").trim();
  if (entityType !== "corporate" || !entityId) return null;
  return {
    active_entity_type: "corporate",
    active_entity_id: entityId,
  };
}

/** Walk message metadata (newest first) for persisted active entity selection. */
export function extractActiveEntityFromSessionMessages(messages = []) {
  const rows = Array.isArray(messages) ? messages : [];
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const meta = rows[i]?.metadata ?? rows[i]?.metadata_json ?? null;
    const normalized = normalizeActiveEntity(meta);
    if (normalized) return normalized;
    const nested = normalizeActiveEntity(meta?.active_entity);
    if (nested) return nested;
  }
  return null;
}

/**
 * Restore only when the entity still appears in the membership list.
 * List fetch failure ≠ empty list — do not activate corporate.
 */
export function resolveRestoredActiveEntity({
  candidate = null,
  membershipEntities = [],
  listOk = false,
} = {}) {
  const normalized = normalizeActiveEntity(candidate);
  if (!normalized) {
    return { activeEntity: null, clearStale: false, listUnavailable: false };
  }
  if (listOk !== true) {
    return { activeEntity: null, clearStale: false, listUnavailable: true };
  }
  const rows = Array.isArray(membershipEntities) ? membershipEntities : [];
  const match = rows.find(
    (row) => String(row?.entity_id ?? "").trim() === normalized.active_entity_id,
  );
  if (!match) {
    return { activeEntity: null, clearStale: true, listUnavailable: false };
  }
  return {
    activeEntity: {
      active_entity_type: "corporate",
      active_entity_id: String(match.entity_id).trim(),
      display_name: String(match.display_name ?? "").trim() || null,
    },
    clearStale: false,
    listUnavailable: false,
  };
}

/** True when Slice 1 corporate auth fail-closed reached the customer answer. */
export function isCorporateAuthFailClosedResult(result = null) {
  if (!result || typeof result !== "object") return false;
  const reason = String(result.failureReason ?? result.failure_reason ?? "").trim();
  if (reason.startsWith("corporate_")) return true;
  const text = String(result.answerText ?? result.answer_text ?? "").trim();
  if (text === CORPORATE_AUTH_FAILED_CUSTOMER_TEXT) return true;
  return false;
}

/**
 * Build entity fields for home KEY request body.
 * Personal → omit both fields. Corporate → type + id only (no role/auth).
 */
export function buildHomeBrainEntityRequestFields(activeEntity = null) {
  const normalized = normalizeActiveEntity(activeEntity);
  if (!normalized) return {};
  return {
    entity_type: "corporate",
    entity_id: normalized.active_entity_id,
  };
}
