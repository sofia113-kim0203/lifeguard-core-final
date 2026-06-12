/**
 * Phase 26 Step 1D — Customer Memory + Coverage Gap + Underwriting + Recommendations + Claude.
 */

import { buildCoverageCategoryRecommendations } from "./recommendationEngine.js";
import { buildRecommendationInputFromAnalysis } from "./recommendationInputBuilder.js";
import { loadCoverageAnalysisContext } from "./customerCoverageGapCore.js";
import { loadUnderwritingAnalysisContext } from "./customerUnderwritingRiskCore.js";
import { resolveAnthropicApiKey } from "./claudeGroundedExecutionCore.js";
import { resolveClaudeModel, resolveSupabaseConfig } from "./policyTermsQaCore.js";
import { attachPolicyMeta, buildPoliciesPromptBlock } from "./panelClaudePoliciesContext.js";
import { createClient } from "@supabase/supabase-js";

const RECOMMENDATION_SYSTEM_RULES = [
  "You are a LIFEGUARD customer insurance recommendation explanation assistant.",
  "Explain only using the provided customer memory, coverage gap, underwriting risk, and pre-computed recommendation JSON.",
  "Do not invent policies, health conditions, premium amounts, carrier products, or binding underwriting decisions.",
  "If information is missing from memory or analysis, explicitly say it is not recorded.",
  "Include: (1) memory-based context, (2) gap and underwriting combined reasoning, (3) priority Top 2 recommendations, (4) coverage to keep, (5) documents to prepare before enrollment, (6) next actions.",
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

export function buildRecommendationExplanationPrompt(
  structuredMemory,
  recommendationResult,
  coverageGapResult,
  underwritingResult,
  policies = [],
) {
  const user = [
    "Explain insurance recommendations to the customer using only the blocks below.",
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
        overall_risk: coverageGapResult?.overall_risk,
        gap_score: coverageGapResult?.gap_score,
        top_gaps: coverageGapResult?.top_gaps,
      },
      null,
      2,
    ),
    "",
    "D. underwriting_summary:",
    JSON.stringify(
      {
        overall_underwriting_risk: underwritingResult?.overall_underwriting_risk,
        likely_surcharge: underwritingResult?.likely_surcharge?.map((item) => item.coverage_label),
        likely_standard: underwritingResult?.likely_standard?.map((item) => item.coverage_label),
      },
      null,
      2,
    ),
    "",
    "E. recommendation_analysis:",
    JSON.stringify(
      {
        customer_visible_top2: recommendationResult.customer_visible_top2,
        keep_existing: recommendationResult.keep_existing,
        all_recommendation_count: recommendationResult.recommendations?.length,
      },
      null,
      2,
    ),
    "",
    "Required sections in Korean:",
    "1) 고객 Memory 기준 현재 상황",
    "2) 보장공백과 인수위험을 함께 고려한 설명",
    "3) 우선 추천 Top 2",
    "4) 유지해도 되는 보장",
    "5) 가입 전 준비할 서류",
    "6) Memory/분석에 없는 정보 (있다면 명시)",
  ].join("\n");

  return { system: RECOMMENDATION_SYSTEM_RULES, user };
}

function joinCoverageLabelsForFallback(labels) {
  const trimmed = labels.filter(Boolean);
  if (!trimmed.length) return null;
  if (trimmed.length === 1) return trimmed[0];
  if (trimmed.length === 2) return `${trimmed[0]}과 ${trimmed[1]}`;
  return `${trimmed.slice(0, -1).join(", ")}과 ${trimmed[trimmed.length - 1]}`;
}

export function buildRecommendationFallbackExplanation({
  recommendationResult,
  underwritingResult,
  requiredDocuments = [],
} = {}) {
  const top2 = recommendationResult?.customer_visible_top2 ?? [];
  const labels = top2.map((item) => item.coverage_label).filter(Boolean);
  const labelPhrase = joinCoverageLabelsForFallback(labels) ?? "우선 보강이 필요한 보장";
  const parts = [`현재 분석 결과 기준으로 ${labelPhrase} 보장 보강이 우선입니다.`];

  const hasUnderwritingReview =
    (underwritingResult?.likely_surcharge?.length ?? 0) > 0 ||
    (underwritingResult?.likely_exclusion?.length ?? 0) > 0 ||
    (underwritingResult?.likely_additional_review?.length ?? 0) > 0 ||
    underwritingResult?.overall_underwriting_risk === "medium" ||
    underwritingResult?.overall_underwriting_risk === "high";

  if (hasUnderwritingReview) {
    parts.push(
      "건강 고지와 최근 처방·투약 이력에 따라 일부 보험사는 추가 심사를 요청할 수 있으므로, 가입 전 건강고지서와 최근 처방전을 준비하는 것이 좋습니다.",
    );
  } else {
    parts.push("가입 전 건강고지서와 필요 서류를 미리 준비해 두시면 설계 검토가 더 원활합니다.");
  }

  const docs =
    requiredDocuments.length > 0
      ? requiredDocuments
      : Array.from(new Set(top2.flatMap((item) => item.required_documents ?? [])));
  if (docs.length) {
    parts.push(`준비 서류 참고: ${docs.slice(0, 4).join(", ")}.`);
  }

  const keepLabels = (recommendationResult?.keep_existing ?? [])
    .map((item) => item.coverage_label)
    .filter(Boolean)
    .slice(0, 3);
  if (keepLabels.length) {
    parts.push(`유지해도 좋은 보장: ${keepLabels.join(", ")}.`);
  }

  return parts.join(" ");
}

