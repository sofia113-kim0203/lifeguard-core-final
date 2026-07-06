/**
 * Phase 27 Step 1A — Customer Memory + Gap + UW + Recommendation + Design + Rebalancing + Claude.
 */

import { buildCustomerRebalancingPlan } from "./rebalancingEngine.js";
import { buildRebalancingInputFromAnalysis } from "./rebalancingInputBuilder.js";
import { loadInsuranceDesignAnalysisContext } from "./customerInsuranceDesignCore.js";
import { loadCoverageAnalysisContext } from "./customerCoverageGapCore.js";
import { resolveSupabaseConfig } from "./policyTermsQaCore.js";
import { createClient } from "@supabase/supabase-js";

const REBALANCING_SYSTEM_RULES = [
  "You are a LIFEGUARD customer insurance rebalancing explanation assistant.",
  "Explain only using the provided customer memory, coverage gap, underwriting risk, recommendation, insurance design, and pre-computed rebalancing JSON.",
  "Do not invent policies, health conditions, premium amounts, carrier products, or binding underwriting decisions.",
  "If information is missing from memory or analysis, explicitly say it is not recorded.",
  "Include: (1) memory-based context, (2) what to keep, (3) what to strengthen, (4) cautions before reduction or new enrollment, (5) budget impact summary, (6) next actions.",
  "Do not recommend specific insurance carrier products by name unless they appear in customer memory or existing holdings.",
  "Respond in Korean with clear headings and bullet points.",
].join(" ");

function createUserSupabaseClient(authHeader, env = process.env) {
  const { url, anonKey } = resolveSupabaseConfig(env);
  if (!url || !anonKey) return null;
  const token = String(authHeader ?? "").replace(/^Bearer\s+/i, "").trim();
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  });
}

export function buildRebalancingExplanationPrompt(structuredMemory, rebalancingResult, context) {
  const user = [
    "Explain the insurance rebalancing plan to the customer using only the blocks below.",
    "",
    "A. customer_memory_summary:",
    JSON.stringify(structuredMemory, null, 2),
    "",
    "B. insurance_design_reference:",
    JSON.stringify(rebalancingResult.insurance_design_reference, null, 2),
    "",
    "C. rebalancing_summary:",
    JSON.stringify(
      {
        keep_items: rebalancingResult.keep_items,
        add_items: rebalancingResult.add_items,
        reduce_items: rebalancingResult.reduce_items,
        review_items: rebalancingResult.review_items,
        warning_items: rebalancingResult.warning_items,
        estimated_budget_impact: rebalancingResult.estimated_budget_impact,
        priority_actions: rebalancingResult.priority_actions,
        customer_visible_rebalancing: rebalancingResult.customer_visible_rebalancing,
      },
      null,
      2,
    ),
    "",
    "D. coverage_gap_top_gaps:",
    JSON.stringify(context.coverageGapResult?.top_gaps ?? [], null, 2),
    "",
    "E. underwriting_surcharge:",
    JSON.stringify(context.underwritingResult?.likely_surcharge ?? [], null, 2),
    "",
    "Required sections in Korean:",
    "1) 고객 Memory 기준 현재 보험 상황",
    "2) 유지할 보험",
    "3) 보강할 보장",
    "4) 줄이기 전 주의사항",
    "5) 예산 영향 요약",
    "6) 다음 행동",
    "7) Memory/분석에 없는 정보 (있다면 명시)",
  ].join("\n");

  return { system: REBALANCING_SYSTEM_RULES, user };
}

async function resolveCustomerId(supabase) {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user) {
    return { ok: false, reason: "UNAUTHORIZED", error_message: "Authentication required." };
  }
  const { data: profile, error: profileError } = await supabase
    .from("customer_profiles")
    .select("id")
    .eq("user_id", authData.user.id)
    .maybeSingle();
  if (profileError || !profile?.id) {
    return { ok: false, reason: "CUSTOMER_PROFILE_NOT_FOUND", error_message: "Customer profile not found." };
  }
  return { ok: true, customerId: profile.id };
}

