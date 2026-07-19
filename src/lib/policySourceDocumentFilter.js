/**
 * prior_facts Hand — hide / plan retire of policies whose source document is gone.
 *
 * RLS note: customers cannot SELECT soft-deleted customer_documents (deleted_at IS NULL
 * on SELECT policy). Therefore we never query deleted ids — we keep only policies whose
 * source_document_id is still in the active document set (or has no source link).
 */

/**
 * Read-path filter: keep signup rows (no source_document_id); drop rows whose source
 * document is not in the active (non-deleted) document id set.
 *
 * Fail-closed: null/undefined activeDocumentIds (loader miss) ≡ [] — drop every
 * sourced prior_fact. Never pass sourced policies through unfiltered.
 */
export function filterPoliciesToActiveSourceDocuments(policies = [], activeDocumentIds = null) {
  const active = new Set(
    (Array.isArray(activeDocumentIds) ? activeDocumentIds : [])
      .map((id) => String(id ?? "").trim())
      .filter(Boolean),
  );
  return (Array.isArray(policies) ? policies : []).filter((row) => {
    const summary =
      row?.coverage_summary && typeof row.coverage_summary === "object" ? row.coverage_summary : {};
    const sourceId = String(summary.source_document_id ?? "").trim();
    if (!sourceId) return true;
    return active.has(sourceId);
  });
}

/** @deprecated use filterPoliciesToActiveSourceDocuments — kept for call-site clarity */
export function filterPoliciesExcludingDeletedSourceDocuments(policies = [], deletedDocumentIds = []) {
  const deleted = new Set(
    (Array.isArray(deletedDocumentIds) ? deletedDocumentIds : [])
      .map((id) => String(id ?? "").trim())
      .filter(Boolean),
  );
  if (deleted.size === 0) return Array.isArray(policies) ? policies : [];
  return (Array.isArray(policies) ? policies : []).filter((row) => {
    const summary =
      row?.coverage_summary && typeof row.coverage_summary === "object" ? row.coverage_summary : {};
    const sourceId = String(summary.source_document_id ?? "").trim();
    if (!sourceId) return true;
    return !deleted.has(sourceId);
  });
}

/**
 * Active document ids for prior_facts filter.
 * Fail-closed on miss/error → [] (sourced policies drop; never unfiltered).
 */
export async function loadActiveSourceDocumentIds(customerId, client) {
  const cid = String(customerId ?? "").trim();
  if (!cid || !client) return [];
  try {
    const { data, error } = await client
      .from("customer_documents")
      .select("id")
      .eq("customer_id", cid)
      .is("deleted_at", null);
    if (error) return [];
    return (Array.isArray(data) ? data : [])
      .map((row) => String(row?.id ?? "").trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** @deprecated RLS blocks deleted-doc SELECT; prefer loadActiveSourceDocumentIds */
export async function loadDeletedSourceDocumentIds(customerId, client) {
  const cid = String(customerId ?? "").trim();
  if (!cid || !client) return [];
  const { data, error } = await client
    .from("customer_documents")
    .select("id")
    .eq("customer_id", cid)
    .not("deleted_at", "is", null);
  if (error) return [];
  return (Array.isArray(data) ? data : [])
    .map((row) => String(row?.id ?? "").trim())
    .filter(Boolean);
}
