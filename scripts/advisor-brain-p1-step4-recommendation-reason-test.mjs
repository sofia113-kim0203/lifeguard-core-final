/**
 * Advisor Brain P1 Step 4 — recommendation_reason explain-only tests (no live DB / no live Claude).
 */
import assert from "node:assert/strict";
import { classifyConsultationIntent } from "../server/intentGateLayer.js";
import {
  shouldActivateAdvisorBrainForClassification,
} from "../server/advisorBrain/advisorBrainResponder.js";
import {
  ADVISOR_BRAIN_RECOMMENDATION_REASON_MAX_TOKENS,
  NO_STORED_RECOMMENDATION_MESSAGE,
  buildRecommendationReasonUserPrompt,
  buildStoredRecommendationEvidence,
  detectRecommendationEvidenceMismatch,
  isInsurerRankQuestion,
  isRecommendationReasonClassification,
  buildRecommendationReasonAnswer,
  ensureInsurerRankNotice,
  INSURER_RANK_NOTICE,
} from "../server/advisorBrain/advisorRecommendationReasonResponder.js";
import { mapJobResultsToAnalysisPanels } from "../src/lib/analysisPanelJobUtils.js";
import { sanitizeAdvisorBrainMessage } from "../server/advisorBrain/advisorBrainGuardrails.js";

const envOn = { ADVISOR_BRAIN_ENABLED: "true" };
const envOff = { ADVISOR_BRAIN_ENABLED: "false" };

const mockCompletedJob = {
  id: "job-rec-1",
  status: "completed",
  customer_id: "cust-1",
  result_json: {
    intent_gate: {
      intent: "recommendation_request",
      pipeline_manifest: ["coverage_gap", "underwriting_risk", "recommendation", "result_claude"],
    },
    coverage_gap: {
      gap_score: 72,
      items: [
        {
          coverage_category: "cancer",
          coverage_label: "암",
          gap_level: "critical",
          reason: "암 보장이 부족합니다.",
        },
      ],
      top_gaps: [{ coverage_label: "암", gap_level: "critical" }],
    },
    underwriting_risk: {
      items: [
        {
          coverage_category: "cancer",
          coverage_label: "암",
          underwriting_status: "likely_standard",
          reason: "현재 건강 memory 기준 인수 제한 신호는 제한적입니다.",
        },
      ],
    },
    recommendation: {
      customer_visible_top2: [
        {
          recommendation_rank: 1,
          recommendation_score: 115,
          coverage_label: "암",
          coverage_category: "cancer",
          reason_codes: ["critical_gap", "type_add_coverage", "uw_friction_low"],
          uw_flags: ["likely_standard"],
          budget_band: "review_needed",
          coverage_gap_level: "critical",
          recommendation_type: "add_coverage",
          priority: "high",
        },
        {
          recommendation_rank: 2,
          recommendation_score: 90,
          coverage_label: "실손",
          coverage_category: "medical_expense",
          reason_codes: ["high_gap", "type_review_existing"],
          uw_flags: [],
          budget_band: "review_needed",
          coverage_gap_level: "high",
        },
      ],
    },
  },
};

const mockPanels = mapJobResultsToAnalysisPanels(mockCompletedJob);
const mockJobLoader = async () => mockCompletedJob;
const emptyJobLoader = async () => null;

let capturedMaxTokens = null;

const mockClaude = async ({ maxTokens }) => {
  capturedMaxTokens = maxTokens;
  return {
    ok: true,
    message:
      "저장된 예비 추천 기준으로 1위는 암 보장 보강입니다. 보장공백과 인수위험 근거를 바탕으로 설명드립니다.",
  };
};

// A — 왜 암보험 추천? → stored reason 설명
{
  const question = "왜 암보험 추천했어?";
  const classification = classifyConsultationIntent(question);
  assert.equal(classification.intent, "recommendation_request");
  assert.equal(isRecommendationReasonClassification(classification, question), true);

  const result = await buildRecommendationReasonAnswer({
    supabase: {},
    customerId: "cust-1",
    question,
    classification,
    jobLoader: mockJobLoader,
    claudeCall: mockClaude,
  });

  assert.equal(result.ok, true);
  assert.match(result.message, /암|보장|예비 추천|근거/);
  assert.equal(result.engine_executed, false);
  assert.equal(result.used_tools.length, 0);
  assert.equal(capturedMaxTokens, ADVISOR_BRAIN_RECOMMENDATION_REASON_MAX_TOKENS);
  console.log("A PASS");
}

