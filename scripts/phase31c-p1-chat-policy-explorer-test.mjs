/**
 * Phase 31-C-P1 — AI 상담실 ↔ Policy Explorer chat integration verification.
 */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import {
  POLICY_DETAIL_RIDER_UNAVAILABLE_MESSAGE,
  answerDirectlyAddressesQuestion,
  buildPolicyDetailAnswer,
  classifyConsultationIntent,
  resolvePipelineManifest,
  resolveSkippedStages,
} from "../server/intentGateLayer.js";
import { handleConversationalQuestionRequest } from "../server/conversationalBackgroundAnalysisCore.js";
import {
  loadAnalysisJob,
  runAnalysisJobToCompletion,
} from "../server/backgroundAnalysisJobRunner.js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_CUSTOMER_ID =
  process.env.AUDIT_CUSTOMER_ID ||
  process.env.PHASE28_TEST_CUSTOMER_ID ||
  "2d61e1eb-4b8e-43f4-9d31-ad2300ed554e";

const POLICY_DETAIL_QUESTIONS = [
  "내 보험 알려줘",
  "내가 가입한 보험은?",
  "보험 보여줘",
  "가입 보험 확인해줘",
  "내 보험 목록",
  "내가 든 보험 알려줘",
];

const routingResults = [];

for (const question of POLICY_DETAIL_QUESTIONS) {
  const classification = classifyConsultationIntent(question);
  const manifest = resolvePipelineManifest(classification.intent);
  const skipped = resolveSkippedStages(manifest);

  assert.equal(
    classification.intent,
    "policy_detail",
    `${question} must route to policy_detail, got ${classification.intent}`,
  );
  assert.notEqual(
    classification.intent,
    "general_consultation",
    `${question} must not be general_consultation`,
  );
  assert.deepEqual(manifest, ["result_claude"], `${question} manifest mismatch`);
  assert.ok(skipped.includes("coverage_gap"), `${question} must skip coverage_gap`);
  assert.ok(skipped.includes("recommendation"), `${question} must skip recommendation`);
  assert.ok(skipped.includes("insurance_design"), `${question} must skip insurance_design`);

  routingResults.push({
    question,
    intent: classification.intent,
    matched_rule: classification.matched_rule,
    manifest,
    skipped,
  });
}

const mockPolicies = [
  {
    id: "p1",
    insurer_name: "메리츠화재",
    product_name: "건강보험(II)2306",
    monthly_premium: 208330,
    policy_type: "health",
    is_active: true,
    policy_status: "유지",
    source: "upload_extract",
    coverage_summary: {},
  },
  {
    id: "p2",
    insurer_name: "한화생명",
    product_name: "뉴하이카운전자상해보험(Hi2304)",
    monthly_premium: 166555,
    policy_type: "driver",
    is_active: true,
    policy_status: "유지",
    source: "signup",
    coverage_summary: { riders: [] },
  },
  {
    id: "p3",
    insurer_name: "삼성화재",
    product_name: "실손의료비",
    monthly_premium: null,
    policy_type: "health",
    is_active: true,
    source: "manual",
    coverage_summary: {},
  },
];

const mockAnswer = buildPolicyDetailAnswer("내 보험 알려줘", {
  snapshot: {
    facts: [{ fact_key: "profile.name", fact_value: "김진우" }],
  },
  sourceContext: { policies: mockPolicies },
  sourceSummary: { insurance: mockPolicies.map(({ monthly_premium, policy_status, ...rest }) => rest) },
});

