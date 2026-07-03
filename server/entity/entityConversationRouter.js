/**
 * Entity Conversation Router — thin adapter at salesDirectorLoop entry (CORP-I4-1).
 * Wraps proven resolveSessionAndLoadContract pipeline behind feature flags.
 * Default: flags off — wiring present, behavior unchanged.
 */
import { resolveSessionAndLoadContract } from "./entityContractLoader.js";
import { ENTITY_TYPES } from "./entityTypes.js";
import { isEntitySession } from "./entitySession.js";

export const ENTITY_CONVERSATION_ROUTER_V1 = "entity-conversation-router-v1";

export function isEntityRuntimeWiringEnabled(env = process.env) {
  return String(env?.ENTITY_RUNTIME_WIRING_ENABLED ?? "").trim().toLowerCase() === "true";
}

export function isCorporateKeyRuntimeEnabled(env = process.env) {
  return (
    isEntityRuntimeWiringEnabled(env) &&
    String(env?.CORPORATE_KEY_RUNTIME_ENABLED ?? "").trim().toLowerCase() === "true"
  );
}

export function isCorporateRuntimeSession(session) {
  return isEntitySession(session) && session.entity_type === ENTITY_TYPES.CORPORATE;
}

export function buildEntityRuntimeTrace({
  enabled = false,
  wiring_active = false,
  corporate_branch_active = false,
  skipped_reason = null,
  session = null,
  resolverTrace = null,
  contract = null,
} = {}) {
  return {
    contract_version: ENTITY_CONVERSATION_ROUTER_V1,
    enabled,
    wiring_active,
    corporate_branch_active,
    skipped_reason,
    entity_type: session?.entity_type ?? null,
    entity_id: session?.entity_id ?? null,
    routing_reason: session?.routing_reason ?? null,
    resolver_action: resolverTrace?.action ?? null,
    resolver_reused_session: resolverTrace?.reused_session ?? false,
    resolver_fallback: resolverTrace?.fallback ?? false,
    compose_route: contract?.compose_route ?? null,
    primary_contract: contract?.primary_contract ?? null,
    wired_to_loop: false,
  };
}

/**
 * Resolve Entity Runtime for one loop turn when master flag is on.
 * Corporate branch consumes compose only when CORPORATE_KEY_RUNTIME_ENABLED is also on.
 */
export async function resolveEntityRuntimeForTurn({
  userSupabase = null,
  customerId,
  conversationContext = {},
  existingSession = null,
  entityRecord = null,
  membership = null,
  conversation_id = null,
  env = process.env,
  loaderOptions = {},
} = {}) {
  if (!customerId) {
    return {
      enabled: false,
      wiring_active: false,
      corporate_branch_active: false,
      session: null,
      contract: null,
      resolverTrace: null,
      trace: buildEntityRuntimeTrace({
        skipped_reason: "customer_id_required",
      }),
    };
  }

  if (!isEntityRuntimeWiringEnabled(env)) {
    return {
      enabled: false,
      wiring_active: false,
      corporate_branch_active: false,
      session: null,
      contract: null,
      resolverTrace: null,
      trace: buildEntityRuntimeTrace({
        skipped_reason: "entity_runtime_wiring_flag_off",
      }),
    };
  }

  const pipeline = await resolveSessionAndLoadContract({
    supabase: userSupabase,
    customerId,
    conversationContext,
    existingSession,
    entityRecord,
    membership,
    conversation_id,
    loaderOptions,
  });

  const corporateBranchActive =
    isCorporateKeyRuntimeEnabled(env) && isCorporateRuntimeSession(pipeline.session);

  return {
    enabled: true,
    wiring_active: true,
    corporate_branch_active: corporateBranchActive,
    session: pipeline.session,
    contract: pipeline.contract,
    resolverTrace: pipeline.resolverTrace,
    trace: buildEntityRuntimeTrace({
      enabled: true,
      wiring_active: true,
      corporate_branch_active: corporateBranchActive,
      session: pipeline.session,
      resolverTrace: pipeline.resolverTrace,
      contract: pipeline.contract,
    }),
  };
}
