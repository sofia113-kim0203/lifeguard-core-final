/**
 * Casual chat intent gate — routing and API behavior (mocked Claude).
 */
import assert from "node:assert/strict";
import {
  classifyConsultationIntent,
  detectCasualChatIntent,
  hasInsuranceTopicSignal,
  resolvePipelineManifest,
} from "../server/intentGateLayer.js";
import { handleConversationalQuestionRequest } from "../server/conversationalBackgroundAnalysisCore.js";
import { CASUAL_CHAT_FALLBACK } from "../server/casualChatResponseCore.js";

const ROUTING_CASES = [
  { question: "하이", intent: "casual_chat", manifest: [], matched_rule: "casual_greeting" },
  { question: "안녕하세요", intent: "casual_chat", manifest: [], matched_rule: "casual_greeting" },
  { question: "고마워", intent: "casual_chat", manifest: [], matched_rule: "casual_thanks" },
  { question: "오늘 힘드네", intent: "casual_chat", manifest: [], matched_rule: "casual_emotion_check" },
  { question: "잠이 안 온다", intent: "casual_chat", manifest: [], matched_rule: "casual_emotion_check" },
  {
    question: "보험료 줄이고 싶어",
    intent: "general_consultation",
    manifest: ["coverage_gap", "result_claude"],
  },
  {
    question: "오늘 힘든데 보험료도 부담돼",
    intent: "general_consultation",
    notCasual: true,
  },
];

for (const testCase of ROUTING_CASES) {
  const classification = classifyConsultationIntent(testCase.question);
  const manifest = resolvePipelineManifest(classification.intent);
  assert.equal(
    classification.intent,
    testCase.intent,
    `${testCase.question}: expected ${testCase.intent}, got ${classification.intent}`,
  );
  if (testCase.manifest) {
    assert.deepEqual(manifest, testCase.manifest, `${testCase.question} manifest mismatch`);
  }
  if (testCase.matched_rule) {
    assert.equal(classification.matched_rule, testCase.matched_rule);
  }
  if (testCase.notCasual) {
    assert.equal(detectCasualChatIntent(testCase.question), null);
    assert.equal(hasInsuranceTopicSignal(testCase.question), true);
  }
}

const mockFetch = async () => ({
  ok: true,
  status: 200,
  headers: { get: () => "req_casual_test" },
  text: async () =>
    JSON.stringify({
      id: "msg_casual",
      model: "claude-sonnet-4-6",
      content: [{ type: "text", text: "안녕하세요! 오늘도 편안한 하루 보내세요." }],
    }),
});

const mockAdmin = {
  from(table) {
    const chain = {
      insert() {
        return chain;
      },
      update() {
        return chain;
      },
      select() {
        return chain;
      },
      eq() {
        return chain;
      },
      single: async () => ({
        data: {
          id: `row-${table}-${Date.now()}`,
          customer_id: "cust-test",
          role: "assistant",
          message: "ok",
          metadata_json: {},
          created_at: new Date().toISOString(),
        },
        error: null,
      }),
    };
    return chain;
  },
};

const casualResult = await handleConversationalQuestionRequest({
  question: "하이",
  testCustomerId: "cust-test",
  adminSupabase: mockAdmin,
  fetchImpl: mockFetch,
  env: { ANTHROPIC_API_KEY: "test-key" },
});

assert.equal(casualResult.ok, true);
assert.equal(casualResult.source, "casual_claude");
assert.equal(casualResult.analysis_job_id, null);
assert.equal(casualResult.analysis_job, null);
assert.equal(casualResult.background_refresh_required, false);
assert.ok(casualResult.fast_response.length > 0);
assert.notEqual(casualResult.fast_response.includes("보장 상태와 인수 심사"), true);

const fallbackResult = await handleConversationalQuestionRequest({
  question: "안녕하세요",
  testCustomerId: "cust-test",
  adminSupabase: mockAdmin,
  fetchImpl: async () => ({
    ok: false,
    status: 500,
    headers: { get: () => null },
    text: async () => JSON.stringify({ error: { type: "api_error", message: "fail" } }),
  }),
  env: { ANTHROPIC_API_KEY: "test-key" },
});

assert.equal(fallbackResult.fast_response, CASUAL_CHAT_FALLBACK);
assert.equal(fallbackResult.analysis_job_id, null);

console.log("casual-chat-intent-gate-test: PASS");
