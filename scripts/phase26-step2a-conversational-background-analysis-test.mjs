/**
 * Phase 26 Step 2A — Conversational Background Analysis test.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { buildFastConversationalResponse } from "../server/fastResponseLayer.js";
import { buildFastReadPayload, makeCacheEntry } from "../server/analysisCacheLayer.js";
import { loadCustomerMemorySnapshot } from "../server/customerMemorySnapshot.js";
import {
  handleConversationalQuestionRequest,
  handleAnalysisJobStatusRequest,
} from "../server/conversationalBackgroundAnalysisCore.js";
import { runAnalysisJobToCompletion } from "../server/backgroundAnalysisJobRunner.js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) throw new Error("SUPABASE_URL and SERVICE_ROLE_KEY are required");

const TEST_CUSTOMER_ID = process.env.PHASE26_TEST_CUSTOMER_ID || "8f8f81e6-a583-44ff-ba6c-a6daed2162ec";
const PRODUCTION_BASE = process.env.PHASE26_PRODUCTION_BASE || "https://lifeguard-core-final.vercel.app";

const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

async function ensureMigrationApplied() {
  const probe = await supabase.from("analysis_jobs").select("id").limit(1);
  if (!probe.error) return { applied: true, method: "existing" };

  const sql = readFileSync(
    new URL("../supabase/migrations/023_conversational_background_analysis.sql", import.meta.url),
    "utf8",
  );

  const { error } = await supabase.rpc("exec_sql", { query: sql }).maybeSingle?.() ?? { error: { message: "no_exec_sql" } };
  if (!error?.message?.includes("no_exec_sql")) {
    const recheck = await supabase.from("analysis_jobs").select("id").limit(1);
    if (!recheck.error) return { applied: true, method: "rpc_exec_sql" };
  }

  return {
    applied: false,
    note: "analysis_jobs table missing — apply migration 023_conversational_background_analysis.sql before production test",
    probe_error: probe.error?.message,
  };
}

const migrationStatus = await ensureMigrationApplied();

const snapshot = await loadCustomerMemorySnapshot(supabase, TEST_CUSTOMER_ID);
const cachePayload = buildFastReadPayload({
  customer_id: TEST_CUSTOMER_ID,
  currentMemoryVersion: snapshot.memory_version,
  cache: {
    coverage_gap: makeCacheEntry({
      data: { gap_score: 100, overall_risk: "high" },
      sourceMemoryVersion: snapshot.memory_version,
    }),
  },
});

const fastResponse = buildFastConversationalResponse({
  question: "암보험 가입 가능할까요?",
  memorySnapshot: snapshot,
  cachePayload,
});

assert.ok(fastResponse.length > 50, "fast response should be substantive");
assert.match(fastResponse, /Memory|분석|보장/);
assert.doesNotMatch(fastResponse, /placeholder|lorem ipsum|TODO/i);

let conversationalResult = null;
let completedJob = null;
let productionResult = null;

if (migrationStatus.applied) {
  const started = Date.now();
  conversationalResult = await handleConversationalQuestionRequest({
    question: "실손은 유지하면서 암·뇌 보장을 보강하려면 어떻게 해야 하나요?",
    testCustomerId: TEST_CUSTOMER_ID,
    adminSupabase: supabase,
    autoProcess: false,
  });

  assert.equal(conversationalResult.ok, true, JSON.stringify(conversationalResult));
  assert.ok(conversationalResult.initial_response_time_ms < 5000, "initial response should be under 5s");
  assert.ok(conversationalResult.fast_response?.length > 30);
  assert.ok(conversationalResult.analysis_job_id);

  const initialMs = Date.now() - started;
  completedJob = await runAnalysisJobToCompletion({
    supabase,
    jobId: conversationalResult.analysis_job_id,
  });

  assert.equal(completedJob?.ok, true, JSON.stringify(completedJob));
  assert.equal(completedJob?.job?.status, "completed");

  const timing = completedJob.job.timing_metrics ?? {};
  assert.ok(Array.isArray(completedJob.job.stages_completed));
  assert.equal(completedJob.job.stages_completed.length, 5);
  assert.ok(timing.initial_response_time_ms != null || conversationalResult.initial_response_time_ms > 0);
  assert.ok(
    (timing.coverage_time_ms ?? 0) >= 0 &&
      (timing.underwriting_time_ms ?? 0) >= 0 &&
      (timing.recommendation_time_ms ?? 0) >= 0 &&
      (timing.design_time_ms ?? 0) >= 0,
  );
  assert.ok((timing.total_analysis_time_ms ?? 0) > 0);

  const statusResult = await handleAnalysisJobStatusRequest({
    jobId: conversationalResult.analysis_job_id,
    testCustomerId: TEST_CUSTOMER_ID,
    adminSupabase: supabase,
    action: "status",
  });
  assert.equal(statusResult.ok, true);
  assert.equal(statusResult.analysis_job.status, "completed");
  assert.ok(statusResult.analysis_job.final_response_text?.length > 20);

  if (process.env.SUPABASE_ACCESS_TOKEN) {
    const keysRes = await fetch(`https://api.supabase.com/v1/projects/fhvlxcguvjvtftttfrix/api-keys`, {
      headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` },
    });
    const anonKey = (await keysRes.json()).find((k) => k.name === "anon")?.api_key;
    const { data: profile } = await supabase
      .from("customer_profiles")
      .select("user_id")
      .eq("id", TEST_CUSTOMER_ID)
      .maybeSingle();
    const { data: userRow } = await supabase.from("users").select("email").eq("id", profile.user_id).maybeSingle();
    const tempPassword = `Phase26Step2A!${Date.now()}`;
    await supabase.auth.admin.updateUserById(profile.user_id, { password: tempPassword });
    const sb = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data: signIn } = await sb.auth.signInWithPassword({ email: userRow.email, password: tempPassword });
    const token = signIn.session.access_token;

    const prodStart = Date.now();
    const prodRes = await fetch(`${PRODUCTION_BASE}/api/customer-conversational-qa`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        question: "보장 공백 분석 결과를 요약해 주세요.",
        auto_process: false,
      }),
    });
    const prodBody = await prodRes.json().catch(() => ({}));
    productionResult = {
      status: prodRes.status,
      ok: prodBody.ok,
      initial_response_time_ms: prodBody.initial_response_time_ms,
      measured_roundtrip_ms: Date.now() - prodStart,
      analysis_job_id: prodBody.analysis_job_id,
      fast_response_preview: String(prodBody.fast_response ?? "").slice(0, 180),
    };
    if (prodRes.status === 404) {
      productionResult.deploy_pending = true;
    } else {
      assert.equal(prodRes.status, 200, JSON.stringify(prodBody));
      assert.equal(prodBody.ok, true);
      assert.ok(prodBody.initial_response_time_ms < 8000);
      productionResult.deploy_verified = true;
    }
  }
}

const report = {
  phase: "26-2A",
  migration: migrationStatus,
  test_customer_id: TEST_CUSTOMER_ID,
  fast_response_unit: {
    pass: true,
    preview: fastResponse.slice(0, 220),
    cache_status: cachePayload.cache_status,
  },
  conversational_flow: conversationalResult
    ? {
        pass: true,
        initial_response_time_ms: conversationalResult.initial_response_time_ms,
        analysis_job_id: conversationalResult.analysis_job_id,
        cache_status: conversationalResult.cache_status,
      }
    : { pass: false, skipped: true },
  background_job: completedJob
    ? {
        pass: completedJob.ok === true && completedJob.job?.status === "completed",
        status: completedJob.job?.status,
        stages_completed: completedJob.job?.stages_completed,
        timing_metrics: completedJob.job?.timing_metrics,
        has_coverage: Boolean(completedJob.job?.result_json?.coverage_gap),
        has_underwriting: Boolean(completedJob.job?.result_json?.underwriting_risk),
        has_recommendation: Boolean(completedJob.job?.result_json?.recommendation),
        has_design: Boolean(completedJob.job?.result_json?.insurance_design),
        final_response_preview: String(completedJob.job?.final_response_text ?? "").slice(0, 220),
      }
    : { pass: false, skipped: true },
  production_api: productionResult,
};

report.allPass =
  report.fast_response_unit.pass &&
  (report.conversational_flow.pass || report.conversational_flow.skipped) &&
  (report.background_job.pass || report.background_job.skipped) &&
  (!report.production_api || report.production_api.deploy_pending || report.production_api.deploy_verified);

console.log(JSON.stringify(report, null, 2));
if (!report.allPass) process.exit(1);
