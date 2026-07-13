/**
 * Slice 1 Hand — explicit corporate entity context → verified read-only fact pack
 * for the single Claude-first KEY path.
 *
 * Reuses: parseEntityContextFromRequestBody, loadEntityContextRecords,
 * assertCorporateEntity, assertEntityAccess, createCorporateEntitySession,
 * loadCorporateMemorySnapshot, buildCorporateSnapshot.
 *
 * Does NOT call: resolveEntitySession (falls back to individual on failure),
 * runCorporateKeyLoopTurn, corporate compose/speech, gap/recommendation.
 */
import { parseEntityContextFromRequestBody } from "../entity/entityApiContextPassthrough.js";
import { loadEntityContextRecords } from "../entity/entityRecordLoader.js";
import { assertCorporateEntity, assertEntityAccess } from "../entity/entityGuard.js";
import { ENTITY_RESOLVER_V1 } from "../entity/entityResolver.js";
import {
  createCorporateEntitySession,
  SESSION_ROUTING_REASONS,
} from "../entity/entitySession.js";
import { ENTITY_TYPES } from "../entity/entityTypes.js";
import { loadCorporateMemorySnapshot } from "../entity/corporate/corporateMemorySnapshot.js";
import {
  buildCorporateSnapshot,
  CORPORATE_SNAPSHOT_V1,
} from "../entity/corporate/corporateSnapshot.js";

export const CORPORATE_AUTH_FAILED_CUSTOMER_TEXT =
  "이 법인의 정보를 확인할 권한이 확인되지 않았습니다.";

export const CLAUDE_CORPORATE_FACT_PACK_V1 = "claude-corporate-fact-pack-v1";

/**
 * True when request explicitly asks for corporate entity context (no keyword guess).
 */
export function hasExplicitCorporateEntitySignal(bodyOrContext = {}) {
  const parsed =
    bodyOrContext?.conversationContext != null || bodyOrContext?.has_entity_signal != null
      ? bodyOrContext
      : parseEntityContextFromRequestBody(bodyOrContext);
  const type = String(
    parsed?.conversationContext?.entity_type ?? bodyOrContext?.entity_type ?? "",
  )
    .trim()
    .toLowerCase();
  const id = String(
    parsed?.conversationContext?.entity_id ?? bodyOrContext?.entity_id ?? "",
  ).trim();
  return type === ENTITY_TYPES.CORPORATE && Boolean(id);
}

/**
 * Build read-only Claude fact pack from corporate snapshot + memory.
 * Separates verified / partial / unknown / provenance. Never invents facts.
 */
export function buildClaudeCorporateFactPack({
  entityRecord = null,
  membership = null,
  snapshot = null,
  memorySnapshot = null,
} = {}) {
  const entityId = entityRecord?.entity_id ?? entityRecord?.id ?? null;
  const role = membership?.member_role
    ? String(membership.member_role).trim().toLowerCase()
    : null;

  const verified_facts = [];
  const partial_facts = [];
  const unknowns = Array.isArray(snapshot?.derived?.unknowns)
    ? [...snapshot.derived.unknowns]
    : [];

  if (entityRecord?.display_name) {
    verified_facts.push({
      key: "identity.display_name",
      value: String(entityRecord.display_name),
      source: "entities",
    });
  }
  if (entityId) {
    verified_facts.push({
      key: "identity.entity_id",
      value: String(entityId),
      source: "entities",
    });
  }
  if (role) {
    verified_facts.push({
      key: "authorization.membership_role",
      value: role,
      source: "entity_memberships",
    });
  }

  const derived = snapshot?.derived ?? {};
  const derivedKnown = [
    ["industry", derived.industry],
    ["group_insurance_status", derived.group_insurance_status],
    ["employee_count", derived.employee_count],
    ["executive_protection", derived.executive_protection],
    ["fire_insurance", derived.fire_insurance],
    ["liability", derived.liability],
  ];
  for (const [field, value] of derivedKnown) {
    if (value == null || value === "" || value === "unknown") continue;
    if (unknowns.includes(field)) continue;
    verified_facts.push({
      key: `derived.${field}`,
      value,
      source: CORPORATE_SNAPSHOT_V1,
    });
  }

  for (const fact of memorySnapshot?.facts ?? []) {
    const key = String(fact?.fact_key ?? "").trim();
    const value = String(fact?.fact_value ?? "").trim();
    if (!key || !value) continue;
    const importance = String(fact?.importance ?? "low").toLowerCase();
    const entry = {
      key,
      value,
      source: memorySnapshot?.memory_namespace ?? "entity_memory_facts",
      importance,
    };
    if (importance === "low") {
      partial_facts.push(entry);
    } else {
      verified_facts.push(entry);
    }
  }

  return {
    contract_version: CLAUDE_CORPORATE_FACT_PACK_V1,
    entity_type: ENTITY_TYPES.CORPORATE,
    entity_id: entityId,
    authorization_verified: true,
    membership_role: role,
    verified_facts,
    partial_facts,
    unknowns,
    provenance: {
      snapshot_contract: snapshot?.contract_version ?? null,
      memory_namespace: memorySnapshot?.memory_namespace ?? "entity_memory_facts",
      memory_version:
        entityRecord?.memory_version ?? memorySnapshot?.memory_version ?? null,
      entity_id: entityId,
      fact_count: memorySnapshot?.fact_count ?? null,
    },
  };
}

