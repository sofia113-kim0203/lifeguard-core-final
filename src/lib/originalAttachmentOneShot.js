/**
 * KEY original-byte delivery authority — upload this turn or explicit chip reopen only.
 * Past active ids / chart / keywords do not authorize Storage originals.
 */

import {
  listAttachedDocumentIds,
  resolveAttachDocumentIdContract,
} from "./homeBrainAttachDocumentIds.js";

/**
 * Ordered unique delivery ids for this turn.
 * @returns {{ deliveryIds: string[], reason: "current_upload"|"explicit_reopen"|null }}
 */
export function resolveOriginalByteDeliveryAuthority({
  currentTurnDocumentIds = null,
  explicitReopenDocumentIds = null,
} = {}) {
  const current = listAttachedDocumentIds(currentTurnDocumentIds);
  if (current.length > 0) {
    return { deliveryIds: current.slice(), reason: "current_upload" };
  }
  const reopen = listAttachedDocumentIds(explicitReopenDocumentIds);
  if (reopen.length > 0) {
    return { deliveryIds: reopen.slice(), reason: "explicit_reopen" };
  }
  return { deliveryIds: [], reason: null };
}

/** Server PdfAttachPolicy force flag — never chart / case / multi-count / keywords. */
export function decideForceFullOriginalForOneShot({
  currentTurnDocumentIds = null,
  explicitReopenDocumentIds = null,
} = {}) {
  return resolveOriginalByteDeliveryAuthority({
    currentTurnDocumentIds,
    explicitReopenDocumentIds,
  }).deliveryIds.length > 0;
}

/**
 * Block Claude request when composer shows files that are not upload-complete ids.
 * Uploading flag alone is also a hard stop (caller).
 */
export function shouldBlockSendForIncompleteUpload({
  uploading = false,
  composerAttachments = [],
} = {}) {
  if (uploading === true) {
    return { block: true, reason: "upload_in_progress" };
  }
  const rows = Array.isArray(composerAttachments) ? composerAttachments : [];
  if (rows.length === 0) {
    return { block: false, reason: null };
  }
  const ids = listAttachedDocumentIds(
    rows.map((row) => row?.documentId ?? row?.document_id),
  );
  if (ids.length !== rows.length || ids.length === 0) {
    return { block: true, reason: "upload_ids_not_ready" };
  }
  return { block: false, reason: null };
}

/**
 * Consume reopen ids at request-build time (one-shot). Caller must clear state after.
 * @returns {{ reopenIds: string[], nextReopenIds: [] }}
 */
export function consumeExplicitReopenDocumentIds(explicitReopenDocumentIds = null) {
  const reopenIds = listAttachedDocumentIds(explicitReopenDocumentIds);
  return { reopenIds, nextReopenIds: [] };
}

/**
 * Request-scope for originals: current_upload ∪ explicit_reopen only.
 * Past activeAttachmentIds never authorize document_ids on the wire.
 */
export function resolveOneShotAttachmentRequestScope({
  currentTurnDocumentIds = null,
  explicitReopenDocumentIds = null,
} = {}) {
  const authority = resolveOriginalByteDeliveryAuthority({
    currentTurnDocumentIds,
    explicitReopenDocumentIds,
  });
  const contract = resolveAttachDocumentIdContract({
    documentIds: authority.deliveryIds,
  });
  return {
    currentTurnDocumentIds: listAttachedDocumentIds(currentTurnDocumentIds),
    explicitReopenDocumentIds: listAttachedDocumentIds(explicitReopenDocumentIds),
    documentId: contract.documentId,
    documentIds: contract.documentIds.length
      ? contract.documentIds
      : contract.documentId
        ? [contract.documentId]
        : [],
    deliveryReason: authority.reason,
    // Past active is not original-delivery authority.
    attachmentReferenceEnabled: false,
    activeAttachmentIds: [],
  };
}
