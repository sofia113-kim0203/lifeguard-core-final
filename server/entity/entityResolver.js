/**
 * Entity Resolver — who are we talking to? (CORP-I1)
 * Operational Gate: false-positive (wrong Entity) worse than false-negative — default Individual.
 * Resolver runs once per conversation start; Session maintains Entity afterward (Principle 17).
 */
import { assertEntityAccess, assertCorporateEntity } from "./entityGuard.js";
import { ENTITY_TYPES } from "./entityTypes.js";
import { isRegisteredEntityType } from "./entityRegistry.js";
import {
  createCorporateEntitySession,
  createIndividualEntitySession,
  isEntitySession,
  SESSION_ROUTING_REASONS,
  shouldReuseEntitySession,
} from "./entitySession.js";

export const ENTITY_RESOLVER_V1 = "entity-resolver-v1";

function buildResolverTrace({
  resolver_version = ENTITY_RESOLVER_V1,
  action,
  routing_reason,
  reused_session = false,
  fallback = false,
  validation_reason = null,
} = {}) {
  return {
    contract_version: ENTITY_RESOLVER_V1,
    resolver_version,
    action,
    routing_reason,
    reused_session,
    fallback,
    validation_reason,
  };
}

function resolveIndividualFallback({
  customerId,
  routing_reason,
  conversation_id,
  validation_reason = null,
  fallback = false,
} = {}) {
  const session = createIndividualEntitySession({
    customerId,
    routing_reason,
    conversation_id,
    resolver_version: ENTITY_RESOLVER_V1,
  });

  return {
    session,
    resolverTrace: buildResolverTrace({
      action: fallback ? "fallback_individual" : "resolve_individual",
      routing_reason,
      fallback,
      validation_reason,
    }),
  };
}

function tryResolveCorporateSession({
  customerId,
  conversationContext = {},
  entityRecord = null,
  membership = null,
  conversation_id = null,
} = {}) {
  const requestedType = String(conversationContext.entity_type ?? "").trim().toLowerCase();
  const requestedId = conversationContext.entity_id ? String(conversationContext.entity_id) : null;

  if (requestedType !== ENTITY_TYPES.CORPORATE) {
    return {
      ok: false,
      reason: "corporate_type_not_requested",
    };
  }

  if (!requestedId) {
    return { ok: false, reason: "corporate_entity_id_missing" };
  }

  if (!entityRecord) {
    return { ok: false, reason: "corporate_entity_record_missing" };
  }

  const corporate = assertCorporateEntity({
    entity_id: entityRecord.entity_id ?? entityRecord.id ?? requestedId,
    entity_type: entityRecord.entity_type ?? requestedType,
    entity_status: entityRecord.entity_status,
    entity_scope: entityRecord.entity_scope,
    display_name: entityRecord.display_name,
    memory_version: entityRecord.memory_version,
  });

  if (!corporate.ok) {
    return { ok: false, reason: corporate.reason ?? "corporate_entity_invalid" };
  }

  if (String(corporate.entity.entity_id) !== requestedId) {
    return { ok: false, reason: "corporate_entity_id_mismatch" };
  }

  const access = assertEntityAccess({
    entity: corporate.entity,
    membership,
    requireMembership: conversationContext.require_membership !== false,
  });

  if (!access.ok) {
    return { ok: false, reason: access.reason ?? "corporate_access_denied" };
  }

  const session = createCorporateEntitySession({
    entityRecord: access.entity,
    membership: access.membership,
    routing_reason: SESSION_ROUTING_REASONS.EXPLICIT_CORPORATE,
    conversation_id,
    customer_id: customerId,
    resolver_version: ENTITY_RESOLVER_V1,
  });

  return {
    ok: true,
    session,
    resolverTrace: buildResolverTrace({
      action: "resolve_corporate",
      routing_reason: SESSION_ROUTING_REASONS.EXPLICIT_CORPORATE,
      validation_reason: "corporate_entity_validated",
    }),
  };
}

/**
 * Resolve Entity Session for a conversation turn.
 * Reuses existing Session when Principle 17 allows — Resolver does not re-run.
 */
export function resolveEntitySession({
  customerId,
  conversationContext = {},
  existingSession = null,
  entityRecord = null,
  membership = null,
  forceResolve = false,
  conversation_id = null,
} = {}) {
  if (!customerId) throw new Error("customer_id_required");

  if (
    shouldReuseEntitySession({
      existingSession,
      customerId,
      conversationContext,
      forceResolve,
    })
  ) {
    return {
      session: existingSession,
      resolverTrace: buildResolverTrace({
        action: "reuse_session",
        routing_reason: SESSION_ROUTING_REASONS.SESSION_REUSE,
        reused_session: true,
      }),
    };
  }

  const requestedType = String(conversationContext.entity_type ?? "").trim().toLowerCase();

  if (requestedType === ENTITY_TYPES.CORPORATE) {
    const corporate = tryResolveCorporateSession({
      customerId,
      conversationContext,
      entityRecord,
      membership,
      conversation_id,
    });

    if (corporate.ok) {
      return { session: corporate.session, resolverTrace: corporate.resolverTrace };
    }

    return resolveIndividualFallback({
      customerId,
      routing_reason: SESSION_ROUTING_REASONS.ENTITY_VALIDATION_FAILED,
      conversation_id,
      validation_reason: corporate.reason,
      fallback: true,
    });
  }

  if (requestedType && !isRegisteredEntityType(requestedType)) {
    return resolveIndividualFallback({
      customerId,
      routing_reason: SESSION_ROUTING_REASONS.RESOLVER_FALLBACK_INDIVIDUAL,
      conversation_id,
      validation_reason: "entity_type_not_registered",
      fallback: true,
    });
  }

  return resolveIndividualFallback({
    customerId,
    routing_reason: SESSION_ROUTING_REASONS.DEFAULT_INDIVIDUAL,
    conversation_id,
  });
}

export function resolveEntitySessionFromContext(input = {}) {
  const result = resolveEntitySession(input);
  if (!isEntitySession(result.session)) {
    throw new Error("entity_session_resolution_failed");
  }
  return result;
}
