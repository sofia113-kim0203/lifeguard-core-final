/**
 * analysis_jobs E2E — queued → completed pipeline for sandbox + insured customers.
 *
 * Usage:
 *   node scripts/analysis_jobs_e2e_test.mjs
 *
 * Optional env:
 *   E2E_SANDBOX_CUSTOMER_ID
 *   E2E_INSURED_CUSTOMER_ID
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { ANALYSIS_PIPELINE_STAGES } from "../server/backgroundAnalysisJobRunner.js";
import {
  handleAnalysisJobStatusRequest,
  handleConversationalQuestionRequest,
} from "../server/conversationalBackgroundAnalysisCore.js";

const ENV_LOCAL = ".env.local";

function loadEnvLocal() {
  if (!existsSync(ENV_LOCAL)) return;
  for (const line of readFileSync(ENV_LOCAL, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvLocal();

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error("Missing SUPABASE_URL or SERVICE_ROLE_KEY (.env.local)");
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

async function discoverCustomers() {
  const sandboxOverride = process.env.E2E_SANDBOX_CUSTOMER_ID?.trim();
  const insuredOverride = process.env.E2E_INSURED_CUSTOMER_ID?.trim();
  if (sandboxOverride && insuredOverride) {
    return { sandboxId: sandboxOverride, insuredId: insuredOverride };
  }

  const { data: profiles, error } = await admin
    .from("customer_profiles")
    .select("id, display_name")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(40);

  if (error) throw new Error(`profile_lookup_failed: ${error.message}`);

  let sandboxId = sandboxOverride ?? null;
  let insuredId = insuredOverride ?? null;

  for (const profile of profiles ?? []) {
    const { count } = await admin
      .from("profile_insurance_policies")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", profile.id)
      .is("deleted_at", null);

    const policyCount = count ?? 0;
    if (!sandboxId && policyCount === 0) sandboxId = profile.id;
    if (!insuredId && policyCount > 0) insuredId = profile.id;
    if (sandboxId && insuredId) break;
  }

  if (!sandboxId || !insuredId) {
    throw new Error(
      `Could not discover sandbox/insured customers (sandbox=${sandboxId}, insured=${insuredId})`,
    );
  }

  return { sandboxId, insuredId };
}

async function pollJobViaApi(customerId, jobId, maxAttempts = 40) {
  let latest = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const result = await handleAnalysisJobStatusRequest({
      jobId,
      testCustomerId: customerId,
      adminSupabase: admin,
      action: "process",
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    latest = result.analysis_job;
    if (latest?.status === "completed" || latest?.status === "failed") {
      return { latest, attempts: attempt + 1 };
    }
  }
  return { latest, attempts: maxAttempts };
}

async function runCustomerScenario({ label, customerId, question }) {
  const created = await handleConversationalQuestionRequest({
    question,
    testCustomerId: customerId,
    adminSupabase: admin,
    autoProcess: false,
  });

  assert.equal(created.ok, true, `${label}: create failed ${JSON.stringify(created)}`);
  assert.equal(created.analysis_job?.status, "queued", `${label}: job must start queued`);

  const jobId = created.analysis_job_id;
  const { latest, attempts } = await pollJobViaApi(customerId, jobId);

  assert.ok(latest, `${label}: missing latest job`);
  assert.equal(latest.status, "completed", `${label}: expected completed got ${latest.status}`);
  assert.deepEqual(
    latest.stages_completed,
    ANALYSIS_PIPELINE_STAGES,
    `${label}: stage list mismatch`,
  );

  const result = latest.result_json ?? {};
  for (const stage of ANALYSIS_PIPELINE_STAGES) {
    assert.ok(result[stage], `${label}: missing result_json.${stage}`);
  }

  assert.ok(result.coverage_gap, `${label}: coverage_gap payload missing`);
  assert.ok(result.underwriting_risk, `${label}: underwriting_risk payload missing`);
  assert.ok(result.recommendation, `${label}: recommendation payload missing`);
  assert.ok(result.insurance_design, `${label}: insurance_design payload missing`);

  const { data: cacheRows, error: cacheError } = await admin
    .from("customer_analysis_cache")
    .select("cache_key, memory_version")
    .eq("customer_id", customerId)
    .in("cache_key", ["coverage_gap", "underwriting_risk", "recommendation", "insurance_design"]);

  if (!cacheError) {
    assert.ok((cacheRows ?? []).length >= 1, `${label}: expected cache rows`);
  }

  const { data: reloaded } = await admin
    .from("analysis_jobs")
    .select("id, status, stages_completed, result_json")
    .eq("id", jobId)
    .maybeSingle();

  assert.equal(reloaded?.status, "completed", `${label}: reload status`);
  assert.equal(reloaded?.stages_completed?.length, 5, `${label}: reload stages`);

  return {
    label,
    customer_id: customerId,
    job_id: jobId,
    attempts,
    stages_completed: latest.stages_completed,
    timing_metrics: latest.timing_metrics,
    has_top2: Boolean(result.recommendation?.customer_visible_top2?.length),
    has_design: Boolean(result.insurance_design?.customer_visible_design),
    cache_rows: cacheRows?.length ?? 0,
  };
}

const report = {
  test: "analysis_jobs_e2e",
  pipeline_stages: ANALYSIS_PIPELINE_STAGES,
  customers: await discoverCustomers(),
  scenarios: [],
  pass: false,
};

report.scenarios.push(
  await runCustomerScenario({
    label: "sandbox_no_insurance",
    customerId: report.customers.sandboxId,
    question: "현재 가입 보험이 있나요?",
  }),
);

report.scenarios.push(
  await runCustomerScenario({
    label: "insured_customer",
    customerId: report.customers.insuredId,
    question: "나의 보험 총 건수는?",
  }),
);

report.pass = report.scenarios.every((scenario) => scenario.stages_completed?.length === 5);

console.log(JSON.stringify(report, null, 2));

if (!report.pass) {
  process.exit(1);
}

console.log("\n✅ analysis_jobs E2E PASSED (sandbox + insured customers).\n");
