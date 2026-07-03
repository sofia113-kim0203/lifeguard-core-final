/**
 * Entity guard — entity_type · entity_id · entity_status · entity_scope + membership role.
 * CORP-B1: read-path assertions; personal customer_id path remains separate.
 */
import { ENTITY_SCOPES, ENTITY_STATUSES, MEMBER_ROLES, normalizeEntityType } from "./entityTypes.js";
import { isRegisteredEntityType } from "./entityRegistry.js";

const ACTIVE_ENTITY_STATUSES = new Set(["active", "demo"]);

export function normalizeEntityRecord(entity = {}) {
  const rawType = String(entity.entity_type ?? "").trim().toLowerCase();
  return {
    entity_id: entity.entity_id ?? entity.id ?? null,
    entity_type: normalizeEntityType(entity.entity_type),
    raw_entity_type: rawType || null,
    entity_status: String(entity.entity_status ?? "active").trim().toLowerCase(),
    entity_scope: String(entity.entity_scope ?? "owner").trim().toLowerCase(),
    display_name: entity.display_name ?? null,
    memory_version: entity.memory_version ?? 0,
    metadata_json: entity.metadata_json ?? {},
  };
}

export function assertEntityFields(entity = {}) {
  const normalized = normalizeEntityRecord(entity);
  const missing = [];
  if (!normalized.entity_id) missing.push("entity_id");
  if (!normalized.entity_type) {
    if (normalized.raw_entity_type) {
      return { ok: false, reason: "entity_type_not_registered", entity: normalized };
    }
    missing.push("entity_type");
  }
  if (!normalized.entity_status) missing.push("entity_status");
  if (!normalized.entity_scope) missing.push("entity_scope");
  if (missing.length) {
    return { ok: false, reason: "entity_fields_missing", missing, entity: normalized };
  }
  if (!ENTITY_STATUSES.includes(normalized.entity_status)) {
    return { ok: false, reason: "entity_status_invalid", entity: normalized };
  }
  if (!ENTITY_SCOPES.includes(normalized.entity_scope)) {
    return { ok: false, reason: "entity_scope_invalid", entity: normalized };
  }
  if (!isRegisteredEntityType(normalized.entity_type)) {
    return { ok: false, reason: "entity_type_not_registered", entity: normalized };
  }
  return { ok: true, entity: normalized };
}

export function assertEntityActive(entity = {}) {
  const fields = assertEntityFields(entity);
  if (!fields.ok) return fields;
  if (!ACTIVE_ENTITY_STATUSES.has(fields.entity.entity_status)) {
    return { ok: false, reason: "entity_not_active", entity: fields.entity };
  }
  return fields;
}

export function assertEntityAccess({
  entity = {},
  membership = null,
  allowedRoles = MEMBER_ROLES,
  requireMembership = true,
} = {}) {
  const active = assertEntityActive(entity);
  if (!active.ok) return active;

  if (!requireMembership) {
    return { ok: true, entity: active.entity, membership: null };
  }

  if (!membership?.user_id) {
    return { ok: false, reason: "membership_required", entity: active.entity };
  }

  const role = String(membership.member_role ?? "").trim().toLowerCase();
  if (!MEMBER_ROLES.includes(role)) {
    return { ok: false, reason: "member_role_invalid", entity: active.entity, membership };
  }
  if (!allowedRoles.includes(role)) {
    return { ok: false, reason: "member_role_forbidden", entity: active.entity, membership };
  }
  if (String(membership.status ?? "active") !== "active") {
    return { ok: false, reason: "membership_not_active", entity: active.entity, membership };
  }

  if (membership.entity_id && membership.entity_id !== active.entity.entity_id) {
    return { ok: false, reason: "membership_entity_mismatch", entity: active.entity, membership };
  }

  return { ok: true, entity: active.entity, membership: { ...membership, member_role: role } };
}

export function assertCorporateEntity(entity = {}) {
  const fields = assertEntityFields(entity);
  if (!fields.ok) return fields;
  if (fields.entity.entity_type !== "corporate") {
    return { ok: false, reason: "not_corporate_entity", entity: fields.entity };
  }
  return fields;
}
