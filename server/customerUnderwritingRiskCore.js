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
import { resolveSupabaseConfig } from "./policyTermsQaCore.js";
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

function documentCodesFor(status, relatedRisks) {
  const docs = new Set();
  if (
    status === "likely_additional_review" ||
    status === "likely_surcharge" ||
    status === "likely_exclusion" ||
    status === "likely_decline"
  ) {
    docs.add("health_disclosure");
    docs.add("prescription_record");
  }
  if (relatedRisks.some((risk) => ["surgery_history", "hospitalization_history"].includes(risk.risk_type))) {
    docs.add("hospitalization_record");
  }
  if (relatedRisks.some((risk) => ["recent_diagnosis", "cancer_history"].includes(risk.risk_type))) {
    docs.add("diagnosis_record");
  }
  if (status === "unknown") {
    docs.add("additional_health_context");
  }
  return Array.from(docs);
}

function deriveReviewStepCode(underwriting_status, gapItem) {
  if (underwriting_status === "likely_standard" && gapItem?.gap_level === "sufficient") {
    return "maintain_standard_path";
  }
  if (underwriting_status === "likely_standard") return "review_with_gap_priority";
  if (underwriting_status === "likely_surcharge") return "prepare_health_documents";
  if (underwriting_status === "likely_exclusion") return "check_exclusion_riders";
  if (underwriting_status === "likely_additional_review" || underwriting_status === "likely_decline") {
    return "agent_review_required";
  }
  return "add_health_memory_context";
}

function deriveUwReasonCodes({
  underwriting_status,
  gapItem,
  diabetesSignal,
  critical,
  elevated,
  vague,
  related,
}) {
  const codes = [];
  if (gapItem?.gap_level === "sufficient") codes.push("coverage_held");
  if (gapItem && ["critical", "high", "medium"].includes(gapItem.gap_level)) {
    codes.push("coverage_gap_priority");
  }
  if (diabetesSignal) codes.push("diabetes_signal");
  if (critical.some((item) => item.status === "high")) codes.push("critical_health_risk");
  if (elevated.some((item) => item.status === "high")) codes.push("elevated_health_risk");
  if (elevated.some((item) => item.status === "medium")) codes.push("medium_health_risk");
  if (vague.length > 0) codes.push("vague_health_signal");
  if (underwriting_status === "likely_decline") codes.push("high_uw_friction");
  if (underwriting_status === "likely_surcharge") codes.push("surcharge_review_signal");
  if (underwriting_status === "likely_exclusion") codes.push("exclusion_review_signal");
  if (underwriting_status === "likely_additional_review") codes.push("additional_review_signal");
  if (underwriting_status === "likely_standard" && related.length === 0) {
    codes.push("no_elevated_health_signal");
  }
  if (related.length === 0 && underwriting_status === "unknown") codes.push("health_memory_limited");
  return codes;
}

function itemEvidenceCodes(confidence_level, related) {
  const codes = [];
  if (confidence_level === "low") codes.push("memory_confidence_low");
  else if (confidence_level === "high") codes.push("memory_confidence_high");
  else codes.push("memory_confidence_medium");
  if (related.some((item) => item.requires_agent_review)) codes.push("requires_agent_review");
  return codes;
}

