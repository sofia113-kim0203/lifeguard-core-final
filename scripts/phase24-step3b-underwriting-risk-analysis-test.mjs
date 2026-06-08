/**
 * Phase 24 Step 3B — Underwriting Risk Analysis Engine test.
 */
import assert from "node:assert/strict";
import { analyzeUnderwritingRisk } from "../server/underwritingRiskAnalysisEngine.js";
import { analyzeCoverageGaps } from "../server/coverageGapAnalysisEngine.js";

function fact(overrides) {
  return {
    id: crypto.randomUUID(),
    fact_key: "health.generic",
    fact_value: "",
    fact_type: "health",
    importance: "high",
    source_table: "customer_memory_facts",
    provenance_type: "profile",
    metadata_json: { review_status: "approved", requires_agent_review: false, memory_confidence: "high" },
    ...overrides,
  };
}

const memory = [
  fact({
    fact_key: "health.medication.hypertension",
    fact_value: "고객은 고혈압 약을 복용 중입니다.",
    metadata_json: {
      requires_agent_review: true,
      review_status: "pending",
      review_priority: "high",
      review_reason: ["health_memory_requires_review"],
      memory_confidence: "medium",
    },
  }),
  fact({ fact_key: "health.diabetes.summary", fact_value: "당뇨 진단 및 당뇨약 복용 이력이 있습니다." }),
  fact({ fact_key: "health.surgery_5y.flag", fact_value: "최근 2년 내 수술 이력이 있습니다." }),
  fact({ fact_key: "health.hospital_5y.flag", fact_value: "최근 입원 이력이 있습니다." }),
  fact({
    fact_key: "health.vague.old_medication",
    fact_value: "아마 예전에 약을 먹었던 것 같아요.",
    metadata_json: {
      requires_agent_review: true,
      review_status: "pending",
      review_priority: "high",
      review_reason: ["vague_customer_statement"],
      memory_confidence: "low",
    },
  }),
  fact({
    fact_key: "health.document.stable_checkup",
    fact_value: "문서 근거: 최근 검진에서 특이 소견 없음.",
    source_table: "customer_document_chunks",
    provenance_type: "document",
    metadata_json: { review_status: "approved", requires_agent_review: false, memory_confidence: "high" },
  }),
  fact({
    fact_key: "health.medication.hypertension",
    fact_value: "고혈압 약 복용 여부가 이전 기억과 충돌합니다.",
    metadata_json: {
      requires_agent_review: true,
      review_status: "pending",
      review_priority: "high",
      review_reason: ["memory_conflict"],
      memory_confidence: "low",
    },
  }),
  fact({ fact_key: "smalltalk.weather", fact_value: "안녕 오늘 날씨 좋네", metadata_json: { category: "small_talk" } }),
  fact({ fact_key: "health.cancer.old", fact_value: "암 이력 있음", superseded_at: new Date().toISOString() }),
];

const result = analyzeUnderwritingRisk({
  customer_id: "customer-a",
  memory,
  generatedAt: "2026-06-08T00:00:00.000Z",
});

function byType(type) {
  return result.health_risk_items.find((item) => item.risk_type === type);
}

const coverageResult = analyzeCoverageGaps({ customer_id: "customer-a", memory, generatedAt: "2026-06-08T00:00:00.000Z" });

const report = {
  phase: "24-3B",
  tests: {
    hypertensionFlag: {
      pass: result.risk_flags.includes("hypertension") && ["medium", "high"].includes(byType("hypertension")?.status),
      item: byType("hypertension"),
    },
    diabetesRisk: {
      pass: result.risk_flags.includes("diabetes") && ["medium", "high"].includes(byType("diabetes")?.status),
      item: byType("diabetes"),
    },
    recentSurgeryHospitalization: {
      pass:
        result.risk_flags.includes("surgery_history") &&
        byType("surgery_history")?.requires_agent_review === true &&
        result.risk_flags.includes("hospitalization_history") &&
        byType("hospitalization_history")?.requires_agent_review === true,
      surgery: byType("surgery_history"),
      hospitalization: byType("hospitalization_history"),
    },
    vagueHealthReview: {
      pass: byType("vague_health")?.requires_agent_review === true && byType("vague_health")?.status === "unknown",
      item: byType("vague_health"),
    },
    documentBackedStableHealth: {
      pass: result.health_risk_items.some((item) => item.evidence_basis === "document" && item.confidence === "high"),
    },
    conflictingHealthMemory: {
      pass: result.agent_review_items.some((item) => JSON.stringify(item).includes("memory_conflict")),
      agent_review_items: result.agent_review_items,
    },
    casualSmallTalkExcluded: {
      pass: !JSON.stringify(result).includes("smalltalk.weather") && !JSON.stringify(result).includes("날씨"),
    },
    riskScoreRange: {
      pass: Number.isInteger(result.risk_score) && result.risk_score >= 0 && result.risk_score <= 100,
      risk_score: result.risk_score,
    },
    reviewMetadataPreserved: {
      pass: result.agent_review_items.some((item) => item.fact_key === "health.medication.hypertension" && item.review_status === "pending" && item.review_priority === "high"),
    },
    coverageGapUnaffected: {
      pass:
        Number.isInteger(coverageResult.gap_score) &&
        coverageResult.coverage_gaps.some((item) => item.coverage_type === "medical_expense") &&
        Array.isArray(coverageResult.unknown_items),
      gap_score: coverageResult.gap_score,
    },
  },
};

report.allPass = Object.values(report.tests).every((test) => test.pass === true);

for (const [name, test] of Object.entries(report.tests)) {
  assert.equal(test.pass, true, `${name} should pass`);
}
assert.equal(report.allPass, true);

console.log(JSON.stringify({ ...report, result }, null, 2));
