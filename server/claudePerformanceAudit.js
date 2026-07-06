/**
 * Phase 26 Step 2B — Claude performance audit utilities.
 */

import {
  ADVISOR_TONE_SYSTEM_RULES,
  buildCustomerFacingContext,
} from "./customerConversationalTone.js";

export function estimateTokens(text) {
  const value = String(text ?? "");
  if (!value) return 0;
  // Korean-heavy prompts: conservative ~2.5 chars per token estimate.
  return Math.ceil(value.length / 2.5);
}

export function measurePrompt({ system = "", user = "" } = {}) {
  const systemText = String(system ?? "");
  const userText = String(user ?? "");
  const promptChars = systemText.length + userText.length;
  return {
    system_chars: systemText.length,
    user_chars: userText.length,
    prompt_chars: promptChars,
    estimated_input_tokens: estimateTokens(systemText) + estimateTokens(userText),
  };
}

export function measureOutput(text) {
  const output = String(text ?? "");
  return {
    output_chars: output.length,
    estimated_output_tokens: estimateTokens(output),
  };
}

export function buildMemorySummary(structuredMemory, snapshot, sourceSummary = null) {
  const facts = snapshot?.facts ?? [];
  const profile = [];
  const health = [];
  const insurance = [];

  for (const fact of facts) {
    const line = `${fact.fact_key}: ${fact.fact_value}`;
    if (fact.fact_type === "health" || String(fact.fact_key).startsWith("health.")) {
      health.push(line);
    } else if (fact.fact_type === "insurance" || String(fact.fact_key).startsWith("insurance.")) {
      insurance.push(line);
    } else {
      profile.push(line);
    }
  }

  const source = sourceSummary ?? {};
  if (!profile.length && source.profile) {
    for (const [key, value] of Object.entries(source.profile)) {
      if (value != null && value !== "") profile.push(`${key}: ${value}`);
    }
  }
  if (!health.length && source.health) {
    for (const [key, value] of Object.entries(source.health)) {
      if (value != null && value !== "") health.push(`${key}: ${value}`);
    }
  }
  if (!insurance.length && Array.isArray(source.insurance)) {
    for (const policy of source.insurance) {
      insurance.push(`${policy.insurer ?? ""} ${policy.product ?? ""}`.trim());
    }
  }

  return {
    customer_name:
      facts.find((f) => f.fact_key === "profile.name")?.fact_value ??
      structuredMemory?.profile?.name ??
      snapshot?.profile?.display_name ??
      source.profile?.name ??
      null,
    memory_version: snapshot?.memory_version ?? structuredMemory?.memory_version ?? null,
    fact_count: snapshot?.fact_count ?? facts.length,
    profile_facts: profile.slice(0, 6),
    health_facts: health.slice(0, 5),
    insurance_facts: insurance.slice(0, 5),
    source_documents: (source.documents ?? []).slice(0, 3),
  };
}

export function buildCompressedAnalysisSummary(workingContext) {
  const {
    structuredMemory,
    snapshot,
    coverageGapResult,
    underwritingResult,
    recommendationResult,
    designBundle,
  } = workingContext;

  const memory = buildMemorySummary(structuredMemory, snapshot, workingContext.sourceSummary);

  const topGaps = (coverageGapResult?.top_gaps ?? []).slice(0, 3).map((item) => ({
    category: item.coverage_label ?? item.coverage_category,
    gap_level: item.gap_level,
    action_code: item.action_code ?? null,
    gap_reason_codes: item.gap_reason_codes ?? [],
  }));

  const uwRisks = (underwritingResult?.likely_surcharge ?? []).slice(0, 3).map((item) => ({
    category: item.coverage_label ?? item.coverage_category,
    status: item.underwriting_status,
    uw_reason_codes: item.uw_reason_codes ?? [],
    review_step_code: item.review_step_code ?? null,
  }));

  const top2 = (recommendationResult?.customer_visible_top2 ?? []).slice(0, 2).map((item) => ({
    rank: item.recommendation_rank,
    category: item.coverage_label ?? item.coverage_category,
    type: item.recommendation_type,
    priority: item.priority,
  }));

  const visibleDesign = designBundle?.customer_visible_design ?? {};
  const keepExisting = visibleDesign.keep_existing_coverages ?? recommendationResult?.keep_existing?.map((i) => i.coverage_label) ?? [];

  return {
    memory,
    coverage_gap: {
      overall_risk: coverageGapResult?.overall_risk,
      gap_score: coverageGapResult?.gap_score,
      top_gaps: topGaps,
      maintained: (coverageGapResult?.maintained_coverage ?? []).slice(0, 3).map((i) => i.coverage_label ?? i.coverage_category),
    },
    underwriting: {
      overall_risk: underwritingResult?.overall_underwriting_risk,
      risk_score: underwritingResult?.risk_score,
      top_risks: uwRisks,
      likely_standard: (underwritingResult?.likely_standard ?? []).slice(0, 2).map((i) => i.coverage_label ?? i.coverage_category),
    },
    recommendation: {
      top2,
      keep_existing: keepExisting,
    },
    insurance_design: {
      design_priority: visibleDesign.design_priority ?? designBundle?.insurance_design?.design_priority ?? null,
      design_reason_codes: visibleDesign.design_reason_codes ?? [],
      plan_step_codes: visibleDesign.plan_step_codes ?? [],
      budget_band_code: visibleDesign.budget_band_code ?? null,
      priority_coverages: visibleDesign.priority_coverages ?? [],
      keep_existing_coverages: visibleDesign.keep_existing_coverages ?? [],
      required_document_codes: (
        visibleDesign.required_document_codes ??
        designBundle?.insurance_design?.required_document_codes ??
        []
      ).slice(0, 5),
      pre_enrollment_caution_codes: (visibleDesign.pre_enrollment_caution_codes ?? []).slice(0, 3),
    },
  };
}

