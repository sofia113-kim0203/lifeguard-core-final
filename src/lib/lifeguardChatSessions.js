/**
 * P5-STATE / P5-CONTINUITY-01 Phase A — LIFEGUARD home chat session persistence.
 */
import { supabase } from "./supabase.js";
import {
  loadCustomerConversations,
  normalizeConversationMessage,
  resolveCustomerId,
} from "./customerConversations.js";
import {
  buildKeyPresenceMetadata,
  buildRecentSessionsFromRows,
  buildSessionMetadata,
  mapSessionRowsToChatMessages,
} from "./lifeguardChatSessionCore.js";
import { toCustomerErrorMessage } from "./uiLocale.js";

export {
  activeSessionStorageKey,
  buildKeyPresenceMetadata,
  buildRecentSessionsFromRows,
  createLifeguardSessionId,
  isLifeguardHomeChatRow,
  LIFEGUARD_HOME_CHAT_PHASE,
  LIFEGUARD_HOME_CHAT_SOURCE,
  mapSessionRowsToChatMessages,
  readActiveSessionId,
  resolveActiveLifeguardSessionId,
  writeActiveSessionId,
} from "./lifeguardChatSessionCore.js";

const RECENT_SCAN_LIMIT = 400;
const SESSION_MESSAGE_SCAN_LIMIT = 500;

async function insertLifeguardConversationMessage(customerId, { role, message, metadata }) {
  const { data, error } = await supabase
    .from("customer_conversations")
    .insert({
      customer_id: customerId,
      role,
      message: String(message ?? "").trim(),
      metadata_json: metadata,
    })
    .select("id, customer_id, role, message, metadata_json, created_at")
    .single();

  if (error) {
    throw new Error(toCustomerErrorMessage(error, "대화 메시지를 저장하지 못했습니다."));
  }
  return normalizeConversationMessage(data);
}

function keyPresenceDedupeMatch(row, sessionId, { keyPresenceSource, anchorDocumentId, anchorJobId, content }) {
  const metadata = row?.metadata ?? {};
  if (String(metadata.session_id) !== String(sessionId)) return false;
  if (metadata.key_presence !== true) return false;
  if (metadata.key_presence_source !== keyPresenceSource) return false;

  const rowAnchorDoc = metadata.anchor_document_id ?? null;
  const rowAnchorJob = metadata.anchor_job_id ?? null;
  if (anchorDocumentId && rowAnchorDoc && String(rowAnchorDoc) === String(anchorDocumentId)) return true;
  if (anchorJobId && rowAnchorJob && String(rowAnchorJob) === String(anchorJobId)) return true;
  if (!anchorDocumentId && !anchorJobId) {
    return String(row.message ?? "").trim() === String(content ?? "").trim();
  }
  return false;
}

async function hasExistingKeyPresence(
  authUser,
  customerId,
  sessionId,
  { keyPresenceSource, anchorDocumentId, anchorJobId, content },
) {
  const rows = await loadCustomerConversations(authUser, {
    limit: SESSION_MESSAGE_SCAN_LIMIT,
    customerId,
  });
  return rows.some((row) =>
    keyPresenceDedupeMatch(row, sessionId, {
      keyPresenceSource,
      anchorDocumentId,
      anchorJobId,
      content,
    }),
  );
}

export async function listLifeguardRecentSessions(
  authUser,
  { customerId: knownCustomerId = null, limit = 12 } = {},
) {
  const customerId = await resolveCustomerId(authUser, knownCustomerId);
  const rows = await loadCustomerConversations(authUser, {
    limit: RECENT_SCAN_LIMIT,
    customerId,
  });
  return buildRecentSessionsFromRows(rows, { limit });
}

export async function loadLifeguardSessionMessages(
  authUser,
  sessionId,
  { customerId: knownCustomerId = null } = {},
) {
  if (!sessionId) return [];
  const customerId = await resolveCustomerId(authUser, knownCustomerId);
  const rows = await loadCustomerConversations(authUser, {
    limit: SESSION_MESSAGE_SCAN_LIMIT,
    customerId,
  });
  return mapSessionRowsToChatMessages(rows, sessionId);
}

export async function persistKeyPresenceMessage(
  authUser,
  {
    sessionId,
    customerId: knownCustomerId = null,
    content,
    keyPresenceSource,
    anchorDocumentId = null,
    anchorJobId = null,
  },
) {
  if (!sessionId) throw new Error("session_id_required");
  if (!keyPresenceSource) throw new Error("key_presence_source_required");
  const trimmed = String(content ?? "").trim();
  if (!trimmed) throw new Error("content_required");

  const customerId = await resolveCustomerId(authUser, knownCustomerId);
  const duplicate = await hasExistingKeyPresence(authUser, customerId, sessionId, {
    keyPresenceSource,
    anchorDocumentId,
    anchorJobId,
    content: trimmed,
  });
  if (duplicate) return { skipped: true, reason: "dedupe" };

  const row = await insertLifeguardConversationMessage(customerId, {
    role: "assistant",
    message: trimmed,
    metadata: buildKeyPresenceMetadata(sessionId, {
      keyPresenceSource,
      anchorDocumentId,
      anchorJobId,
    }),
  });
  return { skipped: false, row };
}

export async function persistLifeguardChatTurn(
  authUser,
  { sessionId, customerId: knownCustomerId = null, userMessage, assistantMessage },
) {
  if (!sessionId) throw new Error("session_id_required");
  const customerId = await resolveCustomerId(authUser, knownCustomerId);
  const metadata = buildSessionMetadata(sessionId);
  const userRow = await insertLifeguardConversationMessage(customerId, {
    role: "user",
    message: userMessage,
    metadata,
  });
  const assistantRow = await insertLifeguardConversationMessage(customerId, {
    role: "assistant",
    message: assistantMessage,
    metadata,
  });
  return { userRow, assistantRow };
}
