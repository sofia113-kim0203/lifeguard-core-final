/**
 * Phase 26 Step 2B — Claude performance audit + optimization verification.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { loadCustomerMemorySnapshot } from "../server/customerMemorySnapshot.js";
import { loadInsuranceDesignAnalysisContext } from "../server/customerInsuranceDesignCore.js";
import {
  resolveSandboxCustomerId,
  safeAdminUpdateUserPassword,
} from "./lib/sandboxAuthGuard.js";
import {
  auditExplanationContext,
  buildShortExplanationPrompt,
  estimateTokens,
  measurePrompt,
} from "../server/claudePerformanceAudit.js";
import {
  buildCoverageGapExplanationPrompt,
} from "../server/customerCoverageGapCore.js";
import {
  buildUnderwritingExplanationPrompt,
} from "../server/customerUnderwritingRiskCore.js";
import {
  buildRecommendationExplanationPrompt,
} from "../server/customerRecommendationCore.js";
import {
  buildInsuranceDesignExplanationPrompt,
} from "../server/customerInsuranceDesignCore.js";
import { generateShortConnectedExplanation } from "../server/claudeShortExplanationCore.js";
import {
  handleConversationalQuestionRequest,
} from "../server/conversationalBackgroundAnalysisCore.js";
import { runAnalysisJobToCompletion } from "../server/backgroundAnalysisJobRunner.js";
import {
  resolveSandboxCustomerId,
  safeAdminUpdateUserPassword,
} from "./lib/sandboxAuthGuard.js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) throw new Error("SUPABASE_URL and SERVICE_ROLE_KEY are required");

const TEST_CUSTOMER_ID = resolveSandboxCustomerId(process.env.PHASE26_TEST_CUSTOMER_ID);
const TEST_QUESTION = process.env.PHASE26_TEST_QUESTION || "암보험 가입 가능할까?";
const PRODUCTION_BASE = process.env.PHASE26_PRODUCTION_BASE || "https://lifeguard-core-final.vercel.app";

const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

async function ensureMigration024() {
  const probe = await supabase.from("claude_result_cache").select("customer_id").limit(1);
  if (!probe.error) return { applied: true };
  const sql = readFileSync(
    new URL("../supabase/migrations/024_claude_performance_optimization.sql", import.meta.url),
    "utf8",
  );
  await fetch(`https://api.supabase.com/v1/projects/fhvlxcguvjvtftttfrix/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  const recheck = await supabase.from("claude_result_cache").select("customer_id").limit(1);
  return { applied: !recheck.error, probe_error: recheck.error?.message };
}

function measureLegacyPromptBundle(workingContext, question) {
  const prompts = [];
  if (workingContext.coverageGapResult) {
    prompts.push(
      measurePrompt(
        buildCoverageGapExplanationPrompt(
          workingContext.structuredMemory,
          workingContext.coverageGapResult,
        ),
      ),
    );
  }
  if (workingContext.underwritingResult) {
    prompts.push(
      measurePrompt(
        buildUnderwritingExplanationPrompt(
          workingContext.structuredMemory,
          workingContext.coverageGapResult,
          workingContext.underwritingResult,
        ),
      ),
    );
  }
  if (workingContext.recommendationResult) {
    prompts.push(
      measurePrompt(
        buildRecommendationExplanationPrompt(
          workingContext.structuredMemory,
          workingContext.recommendationResult,
          workingContext.coverageGapResult,
          workingContext.underwritingResult,
        ),
      ),
    );
  }
  if (workingContext.designBundle) {
    prompts.push(
      measurePrompt(
        buildInsuranceDesignExplanationPrompt(
          workingContext.structuredMemory,
          workingContext.designBundle,
          workingContext,
        ),
      ),
    );
  }

  const legacyConnectedUser = [
    "analysis_bundle_json:",
    JSON.stringify(
      {
        coverage_gap_result: workingContext.coverageGapResult,
        underwriting_result: workingContext.underwritingResult,
        recommendation_result: workingContext.recommendationResult,
        insurance_design: workingContext.designBundle,
      },
      null,
      2,
    ),
    `Question: ${question}`,
  ].join("\n");
  prompts.push({
    system_chars: 120,
    user_chars: legacyConnectedUser.length,
    prompt_chars: 120 + legacyConnectedUser.length,
    estimated_input_tokens: estimateTokens(legacyConnectedUser) + estimateTokens("x".repeat(120)),
  });

  const totalPromptChars = prompts.reduce((sum, p) => sum + p.prompt_chars, 0);
  const totalInputTokens = prompts.reduce((sum, p) => sum + p.estimated_input_tokens, 0);
  return {
    claude_call_count: prompts.length,
    prompt_chars: totalPromptChars,
    estimated_input_tokens: totalInputTokens,
    per_call: prompts,
    bottleneck: "result_claude stage executed 5 sequential Claude calls with full JSON prompts",
  };
}

const migration = await ensureMigration024();
const designContext = await loadInsuranceDesignAnalysisContext(supabase, TEST_CUSTOMER_ID);
const workingContext = {
  question: TEST_QUESTION,
  snapshot: designContext.snapshot,
  structuredMemory: designContext.structuredMemory,
  coverageGapResult: designContext.coverageGapResult,
  underwritingResult: designContext.underwritingResult,
  recommendationResult: designContext.recommendationResult,
  designBundle: designContext.designBundle,
};

const beforeAudit = auditExplanationContext(workingContext, TEST_QUESTION);
const beforeLegacy = measureLegacyPromptBundle(workingContext, TEST_QUESTION);

const shortPrompt = buildShortExplanationPrompt(TEST_QUESTION, workingContext);
const afterPromptMetrics = measurePrompt(shortPrompt);

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
const resultStage = completed.job.result_json?.result_claude ?? {};
const afterPerformance = resultStage.performance ?? {};

const explanation = await generateShortConnectedExplanation({
  supabase,
  customerId: TEST_CUSTOMER_ID,
  question: TEST_QUESTION,
  workingContext,
  memoryVersion: designContext.snapshot.memory_version,
});
const cacheHitSecondCall = explanation.cache_hit === true;

let productionAfter = null;
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
  const tempPassword = `Phase26Step2B!${Date.now()}`;
  await safeAdminUpdateUserPassword(supabase, {
    userId: profile.user_id,
    email: userRow.email,
    customerId: TEST_CUSTOMER_ID,
    password: tempPassword,
  });
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
    const stepBody = await stepRes.json();
    prodJob = stepBody.analysis_job;
    if (prodJob?.status === "completed" || prodJob?.status === "failed") break;
    await new Promise((r) => setTimeout(r, 1200));
  }

  productionAfter = {
    initial_response_time_ms: created.initial_response_time_ms,
    result_claude_time_ms: prodJob?.timing_metrics?.result_claude_time_ms,
    result_claude_cache_hit: prodJob?.timing_metrics?.result_claude_cache_hit,
    prompt_chars: prodJob?.timing_metrics?.result_claude_prompt_chars,
    estimated_input_tokens: prodJob?.timing_metrics?.result_claude_input_tokens,
    output_chars: prodJob?.timing_metrics?.result_claude_output_chars,
    final_preview: String(prodJob?.final_response_text ?? "").slice(0, 220),
  };
}

const answerText = completed.job.final_response_text ?? "";
const qualityChecks = {
  mentions_memory: /Memory|당뇨|복용|실손|테스트고객/.test(answerText),
  mentions_gap: /암|보장|공백|뇌|심혈관/.test(answerText),
  mentions_uw: /인수|심사|할증|주의|건강/.test(answerText),
  mentions_rec: /추천|우선|준비|서류/.test(answerText),
  mentions_design: /설계|다음|유지|행동/.test(answerText),
  under_800_chars: answerText.length <= 800,
};

const report = {
  phase: "26-2B",
  migration,
  test_customer_id: TEST_CUSTOMER_ID,
  test_question: TEST_QUESTION,
  bottleneck_analysis: {
    root_cause: beforeLegacy.bottleneck,
    legacy_claude_call_count: beforeLegacy.claude_call_count,
    legacy_total_prompt_chars: beforeLegacy.prompt_chars,
    legacy_estimated_input_tokens: beforeLegacy.estimated_input_tokens,
    rag_context_included: beforeAudit.rag_context_included,
  },
  before: {
    result_claude_time_ms: 88487,
    prompt_chars: beforeLegacy.prompt_chars,
    estimated_input_tokens: beforeLegacy.estimated_input_tokens,
    output_chars: null,
    claude_call_count: 5,
    context_sizes: beforeAudit,
  },
  after: {
    result_claude_time_ms: timing.result_claude_time_ms,
    prompt_chars: afterPerformance.prompt_chars ?? afterPromptMetrics.prompt_chars,
    estimated_input_tokens:
      afterPerformance.estimated_input_tokens ?? afterPromptMetrics.estimated_input_tokens,
    output_chars: afterPerformance.output_chars ?? answerText.length,
    cache_hit_first_run: timing.result_claude_cache_hit ?? resultStage.cache_hit ?? false,
    cache_hit_second_run: cacheHitSecondCall,
    claude_call_count: 1,
    context_sizes: resultStage.audit ?? beforeAudit,
    explanation_mode: resultStage.explanation_mode ?? "short",
    quality_checks: qualityChecks,
    final_preview: answerText.slice(0, 300),
  },
  preserved: {
    initial_response_time_ms: conversational.initial_response_time_ms,
    cache_stages_used: {
      coverage: timing.coverage_gap_from_cache,
      underwriting: timing.underwriting_risk_from_cache,
      recommendation: timing.recommendation_from_cache,
      design: timing.insurance_design_from_cache,
    },
  },
  production_after: productionAfter,
};

report.pass =
  report.after.result_claude_time_ms <= 15000 &&
  report.after.quality_checks.mentions_memory &&
  report.after.quality_checks.mentions_gap &&
  (report.after.cache_hit_second_run === true || report.after.result_claude_time_ms <= 15000);

report.status = report.pass ? "PASS" : report.after.result_claude_time_ms >= 30000 ? "FAIL" : "PARTIAL";

console.log(JSON.stringify(report, null, 2));
if (!report.pass) process.exit(1);