// B — 추천 근거 뭐야? → rank1 reason 설명
{
  const question = "추천 근거가 뭐야?";
  const classification = classifyConsultationIntent(question);
  const evidence = buildStoredRecommendationEvidence(mockPanels);
  const prompt = buildRecommendationReasonUserPrompt({
    question,
    evidence,
    insurerRankQuestion: false,
  });

  assert.match(prompt, /"recommendation_rank": 1/);
  assert.match(prompt, /"reason_codes":/);
  assert.match(prompt, /"uw_flags":/);
  assert.match(prompt, /"budget_band":/);

  const result = await buildRecommendationReasonAnswer({
    supabase: {},
    customerId: "cust-1",
    question,
    classification,
    jobLoader: mockJobLoader,
    claudeCall: async () => ({
      ok: true,
      message:
        "1위 추천은 암 보장 보강이며, 저장된 reason_codes와 uw_flags를 근거로 한 예비 추천입니다.",
    }),
  });

  assert.equal(result.ok, true);
  assert.match(result.message, /1위|암|예비 추천|근거/);
  console.log("B PASS");
}

// C — 왜 B보험사 제외? → 보험사 순위 아님 안내
{
  const question = "왜 B보험사는 추천에서 제외됐어?";
  const classification = classifyConsultationIntent(question);
  assert.equal(classification.intent, "recommendation_request");
  assert.equal(isInsurerRankQuestion(question), true);

  const evidence = buildStoredRecommendationEvidence(mockPanels);
  const prompt = buildRecommendationReasonUserPrompt({
    question,
    evidence,
    insurerRankQuestion: true,
  });

  assert.match(prompt, /보험사 순위가 아니라 보장 영역 기준 추천/);

  const result = await buildRecommendationReasonAnswer({
    supabase: {},
    customerId: "cust-1",
    question,
    classification,
    jobLoader: mockJobLoader,
    claudeCall: async () => ({
      ok: true,
      message: "저장된 1위 추천 근거를 설명드립니다. 보험사 제외 사유는 저장된 결과에 없습니다.",
    }),
  });

  assert.equal(result.ok, true);
  assert.match(result.message, /보험사 순위가 아니라 보장 영역 기준 추천/);
  assert.doesNotMatch(result.message, /B보험사.*제외.*사유는/);
  console.log("C PASS");
}

// K — insurer rank notice sanitize append when Claude omits it
{
  const appended = ensureInsurerRankNotice("저장된 추천 근거만 설명합니다.", {
    insurerRankQuestion: true,
  });
  assert.match(appended, /보험사 순위가 아니라 보장 영역 기준 추천/);

  const result = await buildRecommendationReasonAnswer({
    supabase: {},
    customerId: "cust-1",
    question: "왜 B보험사는 추천에서 제외됐어?",
    classification: classifyConsultationIntent("왜 B보험사는 추천에서 제외됐어?"),
    jobLoader: mockJobLoader,
    claudeCall: async () => ({
      ok: true,
      message: "저장된 추천 근거만 설명합니다.",
    }),
  });
  assert.match(result.message, /보험사 순위가 아니라 보장 영역 기준 추천/);
  console.log("K PASS");
}

