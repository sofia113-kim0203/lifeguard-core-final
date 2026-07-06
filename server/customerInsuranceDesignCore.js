/**
 * Phase 26 Step 1E — Customer Memory + Gap + UW + Recommendation + Insurance Design + Claude.
 */

import { buildCustomerInsuranceDesignPlan } from "./insuranceDesignGenerator.js";
import { buildInsuranceDesignInputFromAnalysis } from "./insuranceDesignInputBuilder.js";
import { loadRecommendationAnalysisContext } from "./customerRecommendationCore.js";
import { resolveSupabaseConfig } from "./policyTermsQaCore.js";
import { createClient } from "@supabase/supabase-js";

const DESIGN_SYSTEM_RULES = [
  "You are a LIFEGUARD customer insurance design explanation assistant.",
  "Explain only using the provided customer memory, coverage gap, underwriting risk, recommendation, and pre-computed insurance design JSON.",
  "Do not invent policies, health conditions, premium amounts, carrier products, or binding underwriting decisions.",
  "If information is missing from memory or analysis, explicitly say it is not recorded.",
  "Include: (1) memory-based context, (2) why this design is needed, (3) priority coverages to prepare first, (4) coverages to keep, (5) underwriting cautions, (6) required documents, (7) next steps.",
  "Do not recommend specific insurance carrier products by name unless they appear in customer memory.",
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

export function sanitizeDesignStructuredForPrompt(designBundle = {}) {
  const pickDesign = (design = {}) => ({
    design_id: design.design_id ?? null,
    design_priority: design.design_priority ?? null,
    design_reason_codes: design.design_reason_codes ?? [],
    plan_step_codes: design.plan_step_codes ?? [],
    budget_band_code: design.budget_band_code ?? null,
    budget_min: design.budget_min ?? design.monthly_budget_range?.min ?? null,
    budget_max: design.budget_max ?? design.monthly_budget_range?.max ?? null,
    priority_coverage_categories: design.priority_coverage_categories ?? [],
    keep_existing_coverages: (design.keep_existing_coverages ?? []).map((item) =>
      typeof item === "string" ? item : item.coverage_category ?? item.coverage_label,
    ),
    recommended_new_coverages: (design.recommended_new_coverages ?? []).map((item) => ({
      coverage_category: item.coverage_category ?? null,
      coverage_label: item.coverage_label ?? null,
      recommendation_type: item.recommendation_type ?? null,
      priority: item.priority ?? null,
    })),
    underwriting_warning_codes: design.underwriting_warning_codes ?? [],
    required_document_codes: design.required_document_codes ?? [],
    confidence_level: design.confidence_level ?? null,
  });

  const visible = designBundle.customer_visible_design ?? {};
  return {
    insurance_design: pickDesign(designBundle.insurance_design ?? {}),
    customer_visible_design: {
      design_priority: visible.design_priority ?? null,
      design_reason_codes: visible.design_reason_codes ?? [],
      plan_step_codes: visible.plan_step_codes ?? [],
      budget_band_code: visible.budget_band_code ?? null,
      budget_min: visible.budget_min ?? null,
      budget_max: visible.budget_max ?? null,
      priority_coverage_categories: visible.priority_coverage_categories ?? [],
      priority_coverages: visible.priority_coverages ?? [],
      keep_existing_coverages: visible.keep_existing_coverages ?? [],
      pre_enrollment_caution_codes: visible.pre_enrollment_caution_codes ?? [],
      required_document_codes: visible.required_document_codes ?? [],
      confidence_level: visible.confidence_level ?? null,
    },
  };
}

export function buildInsuranceDesignExplanationPrompt(
  structuredMemory,
  designBundle,
  context,
  policies = [],
  countContract = null,
) {
  const structuredDesign = sanitizeDesignStructuredForPrompt(designBundle);
  const user = [
    "Explain the insurance design plan to the customer using only the blocks below.",
    "",
    "A. customer_memory_summary:",
    JSON.stringify(structuredMemory, null, 2),
    "",
    "C. coverage_gap_summary:",
    JSON.stringify(
      {
        overall_risk: context.coverageGapResult?.overall_risk,
        top_gaps: (context.coverageGapResult?.top_gaps ?? []).map((item) => ({
          coverage_category: item.coverage_category,
          gap_level: item.gap_level,
          action_code: item.action_code,
        })),
      },
      null,
      2,
    ),
    "",
    "D. underwriting_summary:",
    JSON.stringify(
      {
        overall_underwriting_risk: context.underwritingResult?.overall_underwriting_risk,
        likely_surcharge: (context.underwritingResult?.likely_surcharge ?? []).map((item) => ({
          coverage_category: item.coverage_category,
          underwriting_status: item.underwriting_status,
          review_step_code: item.review_step_code,
        })),
      },
      null,
      2,
    ),
    "",
    "E. recommendation_top2:",
    JSON.stringify(
      (context.recommendationResult?.customer_visible_top2 ?? []).map((item) => ({
        coverage_category: item.coverage_category,
        coverage_label: item.coverage_label,
        reason_codes: item.reason_codes,
        recommendation_type: item.recommendation_type,
      })),
      null,
      2,
    ),
    "",
    "F. insurance_design (structured codes only — do not invent binding product enrollment):",
    JSON.stringify(structuredDesign, null, 2),
    "",
    "Required sections in Korean:",
    "1) 고객 Memory 기준 현재 상황",
    "2) 왜 이 설계가 필요한지",
    "3) 먼저 준비할 보장",
    "4) 유지할 보장",
    "5) 인수심사 주의사항",
    "6) 필요 서류",
    "7) 다음 단계",
    "8) Memory/분석에 없는 정보 (있다면 명시)",
  ].join("\n");

  return { system: DESIGN_SYSTEM_RULES, user };
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

export async function loadInsuranceDesignAnalysisContext(supabase, customerId) {
  const recContext = await loadRecommendationAnalysisContext(supabase, customerId);

  const input = buildInsuranceDesignInputFromAnalysis({
    snapshot: recContext.snapshot,
    policies: recContext.policies ?? [],
    health: recContext.health ?? null,
    coverageGapResult: recContext.coverageGapResult,
    underwritingResult: recContext.underwritingResult,
    recommendationResult: recContext.recommendationResult,
    structuredMemory: recContext.structuredMemory,
  });

  const designBundle = buildCustomerInsuranceDesignPlan({
    customer_id: customerId,
    structuredMemory: recContext.structuredMemory,
    coverageGapResult: recContext.coverageGapResult,
    underwritingResult: recContext.underwritingResult,
    recommendationResult: recContext.recommendationResult,
    monthly_budget: input.monthly_budget,
    insurance_goal: input.insurance_goal,
  });

  return {
    input,
    snapshot: recContext.snapshot,
    structuredMemory: recContext.structuredMemory,
    coverageGapResult: recContext.coverageGapResult,
    underwritingResult: recContext.underwritingResult,
    recommendationResult: recContext.recommendationResult,
    designBundle,
    policies: recContext.policies ?? [],
    active_policy_count: recContext.active_policy_count ?? null,
    active_policy_count_source: recContext.active_policy_count_source ?? null,
    active_policy_ids: recContext.active_policy_ids ?? null,
    policy_count: recContext.policy_count ?? null,
  };
}

export async function handleAllAnalysisPanelsRequest({
  authHeader = null,
  testCustomerId = null,
  adminSupabase = null,
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

  const context = await loadInsuranceDesignAnalysisContext(supabase, customerId);

  return {
    ok: true,
    analysis: {
      coverage_gap: context.coverageGapResult ?? null,
      underwriting_risk: context.underwritingResult ?? null,
      recommendation: context.recommendationResult ?? null,
      insurance_design: context.designBundle ?? null,
    },
  };
}

export async function handleCustomerInsuranceDesignRequest({
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

  const context = await loadInsuranceDesignAnalysisContext(supabase, customerId);

  // FACTORY-SPEAK-04-S1 — design factory must not speak to customers via Claude explanation.
  const claudeExplanation = null;
  const claudeMeta = {
    skipped: true,
    reason: "FACTORY_SPEAK_04_S1",
    explanation_mode: "blocked",
  };

  return {
    ok: true,
    customer_id: customerId,
    memory_used: (context.snapshot.fact_count ?? 0) > 0,
    coverage_gap_used: Boolean(context.coverageGapResult),
    underwriting_used: Boolean(context.underwritingResult),
    recommendation_used: Boolean(context.recommendationResult),
    memory_version: context.snapshot.memory_version ?? 0,
    memory_fact_count: context.snapshot.fact_count ?? 0,
    used_memory_sources: context.input.memory_sources_used,
    insurance_design: context.designBundle.insurance_design,
    customer_visible_design: context.designBundle.customer_visible_design,
    required_document_codes: context.designBundle.insurance_design.required_document_codes,
    claude_explanation: claudeExplanation,
    claude_meta: claudeMeta,
  };
}

export function parseCustomerInsuranceDesignBody(body) {
  if (!body || typeof body !== "object") return {};
  const skipClaude = body.skip_claude === true || body.skipClaude === true;
  return { skipClaude };
}
