/**
 * PR-C3 — document-level Live Gate and row-level filter for coverage analysis sheets.
 */
import { filterPassingSheetRows, isPassingSheetRow } from "./coverageSheetRowFilter.js";

export { filterPassingSheetRows, isPassingSheetRow };

export function isCoverageSheetLiveGateEnabled(env = process.env) {
  const raw = String(env.COVERAGE_SHEET_LIVE_GATE ?? "0").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
}

function deriveBlockedReason(sheetExtraction) {
  if (!sheetExtraction) return "SHEET_EXTRACTION_MISSING";
  if (sheetExtraction.pass_l1_v1 !== true) return "PASS_L1_V1_FAILED";
  if ((sheetExtraction.row_count ?? 0) < 1) return "ROW_COUNT_EMPTY";
  if (sheetExtraction.confidence !== "high") return "CONFIDENCE_NOT_HIGH";
  const passingRows = filterPassingSheetRows(sheetExtraction.rows);
  if (passingRows.length === 0) return "ROW_LEVEL_PASS_EMPTY";
  return "UNKNOWN_BLOCK";
}

export function evaluateCoverageSheetLiveGate(sheetExtraction) {
  const passingRows = filterPassingSheetRows(sheetExtraction?.rows ?? []);
  const docGatePass =
    sheetExtraction?.pass_l1_v1 === true &&
    (sheetExtraction?.row_count ?? 0) >= 1 &&
    sheetExtraction?.confidence === "high";
  const pass = docGatePass && passingRows.length >= 1;

  return {
    pass,
    criteria: "DOC_PASS-L1-V1+ROW+HIGH",
    pass_l1_v1: Boolean(sheetExtraction?.pass_l1_v1),
    row_count: sheetExtraction?.row_count ?? 0,
    passing_row_count: passingRows.length,
    confidence: sheetExtraction?.confidence ?? null,
    layout: sheetExtraction?.layout ?? null,
    warnings: sheetExtraction?.warnings ?? [],
    blocked_reason: pass ? null : deriveBlockedReason({ ...sheetExtraction, rows: sheetExtraction?.rows }),
  };
}
