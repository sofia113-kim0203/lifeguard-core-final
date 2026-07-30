/**
 * Ordered document_id list for home KEY attach (single + multi).
 * Preserves caller order. Does not invent or silently drop duplicates.
 */

/** @param {unknown} value */
export function listAttachedDocumentIds(value = null) {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.map((id) => String(id ?? "").trim()).filter(Boolean);
  }
  if (typeof value === "object") {
    const fromArray = Array.isArray(value.documentIds)
      ? value.documentIds
      : Array.isArray(value.document_ids)
        ? value.document_ids
        : null;
    if (fromArray) {
      return fromArray.map((id) => String(id ?? "").trim()).filter(Boolean);
    }
    const single = String(value.documentId ?? value.document_id ?? "").trim();
    return single ? [single] : [];
  }
  const single = String(value).trim();
  return single ? [single] : [];
}

/**
 * Resolve primary document_id + ordered document_ids for request/API.
 * - 0 → null / []
 * - 1 → documentId only (documentIds empty for wire compat)
 * - 2+ → documentId = first, documentIds = full ordered list
 */
export function resolveAttachDocumentIdContract({
  documentId = null,
  documentIds = null,
  document_id = null,
  document_ids = null,
} = {}) {
  const fromMulti = listAttachedDocumentIds(documentIds ?? document_ids);
  const ids =
    fromMulti.length > 0
      ? fromMulti
      : listAttachedDocumentIds(documentId ?? document_id);
  if (ids.length === 0) {
    return { documentId: null, documentIds: [] };
  }
  if (ids.length === 1) {
    return { documentId: ids[0], documentIds: [] };
  }
  return { documentId: ids[0], documentIds: ids };
}