export async function loadRebalancingAnalysisContext(supabase, customerId) {
  const [designContext, coverageContext] = await Promise.all([
    loadInsuranceDesignAnalysisContext(supabase, customerId),
    loadCoverageAnalysisContext(supabase, customerId),
  ]);

  const input = buildRebalancingInputFromAnalysis({
    snapshot: designContext.snapshot,
    policies: coverageContext.policies ?? [],
    health: coverageContext.health ?? null,
    structuredMemory: designContext.structuredMemory,
    coverageGapResult: designContext.coverageGapResult,
    underwritingResult: designContext.underwritingResult,
    recommendationResult: designContext.recommendationResult,
    designBundle: designContext.designBundle,
  });

  const rebalancingResult = buildCustomerRebalancingPlan({
    customer_id: customerId,
    structuredMemory: designContext.structuredMemory,
    insurance_holdings: input.insurance_holdings,
    health_profile: input.health_profile,
    memory_facts: input.memory_facts,
    monthly_budget: input.monthly_budget,
    coverageGapResult: designContext.coverageGapResult,
    underwritingResult: designContext.underwritingResult,
    recommendationResult: designContext.recommendationResult,
    insurance_design: designContext.designBundle.insurance_design,
    customer_visible_design: designContext.designBundle.customer_visible_design,
  });

  return {
    input,
    snapshot: designContext.snapshot,
    structuredMemory: designContext.structuredMemory,
    coverageGapResult: designContext.coverageGapResult,
    underwritingResult: designContext.underwritingResult,
    recommendationResult: designContext.recommendationResult,
    designBundle: designContext.designBundle,
    rebalancingResult,
  };
}

export async function handleCustomerRebalancingRequest({
  authHeader = null,
  testCustomerId = null,
  adminSupabase = null,
  skipClaude = false,
  fetchImpl = fetch,
  env = process.env,
} = {}) {
  let supabase = adminSupabase;
  let customerId = testCustomerId;

  if (!supabase) {
    supabase = createUserSupabaseClient(authHeader, env);
    if (!supabase) {
      return { ok: false, reason: "SUPABASE_NOT_CONFIGURED", error_message: "Supabase is not configured." };
    }
    const resolved = await resolveCustomerId(supabase);
    if (!resolved.ok) return resolved;
    customerId = resolved.customerId;
  }

  if (!customerId) {
    return { ok: false, reason: "CUSTOMER_ID_REQUIRED", error_message: "customer_id is required." };
  }

  const context = await loadRebalancingAnalysisContext(supabase, customerId);

  // FACTORY-SPEAK-05-S1 — rebalancing factory must not speak to customers via Claude explanation.
  const claudeExplanation = null;
  const claudeMeta = {
    skipped: true,
    reason: "FACTORY_SPEAK_05_S1",
    explanation_mode: "blocked",
  };

  return {
    ok: true,
    customer_id: customerId,
    memory_used: (context.snapshot.fact_count ?? 0) > 0,
    insurance_design_used: Boolean(context.designBundle?.insurance_design),
    coverage_gap_used: Boolean(context.coverageGapResult),
    underwriting_used: Boolean(context.underwritingResult),
    recommendation_used: Boolean(context.recommendationResult),
    memory_version: context.snapshot.memory_version ?? 0,
    memory_fact_count: context.snapshot.fact_count ?? 0,
    used_memory_sources: context.input.memory_sources_used,
    rebalancing_result: context.rebalancingResult,
    customer_visible_rebalancing: context.rebalancingResult.customer_visible_rebalancing,
    claude_explanation: claudeExplanation,
    claude_meta: claudeMeta,
  };
}

export function parseCustomerRebalancingBody(body) {
  if (!body || typeof body !== "object") return {};
  const skipClaude = body.skip_claude === true || body.skipClaude === true;
  return { skipClaude };
}
