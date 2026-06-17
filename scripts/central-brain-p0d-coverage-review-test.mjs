#!/usr/bin/env node
/**
 * P0-D — Central Brain coverage_review_request mode tests (no live DB / Claude).
 */
import assert from "node:assert/strict";
import { classifyConsultationIntent } from "../server/intentGateLayer.js";
import {
  planCentralBrainEvidence,
  resolveCentralBrainMode,
  routeCentralBrain,
} from "../server/centralBrain/index.js";
import {
  buildReviewBundleFromEvidenceData,
  COVERAGE_REVIEW_PENDING_MESSAGE,
  isCoverageReviewEvidenceSufficient,
} from "../server/advisorBrain/advisorCoverageReviewResponder.js";
import { loadCentralBrainEvidence } from "../server/centralBrain/centralBrainEvidenceLoader.js";
import { runCentralBrainTurn } from "../server/centralBrain/centralBrainOrchestrator.js";
import { mapJobResultsToAnalysisPanels } from "../src/lib/analysisPanelJobUtils.js";

const envBothOn = { CENTRAL_BRAIN_ENABLED: "true", ADVISOR_BRAIN_ENABLED: "true" };

const successQuestions = [
  "보험 점검해줘",
  "내 보험 분석해줘",
  "전체 분석해줘",
  "전체 검토해줘",
  "내 보험 진단해줘",
  "보장 점검해줘",
];

const regressionCases = [
  { question: "암보험 부족해?", intent: "coverage_gap_check", mode: "coverage_gap_reason" },
  { question: "보험료 얼마야?", intent: "factual_lookup", mode: "factual_lookup" },
  { question: "청구 가능해?", intent: "claim_eligibility_check", mode: null },
  { question: "설계 다시 봐줘", intent: "design_request", mode: null },
  { question: "안녕", intent: "casual_chat", mode: null },
  { question: "오늘 힘들다", intent: "casual_chat", mode: null },
];

const mockJob = {
  id: "job-review-1",
  status: "completed",
  customer_id: "cust-review-1",
  result_json: {
    coverage_gap: {
      gap_score: 65,
      items: [{ coverage_label: "뇌혈관", gap_level: "critical" }],
      top_gaps: [{ coverage_label: "뇌혈관", gap_level: "critical" }],
    },
    underwriting_risk: { items: [{ risk_label: "고혈압", level: "medium" }] },
    recommendation: {
      customer_visible_top2: [{ recommendation_rank: 1, coverage_label: "뇌혈관", reason: "보강 검토" }],
    },
    insurance_design: { monthly_premium_target: 150000 },
  },
};

const mockPanels = mapJobResultsToAnalysisPanels(mockJob);
const mockJobLoader = async () => mockJob;

function buildMockSupabase({ completedJob = mockJob, inFlightJob = null } = {}) {
  return {
    from(table) {
      const chain = {
        select() {
          return chain;
        },
        eq() {
          return chain;
        },
        in() {
          return chain;
        },
        is() {
          return chain;
        },
        order() {
          return chain;
        },
        limit: async () => {
          if (table === "analysis_jobs") {
            return { data: inFlightJob ? [inFlightJob] : completedJob ? [completedJob] : [], error: null };
          }
          return { data: [], error: null };
        },
        maybeSingle: async () => ({ data: completedJob, error: null }),
      };
      return chain;
    },
  };
}

// 1 — intent classification
for (const question of successQuestions) {
  const classification = classifyConsultationIntent(question);
  assert.equal(
    classification.intent,
    "coverage_review_request",
    `intent for "${question}"`,
  );
}
console.log("INTENT PASS");

// 2 — central mode routing
for (const question of successQuestions) {
  const classification = classifyConsultationIntent(question);
  assert.equal(resolveCentralBrainMode(classification, question), "coverage_review_request");
  const route = routeCentralBrain({ question, env: envBothOn });
  assert.equal(route.central_mode, "coverage_review_request");
  assert.equal(route.response_lane, "central_brain");
}
console.log("ROUTE PASS");

// 3 — regression intents
for (const row of regressionCases) {
  const classification = classifyConsultationIntent(row.question);
  assert.equal(classification.intent, row.intent, row.question);
  const mode = resolveCentralBrainMode(classification, row.question);
  assert.equal(mode, row.mode, `mode for ${row.question}`);
}
console.log("REGRESSION PASS");

