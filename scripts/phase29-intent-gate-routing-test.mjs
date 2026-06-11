/**
 * Phase 29-A — Intent Gate routing and factual_lookup pipeline verification.
 */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import {
  answerDirectlyAddressesQuestion,
  classifyConsultationIntent,
  resolvePipelineManifest,
  resolveSkippedStages,
} from "../server/intentGateLayer.js";
import { handleConversationalQuestionRequest } from "../server/conversationalBackgroundAnalysisCore.js";
import {
  loadAnalysisJob,
  runAnalysisJobToCompletion,
} from "../server/backgroundAnalysisJobRunner.js";
import { resolveAuditCustomerId } from "./lib/sandboxAuthGuard.js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_CUSTOMER_ID = resolveAuditCustomerId(process.env.PHASE28_TEST_CUSTOMER_ID);

const ROUTING_CASES = [
  {
    question: "운전자보험 있나요?",
    intent: "factual_lookup",
    manifest: ["result_claude"],
    forbiddenStages: ["coverage_gap", "underwriting_risk", "recommendation", "insurance_design"],
  },
  {
    question: "실손 있나요?",
    intent: "factual_lookup",
    manifest: ["result_claude"],
    forbiddenStages: ["coverage_gap", "underwriting_risk", "recommendation", "insurance_design"],
  },
  {
    question: "내 보험 몇 건이야?",
    intent: "factual_lookup",
    manifest: ["result_claude"],
    forbiddenStages: ["coverage_gap", "underwriting_risk", "recommendation", "insurance_design"],
  },
  {
    question: "암보험 부족해?",
    intent: "coverage_gap_check",
    manifest: ["coverage_gap", "result_claude"],
    forbiddenStages: ["underwriting_risk", "recommendation", "insurance_design"],
  },
  {
    question: "뭘 가입해야 해?",
    intent: "recommendation_request",
    manifest: ["coverage_gap", "recommendation", "result_claude"],
    forbiddenStages: ["underwriting_risk", "insurance_design"],
  },
  {
    question: "설계안 만들어줘",
    intent: "design_request",
    manifest: [
      "coverage_gap",
      "underwriting_risk",
      "recommendation",
      "insurance_design",
      "result_claude",
    ],
    forbiddenStages: [],
  },
];

const routingResults = [];

for (const testCase of ROUTING_CASES) {
  const classification = classifyConsultationIntent(testCase.question);
  const manifest = resolvePipelineManifest(classification.intent);
  const skipped = resolveSkippedStages(manifest);

  assert.equal(
    classification.intent,
    testCase.intent,
    `${testCase.question} intent mismatch: ${classification.intent}`,
  );
  assert.deepEqual(manifest, testCase.manifest, `${testCase.question} manifest mismatch`);

  for (const forbidden of testCase.forbiddenStages) {
    assert.ok(
      skipped.includes(forbidden),
      `${testCase.question} should skip ${forbidden}, skipped=${skipped.join(",")}`,
    );
    assert.ok(
      !manifest.includes(forbidden),
      `${testCase.question} manifest must not include ${forbidden}`,
    );
  }

  routingResults.push({
    question: testCase.question,
    intent: classification.intent,
    manifest,
    skipped,
    matched_rule: classification.matched_rule,
  });
}

let factualIntegration = null;
let duplicateGuard = null;

if (url && serviceRoleKey) {
  const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

  const factualQuestion = `운전자보험 있나요? Phase29A ${Date.now()}`;
  const conversational = await handleConversationalQuestionRequest({
    question: factualQuestion,
    testCustomerId: TEST_CUSTOMER_ID,
    adminSupabase: supabase,
    autoProcess: false,
  });

  assert.equal(conversational.ok, true, JSON.stringify(conversational));
  assert.equal(
    conversational.analysis_job?.result_json?.intent_gate?.intent ?? null,
    "factual_lookup",
  );

  const fastResponse = conversational.fast_response ?? "";
  assert.ok(fastResponse.length > 0, "factual_lookup fast response required");
  assert.ok(
    !/뇌혈관|심혈관|보장이\s*부족/.test(fastResponse),
    `fast response must not lead with gap analysis: ${fastResponse}`,
  );
  assert.ok(
    answerDirectlyAddressesQuestion(factualQuestion, fastResponse, {
      intent: "factual_lookup",
      lookup_category: "driver",
      lookup_sub_intent: "coverage_presence",
    }),
    `fast response should directly address question: ${fastResponse}`,
  );

  const completed = await runAnalysisJobToCompletion({ supabase, jobId: conversational.analysis_job_id });
  assert.equal(completed?.job?.status, "completed");

  const completedJob = await loadAnalysisJob(supabase, conversational.analysis_job_id);
  const stagesCompleted = completedJob?.stages_completed ?? [];

  assert.ok(!stagesCompleted.includes("coverage_gap"), "factual_lookup must not run coverage_gap");
  assert.ok(!stagesCompleted.includes("recommendation"), "factual_lookup must not run recommendation");
  assert.ok(!stagesCompleted.includes("insurance_design"), "factual_lookup must not run insurance_design");
  assert.ok(stagesCompleted.includes("result_claude"), "factual_lookup should run result_claude light");

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
  assert.equal(resultCount, 0, "routing test does not post result message directly");

  factualIntegration = {
    analysis_job_id: conversational.analysis_job_id,
    stages_completed: stagesCompleted,
    fast_response_preview: fastResponse.slice(0, 160),
    final_response_preview: String(completedJob?.final_response_text ?? "").slice(0, 160),
    explanation_mode: completedJob?.result_json?.explanation_mode ?? null,
  };

  const duplicateQuestion = `Phase29A duplicate guard ${Date.now()}`;
  const duplicateRun = await handleConversationalQuestionRequest({
    question: duplicateQuestion,
    testCustomerId: TEST_CUSTOMER_ID,
    adminSupabase: supabase,
    autoProcess: false,
  });
  assert.equal(duplicateRun.ok, true);
  await runAnalysisJobToCompletion({ supabase, jobId: duplicateRun.analysis_job_id });
  const duplicateJob = await loadAnalysisJob(supabase, duplicateRun.analysis_job_id);
  assert.ok(duplicateJob?.final_response_text, "completed job must have final response");

  const { count: duplicateResultCount, error: duplicateCountError } = await supabase
    .from("customer_conversations")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", TEST_CUSTOMER_ID)
    .eq("role", "assistant")
    .contains("metadata_json", {
      phase: "phase26-2a-result",
      analysis_job_id: duplicateRun.analysis_job_id,
    });
  if (duplicateCountError) throw duplicateCountError;
  assert.equal(duplicateResultCount, 0, "routing test leaves result posting to existing duplicate-guard flows");

  duplicateGuard = {
    analysis_job_id: duplicateRun.analysis_job_id,
    intent: duplicateJob?.result_json?.intent_gate?.intent ?? null,
    phase26_2a_result_count: duplicateResultCount,
  };
}

console.log(
  JSON.stringify(
    {
      phase: "29-intent-gate-routing",
      pass: true,
      routing_results: routingResults,
      factual_integration: factualIntegration,
      duplicate_guard: duplicateGuard,
    },
    null,
    2,
  ),
);
