/**
 * Production verification: one conversational question → exactly one phase26-2a-result row.
 */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const PRODUCTION_BASE = process.env.PHASE28_PRODUCTION_BASE || "https://lifeguard-core-final.vercel.app";
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const testEmail = process.env.PHASE28_TEST_EMAIL || "sofia113@naver.com";
const testPassword = process.env.PHASE28_TEST_PASSWORD;

if (!url || !anonKey || !serviceRoleKey) {
  throw new Error("SUPABASE_URL, anon key, and SERVICE_ROLE_KEY are required");
}
if (!testPassword) {
  throw new Error("PHASE28_TEST_PASSWORD is required for production verification");
}

const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
const client = createClient(url, anonKey, { auth: { persistSession: false } });

async function pollJobUntilComplete(token, jobId) {
  let latestJob = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await fetch(`${PRODUCTION_BASE}/api/customer-analysis-job`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ job_id: jobId, action: "process" }),
    });
    const payload = await response.json().catch(() => ({}));
    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.equal(payload.ok, true);
    latestJob = payload.analysis_job ?? null;
    if (!latestJob) break;
    if (latestJob.status === "completed" || latestJob.status === "failed") {
      return latestJob;
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  return latestJob;
}

const { data: signIn, error: signInError } = await client.auth.signInWithPassword({
  email: testEmail,
  password: testPassword,
});
if (signInError) throw signInError;
const token = signIn.session.access_token;

const question = `Production 중복응답 검증 ${Date.now()}`;
const qaRes = await fetch(`${PRODUCTION_BASE}/api/customer-conversational-qa`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({ question, auto_process: false }),
});
const qaBody = await qaRes.json().catch(() => ({}));
assert.equal(qaRes.status, 200, JSON.stringify(qaBody));
assert.equal(qaBody.ok, true);
const jobId = qaBody.analysis_job_id;
assert.ok(jobId);

const finalJob = await pollJobUntilComplete(token, jobId);
assert.equal(finalJob?.status, "completed");

const { data: profile } = await admin
  .from("customer_profiles")
  .select("id")
  .eq("user_id", signIn.user.id)
  .maybeSingle();
const customerId = profile?.id;
assert.ok(customerId);

const { count, error: countError } = await admin
  .from("customer_conversations")
  .select("id", { count: "exact", head: true })
  .eq("customer_id", customerId)
  .eq("role", "assistant")
  .contains("metadata_json", { phase: "phase26-2a-result", analysis_job_id: jobId });
if (countError) throw countError;

const { data: jobRow } = await admin
  .from("analysis_jobs")
  .select("timing_metrics, result_json")
  .eq("id", jobId)
  .single();

const pass = count === 1;
console.log(
  JSON.stringify(
    {
      phase: "28-chat-duplicate-production-verify",
      pass,
      production_base: PRODUCTION_BASE,
      analysis_job_id: jobId,
      phase26_2a_result_count: count,
      result_claude_time_ms: jobRow?.timing_metrics?.result_claude_time_ms ?? null,
      result_message_posted: jobRow?.result_json?.result_message_posted ?? null,
    },
    null,
    2,
  ),
);

if (!pass) process.exit(1);
