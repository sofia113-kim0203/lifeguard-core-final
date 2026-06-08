/**
 * Phase 24 Step 3A — Coverage Gap Analysis Engine test.
 */
import assert from "node:assert/strict";
import { analyzeCoverageGaps } from "../server/coverageGapAnalysisEngine.js";

function fact(overrides) {
  return {
    id: crypto.randomUUID(),
    fact_key: "insurance.generic",
    fact_value: "",
    fact_type: "insurance",
    importance: "medium",
    source_table: "customer_memory_facts",
    provenance_type: "profile",
    metadata_json: { review_status: "approved", requires_agent_review: false },
    ...overrides,
  };
}

const memory = [
  fact({ fact_key: "insurance.cancer.missing", fact_value: "암 진단비 보장 없음", importance: "high" }),
  fact({ fact_key: "insurance.brain.insufficient", fact_value: "뇌혈관 보장이 부족합니다", importance: "high" }),
  fact({ fact_key: "insurance.heart.insufficient", fact_value: "심장 보장 부족", importance: "high" }),
  fact({ fact_key: "insurance.indemnity.held", fact_value: "실손의료비 보험 보유", importance: "high" }),
  fact({ fact_key: "insurance.driver.primary", fact_value: "운전자 특약 보유", importance: "medium" }),
  fact({ fact_key: "insurance.driver.duplicate", fact_value: "운전자 특약 2건 중복 가능", importance: "medium" }),
  fact({
    fact_key: "health.medication.summary",
    fact_value: "고객은 혈압약을 복용 중입니다.",
    fact_type: "health",
    importance: "critical",
    metadata_json: {
      requires_agent_review: true,
      review_status: "pending",
      review_priority: "high",
      review_reason: ["health_memory_requires_review"],
      memory_confidence: "medium",
    },
  }),
  fact({ fact_key: "smalltalk.weather", fact_value: "안녕 오늘 날씨 좋네", fact_type: "preference", metadata_json: { category: "small_talk" } }),
  fact({ fact_key: "insurance.death.old", fact_value: "사망 보장 보유", superseded_at: new Date().toISOString() }),
];

const result = analyzeCoverageGaps({
  customer_id: "customer-a",
  memory,
  generatedAt: "2026-06-08T00:00:00.000Z",
});

function byType(type) {
  return result.coverage_gaps.find((item) => item.coverage_type === type);
}

const report = {
  phase: "24-3A",
  tests: {
    cancerMissingHigh: {
      pass: byType("cancer")?.status === "missing" && byType("cancer")?.severity === "high",
      item: byType("cancer"),
    },
    brainHeartInsufficient: {
      pass:
        byType("brain")?.status === "insufficient" &&
        ["high", "medium"].includes(byType("brain")?.severity) &&
        byType("heart")?.status === "insufficient" &&
        ["high", "medium"].includes(byType("heart")?.severity),
      brain: byType("brain"),
      heart: byType("heart"),
    },
    medicalExpenseAdequate: {
      pass: byType("medical_expense")?.status === "adequate",
      item: byType("medical_expense"),
    },
    duplicateWarning: {
      pass: result.duplicate_warnings.some((item) => item.coverage_type === "driver"),
      duplicate_warnings: result.duplicate_warnings,
    },
    unknownItems: {
      pass: result.unknown_items.some((item) => item.coverage_type === "death") && result.unknown_items.some((item) => item.coverage_type === "dental"),
      unknown_items: result.unknown_items.map((item) => item.coverage_type),
    },
    agentReviewItems: {
      pass: result.agent_review_items.some((item) => item.fact_key === "health.medication.summary" || item.coverage_type === "surgery"),
      agent_review_items: result.agent_review_items,
    },
    smallTalkIgnored: {
      pass: !JSON.stringify(result).includes("smalltalk.weather") && !JSON.stringify(result).includes("날씨"),
    },
    gapScoreRange: {
      pass: Number.isInteger(result.gap_score) && result.gap_score >= 0 && result.gap_score <= 100,
      gap_score: result.gap_score,
    },
    reviewMetadataPreserved: {
      pass: result.agent_review_items.some((item) => item.fact_key === "health.medication.summary" && item.review_status === "pending" && item.review_priority === "high"),
    },
  },
};

report.allPass = Object.values(report.tests).every((test) => test.pass === true);

assert.equal(report.tests.cancerMissingHigh.pass, true);
assert.equal(report.tests.brainHeartInsufficient.pass, true);
assert.equal(report.tests.medicalExpenseAdequate.pass, true);
assert.equal(report.tests.duplicateWarning.pass, true);
assert.equal(report.tests.unknownItems.pass, true);
assert.equal(report.tests.agentReviewItems.pass, true);
assert.equal(report.tests.smallTalkIgnored.pass, true);
assert.equal(report.tests.gapScoreRange.pass, true);
assert.equal(report.tests.reviewMetadataPreserved.pass, true);
assert.equal(report.allPass, true);

console.log(JSON.stringify({ ...report, result }, null, 2));
