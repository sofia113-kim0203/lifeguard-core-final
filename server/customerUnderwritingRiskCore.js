/**
 * Phase 26 Step 1C — Customer Memory + Coverage Gap + Underwriting Risk + Claude.
 */

import { analyzeUnderwritingRisk } from "./underwritingRiskAnalysisEngine.js";
import {
  buildUnderwritingRiskInputFromMemory,
  UNDERWRITING_COVERAGE_CATEGORIES,
} from "./underwritingRiskInputBuilder.js";
import { loadCoverageAnalysisContext } from "./customerCoverageGapCore.js";
import {
  buildStructuredMemoryProfile,
  mapMemoryFactsForResponse,
} from "./customerMemorySnapshot.js";
import { resolveAnthropicApiKey } from "./claudeGroundedExecutionCore.js";
import { resolveClaudeModel, resolveSupabaseConfig } from "./policyTermsQaCore.js";
import { attachPolicyMeta, buildPoliciesPromptBlock } from "./panelClaudePoliciesContext.js";
import { createClient } from "@supabase/supabase-js";

const STATUS_ORDER = {
  likely_decline: 0,
  likely_exclusion: 1,
  likely_surcharge: 2,
  likely_additional_review: 3,
  unknown: 4,
  likely_standard: 5,
};

const RISK_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

