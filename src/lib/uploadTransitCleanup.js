/**
 * Upload is a one-shot transit into the document vault.
 * After store success: discard File/preview/UI authority; keep only pending document_ids
 * for the next chat send (one-shot), then consume to empty.
 */

import {
  listChatComposerDocumentIds,
  revokeChatComposerPreviewUrls,
  snapshotChatComposerAttachments,
} from "./chatComposerAttachments.js";
import { listAttachedDocumentIds } from "./homeBrainAttachDocumentIds.js";

export function createEmptyPendingDocumentDelivery() {
  return {
    documentIds: [],
    filenames: [],
    mimes: [],
  };
}

export function createEmptyUploadTransitSnapshot() {
  return {
    composerAttachments: [],
    pendingDelivery: createEmptyPendingDocumentDelivery(),
    activeAttachmentIds: [],
    activeAttachmentId: null,
    restorableCandidate: null,
    attachHint: "",
    selectedFileCount: 0,
  };
}

/**
 * After vault store success — arm document_ids only (no File / preview / base64).
 */
export function armPendingDocumentDeliveryAfterStore(
  prev = null,
  storedRows = [],
) {
  const base =
    prev && typeof prev === "object"
      ? prev
      : createEmptyPendingDocumentDelivery();
  const ids = listAttachedDocumentIds(base.documentIds);
  const filenames = Array.isArray(base.filenames) ? base.filenames.slice() : [];
  const mimes = Array.isArray(base.mimes) ? base.mimes.slice() : [];
  const seen = new Set(ids);

  for (const row of Array.isArray(storedRows) ? storedRows : []) {
    const id = String(row?.documentId ?? row?.document_id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    filenames.push(String(row?.filename ?? row?.original_filename ?? "파일").trim() || "파일");
    mimes.push(
      row?.mime != null
        ? String(row.mime).trim() || null
        : row?.mime_type != null
          ? String(row.mime_type).trim() || null
          : null,
    );
  }
  return { documentIds: ids, filenames, mimes };
}

/** Consume pending ids for one chat send; returns empty next state. */
export function consumePendingDocumentDelivery(pending = null) {
  const src =
    pending && typeof pending === "object"
      ? pending
      : createEmptyPendingDocumentDelivery();
  const documentIds = listAttachedDocumentIds(src.documentIds);
  const filenames = Array.isArray(src.filenames)
    ? src.filenames.slice(0, documentIds.length)
    : [];
  const mimes = Array.isArray(src.mimes) ? src.mimes.slice(0, documentIds.length) : [];
  return {
    deliveryIds: documentIds,
    filenames,
    mimes,
    label: filenames.filter(Boolean).join(", "),
    nextPending: createEmptyPendingDocumentDelivery(),
  };
}

/**
 * Discard composer transit rows: revoke blob previews, return [].
 * Does not delete vault documents.
 */
export function discardComposerUploadTransit(attachments = []) {
  const snap = snapshotChatComposerAttachments(attachments);
  revokeChatComposerPreviewUrls(snap);
  return [];
}

export function countPreviewUrls(attachments = []) {
  return (Array.isArray(attachments) ? attachments : []).filter((row) =>
    String(row?.previewUrl ?? "").trim(),
  ).length;
}

export function buildUploadTransitCleanupTrace({
  documentStoreCommitted = false,
  before = null,
  after = null,
  objectUrlsRevoked = 0,
  nextTurnOriginalCount = 0,
} = {}) {
  const b = before && typeof before === "object" ? before : {};
  const a = after && typeof after === "object" ? after : {};
  return {
    document_store_committed: documentStoreCommitted === true,
    raw_file_count_before: Number(b.raw_file_count) || 0,
    raw_file_count_after: Number(a.raw_file_count) || 0,
    preview_count_before: Number(b.preview_count) || 0,
    preview_count_after: Number(a.preview_count) || 0,
    client_attachment_id_count_after:
      Number(a.client_attachment_id_count) ||
      listChatComposerDocumentIds(a.composerAttachments).length ||
      0,
    current_upload_document_id_count_after:
      Number(a.current_upload_document_id_count) ||
      listAttachedDocumentIds(a.pendingDelivery?.documentIds).length ||
      0,
    object_urls_revoked: Number(objectUrlsRevoked) || 0,
    next_turn_original_count: Number(nextTurnOriginalCount) || 0,
  };
}

/**
 * Post-store cleanup decision (pure): UI/authority all zero; optional pending ids kept
 * only until consumed by the next send.
 */
export function planUploadTransitCleanupAfterDocumentStore({
  composerAttachments = [],
  storedRows = [],
  priorPending = null,
  keepPendingDeliveryForNextSend = true,
} = {}) {
  const previewBefore = countPreviewUrls(composerAttachments);
  const rawBefore = Array.isArray(composerAttachments)
    ? composerAttachments.length
    : 0;
  const pending = keepPendingDeliveryForNextSend
    ? armPendingDocumentDeliveryAfterStore(priorPending, storedRows)
    : createEmptyPendingDocumentDelivery();
  const clearedComposer = discardComposerUploadTransit(composerAttachments);
  const after = {
    raw_file_count: 0,
    preview_count: 0,
    composerAttachments: clearedComposer,
    pendingDelivery: pending,
    // UI / client attachment authority — must be 0 after store cleanup.
    client_attachment_id_count: 0,
    current_upload_document_id_count: 0,
  };
  const trace = {
    ...buildUploadTransitCleanupTrace({
      documentStoreCommitted: true,
      before: {
        raw_file_count: rawBefore,
        preview_count: previewBefore,
      },
      after,
      objectUrlsRevoked: previewBefore,
      nextTurnOriginalCount: 0,
    }),
    // Internal one-shot arm only (not UI upload state; consumed on next chat send).
    pending_delivery_document_id_count: pending.documentIds.length,
  };
  return {
    composerAttachments: clearedComposer,
    pendingDelivery: pending,
    activeAttachmentIds: [],
    activeAttachmentId: null,
    restorableCandidate: null,
    attachHint: "",
    trace,
  };
}

/** After pending delivery consumed for a send — all transit counts must be 0. */
export function planUploadTransitAfterDeliveryConsumed(pendingAfterConsume = null) {
  const pending =
    pendingAfterConsume && typeof pendingAfterConsume === "object"
      ? pendingAfterConsume
      : createEmptyPendingDocumentDelivery();
  return buildUploadTransitCleanupTrace({
    documentStoreCommitted: true,
    before: { raw_file_count: 0, preview_count: 0 },
    after: {
      raw_file_count: 0,
      preview_count: 0,
      client_attachment_id_count: 0,
      current_upload_document_id_count: listAttachedDocumentIds(pending.documentIds)
        .length,
      pendingDelivery: pending,
    },
    objectUrlsRevoked: 0,
    nextTurnOriginalCount: listAttachedDocumentIds(pending.documentIds).length,
  });
}

/**
 * KEY commit failure after vault store: never revive File/preview/composer authority.
 */
export function planUploadTransitOnMemoryCommitFailure() {
  return {
    reviveComposer: false,
    autoReupload: false,
    restorableCandidate: null,
    claudeWithEmptyMemory: false,
    keepVaultDocumentIds: true,
  };
}