assert.match(mockAnswer, /김진우님, 현재 등록된 보험은 총 3건입니다\./);
assert.match(mockAnswer, /월 보험료가 확인되는 계약은 2건/);
assert.match(mockAnswer, /확인된 월 보험료 합계는 374,885원/);
assert.match(mockAnswer, /보험료 미확인 1건/);
assert.match(mockAnswer, /1\. 메리츠화재 \/ 건강보험\(II\)2306/);
assert.match(mockAnswer, /- 월 보험료: 208,330원/);
assert.match(mockAnswer, /- 상태: 유지/);
assert.match(mockAnswer, /- 출처: 문서 추출\(OCR\)/);
assert.match(
  mockAnswer,
  new RegExp(POLICY_DETAIL_RIDER_UNAVAILABLE_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
);
assert.ok(!/암|뇌혈관|추천|설계안|부족/.test(mockAnswer), "mock answer must not include analysis topics");

assert.ok(
  answerDirectlyAddressesQuestion("내 보험 알려줘", mockAnswer, { intent: "policy_detail" }),
  "policy_detail answer should directly address question",
);

let integration = null;

if (url && serviceRoleKey) {
  const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  const liveQuestion = `내 보험 알려줘 Phase31C-P1 ${Date.now()}`;

  const conversational = await handleConversationalQuestionRequest({
    question: liveQuestion,
    testCustomerId: TEST_CUSTOMER_ID,
    adminSupabase: supabase,
    autoProcess: false,
  });

  assert.equal(conversational.ok, true, JSON.stringify(conversational));
  assert.equal(
    conversational.analysis_job?.result_json?.intent_gate?.intent ?? null,
    "policy_detail",
    "live job must classify as policy_detail",
  );

  const fastResponse = conversational.fast_response ?? "";
  assert.ok(fastResponse.length > 0, "policy_detail fast response required");
  assert.match(fastResponse, /총\s*8건/, `expected 8 policies in fast response: ${fastResponse.slice(0, 240)}`);
  assert.match(fastResponse, /월 보험료 합계/, "fast response must include premium sum");
  assert.match(
    fastResponse,
    new RegExp(POLICY_DETAIL_RIDER_UNAVAILABLE_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    "fast response must include rider unavailable message",
  );
  assert.ok(
    !/가입 보험 확인 중/.test(fastResponse),
    "fast response must not stall on coverage_gap label",
  );
  assert.ok(
    !/암보험|뇌혈관|추천|설계안|보장이\s*부족/.test(fastResponse),
    `fast response must not include unsolicited analysis: ${fastResponse.slice(0, 240)}`,
  );
  assert.ok(
    /1\.\s*.+\s*\/\s*.+/.test(fastResponse),
    "fast response must list policies per contract",
  );

  const completed = await runAnalysisJobToCompletion({
    supabase,
    jobId: conversational.analysis_job_id,
  });
  assert.equal(completed?.job?.status, "completed");

  const completedJob = await loadAnalysisJob(supabase, conversational.analysis_job_id);
  const stagesCompleted = completedJob?.stages_completed ?? [];
  assert.ok(!stagesCompleted.includes("coverage_gap"), "policy_detail must not run coverage_gap");
  assert.ok(!stagesCompleted.includes("recommendation"), "policy_detail must not run recommendation");
  assert.ok(!stagesCompleted.includes("insurance_design"), "policy_detail must not run insurance_design");
  assert.ok(stagesCompleted.includes("result_claude"), "policy_detail should complete result_claude");

  const finalResponse = String(completedJob?.final_response_text ?? "");
  assert.match(finalResponse, /총\s*8건/, "final response must include 8 policies");
  assert.match(finalResponse, /월 보험료 합계/, "final response must include premium sum");
  assert.equal(
    completedJob?.result_json?.final_claude?.explanation_mode ?? null,
    "policy_detail_light",
    "final explanation should use policy_detail_light",
  );

  const { count: resultCount, error: countError } = await supabase
    .from("customer_conversations")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", TEST_CUSTOMER_ID)
    .eq("role", "assistant")
    .contains("metadata_json", {
      phase: "phase26-2a-result",
      analysis_job_id: conversational.analysis_job_id,
    });
  if (countError) throw countError;
  assert.equal(resultCount, 0, "policy_detail test keeps single result duplicate guard");

  integration = {
    analysis_job_id: conversational.analysis_job_id,
    customer_id: TEST_CUSTOMER_ID,
    stages_completed: stagesCompleted,
    fast_response_preview: fastResponse.slice(0, 240),
    final_response_preview: finalResponse.slice(0, 240),
    explanation_mode: completedJob?.result_json?.final_claude?.explanation_mode ?? null,
    phase26_2a_result_count: resultCount,
  };
}

console.log(
  JSON.stringify(
    {
      phase: "31c-p1-chat-policy-explorer",
      pass: true,
      routing_results: routingResults,
      mock_answer_preview: mockAnswer.split("\n").slice(0, 8),
      integration,
    },
    null,
    2,
  ),
);