// 4 — planner read-only
{
  const route = routeCentralBrain({ question: "보험 점검해줘", env: envBothOn });
  const plan = planCentralBrainEvidence({ route });
  assert.equal(plan.central_mode, "coverage_review_request");
  assert.equal(plan.use_live_engines, false);
  assert.equal(plan.read_only, true);
  assert.ok(plan.forbidden_loaders.includes("coverage_gap_live"));
  assert.ok(plan.rationale.some((line) => line.includes("comprehensive_review")));
}
console.log("PLANNER PASS");

// 5 — review bundle assembly
{
  const reviewBundle = buildReviewBundleFromEvidenceData({
    policy_count: 3,
    premium_stats: { totalCount: 3 },
    structured_memory: { fact_count: 5 },
    stored_panels: mockPanels,
    stored_job: mockJob,
  });
  assert.ok(reviewBundle.coverage_gap);
  assert.ok(reviewBundle.underwriting_risk);
  assert.ok(reviewBundle.recommendation);
  assert.ok(reviewBundle.insurance_design);
  assert.equal(isCoverageReviewEvidenceSufficient(reviewBundle, mockJob), true);
}
console.log("REVIEW_BUNDLE PASS");

// 6 — sufficient evidence → skip job + review answer
{
  const mockClaude = async () => ({
    ok: true,
    message:
      "1. 현재 고객 상태 요약\n등록 보험 3건 기준으로 확인했습니다.\n2. 주요 보장 공백\n뇌혈관 보장 보강 검토가 필요해 보입니다.",
  });

  const result = await runCentralBrainTurn({
    question: "보험 점검해줘",
    supabase: buildMockSupabase(),
    customerId: "cust-review-1",
    env: envBothOn,
    jobLoader: mockJobLoader,
    claudeCall: mockClaude,
    memorySnapshot: { facts: [], memory_version: 1, fact_count: 0 },
    cachePayload: { cache_status: "ready" },
    conversationHistory: [],
  });

  assert.equal(result.central_brain_mode, "coverage_review_request");
  assert.equal(result.skip_analysis_job, true);
  assert.equal(result.ok, true);
  assert.match(result.message, /보장 공백|고객 상태/);
}
console.log("SUFFICIENT PASS");

// 7 — insufficient evidence → pending message + allow job
{
  const result = await runCentralBrainTurn({
    question: "보험 점검해줘",
    supabase: buildMockSupabase({ completedJob: null }),
    customerId: "cust-review-1",
    env: envBothOn,
    jobLoader: async () => null,
    memorySnapshot: { facts: [], memory_version: 1, fact_count: 0 },
    cachePayload: null,
    conversationHistory: [],
  });

  assert.equal(result.skip_analysis_job, false);
  assert.equal(result.message, COVERAGE_REVIEW_PENDING_MESSAGE);
  assert.equal(result.reuse_analysis_job_id, null);
}
console.log("INSUFFICIENT PASS");

// 8 — in-flight job reuse
{
  const inFlight = { id: "job-inflight-1", status: "processing" };
  const result = await runCentralBrainTurn({
    question: "보험 점검해줘",
    supabase: buildMockSupabase({ completedJob: null, inFlightJob: inFlight }),
    customerId: "cust-review-1",
    env: envBothOn,
    jobLoader: async () => null,
    memorySnapshot: { facts: [], memory_version: 1, fact_count: 0 },
    cachePayload: null,
    conversationHistory: [],
  });

  assert.equal(result.reuse_analysis_job_id, "job-inflight-1");
  assert.equal(result.skip_analysis_job, false);
}
console.log("REUSE PASS");

// 9 — loader sufficiency fix (coverageGapResult keys)
{
  const route = routeCentralBrain({ question: "보험 점검해줘", env: envBothOn });
  const plan = planCentralBrainEvidence({ route });
  const bundle = await loadCentralBrainEvidence({
    supabase: buildMockSupabase(),
    customerId: "cust-review-1",
    plan,
    jobLoader: mockJobLoader,
    memorySnapshot: { facts: [], memory_version: 1, fact_count: 0 },
    cachePayload: { cache_status: "ready" },
  });
  assert.equal(bundle.sufficiency, "sufficient");
  assert.ok(bundle.review_bundle?.coverage_gap);
}
console.log("LOADER PASS");

console.log("central-brain-p0d-coverage-review-test: PASS");
