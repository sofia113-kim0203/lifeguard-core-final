/**
 * Rider coverage_summary population — string[] contract + inputBuilder path tests.
 */
import assert from "node:assert/strict";
import { extractPoliciesFromOcrText } from "../server/documentPolicyExtractor.js";
import { analyzeCoverageGaps } from "../server/coverageGapAnalysisEngine.js";
import { buildCoverageGapInputFromMemory } from "../server/coverageGapInputBuilder.js";
import {
  assertRidersStringArray,
  assembleRidersFromCandidate,
  assembleRidersFromSheetRow,
  isEligibleRiderLabel,
} from "../server/coverageRiderPopulation.js";
import {
  buildCoverageSummaryFromSheetRow,
  buildPolicyRowFromSheetRow,
} from "../server/coverageSheetPersist.js";
import {
  buildCoverageSummaryFromCandidate,
  buildPolicyRowFromCandidate,
} from "../server/documentPolicyUploadPersist.js";
import { buildPolicyRiderMemoryFields } from "../server/memoryBuilderRidersSerialize.js";

const documentId = "doc-rider-population-test-0001";
const POLICY_ID = "policy-input-builder-0001";

const report = { phase: "rider-coverage-summary-population", tests: {} };

report.tests.eligibilityGuards = (() => {
  const pass =
    !isEligibleRiderLabel("메리츠화재") &&
    !isEligibleRiderLabel("한화생명") &&
    !isEligibleRiderLabel("건강보험(II)2306") &&
    isEligibleRiderLabel("암진단비") &&
    isEligibleRiderLabel("뇌혈관질환진단비") &&
    isEligibleRiderLabel("급성심근경색진단비") &&
    isEligibleRiderLabel("실손의료비");
  return { pass };
})();

report.tests.sheetRidersStored = (() => {
  const row = {
    row_index: 1,
    insurer_name: "메리츠화재",
    product_name: "건강보험(II)2306",
    coverage_name: "암진단비",
    amount_value: 30000000,
    amount_unit: "won",
    amount_text: "3,000만원",
  };
  const summary = buildCoverageSummaryFromSheetRow(documentId, row);
  const policyRow = buildPolicyRowFromSheetRow("cust-1", documentId, row);

  const pass =
    assertRidersStringArray(summary.riders) &&
    summary.riders.length === 1 &&
    summary.riders[0] === "암진단비" &&
    Array.isArray(summary.rider_details) &&
    summary.rider_details[0].rider_name === "암진단비" &&
    summary.rider_details[0].coverage_amount === 30000000 &&
    !summary.riders.includes("메리츠화재") &&
    !summary.riders.includes("건강보험(II)2306") &&
    assertRidersStringArray(policyRow.coverage_summary.riders);

  return {
    pass,
    riders: summary.riders,
    rider_details: summary.rider_details,
    product_name: summary.product_name,
  };
})();

report.tests.sheetProductNameExcluded = (() => {
  const row = {
    row_index: 0,
    insurer_name: "메리츠화재",
    product_name: "건강보험(II)2306",
    coverage_name: "건강보험(II)2306",
    amount_value: 208330,
    amount_unit: "won",
  };
  const summary = buildCoverageSummaryFromSheetRow(documentId, row);
  const pass = assertRidersStringArray(summary.riders) && summary.riders.length === 0;
  return { pass, riders: summary.riders };
})();

report.tests.certRidersStored = (() => {
  const sample = `
보장분석
삼성생명
상품명: 실손의료비보험
월보험료 45,000원
특약: 암진단비 3,000만원
뇌혈관질환진단비 1,000만원
`;
  const multi = extractPoliciesFromOcrText(sample);
  const samsung = multi.policies.find((policy) => policy.fields.insurer_name === "삼성생명");
  assert.ok(samsung, "samsung candidate required");

  const summary = buildCoverageSummaryFromCandidate(documentId, samsung);
  const pass =
    assertRidersStringArray(summary.riders) &&
    summary.riders.length >= 1 &&
    summary.riders.some((entry) => /암/.test(entry)) &&
    !summary.riders.includes("삼성생명") &&
    !summary.riders.includes("실손의료비보험") &&
    Array.isArray(summary.rider_details) &&
    summary.rider_details.length >= 1;

  return {
    pass,
    riders: summary.riders,
    rider_details_count: summary.rider_details.length,
  };
})();

report.tests.certMergePreservesExisting = (() => {
  const existingSummary = {
    source_document_id: documentId,
    upload_extract_key: "legacy-key",
    riders: ["기존특약진단비"],
    rider_details: [{ rider_name: "기존특약진단비", coverage_amount: 1000, source_kind: "legacy" }],
    policy_number: "OLD-123",
  };
  const candidate = {
    fields: {
      insurer_name: "삼성생명",
      product_name: "실손의료비",
      policy_number: "NEW-456",
      rider_name: "암진단비",
      coverage_amount: 5000000,
    },
    riders: [{ rider_name: "급성심근경색진단비", coverage_amount: 2000000 }],
    confidence: 0.9,
    tier: "full",
  };

  const summary = buildCoverageSummaryFromCandidate(documentId, candidate, existingSummary);

  const pass =
    assertRidersStringArray(summary.riders) &&
    summary.policy_number === "NEW-456" &&
    summary.riders.includes("기존특약진단비") &&
    summary.riders.includes("암진단비") &&
    summary.riders.includes("급성심근경색진단비") &&
    summary.rider_details.some((entry) => entry.rider_name === "기존특약진단비");

  return { pass, riders: summary.riders, policy_number: summary.policy_number };
})();

