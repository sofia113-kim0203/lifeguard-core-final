/**
 * Pure home KEY request body builder (browser + Node unit-test safe).
 */

import { resolveAttachDocumentIdContract } from "./homeBrainAttachDocumentIds.js";
import { resolveOneShotAttachmentRequestScope } from "./originalAttachmentOneShot.js";

/**
 * Isolate attach-authority fields for the request body.
 * Original bytes: current-turn uploads or explicit chip reopen only.
 * Restorable candidates / past active ids must never appear as delivery authority.
 */
export function resolveAttachmentRequestScope({
  attachmentReferenceEnabled = false,
  activeAttachmentIds = null,
  currentTurnDocumentIds = null,
  explicitReopenDocumentIds = null,
  documentId = null,
  documentIds = null,
} = {}) {
  void attachmentReferenceEnabled;
  void activeAttachmentIds;
  void documentId;
  void documentIds;
  const oneShot = resolveOneShotAttachmentRequestScope({
    currentTurnDocumentIds,
    explicitReopenDocumentIds,
  });
  // Wire contract: single id → documentIds empty for compat; multi → full list.
  const contract = resolveAttachDocumentIdContract({
    documentIds: oneShot.documentIds,
  });
  return {
    attachmentReferenceEnabled: false,
    activeAttachmentIds: [],
    currentTurnDocumentIds: oneShot.currentTurnDocumentIds,
    explicitReopenDocumentIds: oneShot.explicitReopenDocumentIds,
    documentId: contract.documentId,
    documentIds: contract.documentIds,
    deliveryReason: oneShot.deliveryReason,
  };
}

export function buildHomeBrainFactRequestBody(question, history = [], options = {}) {
  const presenceTurn = options.presence === true || options.presenceTurn === true;
  const trimmed = presenceTurn ? "" : String(question ?? "").trim();
  const scope = presenceTurn
    ? {
        attachmentReferenceEnabled: false,
        activeAttachmentIds: [],
        currentTurnDocumentIds: [],
        explicitReopenDocumentIds: [],
        documentId: null,
        documentIds: [],
      }
    : resolveAttachmentRequestScope({
        attachmentReferenceEnabled:
          options.attachmentReferenceEnabled ?? options.attachment_reference_enabled ?? false,
        activeAttachmentIds: options.activeAttachmentIds ?? options.active_attachment_ids,
        currentTurnDocumentIds: options.currentTurnDocumentIds ?? options.current_turn_document_ids,
        explicitReopenDocumentIds:
          options.explicitReopenDocumentIds ?? options.explicit_reopen_document_ids,
        documentId: options.documentId ?? options.document_id,
        documentIds: options.documentIds ?? options.document_ids,
      });
  const documentId = scope.documentId;
  const documentIds = scope.documentIds;
  const priorAttachFollowUp = Boolean(
    options.priorAttachFollowUp ?? options.prior_attach_follow_up ?? false,
  );
  const currentTurnDocumentIds = scope.currentTurnDocumentIds;
  const explicitReopenDocumentIds = scope.explicitReopenDocumentIds || [];
  const sessionId = String(options.sessionId ?? options.session_id ?? "").trim() || null;
  const handoffToken = String(
    options.readyCardHandoffToken ?? options.ready_card_handoff_token ?? "",
  ).trim() || null;
  const entityId = String(options.entityId ?? options.entity_id ?? "").trim() || null;
  const entityType = String(options.entityType ?? options.entity_type ?? "").trim() || null;
  const viewModeRaw = String(options.viewMode ?? options.view_mode ?? "")
    .trim()
    .toLowerCase();
  const viewMode =
    viewModeRaw === "personal" || viewModeRaw === "corporate" || viewModeRaw === "both"
      ? viewModeRaw
      : null;
  const clientTurnId =
    String(options.clientTurnId ?? options.client_turn_id ?? "").trim() || null;

  return {
    question: trimmed,
    history: presenceTurn ? [] : Array.isArray(history) ? history : [],
    ...(presenceTurn ? { presence: true } : {}),
    ...(documentId && !presenceTurn ? { document_id: documentId } : {}),
    ...(documentIds.length > 1 && !presenceTurn ? { document_ids: documentIds } : {}),
    ...(!presenceTurn ? { attachment_reference_enabled: false } : {}),
    ...(currentTurnDocumentIds.length && !presenceTurn
      ? { current_turn_document_ids: currentTurnDocumentIds }
      : {}),
    ...(explicitReopenDocumentIds.length && !presenceTurn
      ? { explicit_reopen_document_ids: explicitReopenDocumentIds }
      : {}),
    ...(priorAttachFollowUp && !presenceTurn ? { prior_attach_follow_up: true } : {}),
    // GO3: session_id only — server loads session_goal SSOT; never send prior_session_goal.
    ...(sessionId ? { session_id: sessionId } : {}),
    // T2.1 — opaque sealed token only (never plaintext READY CARD JSON).
    ...(handoffToken ? { ready_card_handoff_token: handoffToken } : {}),
    // Unified view — selection hint only; server re-authorizes membership/consent every turn.
    ...(entityId && !presenceTurn ? { entity_id: entityId } : {}),
    ...(entityType && !presenceTurn ? { entity_type: entityType } : {}),
    ...(viewMode && !presenceTurn ? { view_mode: viewMode } : {}),
    ...(clientTurnId ? { client_turn_id: clientTurnId } : {}),
  };
}
