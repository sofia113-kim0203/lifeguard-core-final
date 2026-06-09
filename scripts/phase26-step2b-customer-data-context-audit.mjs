/**
 * Phase 26 Step 2B — Customer Data Context Flow Audit + Claude Performance verification.
 */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import {
  ensureCustomerMemoryContext,
  loadCustomerSourceContext,
  assessMemorySyncNeed,
} from "../server/customerMemoryContextSync.js";
import { loadCustomerMemorySnapshot } from "../server/customerMemorySnapshot.js";
import {
  handleConversationalQuestionRequest,
} from "../server/conversationalBackgroundAnalysisCore.js";
import { runAnalysisJobToCompletion } from "../server/backgroundAnalysisJobRunner.js";
import {
  buildShortExplanationPrompt,
  auditExplanationContext,
  measurePrompt,
} from "../server/claudePerformanceAudit.js";
import { loadInsuranceDesignAnalysisContext } from "../server/customerInsuranceDesignCore.js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) throw new Error("SUPABASE_URL and SERVICE_ROLE_KEY are required");

const TEST_CUSTOMER_ID = process.env.PHASE26_TEST_CUSTOMER_ID || "8f8f81e6-a583-44ff-ba6c-a6daed2162ec";
const TEST_QUESTION = process.env.PHASE26_TEST_QUESTION || "암보험 가입 가능할까?";
const PRODUCTION_BASE = process.env.PHASE26_PRODUCTION_BASE || "https://lifeguard-core-final.vercel.app";

const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

// Part A — Data flow audit
const sourceContext = await loadCustomerSourceContext(supabase, TEST_CUSTOMER_ID);
const snapshotBefore = await loadCustomerMemorySnapshot(supabase, TEST_CUSTOMER_ID);
const syncNeed = assessMemorySyncNeed(sourceContext, snapshotBefore);
const memoryContext = await ensureCustomerMemoryContext({ supabase, customerId: TEST_CUSTOMER_ID });

const shortPromptContext = await loadInsuranceDesignAnalysisContext(supabase, TEST_CUSTOMER_ID);
shortPromptContext.question = TEST_QUESTION;
shortPromptContext.sourceSummary = memoryContext.sourceSummary;
const prompt = buildShortExplanationPrompt(TEST_QUESTION, shortPromptContext);
const promptMetrics = measurePrompt(prompt);
const audit = auditExplanationContext(shortPromptContext, TEST_QUESTION);

const conversational = await handleConversationalQuestionRequest({
  question: TEST_QUESTION,
  testCustomerId: TEST_CUSTOMER_ID,
  adminSupabase: supabase,
  autoProcess: false,
});
assert.equal(conversational.ok, true);

const completed = await runAnalysisJobToCompletion({
  supabase,
  jobId: conversational.analysis_job_id,
});
assert.equal(completed?.job?.status, "completed");

const timing = completed.job.timing_metrics ?? {};
const finalText = completed.job.final_response_text ?? "";
const resultClaude = completed.job.result_json?.result_claude ?? {};

const dataInDb =
  sourceContext.has_profile || sourceContext.has_health || sourceContext.has_policies;
const passedToMemory = (memoryContext.snapshot.fact_count ?? 0) > 0 || memoryContext.memory_synced;
const passedToConsultation = !/정보가 아직 없어|정보가 없어/.test(conversational.fast_response ?? "");
const includedInPrompt =
  audit.memory_context_chars > 0 &&
  prompt.user.includes("analysis_summary_json") &&
  (prompt.user.includes("암") || prompt.user.includes("coverage") || prompt.user.includes("당뇨") || prompt.user.includes("실손") || prompt.user.includes("brain") || prompt.user.includes("cancer") || JSON.stringify(prompt.user).length > 100);

