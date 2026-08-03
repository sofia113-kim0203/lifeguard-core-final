/**
 * Phase 28 — background result speech monopoly verification.
 * Simulates concurrent job completion handlers and asserts no result row is created.
 */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import {
  handleConversationalQuestionRequest,
  postResultMessageIfNeededForTest,
} from "../server/conversationalBackgroundAnalysisCore.js";
import { loadAnalysisJob } from "../server/backgroundAnalysisJobRunner.js";
import { runAnalysisJobToCompletion } from "../server/backgroundAnalysisJobRunner.js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) throw new Error("SUPABASE_URL and SERVICE_ROLE_KEY are required");

const TEST_CUSTOMER_ID =
  process.env.PHASE28_TEST_CUSTOMER_ID || "2d61e1eb-4b8e-43f4-9d31-ad2300ed554e";

const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

async function countResultMessages(customerId, jobId) {
  const { count, error } = await supabase
    .from("customer_conversations")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId)
    .eq("role", "assistant")
    .contains("metadata_json", { phase: "phase26-2a-result", analysis_job_id: jobId });
  if (error) throw error;
  return count ?? 0;
}

const question = `중복응답 감사 테스트 ${Date.now()}`;
const conversationalResult = await handleConversationalQuestionRequest({
  question,
  testCustomerId: TEST_CUSTOMER_ID,
  adminSupabase: supabase,
  autoProcess: false,
});

assert.equal(conversationalResult.ok, true, JSON.stringify(conversationalResult));
const jobId = conversationalResult.analysis_job_id;

const completed = await runAnalysisJobToCompletion({ supabase, jobId });
assert.equal(completed?.job?.status, "completed");

const completedJob = await loadAnalysisJob(supabase, jobId);
assert.ok(completedJob?.final_response_text, "completed job must have final_response_text");

const concurrentPosts = Array.from({ length: 12 }, () =>
  postResultMessageIfNeededForTest(supabase, TEST_CUSTOMER_ID, completedJob),
);

const results = await Promise.all(concurrentPosts);
const postedRows = results.filter((row) => row?.id);
assert.equal(postedRows.length, 0, "background handlers must not return a customer message row");

const resultCount = await countResultMessages(TEST_CUSTOMER_ID, jobId);
assert.equal(resultCount, 0, `expected no phase26-2a-result row, got ${resultCount}`);

const { data: jobRow } = await supabase
  .from("analysis_jobs")
  .select("result_json, timing_metrics")
  .eq("id", jobId)
  .single();

assert.equal(jobRow?.result_json?.result_message_posted, true);
assert.ok(jobRow?.timing_metrics?.result_claude_time_ms != null, "result_claude should have run once");

console.log(
  JSON.stringify(
    {
      phase: "28-chat-duplicate-fix",
      pass: true,
      test_customer_id: TEST_CUSTOMER_ID,
      analysis_job_id: jobId,
      phase26_2a_result_count: resultCount,
      concurrent_handlers: concurrentPosts.length,
      result_claude_time_ms: jobRow?.timing_metrics?.result_claude_time_ms ?? null,
    },
    null,
    2,
  ),
);