async function parseAnthropicErrorResponse(response) {
  const http_status = response.status;
  let error_type = null;
  let detailMessage = null;

  try {
    const raw = await response.text();
    if (raw) {
      try {
        const body = JSON.parse(raw);
        error_type = body?.error?.type ?? null;
        detailMessage =
          typeof body?.error?.message === "string" ? body.error.message.slice(0, 240) : null;
      } catch {
        detailMessage = raw.slice(0, 240);
      }
    }
  } catch {
    // ignore body read failures
  }

  const error_message = detailMessage
    ? `Claude API error (${http_status}): ${detailMessage}`
    : `Claude API error (${http_status})`;

  return {
    ok: false,
    reason: "CLAUDE_API_ERROR",
    http_status,
    error_type,
    error_message,
    errorMessage: error_message,
  };
}

function buildRecommendationClaudeMetaFromFailure(claudeResult, reasonOverride = null) {
  return {
    skipped: true,
    reason: reasonOverride ?? claudeResult.reason ?? "CLAUDE_API_ERROR",
    http_status: claudeResult.http_status ?? null,
    error_type: claudeResult.error_type ?? null,
    error_message: claudeResult.error_message ?? claudeResult.errorMessage ?? null,
    fallback_used: true,
    explanation_mode: "fallback",
  };
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
      max_tokens: 1500,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!response.ok) {
    return parseAnthropicErrorResponse(response);
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

export async function loadRecommendationAnalysisContext(supabase, customerId) {
  const [coverageContext, uwContext] = await Promise.all([
    loadCoverageAnalysisContext(supabase, customerId),
    loadUnderwritingAnalysisContext(supabase, customerId),
  ]);

  const input = buildRecommendationInputFromAnalysis({
    snapshot: uwContext.snapshot,
    policies: coverageContext.policies ?? [],
    health: coverageContext.health ?? null,
    coverageGapResult: uwContext.coverageGapResult,
    underwritingResult: uwContext.underwritingResult,
    structuredMemory: uwContext.structuredMemory,
  });

  const recommendationResult = buildCoverageCategoryRecommendations({
    customer_id: customerId,
    coverageGapResult: uwContext.coverageGapResult,
    underwritingResult: uwContext.underwritingResult,
    monthly_budget: input.monthly_budget,
    insurance_goal: input.insurance_goal,
  });

  return {
    input,
    snapshot: uwContext.snapshot,
    structuredMemory: uwContext.structuredMemory,
    coverageGapResult: uwContext.coverageGapResult,
    underwritingResult: uwContext.underwritingResult,
    recommendationResult,
    policies: coverageContext.policies ?? [],
    health: coverageContext.health ?? null,
  };
}

export async function handleCustomerRecommendationRequest({
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

  const context = await loadRecommendationAnalysisContext(supabase, customerId);

  const requiredDocuments = Array.from(
    new Set(context.recommendationResult.recommendations.flatMap((item) => item.required_documents ?? [])),
  );

  const fallbackExplanation = () =>
    buildRecommendationFallbackExplanation({
      recommendationResult: context.recommendationResult,
      underwritingResult: context.underwritingResult,
      requiredDocuments,
    });

  let claudeExplanation = null;
  let claudeMeta = { skipped: true, reason: "skipClaude" };

  if (!skipClaude) {
    const anthropicApiKey = resolveAnthropicApiKey(env);
    if (!anthropicApiKey) {
      claudeExplanation = fallbackExplanation();
      claudeMeta = attachPolicyMeta(
        {
          skipped: true,
          reason: "ANTHROPIC_NOT_CONFIGURED",
          http_status: null,
          error_type: null,
          error_message: "ANTHROPIC_API_KEY is not configured on the server.",
          fallback_used: true,
          explanation_mode: "fallback",
        },
        context.policies ?? [],
      );
    } else {
      const prompt = buildRecommendationExplanationPrompt(
        context.structuredMemory,
        context.recommendationResult,
        context.coverageGapResult,
        context.underwritingResult,
        context.policies ?? [],
      );
      let claudeResult;
      try {
        claudeResult = await callAnthropic({
          apiKey: anthropicApiKey,
          modelName: resolveClaudeModel(env),
          system: prompt.system,
          user: prompt.user,
          fetchImpl,
        });
      } catch (error) {
        claudeResult = {
          ok: false,
          reason: "CLAUDE_API_ERROR",
          http_status: null,
          error_type: "network_error",
          error_message: error instanceof Error ? error.message : "claude_request_failed",
          errorMessage: error instanceof Error ? error.message : "claude_request_failed",
        };
      }
      if (claudeResult.ok) {
        claudeExplanation = claudeResult.answer;
        claudeMeta = attachPolicyMeta(
          {
            skipped: false,
            model_name: claudeResult.model,
            provider: claudeResult.provider,
            explanation_mode: "claude",
          },
          context.policies ?? [],
        );
      } else {
        claudeExplanation = fallbackExplanation();
        claudeMeta = attachPolicyMeta(
          buildRecommendationClaudeMetaFromFailure(claudeResult),
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
    memory_version: context.snapshot.memory_version ?? 0,
    memory_fact_count: context.snapshot.fact_count ?? 0,
    used_memory_sources: context.input.memory_sources_used,
    structured_memory: context.structuredMemory,
    coverage_gap_result: context.coverageGapResult,
    underwriting_result: context.underwritingResult,
    recommendations: context.recommendationResult.recommendations,
    customer_visible_top2: context.recommendationResult.customer_visible_top2,
    keep_existing_recommendations: context.recommendationResult.keep_existing,
    required_documents: requiredDocuments,
    claude_explanation: claudeExplanation,
    claude_meta: claudeMeta,
  };
}

export function parseCustomerRecommendationBody(body) {
  if (!body || typeof body !== "object") return {};
  const skipClaude = body.skip_claude === true || body.skipClaude === true;
  return { skipClaude };
}