function assessCategoryUnderwriting(categoryConfig, healthRiskItems, gapItem, healthFacts) {
  const elevated = matchingRisks(healthRiskItems, categoryConfig.elevated_risks);
  const critical = matchingRisks(healthRiskItems, categoryConfig.critical_risks);
  const diabetesSignal = hasDiabetesSignal(healthRiskItems, healthFacts);
  const vague = matchingRisks(healthRiskItems, ["vague_health"]);
  const related = [...new Map([...critical, ...elevated].map((item) => [item.risk_type, item])).values()];

  let underwriting_status = "unknown";
  let risk_level = "low";
  let confidence_level = "low";

  if (gapItem?.gap_level === "sufficient") {
    underwriting_status = "likely_standard";
    risk_level = "low";
    confidence_level = gapItem.confidence === "high" ? "high" : "medium";
  } else if (critical.some((item) => item.status === "high")) {
    underwriting_status = "likely_decline";
    risk_level = "critical";
    confidence_level = critical[0].confidence ?? "medium";
  } else if (
    diabetesSignal &&
    ["cancer", "brain", "heart", "surgery", "hospitalization", "dementia_care", "death"].includes(
      categoryConfig.coverage_category,
    )
  ) {
    underwriting_status = "likely_surcharge";
    risk_level = "high";
    confidence_level = "high";
  } else if (elevated.some((item) => item.status === "high")) {
    underwriting_status = "likely_exclusion";
    risk_level = "high";
    confidence_level = elevated[0].confidence ?? "medium";
  } else if (elevated.some((item) => item.status === "medium") || vague.length > 0) {
    underwriting_status = "likely_additional_review";
    risk_level = "medium";
    confidence_level = "medium";
  } else if (gapItem && ["critical", "high", "medium"].includes(gapItem.gap_level) && related.length === 0) {
    underwriting_status = "likely_standard";
    risk_level = "low";
    confidence_level = "medium";
  } else if (related.length > 0) {
    underwriting_status = "likely_additional_review";
    risk_level = "medium";
    confidence_level = "medium";
  }

  const uw_reason_codes = deriveUwReasonCodes({
    underwriting_status,
    gapItem,
    diabetesSignal,
    critical,
    elevated,
    vague,
    related,
  });
  const review_step_code = deriveReviewStepCode(underwriting_status, gapItem);
  const required_document_codes = documentCodesFor(underwriting_status, related);
  const evidence_codes = itemEvidenceCodes(confidence_level, related);

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
    uw_reason_codes,
    review_step_code,
    related_memory_sources: memorySources,
    related_health_risk_types: related.map((item) => item.risk_type),
    required_document_codes,
    confidence_level,
    evidence_codes,
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

  const required_document_codes = Array.from(new Set(items.flatMap((item) => item.required_document_codes ?? [])));

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
    required_document_codes,
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

export function sanitizeUnderwritingStructuredForPrompt(underwritingResult = {}) {
  const pickItem = (item) => ({
    coverage_category: item.coverage_category ?? null,
    coverage_label: item.coverage_label ?? null,
    underwriting_status: item.underwriting_status ?? null,
    risk_level: item.risk_level ?? null,
    uw_reason_codes: item.uw_reason_codes ?? [],
    review_step_code: item.review_step_code ?? null,
    evidence_codes: item.evidence_codes ?? [],
    confidence_level: item.confidence_level ?? null,
    required_document_codes: item.required_document_codes ?? [],
    related_health_risk_types: item.related_health_risk_types ?? [],
  });

  return {
    overall_underwriting_risk: underwritingResult.overall_underwriting_risk ?? null,
    risk_score: underwritingResult.risk_score ?? null,
    items: (underwritingResult.items ?? []).map(pickItem),
    likely_standard: (underwritingResult.likely_standard ?? []).map(pickItem),
    likely_surcharge: (underwritingResult.likely_surcharge ?? []).map(pickItem),
    likely_exclusion: (underwritingResult.likely_exclusion ?? []).map(pickItem),
    likely_additional_review: (underwritingResult.likely_additional_review ?? []).map(pickItem),
    likely_decline: (underwritingResult.likely_decline ?? []).map(pickItem),
    coverage_gap_reference: underwritingResult.coverage_gap_reference ?? null,
    required_document_codes: underwritingResult.required_document_codes ?? [],
  };
}

export function buildUnderwritingExplanationPrompt(
  structuredMemory,
  coverageGapResult,
  underwritingResult,
  policies = [],
  countContract = null,
) {
  const structuredUw = sanitizeUnderwritingStructuredForPrompt(underwritingResult);
  const user = [
    "Explain underwriting risk analysis to the customer using only the blocks below.",
    "",
    "A. customer_memory_summary:",
    JSON.stringify(structuredMemory, null, 2),
    "",
    "B. coverage_gap_reference:",
    JSON.stringify(underwritingResult.coverage_gap_reference, null, 2),
    "",
    "C. underwriting_risk_analysis (structured codes only — do not invent binding enrollment verdicts):",
    JSON.stringify(structuredUw, null, 2),
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
    active_policy_count: coverageContext.active_policy_count ?? null,
    active_policy_count_source: coverageContext.active_policy_count_source ?? null,
    active_policy_ids: coverageContext.active_policy_ids ?? null,
    policy_count: coverageContext.policy_count ?? null,
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

  // FACTORY-SPEAK-03-S1 — underwriting factory must not speak to customers via Claude explanation.
  const claudeExplanation = null;
  const claudeMeta = {
    skipped: true,
    reason: "FACTORY_SPEAK_03_S1",
    explanation_mode: "blocked",
  };

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
    required_document_codes: context.underwritingResult.required_document_codes,
    claude_explanation: claudeExplanation,
    claude_meta: claudeMeta,
  };
}

export function parseCustomerUnderwritingRiskBody(body) {
  if (!body || typeof body !== "object") return {};
  const skipClaude = body.skip_claude === true || body.skipClaude === true;
  return { skipClaude };
}
