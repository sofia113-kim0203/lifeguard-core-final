/**
 * Phase 25 Step 1B — Rebalancing Engine test.
 */
import assert from "node:assert/strict";
import { analyzeRebalancing } from "../server/rebalancingEngine.js";

const baseCoverage = {
  coverage_gaps: [
    { coverage_type: "cancer", status: "missing", severity: "high" },
    { coverage_type: "brain", status: "insufficient", severity: "high" },
    { coverage_type: "medical_expense", status: "adequate", severity: "low" },
  ],
  duplicate_warnings: [],
};

const safeRisk = { underwriting_risk_level: "low", health_risk_items: [] };
const highRisk = { underwriting_risk_level: "high", health_risk_items: [{ risk_type: "hypertension", requires_agent_review: true }] };

function draft({ premium = 110000, focus = ["cancer", "brain"], warnings = [], review = false } = {}) {
  return {
    customer_top2_designs: [
      {
        carrier_id: "carrier-a",
        product_id: "product-a",
        design_focus: focus,
        monthly_premium_estimate: premium,
        warnings,
        requires_agent_review: review,
      },
    ],
    recommended_designs: [],
  };
}

const keep = analyzeRebalancing({
  customer_id: "c1",
  currentPortfolio: { monthly_premium: 100000, coverage_score: 85, duplicate_count: 0 },
  designDraft: draft({ premium: 105000, focus: [] }),
  coverageGapResult: { coverage_gaps: [], duplicate_warnings: [] },
  underwritingRiskResult: safeRisk,
  generatedAt: "2026-06-08T00:00:00.000Z",
});

const add = analyzeRebalancing({
  customer_id: "c2",
  currentPortfolio: { monthly_premium: 100000, coverage_score: 50, duplicate_count: 0 },
  designDraft: draft({ premium: 115000, focus: ["cancer", "brain"] }),
  coverageGapResult: baseCoverage,
  underwritingRiskResult: safeRisk,
  generatedAt: "2026-06-08T00:00:00.000Z",
});

const change = analyzeRebalancing({
  customer_id: "c3",
  currentPortfolio: { monthly_premium: 100000, coverage_score: 45, duplicate_count: 0 },
  designDraft: draft({ premium: 160000, focus: ["cancer", "brain"] }),
  coverageGapResult: baseCoverage,
  underwritingRiskResult: safeRisk,
  generatedAt: "2026-06-08T00:00:00.000Z",
});

const reduce = analyzeRebalancing({
  customer_id: "c4",
  currentPortfolio: { monthly_premium: 180000, coverage_score: 80, duplicate_count: 2 },
  designDraft: draft({ premium: 120000, focus: [] }),
  coverageGapResult: { coverage_gaps: [], duplicate_warnings: [{ coverage_type: "driver" }] },
  underwritingRiskResult: safeRisk,
  generatedAt: "2026-06-08T00:00:00.000Z",
});

const review = analyzeRebalancing({
  customer_id: "c5",
  currentPortfolio: { monthly_premium: 120000, coverage_score: 50, duplicate_count: 0 },
  designDraft: draft({ premium: 130000, focus: ["cancer"], warnings: ["건강 memory 기반 인수심사 검토 필요 가능성이 있습니다."], review: true }),
  coverageGapResult: baseCoverage,
  underwritingRiskResult: highRisk,
  generatedAt: "2026-06-08T00:00:00.000Z",
});

const report = {
  phase: "25-1B",
  tests: {
    keepAction: { pass: keep.action === "keep", result: keep },
    addAction: { pass: add.action === "add" && add.premium_change.delta === 15000 && add.coverage_improvement.score > 0, result: add },
    changeAction: { pass: change.action === "change" && change.coverage_improvement.score > 0, result: change },
    reduceAction: { pass: reduce.action === "reduce" && reduce.premium_change.delta < 0, result: reduce },
    reviewAction: { pass: review.action === "review" && review.requires_agent_review === true && review.risk_warnings.length > 0, result: review },
    monthlyReportSummary: { pass: typeof add.monthly_report_summary === "string" && add.monthly_report_summary.includes("add") },
    kakaoSummary: { pass: typeof review.kakao_notification_summary === "string" && review.kakao_notification_summary.length <= 80 },
    outputFields: {
      pass: [
        "rebalancing_score",
        "action",
        "reasons",
        "premium_change",
        "coverage_improvement",
        "risk_warnings",
        "monthly_report_summary",
        "kakao_notification_summary",
        "requires_agent_review",
        "generated_at",
      ].every((key) => Object.hasOwn(add, key)),
    },
    noFinalDecisionLanguage: {
      pass: !JSON.stringify({ keep, add, change, reduce, review }).includes("가입 가능") && !JSON.stringify({ keep, add, change, reduce, review }).includes("거절 확정") && !JSON.stringify({ keep, add, change, reduce, review }).includes("할증 확정") && !JSON.stringify({ keep, add, change, reduce, review }).includes("부담보 확정"),
    },
  },
};

report.allPass = Object.values(report.tests).every((test) => test.pass === true);
for (const [name, test] of Object.entries(report.tests)) {
  assert.equal(test.pass, true, `${name} should pass`);
}
assert.equal(report.allPass, true);
console.log(JSON.stringify(report, null, 2));
