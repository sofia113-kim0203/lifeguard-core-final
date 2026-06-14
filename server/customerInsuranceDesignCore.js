/**
 * Phase 26 Step 1E — Customer Memory + Gap + UW + Recommendation + Insurance Design + Claude.
 */

import { buildCustomerInsuranceDesignPlan } from "./insuranceDesignGenerator.js";
import { buildInsuranceDesignInputFromAnalysis } from "./insuranceDesignInputBuilder.js";
import { loadRecommendationAnalysisContext } from "./customerRecommendationCore.js";
import { resolveAnthropicApiKey } from "./claudeGroundedExecutionCore.js";
import { resolveClaudeModel, resolveSupabaseConfig } from "./policyTermsQaCore.js";
import { attachPolicyMeta, buildPoliciesPromptBlock } from "./panelClaudePoliciesContext.js";
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

export function buildInsuranceDesignExplanationPrompt(
  structuredMemory,
  designBundle,
  context,
  policies = [],
) {
  const user = [
    "Explain the insurance design plan to the customer using only the blocks below.",
    "",
    "A. customer_memory_summary:",
    JSON.stringify(structuredMemory, null, 2),
    "",
    "B.",
    buildPoliciesPromptBlock(policies),
    "",
    "C. coverage_gap_summary:",
    JSON.stringify(
      {
        overall_risk: context.coverageGapResult?.overall_risk,
        top_gaps: context.coverageGapResult?.top_gaps,
      },
      null,
      2,
    ),
    "",
    "D. underwriting_summary:",
    JSON.stringify(
      {
        overall_underwriting_risk: context.underwritingResult?.overall_underwriting_risk,
        likely_surcharge: context.underwritingResult?.likely_surcharge?.map((item) => item.coverage_label),
      },
      null,
      2,
    ),
    "",
    "E. recommendation_top2:",
    JSON.stringify(context.recommendationResult?.customer_visible_top2, null, 2),
    "",
    "F. insurance_design:",
    JSON.stringify(
      {
        insurance_design: designBundle.insurance_design,
        customer_visible_design: designBundle.customer_visible_design,
      },
      null,
      2,
    ),
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

async function callAnthropic({ apiKey, modelName, system, user, fetchImpl = fetch }) {
  const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: modelName,
      max_tokens: 1600,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!response.ok) {
    return {
      ok: false,
      reason: "CLAUDE_API_ERROR",
      errorMessage: `Claude API error (${response.status})`,
    };
  }

  const data = await response.json();
  const text = Array.isArray(data?.content)
    ? data.content
        .filter((block) => block?.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim()
    : "";

  return {
    ok: true,
    answer: text,
    model: data?.model ?? modelName,
    provider: "anthropic",
  };
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

  // enrich input with policies/health from recommendation context's underlying data
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

  // Single server-side pass: this context cascades coverage -> underwriting -> recommendation
  // -> insurance design, all via LLM-free engines, so the four recommendation panels are
  // computed together and returned in ONE response. No analysis_jobs, no per-stage polling,
  // and no Claude call here (the panel hydrates explanations lazily) -> the screen renders
  // immediately instead of waiting on a job that polls one stage at a time.
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

  let claudeExplanation = null;
  let claudeMeta = { skipped: true, reason: "skipClaude" };

  if (!skipClaude) {
    const anthropicApiKey = resolveAnthropicApiKey(env);
    if (!anthropicApiKey) {
      claudeMeta = attachPolicyMeta(
        { skipped: true, reason: "ANTHROPIC_NOT_CONFIGURED" },
        context.policies ?? [],
      );
    } else {
      const prompt = buildInsuranceDesignExplanationPrompt(
        context.structuredMemory,
        context.designBundle,
        context,
        context.policies ?? [],
      );
      const claudeResult = await callAnthropic({
        apiKey: anthropicApiKey,
        modelName: resolveClaudeModel(env),
        system: prompt.system,
        user: prompt.user,
        fetchImpl,
      });
      if (claudeResult.ok) {
        claudeExplanation = claudeResult.answer;
        claudeMeta = attachPolicyMeta(
          {
            skipped: false,
            model_name: claudeResult.model,
            provider: claudeResult.provider,
          },
          context.policies ?? [],
        );
      } else {
        claudeMeta = attachPolicyMeta(
          {
            skipped: true,
            reason: claudeResult.reason,
            error_message: claudeResult.errorMessage,
          },
          context.policies ?? [],
        );
      }
    }
  }

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
    required_documents: context.designBundle.insurance_design.required_documents,
    claude_explanation: claudeExplanation,
    claude_meta: claudeMeta,
  };
}

export function parseCustomerInsuranceDesignBody(body) {
  if (!body || typeof body !== "object") return {};
  const skipClaude = body.skip_claude === true || body.skipClaude === true;
  return { skipClaude };
}
