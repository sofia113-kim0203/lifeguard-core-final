/**
 * PR-D1 — Retire profile_insurance_policies rows when source document is soft-deleted.
 * Shared contract for SQL RPC parity and unit tests.
 */

export const RETIRE_REASON_SOURCE_DOCUMENT_DELETED = "source_document_deleted";
export const RETIRE_REASON_SUPERSEDED_BY_REEXTRACT = "superseded_by_reextract";

export function isActivePolicyRow(row = {}) {
  return row.is_active !== false;
}

export function matchesSourceDocumentPolicyRow(row = {}, documentId) {
  const coverage = row.coverage_summary;
  if (!coverage || typeof coverage !== "object") return false;
  return String(coverage.source_document_id ?? "").trim() === String(documentId ?? "").trim();
}

export function buildRetiredCoverageSummary(existing = {}, retiredReason) {
  return {
    ...(existing ?? {}),
    retired_at: new Date().toISOString(),
    retired_reason: retiredReason,
  };
}

export function planPolicyIdsToRetireForSourceDocumentDelete(policies = [], documentId) {
  return (policies ?? [])
    .filter(isActivePolicyRow)
    .filter((row) => matchesSourceDocumentPolicyRow(row, documentId))
    .map((row) => row.id);
}

export function buildPolicyRetireUpdateRow(existingRow = {}, retiredReason = RETIRE_REASON_SOURCE_DOCUMENT_DELETED) {
  return {
    is_active: false,
    coverage_summary: buildRetiredCoverageSummary(existingRow.coverage_summary ?? {}, retiredReason),
    updated_at: new Date().toISOString(),
  };
}
