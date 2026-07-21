/**
 * ACTIVATION-2 — API entity context passthrough (flag-gated consumption in loop · passthrough always traced).
 */
import { isEntitySession } from "./entitySession.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function trimString(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
}

function parseExistingSession(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return isEntitySession(raw) ? raw : null;
}

export function parseEntityContextFromRequestBody(body = {}) {
  const entity_type = trimString(body.entity_type);
  const entity_id = trimString(body.entity_id);
  const conversation_id = trimString(body.conversation_id);
  const view_mode_raw = trimString(body.view_mode ?? body.viewMode);
  const view_mode =
    view_mode_raw === "personal" ||
    view_mode_raw === "corporate" ||
    view_mode_raw === "both"
      ? view_mode_raw
      : null;
  const existingSession =
    parseExistingSession(body.entity_session) ?? parseExistingSession(body.existing_session);

  const conversationContext = {
    ...(conversation_id ? { conversation_id } : {}),
    ...(entity_type ? { entity_type } : {}),
    ...(entity_id ? { entity_id } : {}),
  };

  const hasEntitySignal = Boolean(entity_type || entity_id || existingSession || view_mode);

  return {
    has_entity_signal: hasEntitySignal,
    conversationContext: Object.keys(conversationContext).length ? conversationContext : {},
    existingSession,
    entityRecord: null,
    membership: null,
    view_mode,
    passthrough_audit: {
      entity_type,
      entity_id,
      conversation_id,
      view_mode,
      has_existing_session: Boolean(existingSession),
      existing_session_entity_type: existingSession?.entity_type ?? null,
    },
  };
}

export function buildEntityContextPassthroughTrace({
  conversationContext = {},
  existingSession = null,
  entityRecord = null,
  membership = null,
} = {}) {
  const entity_type = trimString(conversationContext?.entity_type);
  const entity_id = trimString(conversationContext?.entity_id);
  const conversation_id = trimString(conversationContext?.conversation_id);

  return {
    contract_version: "entity-api-context-passthrough-v1",
    received: Boolean(entity_type || entity_id || existingSession || entityRecord || membership),
    entity_type,
    entity_id,
    conversation_id,
    has_existing_session: Boolean(existingSession),
    existing_session_entity_type: existingSession?.entity_type ?? null,
    has_entity_record: Boolean(entityRecord),
    has_membership: Boolean(membership),
    entity_id_format_valid: entity_id ? UUID_RE.test(entity_id) : null,
  };
}
