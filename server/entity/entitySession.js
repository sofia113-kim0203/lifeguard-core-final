/**
 * Entity Session — conversation-scoped entity binding (CORP-I1 · Principle 16 · 17).
 * Conversation selects Entity once; Session maintains Entity for subsequent turns.
 */
import { ENTITY_TYPES } from "./entityTypes.js";

export const ENTITY_SESSION_V1 = "entity-session-v1";

export const SESSION_ROUTING_REASONS = {
  SESSION_REUSE: "session_reuse",
  DEFAULT_INDIVIDUAL: "default_individual",
  EXPLICIT_CORPORATE: "explicit_corporate",
  RESOLVER_FALLBACK_INDIVIDUAL: "resolver_fallback_individual",
  ENTITY_VALIDATION_FAILED: "entity_validation_failed_fallback",
};

const KNOWN_ENTITY_TYPES = new Set(Object.values(ENTITY_TYPES));

function normalizePermissions(permissions = {}) {
  const scopes = Array.isArray(permissions.scopes)
    ? permissions.scopes.map((row) => String(row).trim().toLowerCase()).filter(Boolean)
    : [];

  return {
    can_read_contract: permissions.can_read_contract !== false,
    can_write: permissions.can_write === true,
    member_role: permissions.member_role ? String(permissions.member_role).trim().toLowerCase() : null,
    scopes: scopes.length ? scopes : ["read"],
  };
}

export function createEntitySession({
  entity_id,
  entity_type,
  entity_scope = "owner",
  permissions = {},
  routing_reason,
  resolver_version = null,
  conversation_id = null,
  customer_id = null,
  created_at = new Date().toISOString(),
} = {}) {
  const normalizedType = String(entity_type ?? "").trim().toLowerCase();
  if (!entity_id) throw new Error("entity_session_entity_id_required");
  if (!KNOWN_ENTITY_TYPES.has(normalizedType)) throw new Error("entity_session_entity_type_invalid");
  if (!routing_reason) throw new Error("entity_session_routing_reason_required");

  return Object.freeze({
    contract_version: ENTITY_SESSION_V1,
    entity_id: String(entity_id),
    entity_type: normalizedType,
    entity_scope: String(entity_scope ?? "owner").trim().toLowerCase(),
    permissions: Object.freeze(normalizePermissions(permissions)),
    routing_reason: String(routing_reason),
    resolver_version: resolver_version ? String(resolver_version) : null,
    conversation_id: conversation_id ? String(conversation_id) : null,
    customer_id: customer_id ? String(customer_id) : null,
    created_at: String(created_at),
  });
}

export function isEntitySession(value) {
  return (
    value?.contract_version === ENTITY_SESSION_V1 &&
    Boolean(value?.entity_id) &&
    Boolean(value?.entity_type) &&
    Boolean(value?.routing_reason)
  );
}

export function assertEntitySession(session) {
  if (!isEntitySession(session)) {
    return { ok: false, reason: "invalid_entity_session", session: session ?? null };
  }
  return { ok: true, session };
}

export function entitySessionRoutingKey(session) {
  const asserted = assertEntitySession(session);
  if (!asserted.ok) return null;
  return `${asserted.session.entity_type}:${asserted.session.entity_id}`;
}

export function createIndividualEntitySession({
  customerId,
  routing_reason = SESSION_ROUTING_REASONS.DEFAULT_INDIVIDUAL,
  conversation_id = null,
  resolver_version = null,
} = {}) {
  if (!customerId) throw new Error("customer_id_required");

  return createEntitySession({
    entity_id: customerId,
    entity_type: ENTITY_TYPES.INDIVIDUAL,
    entity_scope: "owner",
    permissions: {
      can_read_contract: true,
      can_write: false,
      member_role: "owner",
      scopes: ["read"],
    },
    routing_reason,
    resolver_version,
    conversation_id,
    customer_id: customerId,
  });
}

export function createCorporateEntitySession({
  entityRecord,
  membership = null,
  routing_reason = SESSION_ROUTING_REASONS.EXPLICIT_CORPORATE,
  conversation_id = null,
  customer_id = null,
  resolver_version = null,
} = {}) {
  const entity_id = entityRecord?.entity_id ?? entityRecord?.id;
  if (!entity_id) throw new Error("corporate_entity_id_required");

  const memberRole = membership?.member_role ?? null;
  const accessScopes = membership?.access_scopes ?? membership?.access_scope ?? ["read"];

  return createEntitySession({
    entity_id,
    entity_type: ENTITY_TYPES.CORPORATE,
    entity_scope: entityRecord?.entity_scope ?? "owner",
    permissions: {
      can_read_contract: true,
      can_write: accessScopes.includes("write") || accessScopes.includes("admin"),
      member_role: memberRole,
      scopes: Array.isArray(accessScopes) ? accessScopes : [String(accessScopes)],
    },
    routing_reason,
    resolver_version,
    conversation_id,
    customer_id,
  });
}

/**
 * Principle 17 — Session maintains Entity unless conversation explicitly selects another.
 */
export function shouldReuseEntitySession({
  existingSession = null,
  customerId = null,
  conversationContext = {},
  forceResolve = false,
} = {}) {
  if (forceResolve) return false;
  if (!isEntitySession(existingSession)) return false;
  if (!customerId) return false;

  if (existingSession.customer_id && existingSession.customer_id !== String(customerId)) {
    return false;
  }

  const requestedType = String(conversationContext.entity_type ?? "").trim().toLowerCase();
  const requestedId = conversationContext.entity_id ? String(conversationContext.entity_id) : null;

  if (requestedType && requestedType !== existingSession.entity_type) return false;
  if (requestedId && requestedId !== existingSession.entity_id) return false;

  if (existingSession.entity_type === ENTITY_TYPES.INDIVIDUAL) {
    return existingSession.entity_id === String(customerId);
  }

  return true;
}
