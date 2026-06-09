/**
 * Phase 27 — Customer-facing conversational tone verification.
 */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { buildFastConversationalResponse } from "../server/fastResponseLayer.js";
import {
  buildAdvisorStyleFallback,
  buildDirectFactualAnswer,
  buildCustomerFacingContext,
} from "../server/customerConversationalTone.js";
import { buildShortExplanationPrompt } from "../server/claudePerformanceAudit.js";
import { loadRebalancingAnalysisContext } from "../server/customerRebalancingCore.js";
import { ensureCustomerMemoryContext } from "../server/customerMemoryContextSync.js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) throw new Error("SUPABASE_URL and SERVICE_ROLE_KEY are required");

const TEST_CUSTOMER_ID = process.env.PHASE27_TEST_CUSTOMER_ID || "8f8f81e6-a583-44ff-ba6c-a6daed2162ec";
const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

const memoryContext = await ensureCustomerMemoryContext({ supabase, customerId: TEST_CUSTOMER_ID });
const analysisContext = await loadRebalancingAnalysisContext(supabase, TEST_CUSTOMER_ID);
const workingContext = {
  snapshot: memoryContext.snapshot,
  sourceSummary: memoryContext.sourceSummary,
  sourceContext: memoryContext.sourceContext,
  structuredMemory: analysisContext.structuredMemory,
  coverageGapResult: analysisContext.coverageGapResult,
  underwritingResult: analysisContext.underwritingResult,
  recommendationResult: analysisContext.recommendationResult,
  designBundle: analysisContext.designBundle,
};

const QUESTIONS = [
  "나의 보험 총 건수는?",
  "내가 가입한 보험사는?",
  "내가 복용 중인 약은?",
  "암보험 가입 가능할까?",
];

const ROBOTIC_PATTERNS = [
  /risk_score/i,
  /gap_score/i,
  /보장 공백 우선 항목은/,
  /Top 2/,
  /Customer Memory \d+건/,
  /질문\("/,
  /analysis_summary_json/,
];

function isAdvisorTone(text) {
  return (
    text.length >= 40 &&
    !ROBOTIC_PATTERNS.some((pattern) => pattern.test(text)) &&
    (/님|고객님|확인|추천|검토|안내|보장/.test(text))
  );
}

const results = QUESTIONS.map((question) => {
  const fast = buildFastConversationalResponse({
    question,
    memorySnapshot: memoryContext.snapshot,
    sourceContext: memoryContext.sourceContext,
    sourceSummary: memoryContext.sourceSummary,
    cachePayload: { cache_status: "fresh", background_refresh_types: [] },
  });
  const fallback = buildAdvisorStyleFallback(question, workingContext);
  const direct = buildDirectFactualAnswer(question, workingContext);
  const prompt = buildShortExplanationPrompt(question, workingContext);

  return {
    question,
    fast_preview: fast.slice(0, 200),
    fallback_preview: fallback.slice(0, 200),
    direct_preview: direct?.slice(0, 200) ?? null,
    prompt_has_advisor_rules: /experienced insurance advisor|insurance advisor/i.test(prompt.system),
    prompt_has_customer_context: prompt.user.includes("customer_facing_context"),
    tone_checks: {
      fast_advisor_tone: isAdvisorTone(fast),
      fallback_advisor_tone: isAdvisorTone(fallback),
      no_robotic_fast: !ROBOTIC_PATTERNS.some((p) => p.test(fast)),
      no_robotic_fallback: !ROBOTIC_PATTERNS.some((p) => p.test(fallback)),
      starts_with_situation: /현재|보유|가입|기록/.test(fast) || /현재|보유|가입|기록/.test(fallback),
      ends_with_action: /추천|검토|안내|말씀|확인/.test(fast) || /추천|검토|안내|말씀|확인/.test(fallback),
    },
  };
});

const customerContext = buildCustomerFacingContext(workingContext);

const report = {
  phase: "27-tone",
  test_customer_id: TEST_CUSTOMER_ID,
  customer_context_preview: customerContext.situation_summary.slice(0, 3),
  results,
  tests: {
    allFastAdvisorTone: { pass: results.every((r) => r.tone_checks.fast_advisor_tone) },
    allFallbackAdvisorTone: { pass: results.every((r) => r.tone_checks.fallback_advisor_tone) },
    noRoboticFast: { pass: results.every((r) => r.tone_checks.no_robotic_fast) },
    noRoboticFallback: { pass: results.every((r) => r.tone_checks.no_robotic_fallback) },
    promptAdvisorRules: { pass: results.every((r) => r.prompt_has_advisor_rules) },
    promptCustomerContext: { pass: results.every((r) => r.prompt_has_customer_context) },
    policyCountDirect: {
      pass: /1건/.test(buildDirectFactualAnswer("나의 보험 총 건수는?", workingContext) ?? ""),
    },
    insurerDirect: {
      pass: /KB손해/.test(buildDirectFactualAnswer("내가 가입한 보험사는?", workingContext) ?? ""),
    },
    medicationDirect: {
      pass: /당뇨/.test(buildDirectFactualAnswer("내가 복용 중인 약은?", workingContext) ?? ""),
    },
  },
};

report.allPass = Object.values(report.tests).every((t) => t.pass === true);
for (const [name, test] of Object.entries(report.tests)) {
  assert.equal(test.pass, true, `${name} should pass`);
}
console.log(JSON.stringify(report, null, 2));