export function buildIntentAwareAnalysisSummary(workingContext = {}) {
  const intent = workingContext.intentGate?.intent ?? "general_consultation";
  const full = buildCompressedAnalysisSummary(workingContext);

  if (intent === "factual_lookup") {
    return {
      memory: full.memory,
      factual_lookup_answer: workingContext.factual_lookup_answer ?? null,
    };
  }

  if (intent === "policy_detail") {
    return {
      memory: full.memory,
      policy_detail_answer: workingContext.policy_detail_answer ?? null,
    };
  }

  if (intent === "coverage_gap_check" || intent === "coverage_review_request") {
    return {
      memory: full.memory,
      coverage_gap: full.coverage_gap,
    };
  }

  if (intent === "recommendation_request") {
    return {
      memory: full.memory,
      coverage_gap: full.coverage_gap,
      recommendation: full.recommendation,
    };
  }

  if (intent === "general_consultation") {
    return {
      memory: full.memory,
      coverage_gap: full.coverage_gap,
    };
  }

  return full;
}

export function buildShortExplanationPrompt(question, workingContext) {
  const intent = workingContext.intentGate?.intent ?? "general_consultation";
  const summary = buildIntentAwareAnalysisSummary(workingContext);
  const customerContext =
    intent === "factual_lookup"
      ? {
          customer_label: buildCustomerFacingContext(workingContext).customer_label,
          factual_lookup_answer: workingContext.factual_lookup_answer ?? null,
        }
      : intent === "policy_detail"
        ? {
            customer_label: buildCustomerFacingContext(workingContext).customer_label,
            policy_detail_answer: workingContext.policy_detail_answer ?? null,
          }
        : buildCustomerFacingContext(workingContext);
  const system = [
    ADVISOR_TONE_SYSTEM_RULES,
    intent === "factual_lookup" || intent === "policy_detail"
      ? "This is a factual lookup answer. Do NOT mention coverage gaps, recommendations, or insurance design unless the customer explicitly asked."
      : "Put the direct answer to the customer's literal question in the first 1-2 sentences. Only after that, add analysis context allowed for this intent.",
  ].join("\n");

  const user = [
    `Customer question: ${question}`,
    `consultation_intent: ${intent}`,
    "",
    "customer_facing_context (use this natural-language summary first):",
    JSON.stringify(customerContext, null, 2),
    "",
    "analysis_reference_json (internal reference only — do not quote field names or scores):",
    JSON.stringify(summary),
  ].join("\n");

  return { system, user, summary, customerContext };
}

export function auditExplanationContext(workingContext, question) {
  const summary = buildCompressedAnalysisSummary(workingContext);
  const shortPrompt = buildShortExplanationPrompt(question, workingContext);

  return {
    memory_context_chars: JSON.stringify(summary.memory).length,
    coverage_gap_context_chars: JSON.stringify(summary.coverage_gap).length,
    underwriting_context_chars: JSON.stringify(summary.underwriting).length,
    recommendation_context_chars: JSON.stringify(summary.recommendation).length,
    design_context_chars: JSON.stringify(summary.insurance_design).length,
    compressed_summary_chars: JSON.stringify(summary).length,
    short_prompt: measurePrompt(shortPrompt),
    rag_context_included: false,
    includes_full_recommendations: false,
    includes_agent_full_details: false,
  };
}