/**
 * Resolve corporate context for Claude-first.
 * Individual when no explicit corporate signal.
 * Corporate auth/entity failures → honest failure (never individual fallback).
 */
export async function resolveClaudeCorporateContext({
  userSupabase = null,
  customerId = null,
  authUserId = null,
  requestBody = null,
  entityContext = null,
  loadEntityContextRecordsImpl = loadEntityContextRecords,
  loadCorporateMemorySnapshotImpl = loadCorporateMemorySnapshot,
  buildCorporateSnapshotImpl = buildCorporateSnapshot,
} = {}) {
  const parsed =
    entityContext ?? parseEntityContextFromRequestBody(requestBody ?? {});

  const entityType = String(parsed?.conversationContext?.entity_type ?? "")
    .trim()
    .toLowerCase();
  const entityId = String(parsed?.conversationContext?.entity_id ?? "").trim() || null;

  if (entityType !== ENTITY_TYPES.CORPORATE) {
    return { mode: "individual", ok: true };
  }

  if (!entityId) {
    return {
      mode: "corporate",
      ok: false,
      failure_reason: "corporate_entity_id_missing",
      customer_text: CORPORATE_AUTH_FAILED_CUSTOMER_TEXT,
      authorization: {
        entity_type: ENTITY_TYPES.CORPORATE,
        entity_id: null,
        authorization_verified: false,
        membership_role: null,
      },
    };
  }

  if (!userSupabase || !authUserId) {
    return {
      mode: "corporate",
      ok: false,
      failure_reason: "corporate_auth_context_missing",
      customer_text: CORPORATE_AUTH_FAILED_CUSTOMER_TEXT,
      authorization: {
        entity_type: ENTITY_TYPES.CORPORATE,
        entity_id: entityId,
        authorization_verified: false,
        membership_role: null,
      },
    };
  }

  const loaded = await loadEntityContextRecordsImpl(userSupabase, {
    conversationContext: { entity_type: ENTITY_TYPES.CORPORATE, entity_id: entityId },
    customerId,
    authUserId,
  });

  if (!loaded?.entityRecord) {
    return {
      mode: "corporate",
      ok: false,
      failure_reason: loaded?.load_error ?? "corporate_entity_not_found",
      customer_text: CORPORATE_AUTH_FAILED_CUSTOMER_TEXT,
      authorization: {
        entity_type: ENTITY_TYPES.CORPORATE,
        entity_id: entityId,
        authorization_verified: false,
        membership_role: null,
      },
    };
  }

  const corporate = assertCorporateEntity(loaded.entityRecord);
  if (!corporate.ok) {
    return {
      mode: "corporate",
      ok: false,
      failure_reason: corporate.reason ?? "corporate_entity_invalid",
      customer_text: CORPORATE_AUTH_FAILED_CUSTOMER_TEXT,
      authorization: {
        entity_type: ENTITY_TYPES.CORPORATE,
        entity_id: entityId,
        authorization_verified: false,
        membership_role: null,
      },
    };
  }

  const access = assertEntityAccess({
    entity: corporate.entity,
    membership: loaded.membership,
    requireMembership: true,
  });
  if (!access.ok) {
    return {
      mode: "corporate",
      ok: false,
      failure_reason: access.reason ?? "corporate_access_denied",
      customer_text: CORPORATE_AUTH_FAILED_CUSTOMER_TEXT,
      authorization: {
        entity_type: ENTITY_TYPES.CORPORATE,
        entity_id: entityId,
        authorization_verified: false,
        membership_role: loaded.membership?.member_role ?? null,
      },
    };
  }

  const entityForLoad = {
    id: access.entity.entity_id,
    entity_id: access.entity.entity_id,
    entity_type: access.entity.entity_type,
    entity_status: access.entity.entity_status,
    entity_scope: access.entity.entity_scope,
    display_name: access.entity.display_name,
    memory_version: access.entity.memory_version,
    metadata_json: access.entity.metadata_json ?? {},
  };

  const memorySnapshot = await loadCorporateMemorySnapshotImpl(
    userSupabase,
    access.entity.entity_id,
    { entityRecord: entityForLoad },
  );
  const snapshot = buildCorporateSnapshotImpl({
    entityRecord: entityForLoad,
    memorySnapshot,
  });

  const session = createCorporateEntitySession({
    entityRecord: access.entity,
    membership: access.membership,
    routing_reason: SESSION_ROUTING_REASONS.EXPLICIT_CORPORATE,
    conversation_id: parsed?.conversationContext?.conversation_id ?? null,
    customer_id: customerId,
    resolver_version: ENTITY_RESOLVER_V1,
  });

  const factPack = buildClaudeCorporateFactPack({
    entityRecord: access.entity,
    membership: access.membership,
    snapshot,
    memorySnapshot,
  });

  return {
    mode: "corporate",
    ok: true,
    factPack,
    session,
    authorization: {
      entity_type: ENTITY_TYPES.CORPORATE,
      entity_id: access.entity.entity_id,
      authorization_verified: true,
      membership_role: access.membership?.member_role ?? null,
    },
  };
}
