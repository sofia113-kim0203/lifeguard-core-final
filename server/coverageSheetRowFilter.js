/**
 * Row-level PASS filter for coverage sheet L1 rows (shared by shadow gate and live persist).
 */
export function isPassingSheetRow(row) {
  return Boolean(
    row?.insurer_name &&
      row?.amount_value != null &&
      row?.amount_unit &&
      row.amount_unit !== "unknown",
  );
}

export function filterPassingSheetRows(rows = []) {
  return (rows ?? []).filter(isPassingSheetRow);
}
