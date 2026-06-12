/**
 * Underwriting / Recommendation pipeline audit — DB + real HTTP API.
 * Usage:
 *   AUDIT_EMAIL=screen-recovery-...@example.com API_BASE=http://localhost:5173 node scripts/underwriting-recommendation-pipeline-audit.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { handleCustomerUnderwritingRiskRequest } from "../server/customerUnderwritingRiskCore.js";
import { handleCustomerRecommendationRequest } from "../server/customerRecommendationCore.js";
import { assertSafeTestScriptExecution, isExampleTestEmail, loadEnvLocal } from "./lib/productionSafetyGuard.mjs";

const SCRIPT_NAME = "underwriting-recommendation-pipeline-audit";
const EMAIL = (process.env.AUDIT_EMAIL ?? "screen-recovery-20260612-cursor-a@example.com").toLowerCase();
const PASSWORD = process.env.AUDIT_PASSWORD ?? "ScreenRecovery!20260612";
const API_BASE = (process.env.API_BASE ?? "http://localhost:5173").replace(/\/$/, "");

loadEnvLocal();
assertSafeTestScriptExecution({
  scriptName: SCRIPT_NAME,
  plannedTestEmail: EMAIL,
  createsTestAccount: isExampleTestEmail(EMAIL),
});

const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceRoleKey) {
  console.error("BLOCKER: missing Supabase env");
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
const userClient = createClient(url, anonKey, { auth: { persistSession: false } });

async function countForCustomer(table, customerId) {
  const { count, error } = await admin
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId);
  if (error) return { count: null, error: error.message, code: error.code };
  return { count: count ?? 0, error: null };
}

async function tableProbe(table) {
  const { data, error } = await admin.from(table).select("id").limit(1);
  return { exists: !error, error: error?.message ?? null, code: error?.code ?? null };
}

async function httpPost(path, accessToken, body = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { _parse_error: true, raw: text.slice(0, 500) };
  }
  return { status: res.status, json };
}

console.log("=== Underwriting / Recommendation Pipeline Audit ===\n");
console.log(`AUDIT_EMAIL: ${EMAIL}`);
console.log(`API_BASE: ${API_BASE}\n`);

const { data: signIn, error: signInError } = await userClient.auth.signInWithPassword({
  email: EMAIL,
  password: PASSWORD,
});
if (signInError || !signIn.session?.access_token) {
  console.error("BLOCKER: signIn failed", signInError?.message ?? "no session");
  process.exit(1);
}

const accessToken = signIn.session.access_token;
const authUserId = signIn.user.id;

const { data: profile, error: profileError } = await admin
  .from("customer_profiles")
  .select("id, user_id, display_name, memory_version, status")
  .eq("user_id", authUserId)
  .maybeSingle();

if (profileError || !profile?.id) {
  console.error("BLOCKER: customer_profiles missing", profileError?.message);
  process.exit(1);
}

const customerId = profile.id;

console.log("--- 1. customer_id ---");
console.log(JSON.stringify({
  email: EMAIL,
  auth_user_id: authUserId,
  customer_id: customerId,
  display_name: profile.display_name,
  memory_version: profile.memory_version,
}, null, 2));

console.log("\n--- 2–3. DB counts ---");
const memoryFacts = await countForCustomer("customer_memory_facts", customerId);
const policies = await countForCustomer("profile_insurance_policies", customerId);
console.log(JSON.stringify({
  customer_memory_facts: memoryFacts,
  profile_insurance_policies: policies,
}, null, 2));

console.log("\n--- 4–5. legacy result tables ---");
const legacyTables = ["underwriting_results", "recommendation_results", "coverage_gap_results", "insurance_design_results"];
const legacy = {};
for (const table of legacyTables) {
  const probe = await tableProbe(table);
  let rowCount = null;
  if (probe.exists) {
    const c = await countForCustomer(table, customerId);
    rowCount = c.count;
  }
  legacy[table] = { ...probe, customer_row_count: rowCount };
}
console.log(JSON.stringify(legacy, null, 2));

console.log("\n--- customer_analysis_cache ---");
const { data: cacheRows, error: cacheError } = await admin
  .from("customer_analysis_cache")
  .select("cache_type, source_memory_version, updated_at")
  .eq("customer_id", customerId);
console.log(JSON.stringify({
  error: cacheError?.message ?? null,
  rows: cacheRows ?? [],
}, null, 2));

console.log("\n--- latest analysis_jobs (recommendation slice) ---");
const { data: jobs } = await admin
  .from("analysis_jobs")
  .select("id, status, created_at, result_json")
  .eq("customer_id", customerId)
  .order("created_at", { ascending: false })
  .limit(3);

for (const job of jobs ?? []) {
  const rec = job.result_json?.recommendation ?? null;
  console.log(JSON.stringify({
    job_id: job.id,
    status: job.status,
    created_at: job.created_at,
    has_recommendation_in_result_json: Boolean(rec),
    customer_visible_top2_len: rec?.customer_visible_top2?.length ?? null,
    recommendations_len: rec?.recommendations?.length ?? null,
  }, null, 2));
}

console.log("\n--- 6. HTTP POST /api/customer-recommendations (real session token) ---");
const recHttp = await httpPost("/api/customer-recommendations", accessToken, { skip_claude: true });
console.log(JSON.stringify({
  http_status: recHttp.status,
  ok: recHttp.json?.ok ?? null,
  reason: recHttp.json?.reason ?? null,
  customer_id: recHttp.json?.customer_id ?? null,
  memory_fact_count: recHttp.json?.memory_fact_count ?? null,
  customer_visible_top2_len: Array.isArray(recHttp.json?.customer_visible_top2)
    ? recHttp.json.customer_visible_top2.length
    : null,
  recommendations_len: Array.isArray(recHttp.json?.recommendations)
    ? recHttp.json.recommendations.length
    : null,
  underwriting_used: recHttp.json?.underwriting_used ?? null,
  coverage_gap_used: recHttp.json?.coverage_gap_used ?? null,
}, null, 2));
console.log("FULL recommendation API JSON:");
console.log(JSON.stringify(recHttp.json, null, 2));

console.log("\n--- HTTP POST /api/customer-underwriting-risk ---");
const uwHttp = await httpPost("/api/customer-underwriting-risk", accessToken, { skip_claude: true });
console.log(JSON.stringify({
  http_status: uwHttp.status,
  ok: uwHttp.json?.ok ?? null,
  reason: uwHttp.json?.reason ?? null,
  likely_standard_len: uwHttp.json?.underwriting_result?.likely_standard?.length ?? null,
  likely_surcharge_len: uwHttp.json?.underwriting_result?.likely_surcharge?.length ?? null,
  memory_fact_count: uwHttp.json?.memory_fact_count ?? null,
}, null, 2));

console.log("\n--- handler direct (admin, same customer_id) for comparison ---");
const uwHandler = await handleCustomerUnderwritingRiskRequest({
  adminSupabase: admin,
  testCustomerId: customerId,
  skipClaude: true,
});
const recHandler = await handleCustomerRecommendationRequest({
  adminSupabase: admin,
  testCustomerId: customerId,
  skipClaude: true,
});
console.log(JSON.stringify({
  uw_handler_ok: uwHandler.ok,
  uw_handler_top2_standard: uwHandler.underwriting_result?.likely_standard?.length ?? null,
  rec_handler_ok: recHandler.ok,
  rec_handler_top2_len: recHandler.customer_visible_top2?.length ?? null,
}, null, 2));

console.log("\n--- 7. UI empty-message condition (code fact) ---");
console.log(JSON.stringify({
  ui_shows_empty_when:
    "!loading && !(recResult?.customerVisibleTop2?.length)",
  note:
    "recResult from API uses camelCase customerVisibleTop2; from analysis_job uses same field mapped from customer_visible_top2",
}, null, 2));
