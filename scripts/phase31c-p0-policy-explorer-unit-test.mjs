/**
 * Phase 31-C-P0 — Policy Explorer display helper verification.
 */
import assert from "node:assert/strict";
import {
  RIDER_UNAVAILABLE_MESSAGE,
  computePolicyExplorerStats,
  formatOcrConfidence,
  formatPolicyPremium,
  formatPolicySource,
  formatPolicyStatus,
  hasStructuredRiders,
  mergePolicyRecords,
} from "../src/lib/policyExplorer.js";

const dashboardPolicies = [
  {
    id: "p1",
    insurer_name: "삼성화재",
    product_name: "실손의료비",
    monthly_premium: 45000,
    policy_type: "health",
    is_active: true,
    policy_status: null,
    source: "upload_extract",
    coverage_summary: {},
  },
  {
    id: "p2",
    insurer_name: "현대해상",
    product_name: "운전자보험",
    monthly_premium: null,
    policy_type: "driver",
    is_active: true,
    source: "signup",
    coverage_summary: { riders: [] },
  },
];

const unifiedPolicies = [
  {
    id: "p1",
    insurer_name: "삼성화재",
    product_name: "실손의료비",
    policy_type: "health",
    is_active: true,
    source: "upload_extract",
  },
];

const merged = mergePolicyRecords(dashboardPolicies, unifiedPolicies);
assert.equal(merged.length, 2);
assert.equal(formatPolicyPremium(merged[0]), "45,000원");
assert.equal(formatPolicyPremium(merged[1]), "확인 필요");
assert.equal(formatPolicySource("upload_extract"), "업로드 문서");
assert.equal(formatPolicyStatus({ is_active: false }), "해지");
assert.equal(formatOcrConfidence({ coverage_summary: { ocr_confidence: 0.82 } }), "82%");
assert.equal(formatOcrConfidence({ source: "signup" }), "확인 필요");
assert.equal(hasStructuredRiders({ coverage_summary: { riders: ["골절진단비"] } }), true);
assert.equal(hasStructuredRiders({ coverage_summary: { riders: [] } }), false);

const stats = computePolicyExplorerStats(merged);
assert.equal(stats.totalCount, 2);
assert.equal(stats.premiumKnownCount, 1);
assert.equal(stats.premiumUnknownCount, 1);
assert.equal(stats.riderStructuredCount, 0);
assert.equal(stats.premiumTotal, 45000);

assert.match(RIDER_UNAVAILABLE_MESSAGE, /특약 정보가 구조화되지 않았습니다/);

function l1SidecarPolicy(amountValue, id = "l1") {
  return {
    id,
    insurer_name: "KB손보",
    product_name: "건강보험",
    monthly_premium: null,
    premium_amount: null,
    coverage_summary: {
      record_kind: "coverage_sheet_row",
      amount_unit: "won",
      amount_value: amountValue,
    },
  };
}

const singleL1 = l1SidecarPolicy(116568, "l1-single");
assert.equal(formatPolicyPremium(singleL1), "116,568원");

const threeL1 = [
  l1SidecarPolicy(116568, "l1-a"),
  l1SidecarPolicy(35560, "l1-b"),
  l1SidecarPolicy(166555, "l1-c"),
];
const l1Stats = computePolicyExplorerStats(threeL1);
assert.equal(l1Stats.totalCount, 3);
assert.equal(l1Stats.premiumKnownCount, 3);
assert.equal(l1Stats.premiumUnknownCount, 0);
assert.equal(l1Stats.premiumTotal, 318683);

const premiumUnavailablePolicy = {
  id: "l1-unavail",
  insurer_name: "DB손보",
  monthly_premium: null,
  premium_amount: null,
  coverage_summary: {
    record_kind: "coverage_sheet_row",
    amount_unit: "premium_unavailable",
    amount_text: "보험료미제공",
    amount_value: null,
  },
};
assert.equal(formatPolicyPremium(premiumUnavailablePolicy), "보험료미제공");

console.log("phase31c-p0-policy-explorer-unit-test: PASS");
