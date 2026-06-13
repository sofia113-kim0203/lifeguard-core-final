/**
 * Coverage sheet bridge row identifiers — shared across persist, UnifiedState, and engines.
 * PR-C3: persist always sets these fields; downstream may filter in a follow-up PR.
 */
export const COVERAGE_SHEET_EXTRACTOR_ORIGIN = "coverage_sheet_l1";
export const COVERAGE_SHEET_RECORD_KIND = "coverage_sheet_row";

export function isCoverageSheetBridgePolicy(policy = {}) {
  const coverage = policy?.coverage_summary;
  if (!coverage || typeof coverage !== "object") return false;
  return coverage.extractor_origin === COVERAGE_SHEET_EXTRACTOR_ORIGIN;
}

export function countCoverageSheetBridgePolicies(policies = []) {
  return (policies ?? []).filter(isCoverageSheetBridgePolicy).length;
}

export function extractCoverageSheetBridgePolicyIds(policies = []) {
  return (policies ?? [])
    .filter(isCoverageSheetBridgePolicy)
    .map((policy) => String(policy.id))
    .sort();
}
