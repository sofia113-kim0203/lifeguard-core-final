/**
 * Phase 26 Step 2B — Claude performance audit utilities.
 */

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

export function buildMemorySummary(structuredMemory, snapshot) {
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

  return {
    customer_name:
      facts.find((f) => f.fact_key === "profile.name")?.fact_value ??
      structuredMemory?.profile_memory?.[0]?.fact_value ??
      null,
    memory_version: snapshot?.memory_version ?? structuredMemory?.memory_version ?? null,
    fact_count: snapshot?.fact_count ?? facts.length,
    profile_facts: profile.slice(0, 6),
    health_facts: health.slice(0, 5),
    insurance_facts: insurance.slice(0, 5),
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

  const memory = buildMemorySummary(structuredMemory, snapshot);

  const topGaps = (coverageGapResult?.top_gaps ?? []).slice(0, 3).map((item) => ({
    category: item.coverage_label ?? item.coverage_category,
    gap_level: item.gap_level,
    reason: String(item.reason ?? "").slice(0, 120),
  }));

  const uwRisks = (underwritingResult?.likely_surcharge ?? []).slice(0, 3).map((item) => ({
    category: item.coverage_label ?? item.coverage_category,
    status: item.underwriting_status,
    reason: String(item.reason ?? "").slice(0, 120),
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
      design_title: visibleDesign.design_title ?? designBundle?.insurance_design?.design_title,
      priority_coverages: visibleDesign.priority_coverages ?? [],
      keep_existing_coverages: visibleDesign.keep_existing_coverages ?? [],
      required_documents: (visibleDesign.required_documents ?? designBundle?.insurance_design?.required_documents ?? []).slice(0, 5),
      next_actions: (visibleDesign.next_actions ?? []).slice(0, 3),
      pre_enrollment_cautions: (visibleDesign.pre_enrollment_cautions ?? []).slice(0, 3),
    },
  };
}

export function buildShortExplanationPrompt(question, workingContext) {
  const summary = buildCompressedAnalysisSummary(workingContext);
  const system = [
    "You are a LIFEGUARD customer insurance consultation assistant.",
    "Write a concise Korean explanation using ONLY the provided analysis summary.",
    "Rules:",
    "- Maximum 5 sentences total.",
    "- Maximum 800 Korean characters.",
    "- Cover: Memory context, top coverage gaps, underwriting caution, top 2 recommendations, design next step.",
    "- Do not invent insurers, products, premiums, or approval/decline decisions.",
    "- End with one practical next action.",
    "- No markdown headings; plain conversational Korean.",
  ].join(" ");

  const user = [
    `Customer question: ${question}`,
    "",
    "analysis_summary_json:",
    JSON.stringify(summary),
  ].join("\n");

  return { system, user, summary };
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