const UNDERWRITING_SYSTEM_RULES = [
  "You are a LIFEGUARD customer insurance underwriting risk explanation assistant.",
  "Explain only using the provided customer memory, coverage gap analysis, and pre-computed underwriting risk JSON.",
  "Do not invent health conditions, policies, underwriting decisions, premium amounts, or product recommendations.",
  "If information is missing from customer memory, explicitly say it is not recorded in memory.",
  "Include: (1) memory-based context, (2) likely enrollable items, (3) surcharge/exclusion risks, (4) additional disclosure needs, (5) required documents, (6) priority linked to coverage gaps.",
  "Do not make final binding underwriting approval or decline decisions.",
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

function findGapItem(coverageGapResult, category) {
  return (coverageGapResult?.items ?? []).find((item) => item.coverage_category === category);
}

function matchingRisks(healthRiskItems, riskTypes) {
  return (healthRiskItems ?? []).filter(
    (item) => riskTypes.includes(item.risk_type) && item.status !== "none",
  );
}

function hasDiabetesSignal(healthRiskItems, healthFacts) {
  const diabetes = healthRiskItems.find((item) => item.risk_type === "diabetes" && item.status !== "none");
  const medication = healthRiskItems.find(
    (item) => item.risk_type === "medication_history" && item.status !== "none",
  );
  const factText = (healthFacts ?? [])
    .map((fact) => `${fact.fact_key} ${fact.fact_value}`)
    .join(" ")
    .toLowerCase();
  const diabetesInFacts = /당뇨|diabetes/.test(factText);
  return Boolean(diabetes) || (medication && diabetesInFacts);
}

function requiredDocumentsFor(status, relatedRisks) {
  const docs = new Set();
  if (status === "likely_additional_review" || status === "likely_surcharge" || status === "likely_exclusion") {
    docs.add("건강고지서");
    docs.add("최근 처방전 또는 투약 확인서");
  }
  if (relatedRisks.some((risk) => ["surgery_history", "hospitalization_history"].includes(risk.risk_type))) {
    docs.add("진단서 또는 입퇴원 확인서");
  }
  if (relatedRisks.some((risk) => ["recent_diagnosis", "cancer_history"].includes(risk.risk_type))) {
    docs.add("진단 관련 의료기록");
  }
  if (status === "unknown") {
    docs.add("추가 건강 정보 확인 자료");
  }
  return Array.from(docs);
}

function recommendedNextStep(status, label, gapItem) {
  if (status === "likely_standard" && gapItem?.gap_level === "sufficient") {
    return `${label}은(는) 현재 Memory 기준 유지 보장으로 판단됩니다.`;
  }
  if (status === "likely_standard") {
    return `${label} 가입 가능성이 상대적으로 높습니다. Coverage Gap 우선순위와 함께 검토하세요.`;
  }
  if (status === "likely_surcharge") {
    return `${label}은(는) 건강 Memory 기준 할증 또는 부담보 가능성이 있어 사전 고지와 서류 준비가 필요합니다.`;
  }
  if (status === "likely_exclusion") {
    return `${label}은(는) 특정 담보 부담보 가능성이 있어 약관·고지 내용을 먼저 확인하세요.`;
  }
  if (status === "likely_additional_review") {
    return `${label}은(는) 추가 심사 가능성이 있어 건강 관련 서류를 준비한 뒤 진행하세요.`;
  }
  if (status === "likely_decline") {
    return `${label}은(는) 현재 Memory 기준 가입 거절 위험이 높습니다. 설계사·보험사 심사 확인이 필요합니다.`;
  }
  return `${label} 관련 건강 Memory가 부족하여 추가 정보 확인 후 재분석하세요.`;
}

function assessCategoryUnderwriting(categoryConfig, healthRiskItems, gapItem, healthFacts) {
  const elevated = matchingRisks(healthRiskItems, categoryConfig.elevated_risks);
  const critical = matchingRisks(healthRiskItems, categoryConfig.critical_risks);
  const diabetesSignal = hasDiabetesSignal(healthRiskItems, healthFacts);
  const vague = matchingRisks(healthRiskItems, ["vague_health"]);
  const related = [...new Map([...critical, ...elevated].map((item) => [item.risk_type, item])).values()];

  let underwriting_status = "unknown";
  let risk_level = "low";
  let reason = `${categoryConfig.label} 관련 건강 Memory가 제한적입니다.`;
  let confidence_level = "low";

  if (gapItem?.gap_level === "sufficient") {
    underwriting_status = "likely_standard";
    risk_level = "low";
    reason = `${categoryConfig.label} 보장이 Memory에 유지 중으로 기록되어 있습니다.`;
    confidence_level = gapItem.confidence === "high" ? "high" : "medium";
  } else if (critical.some((item) => item.status === "high")) {
    underwriting_status = "likely_decline";
    risk_level = "critical";
    reason = `${categoryConfig.label} 가입 시 ${critical[0].reason}`;
    confidence_level = critical[0].confidence ?? "medium";
  } else if (diabetesSignal && ["cancer", "brain", "heart", "surgery", "hospitalization", "dementia_care", "death"].includes(categoryConfig.coverage_category)) {
    underwriting_status = "likely_surcharge";
    risk_level = "high";
    reason = `당뇨 관련 health memory(복용약 등)가 있어 ${categoryConfig.label} 가입 시 할증 또는 부담보 가능성이 있습니다.`;
    confidence_level = "high";
  } else if (elevated.some((item) => item.status === "high")) {
    underwriting_status = "likely_exclusion";
    risk_level = "high";
    reason = `${categoryConfig.label} 가입 시 특정 담보 부담보 가능성이 있는 health memory가 있습니다.`;
    confidence_level = elevated[0].confidence ?? "medium";
  } else if (elevated.some((item) => item.status === "medium") || vague.length > 0) {
    underwriting_status = "likely_additional_review";
    risk_level = "medium";
    reason = `${categoryConfig.label} 가입 시 추가 심사 또는 고지 확인이 필요할 수 있는 health memory가 있습니다.`;
    confidence_level = "medium";
  } else if (gapItem && ["critical", "high", "medium"].includes(gapItem.gap_level) && related.length === 0) {
    underwriting_status = "likely_standard";
    risk_level = "low";
    reason = `Coverage Gap에서 ${categoryConfig.label} 보장이 부족하지만, 현재 health memory 기준 특별한 인수 위험 신호는 없습니다.`;
    confidence_level = "medium";
  } else if (related.length > 0) {
    underwriting_status = "likely_additional_review";
    risk_level = "medium";
    reason = `${categoryConfig.label} 가입과 연관된 health memory가 있어 추가 확인이 필요합니다.`;
    confidence_level = "medium";
  }

  const memorySources = Array.from(
    new Set([
      ...(gapItem?.memory_sources_used ?? []),
      ...related.flatMap((item) => item.evidence_fact_keys ?? []),
    ]),
  );

  return {
    coverage_category: categoryConfig.coverage_category,
    coverage_label: categoryConfig.label,
    underwriting_status,
    risk_level,
    reason,
    related_memory_sources: memorySources,
    related_health_risks: related.map((item) => item.risk_type),
    recommended_next_step: recommendedNextStep(underwriting_status, categoryConfig.label, gapItem),
    required_documents: requiredDocumentsFor(underwriting_status, related),
    confidence_level,
    coverage_gap_level: gapItem?.gap_level ?? null,
    coverage_gap_priority: gapItem?.priority ?? null,
  };
}

export function transformUnderwritingRiskResults({
  healthAnalysis,
  input,
  coverageGapResult,
}) {
  const items = UNDERWRITING_COVERAGE_CATEGORIES.map((category) =>
    assessCategoryUnderwriting(
      category,
      healthAnalysis.health_risk_items,
      findGapItem(coverageGapResult, category.coverage_category),
      input.health_memory_facts,
    ),
  );

  items.sort(
    (left, right) =>
      (STATUS_ORDER[left.underwriting_status] ?? 99) - (STATUS_ORDER[right.underwriting_status] ?? 99) ||
      (RISK_ORDER[left.risk_level] ?? 99) - (RISK_ORDER[right.risk_level] ?? 99),
  );

  const likely_standard = items.filter((item) => item.underwriting_status === "likely_standard");
  const likely_surcharge = items.filter((item) => item.underwriting_status === "likely_surcharge");
  const likely_exclusion = items.filter((item) => item.underwriting_status === "likely_exclusion");
  const likely_additional_review = items.filter(
    (item) => item.underwriting_status === "likely_additional_review",
  );
  const likely_decline = items.filter((item) => item.underwriting_status === "likely_decline");

  const required_documents = Array.from(new Set(items.flatMap((item) => item.required_documents)));

  const overallRisk =
    items.some((item) => item.risk_level === "critical")
      ? "critical"
      : items.some((item) => item.risk_level === "high")
        ? "high"
        : items.some((item) => item.risk_level === "medium")
          ? "medium"
          : "low";

  return {
    customer_id: input.customer_id,
    overall_underwriting_risk: overallRisk,
    risk_score: healthAnalysis.risk_score ?? 0,
    generated_at: healthAnalysis.generated_at,
    items,
    likely_standard,
    likely_surcharge,
    likely_exclusion,
    likely_additional_review,
    likely_decline,
    required_documents,
    health_risk_items: healthAnalysis.health_risk_items ?? [],
    unknown_items: healthAnalysis.unknown_items ?? [],
    agent_review_items: healthAnalysis.agent_review_items ?? [],
    coverage_gap_reference: {
      overall_risk: coverageGapResult?.overall_risk ?? null,
      gap_score: coverageGapResult?.gap_score ?? null,
      top_gaps: (coverageGapResult?.top_gaps ?? []).map((gap) => ({
        coverage_category: gap.coverage_category,
        gap_level: gap.gap_level,
      })),
    },
    used_memory_sources: input.memory_sources_used ?? [],
    memory_facts_used: mapMemoryFactsForResponse(input.health_memory_facts),
  };
}

export function buildUnderwritingExplanationPrompt(
  structuredMemory,
  coverageGapResult,
  underwritingResult,
  policies = [],
) {
  const user = [
    "Explain underwriting risk analysis to the customer using only the blocks below.",
    "",
    "A. customer_memory_summary:",
    JSON.stringify(structuredMemory, null, 2),
    "",
    "B.",
    buildPoliciesPromptBlock(policies),
    "",
    "C. coverage_gap_reference:",
    JSON.stringify(underwritingResult.coverage_gap_reference, null, 2),
    "",
    "D. underwriting_risk_analysis:",
    JSON.stringify(underwritingResult, null, 2),
    "",
    "Required sections in Korean:",
    "1) 고객 Memory 기준 현재 상황",
    "2) 가입 가능성이 높은 항목",
    "3) 할증/부담보 가능성이 있는 항목",
    "4) 추가 고지가 필요한 항목",
    "5) 필요 서류",
    "6) Coverage Gap과 연결된 우선순위",
    "7) Memory에 없는 정보 (있다면 명시)",
  ].join("\n");

  return { system: UNDERWRITING_SYSTEM_RULES, user };
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

export async function loadUnderwritingAnalysisContext(supabase, customerId) {
  const coverageContext = await loadCoverageAnalysisContext(supabase, customerId);
  const input = buildUnderwritingRiskInputFromMemory({
    snapshot: coverageContext.snapshot,
    policies: coverageContext.policies ?? [],
    health: coverageContext.health ?? null,
    coverageGapResult: coverageContext.coverageGapResult,
  });

  const healthAnalysis = analyzeUnderwritingRisk({
    customer_id: customerId,
    memory: input.health_memory_facts,
  });

  const underwritingResult = transformUnderwritingRiskResults({
    healthAnalysis,
    input,
    coverageGapResult: coverageContext.coverageGapResult,
  });

  return {
    snapshot: coverageContext.snapshot,
    structuredMemory: coverageContext.structuredMemory ?? buildStructuredMemoryProfile(coverageContext.snapshot),
    coverageGapResult: coverageContext.coverageGapResult,
    policies: coverageContext.policies ?? [],
    input,
    healthAnalysis,
    underwritingResult,
  };
}

export async function handleCustomerUnderwritingRiskRequest({
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

  const context = await loadUnderwritingAnalysisContext(supabase, customerId);

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
      const prompt = buildUnderwritingExplanationPrompt(
        context.structuredMemory,
        context.coverageGapResult,
        context.underwritingResult,
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
    memory_version: context.snapshot.memory_version ?? 0,
    memory_fact_count: context.snapshot.fact_count ?? 0,
    used_memory_sources: context.underwritingResult.used_memory_sources,
    structured_memory: context.structuredMemory,
    coverage_gap_result: context.coverageGapResult,
    underwriting_result: context.underwritingResult,
    required_documents: context.underwritingResult.required_documents,
    claude_explanation: claudeExplanation,
    claude_meta: claudeMeta,
  };
}

export function parseCustomerUnderwritingRiskBody(body) {
  if (!body || typeof body !== "object") return {};
  const skipClaude = body.skip_claude === true || body.skipClaude === true;
  return { skipClaude };
}
