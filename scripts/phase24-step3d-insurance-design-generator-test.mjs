/**
 * Phase 24 Step 3D — Insurance Design Generator test.
 */
import assert from "node:assert/strict";
import { analyzeCoverageGaps } from "../server/coverageGapAnalysisEngine.js";
import { analyzeUnderwritingRisk } from "../server/underwritingRiskAnalysisEngine.js";
import { buildRecommendationResult } from "../server/recommendationEngine.js";
import {
  customerInsuranceDesignView,
  generateInsuranceDesignDraft,
} from "../server/insuranceDesignGenerator.js";

function fact(overrides) {
  return {
    fact_key: "preference.monthly_budget",
    fact_value: "월 보험료 15만원 이하를 선호합니다.",
    fact_type: "preference",
    importance: "high",
    source_table: "consultation_messages",
    metadata_json: { review_status: "approved", requires_agent_review: false },
    ...overrides,
  };
}

const memoryFacts = [
  fact({ fact_key: "preference.monthly_budget", fact_value: "월 보험료 15만원 이하를 선호합니다." }),
  fact({ fact_key: "preference.keep_indemnity", fact_value: "고객은 실손보험을 유지하고 싶다고 명시했습니다." }),
  fact({ fact_key: "insurance.cancer.missing", fact_value: "암 진단비 보장 없음", fact_type: "insurance" }),
  fact({ fact_key: "insurance.brain.insufficient", fact_value: "뇌혈관 보장이 부족합니다", fact_type: "insurance" }),
  fact({ fact_key: "insurance.heart.insufficient", fact_value: "심장 보장 부족", fact_type: "insurance" }),
  fact({ fact_key: "insurance.indemnity.held", fact_value: "실손의료비 보험 보유", fact_type: "insurance" }),
  fact({
    fact_key: "health.medication.hypertension",
    fact_value: "고객은 고혈압 약을 복용 중입니다.",
    fact_type: "health",
    metadata_json: {
      requires_agent_review: true,
      review_status: "pending",
      review_priority: "high",
      review_reason: ["health_memory_requires_review"],
      memory_confidence: "medium",
    },
  }),
];

const coverageGapResult = analyzeCoverageGaps({ customer_id: "customer-a", memory: memoryFacts, generatedAt: "2026-06-08T00:00:00.000Z" });
const underwritingRiskResult = analyzeUnderwritingRisk({ customer_id: "customer-a", memory: memoryFacts, generatedAt: "2026-06-08T00:00:00.000Z" });
const recommendationResult = buildRecommendationResult({
  customer_id: "customer-a",
  coverageGapResult,
  underwritingRiskResult,
  memoryFacts,
  generatedAt: "2026-06-08T00:00:00.000Z",
});
const draft = generateInsuranceDesignDraft({
  customer_id: "customer-a",
  coverageGapResult,
  underwritingRiskResult,
  recommendationResult,
  memoryFacts,
  generatedAt: "2026-06-08T00:00:00.000Z",
});
const customerView = customerInsuranceDesignView(draft);

const serialized = JSON.stringify(draft);
const report = {
  phase: "24-3D",
  tests: {
    customerTop2DesignsOnly: {
      pass: customerView.customer_top2_designs.length === 2 && !Object.hasOwn(customerView, "agent_full_details") && !Object.hasOwn(customerView, "recommended_designs"),
      customer_keys: Object.keys(customerView),
    },
    agentDetailsPreserveFullEvidence: {
      pass:
        draft.agent_full_details.full_ranking.length === recommendationResult.full_ranking.length &&
        draft.agent_full_details.coverage_gaps.length === coverageGapResult.coverage_gaps.length &&
        draft.agent_full_details.health_risk_items.length === underwritingRiskResult.health_risk_items.length,
      full_ranking_count: draft.agent_full_details.full_ranking.length,
    },
    coverageGapsReflected: {
      pass:
        draft.current_issues.some((issue) => issue.type === "coverage_gap" && ["cancer", "brain", "heart"].includes(issue.key)) &&
        draft.customer_top2_designs.every((design) => design.design_focus.length > 0),
      current_issues: draft.current_issues,
    },
    underwritingWarningsReflected: {
      pass: draft.warnings.some((warning) => warning.includes("인수심사")) && draft.requires_agent_review === true,
      warnings: draft.warnings,
    },
    budgetPreferenceReflected: {
      pass:
        draft.customer_summary.budget.includes("15만원") &&
        draft.customer_summary.preferences.some((item) => item.includes("실손")) &&
        serialized.includes("예산"),
      customer_summary: draft.customer_summary,
    },
    noFinalDecisionLanguage: {
      pass: !serialized.includes("가입 가능") && !serialized.includes("거절 확정") && !serialized.includes("할증 확정") && !serialized.includes("부담보 확정") && !serialized.includes("전자청약"),
    },
    outputFieldsPresent: {
      pass:
        Object.hasOwn(draft, "customer_summary") &&
        Object.hasOwn(draft, "current_issues") &&
        Object.hasOwn(draft, "recommended_designs") &&
        Object.hasOwn(draft, "customer_top2_designs") &&
        Object.hasOwn(draft, "agent_full_details") &&
        Object.hasOwn(draft, "warnings") &&
        Object.hasOwn(draft, "requires_agent_review") &&
        Object.hasOwn(draft, "generated_at"),
      keys: Object.keys(draft),
    },
    upstreamInputsRemainValid: {
      pass:
        coverageGapResult.gap_score >= 0 &&
        underwritingRiskResult.risk_score >= 0 &&
        recommendationResult.customer_top2.length === 2,
    },
  },
};

report.allPass = Object.values(report.tests).every((test) => test.pass === true);
for (const [name, test] of Object.entries(report.tests)) {
  assert.equal(test.pass, true, `${name} should pass`);
}
assert.equal(report.allPass, true);
console.log(JSON.stringify({ ...report, draft, customerView }, null, 2));
