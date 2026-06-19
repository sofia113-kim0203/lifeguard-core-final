/**
 * Unit tests for L1 coverage sheet extractor (shadow only, no Supabase).
 */
import { extractPoliciesFromOcrText, segmentOcrIntoPolicyBlocks } from "../server/documentPolicyExtractor.js";
import {
  analyzeLayoutFeatures,
  detectL1Layout,
  evaluatePassL1V1,
  extractCoverageSheetFromOcrText,
  isCoverageAnalysisSheetDocument,
  parseAmountLine,
  PASS_CRITERIA_ID,
} from "../server/coverageSheetExtractor.js";
import {
  buildCoverageSheetShadowMetadata,
  buildMetadataPatchWithShadow,
  runShadowCoverageSheet,
} from "../server/policyExtractionShadow.js";

const l1ProductionSample = `
SUCCESS
김진우
김진우
2026.06.13
13:28:40
기준담보/권장금액
기본형(37개)/표준형
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

const nonL1CertificateSample = `
보험증권
보험사: 삼성생명
상품명: 실손의료비보험
월 보험료: 45,000원
`;

const nonL1TableSample = `
보장분석
보험사 상품명 가입금액
삼성생명 실손의료비 3,000만원
한화생명 암보험 5,000만원
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

const certificateSample = `
보험증권
보험사: 삼성생명
상품명: 실손의료비보험
월 보험료: 45,000원
증권번호: AB1234567890
`;

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

console.log("coverage-sheet-extractor-unit-test");

let passed = 0;
let failed = 0;

