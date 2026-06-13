/**
 * PR-C3 unit tests — Live Gate, row filter, persist mapper, bridge identification (no Supabase).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  COVERAGE_SHEET_EXTRACTOR_ORIGIN,
  COVERAGE_SHEET_RECORD_KIND,
  countCoverageSheetBridgePolicies,
  isCoverageSheetBridgePolicy,
} from "../server/coverageSheetBridge.js";
import {
  evaluateCoverageSheetLiveGate,
  filterPassingSheetRows,
  isCoverageSheetLiveGateEnabled,
  isPassingSheetRow,
} from "../server/coverageSheetLiveGate.js";
import { extractCoverageSheetFromOcrText } from "../server/coverageSheetExtractor.js";
import {
  buildCoverageSummaryFromSheetRow,
  buildPolicyRowFromSheetRow,
  buildSheetUploadExtractKey,
  resolveExistingSheetPolicyForRow,
} from "../server/coverageSheetPersist.js";
import { buildUploadExtractKey } from "../server/documentPolicyUploadPersist.js";
import { buildCoverageGapInputFromMemory } from "../server/coverageGapInputBuilder.js";
import { isCoverageSheetBridgePolicy as isBridgeFromUnified } from "../server/unifiedCustomerState.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pipelineSource = readFileSync(join(__dirname, "../server/documentPolicyExtractionPipeline.js"), "utf8");
const persistSource = readFileSync(join(__dirname, "../server/coverageSheetPersist.js"), "utf8");

const l1ProductionSample = `
SUCCESS
김진우
기준담보/권장금액
(1)
메리츠화재
(2)
메리츠화재
(3)
메리츠화재
(4)
메리츠화재
건강보험(II)2306
208,330원
92,490원
18,110원
37,210원
`;

const unknownAmountSample = `
SUCCESS
기준담보/권장금액
(1)
메리츠화재
(2)
메리츠화재
12345
99999
`;

const documentId = "doc-pr-c3-test-0001";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runCase(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
    return true;
  } catch (error) {
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

console.log("coverage-sheet-live-gate-unit-test");

let passed = 0;
let failed = 0;

const tests = [
  ["live gate disabled by default", () => {
    assert(!isCoverageSheetLiveGateEnabled({}), "COVERAGE_SHEET_LIVE_GATE should default off");
    assert(!isCoverageSheetLiveGateEnabled({ COVERAGE_SHEET_LIVE_GATE: "0" }), "0 is off");
    assert(isCoverageSheetLiveGateEnabled({ COVERAGE_SHEET_LIVE_GATE: "1" }), "1 is on");
  }],
  ["L1 sample passes document gate", () => {
    const sheet = extractCoverageSheetFromOcrText(l1ProductionSample);
    const gate = evaluateCoverageSheetLiveGate(sheet);
    assert(gate.pass, `expected gate pass, got ${gate.blocked_reason}`);
    assert(gate.passing_row_count >= 1, "passing_row_count required");
    assert(gate.criteria === "DOC_PASS-L1-V1+ROW+HIGH", "criteria mismatch");
  }],
  ["non-L1 sample fails gate", () => {
    const sheet = extractCoverageSheetFromOcrText("보험증권\n삼성생명\n월보험료 45000원");
    const gate = evaluateCoverageSheetLiveGate(sheet);
    assert(!gate.pass, "non-L1 must fail gate");
    assert(gate.blocked_reason, "blocked_reason required");
  }],
  ["unknown amount rows excluded from persist candidates", () => {
    const sheet = extractCoverageSheetFromOcrText(unknownAmountSample);
    const passing = filterPassingSheetRows(sheet.rows);
    assert(passing.length === 0, `expected 0 passing rows, got ${passing.length}`);
    const gate = evaluateCoverageSheetLiveGate(sheet);
    assert(!gate.pass || gate.passing_row_count === 0, "gate must block empty passing rows");
  }],
  ["isPassingSheetRow rejects missing amount", () => {
    assert(!isPassingSheetRow({ insurer_name: "메리츠화재", amount_value: null, amount_unit: "won" }), "amount missing");
    assert(!isPassingSheetRow({ insurer_name: "메리츠화재", amount_value: 100, amount_unit: "unknown" }), "unknown unit");
    assert(isPassingSheetRow({ insurer_name: "메리츠화재", amount_value: 100, amount_unit: "won" }), "valid row");
  }],
  ["persist mapper sets required bridge identifiers", () => {
    const row = {
      row_index: 2,
      insurer_name: "메리츠화재",
      product_name: null,
      amount_value: 92490,
      amount_unit: "won",
      amount_text: "92,490원",
      warnings: [],
    };
    const summary = buildCoverageSummaryFromSheetRow(documentId, row);
    assert(summary.extractor_origin === COVERAGE_SHEET_EXTRACTOR_ORIGIN, "extractor_origin missing");
    assert(summary.record_kind === COVERAGE_SHEET_RECORD_KIND, "record_kind missing");
    assert(summary.sheet_row_index === 2, "sheet_row_index missing");
    assert(summary.source_document_id === documentId, "source_document_id missing");
    assert(summary.upload_extract_key.includes("|sheet|"), "sheet key namespace required");

    const policyRow = buildPolicyRowFromSheetRow("cust-1", documentId, row);
    assert(policyRow.source === "upload_extract", "source column must stay upload_extract");
    assert(isCoverageSheetBridgePolicy(policyRow), "persisted row must be bridge-identifiable");
  }],
  ["sheet upload_extract_key namespace differs from cert", () => {
    const sheetKey = buildSheetUploadExtractKey(documentId, {
      row_index: 0,
      insurer_name: "메리츠화재",
      amount_value: 208330,
    });
    const certKey = buildUploadExtractKey(documentId, {
      insurer_name: "메리츠화재",
      product_name: "건강보험",
      policy_number: "",
      monthly_premium: 45000,
    });
    assert(sheetKey.includes("|sheet|"), "sheet namespace required");
    assert(!certKey.includes("|sheet|"), "cert key must not use sheet namespace");
    assert(sheetKey !== certKey, "keys must differ");
  }],
  ["resolveExistingSheetPolicyForRow matches upload_extract_key", () => {
    const row = { row_index: 1, insurer_name: "메리츠화재", amount_value: 92490 };
    const key = buildSheetUploadExtractKey(documentId, row);
    const existingRows = [
      {
        id: "policy-existing",
        is_active: true,
        coverage_summary: { source_document_id: documentId, upload_extract_key: key },
      },
    ];
    const resolved = resolveExistingSheetPolicyForRow(existingRows, documentId, row, 1);
    assert(resolved.row?.id === "policy-existing", "existing sheet row should resolve");
  }],
  ["UnifiedState and Gap input expose bridge flags without filtering", () => {
    const bridgePolicy = buildPolicyRowFromSheetRow("cust-1", documentId, {
      row_index: 0,
      insurer_name: "메리츠화재",
      amount_value: 208330,
      amount_unit: "won",
    });
    bridgePolicy.id = "bridge-policy-1";
    const certPolicy = {
      id: "cert-policy-1",
      insurer_name: "삼성생명",
      product_name: "실손",
      coverage_summary: { extractor_version: "step4-ocr-policy-v3-multi" },
      is_active: true,
    };
    const policies = [bridgePolicy, certPolicy];
    assert(countCoverageSheetBridgePolicies(policies) === 1, "bridge count should be 1");
    assert(isBridgeFromUnified(bridgePolicy), "unified helper should detect bridge");

    const gapInput = buildCoverageGapInputFromMemory({ snapshot: { customer_id: "cust-1" }, policies });
    const bridgeHolding = gapInput.insurance_holdings.find((h) => h.policy_id === "bridge-policy-1");
    assert(bridgeHolding?.is_coverage_sheet_bridge === true, "gap holdings bridge flag");
    assert(bridgeHolding?.extractor_origin === COVERAGE_SHEET_EXTRACTOR_ORIGIN, "gap holdings extractor_origin");
    assert(gapInput.insurance_holdings.length === 2, "PR-C3 must not filter holdings count");
  }],
  ["pipeline S1 branch does not read shadow metadata for persist", () => {
    assert(!persistSource.includes("coverage_sheet_shadow"), "persist must not reference shadow metadata");
    assert(pipelineSource.includes("runCoverageSheetLiveGateExtraction"), "live gate extraction path required");
    assert(pipelineSource.includes("isCoverageSheetLiveGateEnabled"), "feature flag gate required");
    assert(!pipelineSource.includes("metadata_json.coverage_sheet_shadow"), "must not persist from shadow metadata");
    assert(pipelineSource.includes("extractPoliciesFromOcrText(ocrText)"), "cert path preserved for non-gate flow");
  }],
  ["sheet live gate path skips cert parser when flag on", () => {
    const gateBranch = pipelineSource.slice(
      pipelineSource.indexOf("isCoverageSheetLiveGateEnabled(env)"),
      pipelineSource.indexOf("const multiExtraction = extractPoliciesFromOcrText"),
    );
    assert(gateBranch.includes("runCoverageSheetLiveGateExtraction"), "early return to sheet path");
    assert(!gateBranch.includes("extractPoliciesFromOcrText"), "cert parser must not run in gate branch");
  }],
];

for (const [name, fn] of tests) {
  if (runCase(name, fn)) passed += 1;
  else failed += 1;
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