// D — 추천 결과 없음 → 분석 필요 안내
{
  const result = await buildRecommendationReasonAnswer({
    supabase: {},
    customerId: "cust-1",
    question: "추천 근거가 뭐야?",
    classification: classifyConsultationIntent("추천 근거가 뭐야?"),
    jobLoader: emptyJobLoader,
    claudeCall: async () => ({
      ok: true,
      message: "이 Claude 응답은 사용되면 안 됩니다.",
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.message, NO_STORED_RECOMMENDATION_MESSAGE);
  assert.equal(result.guardrail_summary.no_stored_recommendation, true);
  console.log("D PASS");
}

// E — entry utterances → KEY recommendation path (GAP-03)
{
  const question = "뭐 가입해야 해?";
  const classification = classifyConsultationIntent(question);
  assert.equal(classification.intent, "recommendation_priority_check");
  assert.equal(classification.matched_rule, "recommendation_entry_check");
  assert.equal(isRecommendationReasonClassification(classification, question), false);
  assert.equal(shouldActivateAdvisorBrainForClassification(classification, envOn, question), false);

  const pureRecommend = classifyConsultationIntent("추천해줘");
  assert.equal(pureRecommend.intent, "recommendation_priority_check");
  assert.equal(pureRecommend.matched_rule, "recommendation_entry_check");
  assert.equal(isRecommendationReasonClassification(pureRecommend, "추천해줘"), false);
  console.log("E PASS");
}

// F — reason 모드 → recommendation 엔진/job 미실행
{
  const result = await buildRecommendationReasonAnswer({
    supabase: {},
    customerId: "cust-1",
    question: "왜 1위로 추천했어?",
    classification: classifyConsultationIntent("왜 1위로 추천했어?"),
    jobLoader: mockJobLoader,
    claudeCall: mockClaude,
  });

  assert.equal(result.recommendation_reason_mode, true);
  assert.equal(result.engine_executed, false);
  assert.deepEqual(result.used_tools, []);
  console.log("F PASS");
}

// G — flag OFF → 기존 경로 (brain 비활성)
{
  const classification = classifyConsultationIntent("추천 근거가 뭐야?");
  assert.equal(
    shouldActivateAdvisorBrainForClassification(classification, envOff, "추천 근거가 뭐야?"),
    false,
  );
  console.log("G PASS");
}

// H — brain 실패 → ok:false (conversational fallback 트리거)
{
  const claudeFail = await buildRecommendationReasonAnswer({
    supabase: {},
    customerId: "cust-1",
    question: "추천 근거가 뭐야?",
    classification: classifyConsultationIntent("추천 근거가 뭐야?"),
    jobLoader: mockJobLoader,
    claudeCall: async () => ({ ok: false, reason: "CLAUDE_API_ERROR", message: null }),
  });
  assert.equal(claudeFail.ok, false);
  assert.equal(claudeFail.reason, "CLAUDE_API_ERROR");

  const noStored = await buildRecommendationReasonAnswer({
    supabase: {},
    customerId: "cust-1",
    question: "추천 근거가 뭐야?",
    classification: classifyConsultationIntent("추천 근거가 뭐야?"),
    jobLoader: emptyJobLoader,
    claudeCall: async () => ({
      ok: true,
      message: "이 Claude 응답은 사용되면 안 됩니다.",
    }),
  });
  assert.equal(noStored.ok, true);
  assert.equal(noStored.message, NO_STORED_RECOMMENDATION_MESSAGE);
  console.log("H PASS");
}

// I — coverage_gap_check Step2 회귀 PASS
{
  const classification = classifyConsultationIntent("암보험 부족해?");
  assert.equal(classification.intent, "coverage_gap_check");
  assert.equal(shouldActivateAdvisorBrainForClassification(classification, envOn), true);
  console.log("I PASS");
}

// J — factual_lookup Step3 회귀 PASS
{
  const classification = classifyConsultationIntent("내 보험료 얼마야?");
  assert.equal(classification.intent, "factual_lookup");
  assert.equal(shouldActivateAdvisorBrainForClassification(classification, envOn), true);

  const unsupported = shouldActivateAdvisorBrainForClassification(
    { intent: "factual_lookup", lookup_sub_intent: "unknown" },
    envOn,
    "테스트",
  );
  assert.equal(unsupported, false);
  console.log("J PASS");
}

// insurer fabrication guard
{
  const mismatch = detectRecommendationEvidenceMismatch({
    hasRecommendationEvidence: false,
    message: "A보험사가 1위이며 B보험사는 제외됐습니다.",
  });
  assert.equal(mismatch.mismatched, true);

  const sanitized = sanitizeAdvisorBrainMessage("반드시 가입 가능한 암보험을 추천합니다.", {
    hasPremiumEvidence: false,
    hasCoverageEvidence: true,
  });
  assert.match(sanitized, /확인 필요|미확인/);
  console.log("EXTRA PASS — insurer fabrication guard");
}

console.log("advisor-brain-p1-step4-recommendation-reason-test: PASS");