const tests = [
  ["isCoverageAnalysisSheetDocument detects document_type", () => {
    assert(
      isCoverageAnalysisSheetDocument({ document_type: "coverage_analysis_sheet" }),
      "document_type should match",
    );
    assert(
      !isCoverageAnalysisSheetDocument({ document_type: "insurance_certificate" }),
      "certificate should not match",
    );
  }],
  ["L1 layout features detected on production sample", () => {
    const lines = l1ProductionSample.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const features = analyzeLayoutFeatures(lines);
    assert(features.carrier_only_lines >= 2, `carrier_only_lines=${features.carrier_only_lines}`);
    assert(features.amount_lines >= 1, `amount_lines=${features.amount_lines}`);
    assert(features.labeled_product_lines === 0, `labeled_product_lines=${features.labeled_product_lines}`);
    assert(features.multi_field_rows === 0, `multi_field_rows=${features.multi_field_rows}`);
    assert(detectL1Layout(features), "expected L1 layout");
  }],
  ["certificate parser still splits L1 sample (carrier split regression baseline)", () => {
    const segmentation = segmentOcrIntoPolicyBlocks(l1ProductionSample);
    assert(segmentation.blocks_detected >= 2, `blocks_detected=${segmentation.blocks_detected}`);
  }],
  ["sheet extractor does not use carrier split and returns rows", () => {
    const result = extractCoverageSheetFromOcrText(l1ProductionSample);
    assert(result.layout === "L1_mobile_ga_stack", `layout=${result.layout}`);
    assert(result.row_count >= 1, `row_count=${result.row_count}`);
    assert(!result.warnings.includes("NON_L1_LAYOUT"), `warnings=${result.warnings.join(",")}`);
    assert(result.rows[0].insurer_name === "메리츠화재", `insurer=${result.rows[0].insurer_name}`);
    assert(result.rows[0].amount_value === 208330, `amount_value=${result.rows[0].amount_value}`);
    assert(result.rows[0].amount_unit === "won", `amount_unit=${result.rows[0].amount_unit}`);
  }],
  ["PASS-L1-V1 passes on L1 production sample", () => {
    const result = extractCoverageSheetFromOcrText(l1ProductionSample);
    assert(result.pass_l1_v1 === true, "pass_l1_v1 should be true");
    assert(result.pass_criteria === PASS_CRITERIA_ID, "pass criteria id");
    assert(result.confidence === "high", `confidence=${result.confidence}`);
    const passState = evaluatePassL1V1(result.rows);
    assert(passState.pass, "evaluatePassL1V1");
    assert(passState.passing_row_count >= 1, `passing_row_count=${passState.passing_row_count}`);
  }],
  ["amount_unit parsing won/manwon/eok/indemnity/premium_unavailable", () => {
    assert(parseAmountLine("208,330원").amount_unit === "won", "won");
    assert(parseAmountLine("3,000만원").amount_unit === "manwon", "manwon");
    assert(parseAmountLine("1억원").amount_unit === "eok", "eok");
    assert(parseAmountLine("실손의료비").amount_unit === "indemnity", "indemnity");
    assert(parseAmountLine("보험료미제공").amount_unit === "premium_unavailable", "premium_unavailable");
    assert(parseAmountLine("보험료미제공").amount_value == null, "premium_unavailable value null");
  }],
  ["NON_L1_LAYOUT guard blocks certificate-style sample", () => {
    const result = extractCoverageSheetFromOcrText(nonL1CertificateSample);
    assert(result.confidence === "low", `confidence=${result.confidence}`);
    assert(result.warnings.includes("NON_L1_LAYOUT"), `warnings=${result.warnings.join(",")}`);
    assert(result.row_count === 0, `row_count=${result.row_count}`);
  }],
  ["NON_L1_LAYOUT guard blocks inline table sample", () => {
    const result = extractCoverageSheetFromOcrText(nonL1TableSample);
    assert(result.warnings.includes("NON_L1_LAYOUT"), `warnings=${result.warnings.join(",")}`);
    assert(result.row_count === 0, `row_count=${result.row_count}`);
  }],
  ["unknown amount_unit triggers warning and fails PASS-L1-V1", () => {
    const result = extractCoverageSheetFromOcrText(unknownAmountSample);
    assert(result.layout === "L1_mobile_ga_stack", `layout=${result.layout}`);
    assert(result.warnings.includes("UNKNOWN_AMOUNT_UNIT_PRESENT"), `warnings=${result.warnings.join(",")}`);
    assert(result.warnings.includes("MANUAL_REVIEW_CANDIDATE"), "manual review warning");
    assert(result.pass_l1_v1 === false, "pass_l1_v1 should be false when unknown unit present");
    const unknownRow = result.rows.find((row) => row.warnings.includes("UNKNOWN_AMOUNT_UNIT"));
    assert(unknownRow, "unknown amount row expected");
  }],
  ["shadow metadata has no DOC_OVER_SPLIT", () => {
    const sheetExtraction = extractCoverageSheetFromOcrText(l1ProductionSample);
    const shadowState = runShadowCoverageSheet({
      sheetExtraction,
      document: { document_type: "coverage_analysis_sheet", metadata_json: { category_key: "coverage_analysis_sheet" } },
    });
    const record = buildCoverageSheetShadowMetadata(
      sheetExtraction,
      { document_type: "coverage_analysis_sheet", metadata_json: { category_key: "coverage_analysis_sheet" } },
      { doc_class: "coverage_analysis_sheet" },
    );
    assert(record.shadow_mode === true, "shadow_mode");
    assert(record.row_count >= 1, `row_count=${record.row_count}`);
    assert(!record.document_flags.includes("DOC_OVER_SPLIT"), `flags=${record.document_flags.join(",")}`);
    const patch = buildMetadataPatchWithShadow({ policy_extraction_status: "pending_manual_review" }, shadowState, null);
    assert(patch.coverage_sheet_shadow, "coverage_sheet_shadow patch");
    assert(!patch.policy_validation, "certificate policy_validation must not be written for sheet shadow");
  }],
  ["insurance_certificate parser regression unchanged", () => {
    const multi = extractPoliciesFromOcrText(certificateSample);
    assert(multi.policy_count >= 1, `policy_count=${multi.policy_count}`);
    assert(multi.policies[0].fields.insurer_name === "삼성생명", `insurer=${multi.policies[0].fields.insurer_name}`);
    assert(multi.policies[0].fields.product_name, "product_name required");
  }],
];

for (const [name, fn] of tests) {
  if (runCase(name, fn)) passed += 1;
  else failed += 1;
}

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
