/**
 * KEY customer relationship state — fact-owned, not memory-query-owned.
 *
 * Memory query failure never decides NEW vs RETURNING.
 * Claude never judges relationship; KEY settles it before ONE PATH assemble.
 */

export const KEY_RELATIONSHIP = Object.freeze({
  NEW_CUSTOMER: "NEW_CUSTOMER",
  RETURNING_CUSTOMER: "RETURNING_CUSTOMER",
});

export const KEY_CONVERSATION = Object.freeze({
  NONE: "NONE",
  NEW_CONVERSATION: "NEW_CONVERSATION",
  CONTINUING_CONVERSATION: "CONTINUING_CONVERSATION",
});

export const KEY_MEMORY_AVAILABILITY = Object.freeze({
  NONE: "none",
  AVAILABLE: "available",
  PARTIAL_UNAVAILABLE: "partial_unavailable",
});

function hasNonEmptyId(v) {
  return Boolean(String(v ?? "").trim());
}

function countArray(v) {
  return Array.isArray(v) ? v.length : 0;
}

/**
 * Fact signals only. Do not pass memory query ok/fail into relationship tier.
 *
 * @returns {{
 *   customer_id: string|null,
 *   conversation_id: string|null,
 *   relationship: "NEW_CUSTOMER"|"RETURNING_CUSTOMER",
 *   conversation: "NONE"|"NEW_CONVERSATION"|"CONTINUING_CONVERSATION",
 *   prior_original_in_same_conversation: boolean,
 *   states: string[],
 *   memory_availability: "none"|"available"|"partial_unavailable",
 *   memory_query_failed: boolean,
 *   facts: object,
 *   authority: "KEY",
 * }}
 */
export function resolveKeyCustomerRelationshipState({
  customerId = null,
  conversationId = null,
  history = [],
  confirmedContracts = null,
  priorConsultation = null,
  readyCardMeta = null,
  currentTurnDocumentIds = null,
  explicitReopenDocumentIds = null,
  originalDeliveryReason = null,
  ownedOriginalSources = null,
  hasOwnedVaultOriginals = false,
  memoryQueryFailed = false,
  memoryLoadStatus = null,
} = {}) {
  const customer_id = hasNonEmptyId(customerId) ? String(customerId).trim() : null;
  const conversation_id = hasNonEmptyId(conversationId)
    ? String(conversationId).trim()
    : null;

  const confirmedCount = countArray(confirmedContracts);
  const historyCount = countArray(history);
  const reopenCount = countArray(explicitReopenDocumentIds);
  const currentTurnCount = countArray(currentTurnDocumentIds);
  const readyDocCount = Number(readyCardMeta?.document_status?.active_count) || 0;
  const materialsConnected = readyCardMeta?.materials_connected === true;
  const priorConsult =
    priorConsultation && typeof priorConsultation === "object"
      ? priorConsultation
      : null;
  const priorConsultTurns = countArray(priorConsult?.related_turns);
  const sources = Array.isArray(ownedOriginalSources) ? ownedOriginalSources : [];
  const hasOwnedPointer = sources.some(
    (s) => String(s || "") === "owned_pointer" || String(s || "") === "vault_document",
  );
  const deliveryReason = String(originalDeliveryReason || "").trim();

  const hasCustomerRecord =
    confirmedCount > 0 ||
    readyDocCount > 0 ||
    materialsConnected === true ||
    priorConsultTurns > 0 ||
    hasOwnedVaultOriginals === true ||
    hasOwnedPointer === true ||
    reopenCount > 0;

  // Same conversation_id with prior turns or lineage = continuing.
  const continuingConversation =
    Boolean(conversation_id) &&
    (historyCount > 0 ||
      reopenCount > 0 ||
      deliveryReason === "explicit_reopen" ||
      (currentTurnCount > 0 && historyCount > 0));

  const priorOriginalInSameConversation =
    reopenCount > 0 ||
    deliveryReason === "explicit_reopen" ||
    hasOwnedPointer === true;

  const relationship = hasCustomerRecord
    ? KEY_RELATIONSHIP.RETURNING_CUSTOMER
    : KEY_RELATIONSHIP.NEW_CUSTOMER;

  let conversation = KEY_CONVERSATION.NONE;
  if (conversation_id) {
    conversation = continuingConversation
      ? KEY_CONVERSATION.CONTINUING_CONVERSATION
      : KEY_CONVERSATION.NEW_CONVERSATION;
  }

  // Memory availability is separate from relationship — never rewrite NEW/RETURNING.
  const memFailed = memoryQueryFailed === true;
  const memStatus = String(memoryLoadStatus || "").trim().toLowerCase();
  let memory_availability = KEY_MEMORY_AVAILABILITY.NONE;
  if (memFailed || memStatus === "query_failed") {
    memory_availability = KEY_MEMORY_AVAILABILITY.PARTIAL_UNAVAILABLE;
  } else if (confirmedCount > 0 || historyCount > 0) {
    memory_availability = KEY_MEMORY_AVAILABILITY.AVAILABLE;
  } else {
    memory_availability = KEY_MEMORY_AVAILABILITY.NONE;
  }

  const states = [relationship];
  if (conversation === KEY_CONVERSATION.CONTINUING_CONVERSATION) {
    states.push(KEY_CONVERSATION.CONTINUING_CONVERSATION);
  }
  if (priorOriginalInSameConversation) {
    states.push("PRIOR_ORIGINAL_IN_SAME_CONVERSATION");
  }

  return {
    schema_version: "key-customer-relationship-state-v1",
    authority: "KEY",
    customer_id,
    conversation_id,
    relationship,
    conversation,
    prior_original_in_same_conversation: priorOriginalInSameConversation,
    states,
    memory_availability,
    memory_query_failed: memFailed || memStatus === "query_failed",
    facts: {
      authenticated_customer: Boolean(customer_id),
      confirmed_contract_count: confirmedCount,
      history_turn_count: historyCount,
      ready_document_count: readyDocCount,
      materials_connected: materialsConnected,
      prior_consultation_turns: priorConsultTurns,
      current_turn_document_count: currentTurnCount,
      explicit_reopen_document_count: reopenCount,
      original_delivery_reason: deliveryReason || null,
      has_owned_vault_originals: hasOwnedVaultOriginals === true,
      has_owned_pointer_original: hasOwnedPointer,
    },
  };
}

/**
 * Memory query failure must never stop the customer-answer Provider path.
 * Relationship is already KEY-owned before memory assemble.
 */
export function shouldStopProviderForMemoryQueryFailure() {
  return false;
}
