/**
 * Slice 2 — membership-scoped corporate entity list (read-only Hand).
 * Returns only entities the authenticated user can access.
 * Does not trust client role / authorization / entity_id filters from the caller beyond auth.
 */
import { ENTITY_TYPES, MEMBER_ROLES } from "./entityTypes.js";

export const CORPORATE_LIST_FAILED_CUSTOMER_TEXT =
  "법인 목록을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.";

const ACTIVE_STATUSES = new Set(["active", "demo"]);

const ROLE_DISPLAY = {
  owner: "소유자",
  member: "구성원",
  agent: "대리",
  admin: "관리자",
};

export function membershipRoleDisplay(memberRole) {
  const role = String(memberRole ?? "")
    .trim()
    .toLowerCase();
  if (!MEMBER_ROLES.includes(role)) return null;
  return ROLE_DISPLAY[role] ?? role;
}

/**
 * Map membership + entity rows into the minimal list contract.
 * Ignores any client-supplied role / authorization fields on input rows.
 */
export function mapMyCorporateEntityRows({
  memberships = [],
  entities = [],
  authUserId = null,
} = {}) {
  const entityById = new Map();
  for (const row of Array.isArray(entities) ? entities : []) {
    const id = String(row?.id ?? row?.entity_id ?? "").trim();
    if (!id) continue;
    const entityType = String(row?.entity_type ?? "")
      .trim()
      .toLowerCase();
    const status = String(row?.entity_status ?? "")
      .trim()
      .toLowerCase();
    if (entityType !== ENTITY_TYPES.CORPORATE) continue;
    if (!ACTIVE_STATUSES.has(status)) continue;
    entityById.set(id, {
      entity_id: id,
      display_name: String(row?.display_name ?? "").trim() || "법인",
    });
  }

  const expectedUserId = authUserId ? String(authUserId).trim() : null;
  const out = [];
  const seen = new Set();
  for (const mem of Array.isArray(memberships) ? memberships : []) {
    if (String(mem?.status ?? "active").trim().toLowerCase() !== "active") continue;
    if (expectedUserId && String(mem?.user_id ?? "").trim() !== expectedUserId) continue;
    const entityId = String(mem?.entity_id ?? "").trim();
    if (!entityId || seen.has(entityId)) continue;
    const entity = entityById.get(entityId);
    if (!entity) continue;
    const role = String(mem?.member_role ?? "")
      .trim()
      .toLowerCase();
    const roleDisplay = membershipRoleDisplay(role);
    if (!roleDisplay) continue;
    seen.add(entityId);
    out.push({
      entity_id: entity.entity_id,
      display_name: entity.display_name,
      membership_role_display: roleDisplay,
    });
  }
  return out;
}

/**
 * Load corporate entities for one authenticated user via membership + entity records.
 * Never lists all corporates; never returns another user's memberships.
 */
export async function listMyCorporateEntities(supabase, { authUserId = null } = {}) {
  if (!supabase) {
    return {
      ok: false,
      reason: "supabase_required",
      entities: [],
      customer_message: CORPORATE_LIST_FAILED_CUSTOMER_TEXT,
    };
  }

  const userId = String(authUserId ?? "").trim();
  if (!userId) {
    return {
      ok: false,
      reason: "auth_user_required",
      entities: [],
      customer_message: CORPORATE_LIST_FAILED_CUSTOMER_TEXT,
    };
  }

  const { data: membershipRows, error: membershipError } = await supabase
    .from("entity_memberships")
    .select("entity_id, user_id, member_role, status")
    .eq("user_id", userId)
    .eq("status", "active");

  if (membershipError) {
    return {
      ok: false,
      reason: "membership_list_failed",
      entities: [],
      customer_message: CORPORATE_LIST_FAILED_CUSTOMER_TEXT,
      error_message: membershipError.message ?? null,
    };
  }

  const memberships = (Array.isArray(membershipRows) ? membershipRows : []).filter(
    (row) => String(row?.user_id ?? "") === userId,
  );

  const entityIds = [
    ...new Set(memberships.map((row) => String(row?.entity_id ?? "").trim()).filter(Boolean)),
  ];

  if (entityIds.length === 0) {
    return { ok: true, reason: null, entities: [], list_status: "empty" };
  }

  const { data: entityRows, error: entityError } = await supabase
    .from("entities")
    .select("id, entity_type, entity_status, display_name")
    .in("id", entityIds)
    .eq("entity_type", ENTITY_TYPES.CORPORATE)
    .in("entity_status", ["active", "demo"]);

  if (entityError) {
    return {
      ok: false,
      reason: "entity_list_failed",
      entities: [],
      customer_message: CORPORATE_LIST_FAILED_CUSTOMER_TEXT,
      error_message: entityError.message ?? null,
    };
  }

  const entities = mapMyCorporateEntityRows({
    memberships,
    entities: entityRows ?? [],
    authUserId: userId,
  });

  return {
    ok: true,
    reason: null,
    entities,
    list_status: entities.length > 0 ? "ok" : "empty",
  };
}
