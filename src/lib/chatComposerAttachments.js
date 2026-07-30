/**
 * Pure helpers for multi-file chat composer attach chips.
 * Order preserved. Failed uploads are never appended by callers.
 */

/** @typedef {{ documentId: string, filename: string, previewUrl?: string, mime?: string|null, isImage?: boolean }} ChatComposerAttachment */

/** @param {ChatComposerAttachment[]} prev @param {ChatComposerAttachment} item */
export function appendChatComposerAttachment(prev = [], item = null) {
  const documentId = String(item?.documentId ?? "").trim();
  if (!documentId) return Array.isArray(prev) ? [...prev] : [];
  const next = {
    documentId,
    filename: String(item?.filename ?? "파일").trim() || "파일",
    previewUrl: String(item?.previewUrl ?? "").trim(),
    mime: item?.mime != null ? String(item.mime).trim() || null : null,
    isImage: item?.isImage === true,
  };
  return [...(Array.isArray(prev) ? prev : []), next];
}

/** @param {ChatComposerAttachment[]} prev @param {string} documentId */
export function removeChatComposerAttachment(prev = [], documentId = "") {
  const did = String(documentId ?? "").trim();
  if (!did) return Array.isArray(prev) ? [...prev] : [];
  return (Array.isArray(prev) ? prev : []).filter(
    (row) => String(row?.documentId ?? "").trim() !== did,
  );
}

/** @param {ChatComposerAttachment[]} attachments */
export function listChatComposerDocumentIds(attachments = []) {
  return (Array.isArray(attachments) ? attachments : [])
    .map((row) => String(row?.documentId ?? "").trim())
    .filter(Boolean);
}

/** @param {ChatComposerAttachment[]} attachments */
export function formatChatComposerAttachLabel(attachments = []) {
  const names = (Array.isArray(attachments) ? attachments : [])
    .map((row) => String(row?.filename ?? "").trim())
    .filter(Boolean);
  return names.join(", ");
}

/** Revoke object URLs from removed/cleared composer rows. */
export function revokeChatComposerPreviewUrls(attachments = []) {
  for (const row of Array.isArray(attachments) ? attachments : []) {
    const url = String(row?.previewUrl ?? "").trim();
    if (url.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    }
  }
}

/** Shallow-copy composer attach rows for a send-turn snapshot (order preserved). */
export function snapshotChatComposerAttachments(attachments = []) {
  return (Array.isArray(attachments) ? attachments : [])
    .map((row) => {
      const documentId = String(row?.documentId ?? "").trim();
      if (!documentId) return null;
      return {
        documentId,
        filename: String(row?.filename ?? "파일").trim() || "파일",
        previewUrl: String(row?.previewUrl ?? "").trim(),
        mime: row?.mime != null ? String(row.mime).trim() || null : null,
        isImage: row?.isImage === true,
      };
    })
    .filter(Boolean);
}

/**
 * On send failure: put failed-turn attaches first, then any composer rows added
 * while the request was in flight. Does not dedupe identical picks.
 */
export function restoreChatComposerAttachmentsOnFailure(
  failedTurnAttachments = [],
  currentComposerAttachments = [],
) {
  const failed = snapshotChatComposerAttachments(failedTurnAttachments);
  const current = snapshotChatComposerAttachments(currentComposerAttachments);
  return [...failed, ...current];
}
