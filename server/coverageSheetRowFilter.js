/**
 * Row-level PASS filter for coverage sheet L1 rows (shared by shadow gate and live persist).
 * Valid policy ≠ has premium: carrier + premium slot (including 미제공) can persist without amount_value.
 */

function normalizeIdentification(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function hasSheetRowPolicyIdentification(row) {
  return Boolean(
    normalizeIdentification(row?.product_name) ||
      normalizeIdentification(row?.coverage_name) ||
      normalizeIdentification(row?.policy_number),
  );
}

export function hasSheetRowPremiumUnavailableSlot(row) {
  return row?.amount_unit === "premium_unavailable";
}

export function hasSheetRowResolvablePremium(row) {
  if (!row?.insurer_name) return false;
  if (row.amount_value == null) return false;
  const unit = row.amount_unit;
  if (!unit || unit === "unknown" || unit === "indemnity" || unit === "premium_unavailable") {
    return false;
  }
  return true;
}

export function isPassingSheetRow(row) {
  if (!row?.insurer_name) return false;
  return (
    hasSheetRowResolvablePremium(row) ||
    hasSheetRowPremiumUnavailableSlot(row) ||
    hasSheetRowPolicyIdentification(row)
  );
}
export function filterPassingSheetRows(rows = []) {
  return (rows ?? []).filter(isPassingSheetRow);
}
