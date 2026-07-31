/**
 * Pure home KEY request body builder (browser + Node unit-test safe).
 */

import { resolveAttachDocumentIdContract } from "./homeBrainAttachDocumentIds.js";

/**
 * Isolate attach-authority fields for the request body.
 * restorable candidates must never appear here — only explicit active + current-turn uploads.
 */
export function resolveAttachmentRequestScope({
  attachmentReferenceEnabled = false,
  activeAttachmentIds = null,
  currentTurnDocumentIds = null,
  documentId = null,
  documentIds = null,
} = {}) {
  const enabled = attachmentReferenceEnabled === true;
  const currentTurnIds = resolveAttachDocumentIdContract({
    documentIds: currentTurnDocumentIds,
  }).documentIds;
  const activeIds = enabled
    ? resolveAttachDocumentIdContract({ documentIds: activeAttachmentIds }).documentIds
    : [];
  const authorized = new Set([...currentTurnIds, ...activeIds]);
  if (!enabled && currentTurnIds.length === 0) {
    return {
      attachmentReferenceEnabled: false,
      activeAttachmentIds: [],
      currentTurnDocumentIds: [],
      documentId: null,
      documentIds: [],
    };
  }
  const requested = resolveAttachDocumentIdContract({ documentId, documentIds });
  const requestedIds =
    requested.documentIds.length > 0
      ? requested.documentIds
      : requested.documentId
        ? [requested.documentId]
        : [];
  const filtered = requestedIds.filter((id) => authorized.has(id));
  const finalIds = filtered.length > 0 ? filtered : [...authorized];
  const contract = resolveAttachDocumentIdContract({ documentIds: finalIds });
  return {
    attachmentReferenceEnabled: enabled,
    activeAttachmentIds: activeIds,
    currentTurnDocumentIds: currentTurnIds,
    documentId: contract.documentId,
    documentIds: contract.documentIds,
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
        documentId: null,
        documentIds: [],
      }
    : resolveAttachmentRequestScope({
        attachmentReferenceEnabled:
          options.attachmentReferenceEnabled ?? options.attachment_reference_enabled ?? false,
        activeAttachmentIds: options.activeAttachmentIds ?? options.active_attachment_ids,
        currentTurnDocumentIds: options.currentTurnDocumentIds ?? options.current_turn_document_ids,
        documentId: options.documentId ?? options.document_id,
        documentIds: options.documentIds ?? options.document_ids,
      });
  const documentId = scope.documentId;
  const documentIds = scope.documentIds;
  const priorAttachFollowUp = Boolean(
    options.priorAttachFollowUp ?? options.prior_attach_follow_up ?? false,
  );
  const attachmentReferenceEnabled = scope.attachmentReferenceEnabled;
  const activeAttachmentIds = scope.activeAttachmentIds;
  const currentTurnDocumentIds = scope.currentTurnDocumentIds;
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

  return {
    question: trimmed,
    history: presenceTurn ? [] : Array.isArray(history) ? history : [],
    ...(presenceTurn ? { presence: true } : {}),
    ...(documentId && !presenceTurn ? { document_id: documentId } : {}),
    ...(documentIds.length > 1 && !presenceTurn ? { document_ids: documentIds } : {}),
    ...(!presenceTurn ? { attachment_reference_enabled: attachmentReferenceEnabled } : {}),
    ...(activeAttachmentIds.length && !presenceTurn
      ? { active_attachment_ids: activeAttachmentIds }
      : {}),
    ...(currentTurnDocumentIds.length && !presenceTurn
      ? { current_turn_document_ids: currentTurnDocumentIds }
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
  };
}
