/**
 * P5-STATE — LIFEGUARD home chat session persistence (customer_conversations + session_id).
 */
import { supabase } from "./supabase.js";
import {
  loadCustomerConversations,
  normalizeConversationMessage,
  resolveCustomerId,
} from "./customerConversations.js";
import {
  buildRecentSessionsFromRows,
  buildSessionMetadata,
  mapSessionRowsToChatMessages,
} from "./lifeguardChatSessionCore.js";
import { toCustomerErrorMessage } from "./uiLocale.js";

export {
  activeSessionStorageKey,
  buildRecentSessionsFromRows,
  createLifeguardSessionId,
  isLifeguardHomeChatRow,
  LIFEGUARD_HOME_CHAT_PHASE,
  LIFEGUARD_HOME_CHAT_SOURCE,
  mapSessionRowsToChatMessages,
} from "./lifeguardChatSessionCore.js";

const RECENT_SCAN_LIMIT = 400;
const SESSION_MESSAGE_SCAN_LIMIT = 500;

async function insertLifeguardConversationMessage(customerId, { role, message, sessionId }) {
  const { data, error } = await supabase
    .from("customer_conversations")
    .insert({
      customer_id: customerId,
      role,
      message: String(message ?? "").trim(),
      metadata_json: buildSessionMetadata(sessionId),
    })
    .select("id, customer_id, role, message, metadata_json, created_at")
    .single();

  if (error) {
    throw new Error(toCustomerErrorMessage(error, "대화 메시지를 저장하지 못했습니다."));
  }
  return normalizeConversationMessage(data);
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

export async function persistLifeguardChatTurn(
  authUser,
  { sessionId, customerId: knownCustomerId = null, userMessage, assistantMessage },
) {
  if (!sessionId) throw new Error("session_id_required");
  const customerId = await resolveCustomerId(authUser, knownCustomerId);
  const userRow = await insertLifeguardConversationMessage(customerId, {
    role: "user",
    message: userMessage,
    sessionId,
  });
  const assistantRow = await insertLifeguardConversationMessage(customerId, {
    role: "assistant",
    message: assistantMessage,
    sessionId,
  });
  return { userRow, assistantRow };
}
