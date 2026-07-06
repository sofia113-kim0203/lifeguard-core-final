/**
 * Phase 24 Step 3C — Recommendation Engine test.
 */
import assert from "node:assert/strict";
import {
  buildRecommendationResult,
  customerRecommendationView,
  DEFAULT_CANDIDATES,
} from "../server/recommendationEngine.js";
import { analyzeCoverageGaps } from "../server/coverageGapAnalysisEngine.js";
import { analyzeUnderwritingRisk } from "../server/underwritingRiskAnalysisEngine.js";

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
const result = buildRecommendationResult({
  customer_id: "customer-a",
  coverageGapResult,
  underwritingRiskResult,
  memoryFacts,
  generatedAt: "2026-06-08T00:00:00.000Z",
});
const customerView = customerRecommendationView(result);

const report = {
  phase: "24-3C",
  tests: {
    fullRankingIncludesAllCandidates: {
      pass: result.full_ranking.length === DEFAULT_CANDIDATES.length,
      full_ranking_count: result.full_ranking.length,
      candidate_count: DEFAULT_CANDIDATES.length,
    },
    customerTop2ExactlyTwo: {
      pass: result.customer_top2.length === 2,
      customer_top2: result.customer_top2,
    },
    customerViewDoesNotExposeFullRanking: {
      pass: !Object.hasOwn(customerView, "full_ranking") && customerView.customer_top2.length === 2,
      customer_keys: Object.keys(customerView),
    },
    fullRankingPreservedForAgentAdmin: {
      pass: Array.isArray(result.full_ranking) && result.full_ranking.length > result.customer_top2.length,
    },
    highRiskWarningsOrReview: {
      pass: result.requires_agent_review === true && result.warning_codes.some((code) => code.includes("uw")),
      warning_codes: result.warning_codes,
      requires_agent_review: result.requires_agent_review,
    },
    coverageGapsInfluenceScore: {
      pass:
        result.full_ranking[0].reason_codes.includes("coverage_fit_positive") &&
        result.full_ranking.some((item) => item.warning_codes.includes("coverage_fit_negative")),
      top: result.full_ranking[0],
    },
    budgetPreferenceInfluence: {
      pass:
        result.full_ranking.some((item) => item.reason_codes.includes("budget_fit")) &&
        result.full_ranking.some((item) => item.warning_codes.some((code) => code.startsWith("budget_over"))),
    },
    scoreRange: {
      pass: result.full_ranking.every((item) => Number.isInteger(item.recommendation_score) && item.recommendation_score >= 0 && item.recommendation_score <= 100),
    },
    noFinalUnderwritingDecision: {
      pass: !JSON.stringify(result).includes("가입 가능") && !JSON.stringify(result).includes("거절 확정") && !JSON.stringify(result).includes("할증 확정") && !JSON.stringify(result).includes("부담보 확정"),
    },
    step3A3BInputsRemainValid: {
      pass: coverageGapResult.gap_score >= 0 && underwritingRiskResult.risk_score >= 0,
      gap_score: coverageGapResult.gap_score,
      risk_score: underwritingRiskResult.risk_score,
    },
  },
};

report.allPass = Object.values(report.tests).every((test) => test.pass === true);
for (const [name, test] of Object.entries(report.tests)) {
  assert.equal(test.pass, true, `${name} should pass`);
}
assert.equal(report.allPass, true);
console.log(JSON.stringify({ ...report, result, customerView }, null, 2));
