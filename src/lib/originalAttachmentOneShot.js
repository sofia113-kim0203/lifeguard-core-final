/**
 * KEY original-byte delivery authority — upload this turn or explicit chip reopen only.
 * Past active ids / chart / keywords do not authorize Storage originals.
 *
 * Explicit reopen lifecycle:
 *   armed → in_flight (request start) → consumed (SSE ack)
 *   in_flight + pre-ack failure → armed (retry allowed)
 *   ack after → consumed (no re-arm even if stream fails)
 */

import {
  listAttachedDocumentIds,
  resolveAttachDocumentIdContract,
} from "./homeBrainAttachDocumentIds.js";

export const EXPLICIT_REOPEN_STATUS = Object.freeze({
  IDLE: "idle",
  ARMED: "armed",
  IN_FLIGHT: "in_flight",
  CONSUMED: "consumed",
});

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
  return (
    resolveOriginalByteDeliveryAuthority({
      currentTurnDocumentIds,
      explicitReopenDocumentIds,
    }).deliveryIds.length > 0
  );
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

/** @returns {{ status: string, documentIds: string[], ackReceived: boolean }} */
export function createExplicitReopenOneShot({ documentIds = [] } = {}) {
  const ids = listAttachedDocumentIds(documentIds);
  return {
    status: ids.length ? EXPLICIT_REOPEN_STATUS.ARMED : EXPLICIT_REOPEN_STATUS.IDLE,
    documentIds: ids,
    ackReceived: false,
  };
}

export function armExplicitReopenOneShot(documentIds = []) {
  return createExplicitReopenOneShot({ documentIds });
}

/**
 * Request-start transition. Snapshot ids for the wire; do not permanently delete until ACK.
 * Second concurrent begin while in_flight is rejected (no duplicate wire ids).
 */
export function beginExplicitReopenFlight(state = null) {
  const prev =
    state && typeof state === "object"
      ? state
      : createExplicitReopenOneShot();
  if (prev.status === EXPLICIT_REOPEN_STATUS.IN_FLIGHT) {
    return {
      ok: false,
      reason: "already_in_flight",
      nextState: prev,
      requestSnapshotIds: [],
    };
  }
  const ids = listAttachedDocumentIds(prev.documentIds);
  if (prev.status !== EXPLICIT_REOPEN_STATUS.ARMED || ids.length === 0) {
    return {
      ok: true,
      reason: "no_reopen",
      nextState: {
        status:
          prev.status === EXPLICIT_REOPEN_STATUS.CONSUMED
            ? EXPLICIT_REOPEN_STATUS.CONSUMED
            : EXPLICIT_REOPEN_STATUS.IDLE,
        documentIds: [],
        ackReceived: prev.ackReceived === true,
      },
      requestSnapshotIds: [],
    };
  }
  return {
    ok: true,
    reason: "started",
    nextState: {
      status: EXPLICIT_REOPEN_STATUS.IN_FLIGHT,
      documentIds: ids.slice(),
      ackReceived: false,
    },
    requestSnapshotIds: ids.slice(),
  };
}

/** SSE event: ack — permanently consume (no re-arm on later stream failure). */
export function markExplicitReopenAck(state = null) {
  const prev =
    state && typeof state === "object"
      ? state
      : createExplicitReopenOneShot();
  if (prev.status !== EXPLICIT_REOPEN_STATUS.IN_FLIGHT) {
    return prev;
  }
  return {
    status: EXPLICIT_REOPEN_STATUS.CONSUMED,
    documentIds: [],
    ackReceived: true,
  };
}

/**
 * Failure after request start.
 * Pre-ack → re-arm same ids. Post-ack → stay consumed.
 */
export function resolveExplicitReopenFlightFailure(state = null) {
  const prev =
    state && typeof state === "object"
      ? state
      : createExplicitReopenOneShot();
  if (
    prev.status === EXPLICIT_REOPEN_STATUS.IN_FLIGHT &&
    prev.ackReceived !== true
  ) {
    const ids = listAttachedDocumentIds(prev.documentIds);
    return {
      status: ids.length ? EXPLICIT_REOPEN_STATUS.ARMED : EXPLICIT_REOPEN_STATUS.IDLE,
      documentIds: ids,
      ackReceived: false,
    };
  }
  if (prev.ackReceived === true || prev.status === EXPLICIT_REOPEN_STATUS.CONSUMED) {
    return {
      status: EXPLICIT_REOPEN_STATUS.CONSUMED,
      documentIds: [],
      ackReceived: true,
    };
  }
  return prev;
}

/**
 * Request-body snapshot helper (does not mutate lifecycle).
 * Prefer beginExplicitReopenFlight for send-path authority.
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
