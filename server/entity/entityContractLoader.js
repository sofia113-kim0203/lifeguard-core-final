/**
 * Entity Contract Loader — which Contract to read for this Session? (CORP-I1)
 * KEY Compose and downstream consumers read Session + loaded Contract only.
 * Principle 15: corporate path uses corp-recommendation-v1 via loadCorporateKeyContext.
 */
import { loadCorporateKeyContext } from "./corporate/corporateKeyContext.js";
import { resolveEntitySession } from "./entityResolver.js";
import { ENTITY_TYPES } from "./entityTypes.js";
import { assertEntitySession, entitySessionRoutingKey } from "./entitySession.js";

export const ENTITY_CONTRACT_LOADER_V1 = "entity-contract-loader-v1";
export const PERSONAL_KEY_COMPOSE_ROUTE = "personal-sales-director-legacy";
export const CORPORATE_KEY_COMPOSE_ROUTE = "corp-key-compose-v1";

function buildLoaderTrace({
  entity_type,
  primary_contract,
  compose_route,
  session_routing_key,
} = {}) {
  return {
    contract_version: ENTITY_CONTRACT_LOADER_V1,
    entity_type,
    primary_contract,
    compose_route,
    session_routing_key,
  };
}

/**
 * Individual contract descriptor — personal loop path unchanged (I1 does not wire loop).
 */
export function loadIndividualKeyContract(session, options = {}) {
  const asserted = assertEntitySession(session);
  if (!asserted.ok) throw new Error(asserted.reason ?? "invalid_entity_session");
  if (asserted.session.entity_type !== ENTITY_TYPES.INDIVIDUAL) {
    throw new Error("individual_contract_requires_individual_session");
  }
  if (!asserted.session.permissions?.can_read_contract) {
    throw new Error("individual_contract_read_forbidden");
  }

  const sessionKey = entitySessionRoutingKey(asserted.session);

  return {
    contract_version: ENTITY_CONTRACT_LOADER_V1,
    entity_type: ENTITY_TYPES.INDIVIDUAL,
    entity_id: asserted.session.entity_id,
    primary_contract: "personal-recommendation-legacy",
    compose_route: PERSONAL_KEY_COMPOSE_ROUTE,
    session_routing_key: sessionKey,
    key_compose: null,
    available: true,
    wired_to_loop: false,
    principle_15: {
      trusts_contract_not_presentation: true,
      primary_source: "personal-sales-director-legacy",
    },
    source: options.source ?? "individual-legacy-path-descriptor",
    loader_trace: buildLoaderTrace({
      entity_type: ENTITY_TYPES.INDIVIDUAL,
      primary_contract: "personal-recommendation-legacy",
      compose_route: PERSONAL_KEY_COMPOSE_ROUTE,
      session_routing_key: sessionKey,
    }),
  };
}

/**
 * Corporate contract — corp-key-compose-v1 via proven CORP-H loader.
 */
export async function loadCorporateKeyContract(supabase, session, options = {}) {
  const asserted = assertEntitySession(session);
  if (!asserted.ok) throw new Error(asserted.reason ?? "invalid_entity_session");
  if (asserted.session.entity_type !== ENTITY_TYPES.CORPORATE) {
    throw new Error("corporate_contract_requires_corporate_session");
  }
  if (!asserted.session.permissions?.can_read_contract) {
    throw new Error("corporate_contract_read_forbidden");
  }

  const sessionKey = entitySessionRoutingKey(asserted.session);
  const keyCompose = await loadCorporateKeyContext(supabase, asserted.session.entity_id, options);

  return {
    contract_version: ENTITY_CONTRACT_LOADER_V1,
    entity_type: ENTITY_TYPES.CORPORATE,
    entity_id: asserted.session.entity_id,
    primary_contract: keyCompose.primary_contract,
    compose_route: CORPORATE_KEY_COMPOSE_ROUTE,
    session_routing_key: sessionKey,
    key_compose: keyCompose,
    available: keyCompose.available !== false,
    wired_to_loop: false,
    principle_15: keyCompose.principle_15 ?? {
      trusts_contract_not_presentation: true,
      primary_source: keyCompose.primary_contract,
    },
    source: options.source ?? "corporate-key-context-loader",
    loader_trace: buildLoaderTrace({
      entity_type: ENTITY_TYPES.CORPORATE,
      primary_contract: keyCompose.primary_contract,
      compose_route: CORPORATE_KEY_COMPOSE_ROUTE,
      session_routing_key: sessionKey,
    }),
  };
}

export async function loadEntityKeyContract(supabase, session, options = {}) {
  const asserted = assertEntitySession(session);
  if (!asserted.ok) throw new Error(asserted.reason ?? "invalid_entity_session");

  switch (asserted.session.entity_type) {
    case ENTITY_TYPES.INDIVIDUAL:
      return loadIndividualKeyContract(asserted.session, options);
    case ENTITY_TYPES.CORPORATE:
      return loadCorporateKeyContract(supabase, asserted.session, options);
    default:
      throw new Error("entity_contract_loader_entity_type_unsupported");
  }
}

/**
 * Resolver + Loader pipeline — for I2 probe; not wired to salesDirectorLoop in I1.
 */
export async function resolveSessionAndLoadContract({
  supabase = null,
  customerId,
  conversationContext = {},
  existingSession = null,
  entityRecord = null,
  membership = null,
  forceResolve = false,
  conversation_id = null,
  loaderOptions = {},
} = {}) {
  const { session, resolverTrace } = resolveEntitySession({
    customerId,
    conversationContext,
    existingSession,
    entityRecord,
    membership,
    forceResolve,
    conversation_id,
  });

  const contract = await loadEntityKeyContract(supabase, session, loaderOptions);

  return {
    session,
    resolverTrace,
    contract,
  };
}
