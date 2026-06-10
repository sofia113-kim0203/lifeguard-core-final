/**
 * Phase 30-A — Claim Intelligence Bridge routing verification.
 */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import {
  assertClaimGuardrails,
  buildClaimBridgeAnswer,
  detectClaimTopic,
} from "../server/claimBridgeLayer.js";
import {
  answerDirectlyAddressesQuestion,
  classifyConsultationIntent,
  resolvePipelineManifest,
  resolveSkippedStages,
} from "../server/intentGateLayer.js";
import { buildFastConversationalResponse } from "../server/fastResponseLayer.js";
import { handleConversationalQuestionRequest } from "../server/conversationalBackgroundAnalysisCore.js";
import {
  loadAnalysisJob,
  runAnalysisJobToCompletion,
} from "../server/backgroundAnalysisJobRunner.js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_CUSTOMER_ID =
  process.env.PHASE28_TEST_CUSTOMER_ID || "2d61e1eb-4b8e-43f4-9d31-ad2300ed554e";

const CLAIM_ROUTING_CASES = [
  "청구 가능할까요?",
  "골절인데 받을 수 있나요?",
  "수술했는데 청구돼요?",
  "암 진단받았는데 보험금 나오나요?",
  "약관상 지급되나요?",
  "실손 청구 가능해요?",
];

const FORBIDDEN_STAGES = [
  "coverage_gap",
  "underwriting_risk",
  "recommendation",
  "insurance_design",
];

const FORBIDDEN_DEFINITIVE = [
  /무조건\s*받을\s*수\s*있/,
  /청구\s*가능합니다/,
  /지급됩니다/,
  /불가능합니다/,
];

const routingResults = [];

for (const question of CLAIM_ROUTING_CASES) {
  const classification = classifyConsultationIntent(question);
  const manifest = resolvePipelineManifest(classification.intent);
  const skipped = resolveSkippedStages(manifest);

  assert.equal(
    classification.intent,
    "claim_eligibility_check",
    `${question} intent mismatch: ${classification.intent}`,
  );
  assert.notEqual(
    classification.intent,
    "factual_lookup",
    `${question} must not be factual_lookup`,
  );
  assert.deepEqual(manifest, ["result_claude"], `${question} manifest mismatch`);

  for (const forbidden of FORBIDDEN_STAGES) {
    assert.ok(skipped.includes(forbidden), `${question} should skip ${forbidden}`);
    assert.ok(!manifest.includes(forbidden), `${question} manifest must not include ${forbidden}`);
  }

  const topic = detectClaimTopic(question);
  const fastResponse = buildFastConversationalResponse({
    question,
    memorySnapshot: { facts: [], fact_count: 0 },
    cachePayload: null,
    sourceContext: { has_policies: true, policies: [{ insurer_name: "한화", product_name: "실손보험" }] },
    sourceSummary: {
      policy_count: 1,
      insurance: [{ insurer_name: "한화", product_name: "실손보험" }],
    },
    intentGate: {
      intent: "claim_eligibility_check",
      result_mode: "claim_light",
    },
  });

  assert.ok(/약관/.test(fastResponse), `${question} fast response must mention 약관`);
  assert.ok(/서류/.test(fastResponse), `${question} fast response must mention 서류`);
  if (topic.label && topic.label !== "보험금") {
    assert.ok(
      fastResponse.includes(topic.label),
      `${question} fast response should reflect topic ${topic.label}: ${fastResponse}`,
    );
  }

  assert.ok(
    answerDirectlyAddressesQuestion(question, fastResponse, { intent: "claim_eligibility_check" }),
    `${question} fast response should directly address claim question`,
  );

  routingResults.push({
    question,
    intent: classification.intent,
    manifest,
    skipped,
    matched_rule: classification.matched_rule,
    claim_topic: topic.topicKey,
    fast_response_preview: fastResponse.slice(0, 180),
  });
}

assert.equal(classifyConsultationIntent("운전자보험 있나요?").intent, "factual_lookup");
assert.equal(classifyConsultationIntent("암보험 부족해?").intent, "coverage_gap_check");

let claimIntegration = null;

if (url && serviceRoleKey) {
  const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  const claimQuestion = `골절인데 받을 수 있나요? Phase30A ${Date.now()}`;

  const conversational = await handleConversationalQuestionRequest({
    question: claimQuestion,
    testCustomerId: TEST_CUSTOMER_ID,
    adminSupabase: supabase,
    autoProcess: false,
  });

  assert.equal(conversational.ok, true, JSON.stringify(conversational));
  assert.equal(
    conversational.analysis_job?.result_json?.intent_gate?.intent ?? null,
    "claim_eligibility_check",
  );
  assert.equal(
    conversational.analysis_job?.result_json?.intent_gate?.result_mode ?? null,
    "claim_light",
  );

  const fastResponse = conversational.fast_response ?? "";
  assert.ok(!/뇌혈관|심혈관|보장이\s*부족|추천/.test(fastResponse), `fast response must not lead with gap/recommendation: ${fastResponse}`);

  const completed = await runAnalysisJobToCompletion({ supabase, jobId: conversational.analysis_job_id });
  assert.equal(completed?.job?.status, "completed");

  const completedJob = await loadAnalysisJob(supabase, conversational.analysis_job_id);
  const stagesCompleted = completedJob?.stages_completed ?? [];
  const finalText = String(completedJob?.final_response_text ?? "");

  assert.ok(!stagesCompleted.includes("coverage_gap"), "claim must not run coverage_gap");
  assert.ok(!stagesCompleted.includes("underwriting_risk"), "claim must not run underwriting_risk");
  assert.ok(!stagesCompleted.includes("recommendation"), "claim must not run recommendation");
  assert.ok(!stagesCompleted.includes("insurance_design"), "claim must not run insurance_design");
  assert.equal(stagesCompleted.filter((stage) => stage === "result_claude").length, 1, "claim should run result_claude once");
  assert.ok(finalText.length > 0, "claim final response required");

  const guardrails = assertClaimGuardrails(finalText);
  assert.equal(guardrails.ok, true, `guardrails failed: ${JSON.stringify(guardrails)}`);

  for (const pattern of FORBIDDEN_DEFINITIVE) {
    assert.ok(!pattern.test(finalText), `definitive phrase forbidden: ${pattern} in ${finalText}`);
  }

  const bridgePreview = await buildClaimBridgeAnswer({
    question: claimQuestion,
    workingContext: completedJob?.result_json?.working_context ?? {},
    supabase,
  });

  assert.ok(
    ["none", "rag_only", "rag_claude"].includes(bridgePreview.rag_mode),
    `unexpected rag_mode: ${bridgePreview.rag_mode}`,
  );
  assert.ok(bridgePreview.text.length > 0, "bridge answer required");

  claimIntegration = {
    analysis_job_id: conversational.analysis_job_id,
    stages_completed: stagesCompleted,
    explanation_mode: completedJob?.result_json?.explanation_mode ?? null,
    rag_mode: bridgePreview.rag_mode,
    rag_row_count: bridgePreview.rag_row_count,
    fast_response_preview: fastResponse.slice(0, 180),
    final_response_preview: finalText.slice(0, 220),
    guardrails_ok: guardrails.ok,
  };
}

console.log(
  JSON.stringify(
    {
      phase: "30-claim-bridge-routing",
      pass: true,
      routing_results: routingResults,
      claim_integration: claimIntegration,
    },
    null,
    2,
  ),
);
