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
assert.equal(formatPolicySource("upload_extract"), "문서 추출(OCR)");
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

console.log("phase31c-p0-policy-explorer-unit-test: PASS");
