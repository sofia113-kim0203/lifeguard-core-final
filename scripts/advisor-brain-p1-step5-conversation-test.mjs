/**
 * Advisor Brain P1 Step 5 — advisor conversation tests (no live DB / no live Claude).
 */
import assert from "node:assert/strict";
import { classifyConsultationIntent } from "../server/intentGateLayer.js";
import {
  shouldActivateAdvisorBrainForClassification,
} from "../server/advisorBrain/advisorBrainResponder.js";
import {
  ADVISOR_BRAIN_CONVERSATION_MAX_TOKENS,
  NO_STORED_CONVERSATION_MESSAGE,
  buildAdvisorConversationUserPrompt,
  buildStoredConversationEvidence,
  detectConversationEvidenceMismatch,
  isAdvisorConversationQuestion,
  buildAdvisorConversationAnswer,
} from "../server/advisorBrain/advisorConversationResponder.js";
import { isRecommendationReasonClassification } from "../server/advisorBrain/advisorRecommendationReasonResponder.js";
import { mapJobResultsToAnalysisPanels } from "../src/lib/analysisPanelJobUtils.js";

const envOn = { ADVISOR_BRAIN_ENABLED: "true" };
const envOff = { ADVISOR_BRAIN_ENABLED: "false" };

const mockCompletedJob = {
  id: "job-conv-1",
  status: "completed",
  customer_id: "cust-1",
  result_json: {
    coverage_gap: {
      gap_score: 78,
      items: [
        {
          coverage_category: "cancer",
          coverage_label: "암",
          gap_level: "high",
          reason: "암 보장이 부족합니다.",
        },
        {
          coverage_category: "cerebrovascular",
          coverage_label: "뇌혈관",
          gap_level: "critical",
          reason: "뇌혈관 보장 공백이 큽니다.",
        },
      ],
      top_gaps: [
        { coverage_label: "뇌혈관", gap_level: "critical" },
        { coverage_label: "암", gap_level: "high" },
      ],
    },
    underwriting_risk: {
      items: [
        {
          coverage_category: "cerebrovascular",
          coverage_label: "뇌혈관",
          underwriting_status: "likely_standard",
          reason: "현재 건강 memory 기준 인수 제한 신호는 제한적입니다.",
        },
      ],
    },
    recommendation: {
      customer_visible_top2: [
        {
          recommendation_rank: 1,
          recommendation_score: 120,
          coverage_label: "뇌혈관",
          coverage_category: "cerebrovascular",
          reason: "뇌혈관 보장 보강이 필요합니다.",
          underwriting_consideration: "인수 제한 신호는 제한적입니다.",
          coverage_gap_level: "critical",
        },
        {
          recommendation_rank: 2,
          recommendation_score: 95,
          coverage_label: "암",
          coverage_category: "cancer",
          reason: "암 보장 검토가 필요합니다.",
          underwriting_consideration: "인수 제한 신호는 제한적입니다.",
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
      "현재 분석 결과 기준으로는 뇌혈관 보장 공백이 가장 크게 확인됩니다. 추가 가입을 검토한다면 뇌혈관 보완을 먼저 고려하는 것이 좋겠습니다. 실제 가입 가능 여부는 인수심사 확인이 필요합니다.",
  };
};

// A — 보험 더 들어야 해?
{
  const question = "보험 더 들어야 해?";
  const classification = classifyConsultationIntent(question);
  assert.equal(isAdvisorConversationQuestion(classification, question), true);

  const result = await buildAdvisorConversationAnswer({
    supabase: {},
    customerId: "cust-1",
    question,
    classification,
    jobLoader: mockJobLoader,
    claudeCall: mockClaude,
  });

  assert.equal(result.ok, true);
  assert.match(result.message, /뇌혈관|보장|분석|검토|인수/);
  assert.equal(result.advisor_conversation_mode, true);
  assert.equal(result.engine_executed, false);
  assert.equal(capturedMaxTokens, ADVISOR_BRAIN_CONVERSATION_MAX_TOKENS);
  console.log("A PASS");
}

// B — 뭘 먼저 해야 해?
{
  const question = "뭘 먼저 해야 해?";
  const classification = classifyConsultationIntent(question);
  const evidence = buildStoredConversationEvidence(mockPanels);
  const prompt = buildAdvisorConversationUserPrompt({ question, evidence });

  assert.match(prompt, /"recommendation_rank": 1/);
  assert.match(prompt, /뇌혈관/);

  const result = await buildAdvisorConversationAnswer({
    supabase: {},
    customerId: "cust-1",
    question,
    classification,
    jobLoader: mockJobLoader,
    claudeCall: async () => ({
      ok: true,
      message:
        "저장된 분석 기준 1순위는 뇌혈관 보장 보완 검토입니다. 암 보장은 그다음 우선순위로 확인됩니다. 실제 가입 가능 여부는 인수심사 확인이 필요합니다.",
    }),
  });

  assert.equal(result.ok, true);
  assert.match(result.message, /뇌혈관|우선|1순위|먼저/);
  console.log("B PASS");
}

// C — 암이랑 뇌혈관 중 뭐가 더 급해? → rank 기반 설명
{
  const question = "암이랑 뇌혈관 중 뭐가 더 급해?";
  const factualClassification = classifyConsultationIntent(question);
  assert.equal(factualClassification.intent, "factual_lookup");
  assert.equal(isAdvisorConversationQuestion(factualClassification, question), false);

  const conversationClassification = { intent: "general_consultation" };
  assert.equal(isAdvisorConversationQuestion(conversationClassification, question), true);

  const result = await buildAdvisorConversationAnswer({
    supabase: {},
    customerId: "cust-1",
    question,
    classification: conversationClassification,
    jobLoader: mockJobLoader,
    claudeCall: async () => ({
      ok: true,
      message:
        "저장된 분석 기준으로는 뇌혈관 보장 공백이 critical로 암보다 우선 검토가 필요합니다. 실제 가입 가능 여부는 인수심사 확인이 필요합니다.",
    }),
  });

  assert.equal(result.ok, true);
  assert.match(result.message, /뇌혈관|암|급|우선|critical|공백/);
  console.log("C PASS");
}

// D — 분석 결과 없음
{
  const result = await buildAdvisorConversationAnswer({
    supabase: {},
    customerId: "cust-1",
    question: "지금 상태 괜찮아?",
    classification: classifyConsultationIntent("지금 상태 괜찮아?"),
    jobLoader: emptyJobLoader,
    claudeCall: async () => ({
      ok: true,
      message: "이 Claude 응답은 사용되면 안 됩니다.",
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.message, NO_STORED_CONVERSATION_MESSAGE);
  assert.equal(result.guardrail_summary.no_stored_analysis, true);
  console.log("D PASS");
}

// E — 보험사 추천해줘 → conversation 비활성
{
  const question = "보험사 추천해줘";
  const classification = classifyConsultationIntent(question);
  assert.equal(isAdvisorConversationQuestion(classification, question), false);
  assert.equal(shouldActivateAdvisorBrainForClassification(classification, envOn, question), false);

  const mismatch = detectConversationEvidenceMismatch({
    hasStoredAnalysis: true,
    message: "A보험사를 추천합니다.",
  });
  assert.equal(mismatch.mismatched, true);
  console.log("E PASS");
}

// F — 상품 추천해줘 → conversation 비활성
{
  const question = "상품 추천해줘";
  const classification = classifyConsultationIntent(question);
  assert.equal(isAdvisorConversationQuestion(classification, question), false);

  const mismatch = detectConversationEvidenceMismatch({
    hasStoredAnalysis: true,
    message: "이 상품을 추천합니다.",
  });
  assert.equal(mismatch.mismatched, true);
  console.log("F PASS");
}

// G — Step2 회귀
{
  const classification = classifyConsultationIntent("암보험 부족해?");
  assert.equal(classification.intent, "coverage_gap_check");
  assert.equal(shouldActivateAdvisorBrainForClassification(classification, envOn), true);
  assert.equal(isAdvisorConversationQuestion(classification, "암보험 부족해?"), false);
  console.log("G PASS");
}

// H — Step3 회귀
{
  const classification = classifyConsultationIntent("내 보험료 얼마야?");
  assert.equal(classification.intent, "factual_lookup");
  assert.equal(shouldActivateAdvisorBrainForClassification(classification, envOn), true);
  assert.equal(isAdvisorConversationQuestion(classification, "내 보험료 얼마야?"), false);
  console.log("H PASS");
}

// I — Step4 회귀
{
  const question = "추천 근거가 뭐야?";
  const classification = classifyConsultationIntent(question);
  assert.equal(isRecommendationReasonClassification(classification, question), true);
  assert.equal(shouldActivateAdvisorBrainForClassification(classification, envOn, question), true);
  assert.equal(isAdvisorConversationQuestion(classification, question), false);
  console.log("I PASS");
}

// J — flag OFF
{
  const classification = classifyConsultationIntent("보험 더 들어야 해?");
  assert.equal(
    shouldActivateAdvisorBrainForClassification(classification, envOff, "보험 더 들어야 해?"),
    false,
  );
  console.log("J PASS");
}

console.log("advisor-brain-p1-step5-conversation-test: PASS");