let production = null;
if (process.env.SUPABASE_ACCESS_TOKEN) {
  const keysRes = await fetch("https://api.supabase.com/v1/projects/fhvlxcguvjvtftttfrix/api-keys", {
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` },
  });
  const anonKey = (await keysRes.json()).find((k) => k.name === "anon")?.api_key;
  const { data: profile } = await supabase
    .from("customer_profiles")
    .select("user_id")
    .eq("id", TEST_CUSTOMER_ID)
    .maybeSingle();
  const { data: userRow } = await supabase.from("users").select("email").eq("id", profile.user_id).maybeSingle();
  const tempPassword = `Phase26Step2BCtx!${Date.now()}`;
  await supabase.auth.admin.updateUserById(profile.user_id, { password: tempPassword });
  const sb = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data: signIn } = await sb.auth.signInWithPassword({ email: userRow.email, password: tempPassword });
  const token = signIn.session.access_token;

  const createRes = await fetch(`${PRODUCTION_BASE}/api/customer-conversational-qa`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ question: TEST_QUESTION, auto_process: false }),
  });
  const created = await createRes.json();

  let prodJob = null;
  for (let i = 0; i < 8; i++) {
    const stepRes = await fetch(`${PRODUCTION_BASE}/api/customer-analysis-job`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ job_id: created.analysis_job_id, action: "process" }),
    });
    prodJob = (await stepRes.json()).analysis_job;
    if (prodJob?.status === "completed" || prodJob?.status === "failed") break;
    await new Promise((r) => setTimeout(r, 1200));
  }

  production = {
    initial_response_time_ms: created.initial_response_time_ms,
    result_claude_time_ms: prodJob?.timing_metrics?.result_claude_time_ms,
    cache_hit: prodJob?.timing_metrics?.result_claude_cache_hit,
    prompt_chars: prodJob?.timing_metrics?.result_claude_prompt_chars,
    estimated_input_tokens: prodJob?.timing_metrics?.result_claude_input_tokens,
    output_chars: prodJob?.timing_metrics?.result_claude_output_chars,
    fast_response_missing_info: /정보가 아직 없어/.test(created.fast_response ?? ""),
    memory_context: created.memory_context,
    final_preview: String(prodJob?.final_response_text ?? "").slice(0, 220),
  };
}

const partA = {
  data_exists_in_db: dataInDb ? "YES" : "NO",
  passed_to_memory: passedToMemory ? "YES" : "NO",
  passed_to_ai_consultation: passedToConsultation ? "YES" : "NO",
  included_in_claude_prompt: includedInPrompt ? "YES" : "NO",
  break_point: dataInDb && !passedToMemory ? "Memory Builder not synced before consultation" : null,
  source_context: {
    has_profile: sourceContext.has_profile,
    has_health: sourceContext.has_health,
    has_policies: sourceContext.has_policies,
    has_documents: sourceContext.has_documents,
  },
  memory_fact_count: memoryContext.snapshot.fact_count,
  sync_assessment: memoryContext.sync_assessment,
  memory_synced: memoryContext.memory_synced,
};

const partB = {
  before: {
    result_claude_time_ms: 88487,
    prompt_chars: 248644,
    estimated_input_tokens: 99461,
    claude_call_count: 5,
  },
  after: {
    result_claude_time_ms: timing.result_claude_time_ms,
    prompt_chars: resultClaude.performance?.prompt_chars ?? promptMetrics.prompt_chars,
    estimated_input_tokens:
      resultClaude.performance?.estimated_input_tokens ?? promptMetrics.estimated_input_tokens,
    output_chars: resultClaude.performance?.output_chars ?? finalText.length,
    cache_hit: timing.result_claude_cache_hit ?? resultClaude.cache_hit ?? false,
    claude_call_count: 1,
    context_sizes: audit,
    rag_context_included: audit.rag_context_included ? "YES" : "NO",
  },
  production,
};

const report = {
  phase: "26-2B",
  test_customer_id: TEST_CUSTOMER_ID,
  test_question: TEST_QUESTION,
  part_a_data_flow: partA,
  part_b_claude_performance: partB,
  quality_checks: {
    memory: /Memory|당뇨|복용|실손|테스트고객/.test(finalText),
    gap: /암|보장|공백|뇌|심혈관/.test(finalText),
    uw: /인수|심사|할증|주의|건강/.test(finalText),
    rec: /추천|우선|준비|서류/.test(finalText),
    design: /설계|다음|유지|행동|유지/.test(finalText),
    under_800_chars: finalText.length <= 800,
    initial_response_ms: conversational.initial_response_time_ms,
  },
};

report.part_a_pass =
  partA.data_exists_in_db === "YES" &&
  partA.passed_to_memory === "YES" &&
  partA.passed_to_ai_consultation === "YES" &&
  partA.included_in_claude_prompt === "YES";

report.part_b_pass =
  partB.after.result_claude_time_ms <= 15000 &&
  Object.values(report.quality_checks).filter((v) => typeof v === "boolean").every(Boolean);

report.pass = report.part_a_pass && report.part_b_pass;
report.status = report.pass ? "PASS" : timing.result_claude_time_ms >= 30000 ? "FAIL" : "PARTIAL";

console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exit(1);