report.tests.inputBuilderFactValue = (() => {
  const summary = buildCoverageSummaryFromSheetRow(documentId, {
    insurer_name: "메리츠화재",
    product_name: "건강보험",
    coverage_name: "암진단비",
    amount_value: 30000000,
    amount_unit: "won",
  });

  const input = buildCoverageGapInputFromMemory({
    snapshot: { customer_id: "cust-1", facts: [], memory_version: 1 },
    policies: [
      {
        id: POLICY_ID,
        insurer_name: "메리츠화재",
        product_name: "건강보험",
        policy_type: "general",
        monthly_premium: null,
        coverage_summary: summary,
        is_active: true,
      },
    ],
  });

  const policyFact = input.memory_facts.find((fact) => fact.fact_key === `insurance.policy.${POLICY_ID}.coverage_input`);
  assert.ok(policyFact, "coverage_input fact required");

  const pass =
    assertRidersStringArray(summary.riders) &&
    policyFact.fact_value.includes("암진단비") &&
    !policyFact.fact_value.includes("[object Object]") &&
    input.insurance_holdings[0].riders.every((entry) => typeof entry === "string");

  return {
    pass,
    fact_value: policyFact.fact_value,
    riders: summary.riders,
    holdings_riders: input.insurance_holdings[0].riders,
  };
})();

report.tests.riderDetailsDoNotBreakGapContract = (() => {
  const summary = buildCoverageSummaryFromCandidate(documentId, {
    fields: {
      insurer_name: "삼성생명",
      product_name: "실손의료비",
      rider_name: "뇌혈관질환진단비",
      coverage_amount: 10000000,
    },
    riders: [],
    confidence: 0.9,
    tier: "full",
  });

  const input = buildCoverageGapInputFromMemory({
    snapshot: { customer_id: "cust-1", facts: [], memory_version: 1 },
    policies: [
      {
        id: POLICY_ID,
        insurer_name: "삼성생명",
        product_name: "실손의료비",
        policy_type: "indemnity",
        coverage_summary: summary,
        is_active: true,
      },
    ],
  });

  const policyFact = input.memory_facts.find((fact) => fact.fact_key.endsWith(".coverage_input"));
  const analysis = analyzeCoverageGaps({ customer_id: "cust-1", memory: input.memory_facts });
  const brain = analysis.coverage_gaps.find((entry) => entry.coverage_type === "brain");

  const pass =
    assertRidersStringArray(summary.riders) &&
    Array.isArray(summary.rider_details) &&
    summary.rider_details.length >= 1 &&
    policyFact.fact_value.includes("뇌혈관") &&
    !policyFact.fact_value.includes("[object Object]") &&
    brain?.status !== "missing";

  return {
    pass,
    fact_value: policyFact?.fact_value ?? null,
    riders: summary.riders,
    rider_details: summary.rider_details,
    brain_status: brain?.status ?? null,
  };
})();

report.tests.noRidersLeavesUnrecorded = (() => {
  const row = {
    insurer_name: "메리츠화재",
    product_name: "건강보험(II)2306",
    amount_value: 92490,
    amount_unit: "won",
  };
  const summary = buildCoverageSummaryFromSheetRow(documentId, row);
  const { riders, riderSuffix } = buildPolicyRiderMemoryFields(summary);
  const pass =
    assertRidersStringArray(summary.riders) &&
    summary.riders.length === 0 &&
    riderSuffix === "" &&
    riders.status === "unknown";
  return { pass, riders_status: riders.status };
})();

report.tests.memorySerialization = (() => {
  const certRow = buildPolicyRowFromCandidate("cust-1", documentId, {
    fields: {
      insurer_name: "삼성생명",
      product_name: "실손의료비",
      rider_name: "암진단비",
      coverage_amount: 3000000,
    },
    riders: [],
    confidence: 0.9,
    tier: "full",
  });
  const { riders, riderSuffix } = buildPolicyRiderMemoryFields(certRow.coverage_summary);
  const pass =
    assertRidersStringArray(certRow.coverage_summary.riders) &&
    riders.names.length >= 1 &&
    !riderSuffix.includes("[object Object]") &&
    riderSuffix.includes("암진단비");
  return {
    pass,
    rider_suffix: riderSuffix,
    riders: certRow.coverage_summary.riders,
  };
})();

report.allPass = Object.values(report.tests).every((test) => test.pass === true);

console.log(JSON.stringify(report, null, 2));
process.exit(report.allPass ? 0 : 1);
