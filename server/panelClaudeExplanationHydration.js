/**
 * Phase 28 Step 1C — Generate and persist panel-level Claude explanations for analysis jobs.
 */
import { loadUnifiedCustomerState, resolveActivePolicyCountFromUnified } from "./unifiedCustomerState.js";
import { resolveAnthropicApiKey } from "./claudeGroundedExecutionCore.js";
import { resolveClaudeModel } from "./policyTermsQaCore.js";
import { buildUnderwritingExplanationPrompt } from "./customerUnderwritingRiskCore.js";
import { buildRecommendationExplanationPrompt } from "./customerRecommendationCore.js";
import { buildInsuranceDesignExplanationPrompt } from "./customerInsuranceDesignCore.js";
import { attachPolicyMeta } from "./panelClaudePoliciesContext.js";
import { measureOutput, measurePrompt } from "./claudePerformanceAudit.js";

export const PANEL_CLAUDE_KEYS = ["underwriting", "recommendation", "insurance_design"];

async function callAnthropic({ apiKey, modelName, system, user, maxTokens = 1500, fetchImpl = fetch }) {
  const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: modelName,
      max_tokens: maxTokens,
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

export function buildClaudeExplanationEntry({
  explanation = null,
  meta = {},
  policies = [],
  countContract = null,
} = {}) {
  return {
    explanation,
    meta: attachPolicyMeta(meta, policies, countContract),
  };
}

function resolvePanelHydrationPolicyIds(unified = null, policies = []) {
  const policyFields = resolveActivePolicyCountFromUnified(unified);
  if (Array.isArray(policyFields.active_policy_ids) && policyFields.active_policy_ids.length > 0) {
    return policyFields.active_policy_ids.map(String);
  }
  return policies.map((policy) => String(policy.id));
}

export function resolvePanelHydrationPolicySummary(unified = null) {
  const policies = unified?.policies ?? [];
  const policyFields = resolveActivePolicyCountFromUnified(unified);
  return {
    active_policy_count: policyFields.active_policy_count,
    active_policy_count_source: policyFields.active_policy_count_source,
    policy_count: policyFields.policy_count,
    policy_ids: resolvePanelHydrationPolicyIds(unified, policies),
  };
}

async function generatePanelExplanation({
  panelKey,
  prompt,
  policies,
  countContract = null,
  anthropicApiKey,
  modelName,
  fetchImpl,
  maxTokens = 1500,
}) {
  if (!prompt) {
    return buildClaudeExplanationEntry({
      explanation: null,
      meta: { skipped: true, reason: "PANEL_CONTEXT_MISSING", panel: panelKey },
      policies,
      countContract,
    });
  }

  if (!anthropicApiKey) {
    return buildClaudeExplanationEntry({
      explanation: null,
      meta: { skipped: true, reason: "ANTHROPIC_NOT_CONFIGURED", panel: panelKey },
      policies,
      countContract,
    });
  }

  const promptMetrics = measurePrompt(prompt);
  const claudeResult = await callAnthropic({
    apiKey: anthropicApiKey,
    modelName,
    system: prompt.system,
    user: prompt.user,
    maxTokens,
    fetchImpl,
  });

  if (claudeResult.ok) {
    const outputMetrics = measureOutput(claudeResult.answer);
    return buildClaudeExplanationEntry({
      explanation: claudeResult.answer,
      meta: {
        skipped: false,
        panel: panelKey,
        model_name: claudeResult.model,
        provider: claudeResult.provider,
        prompt_chars: promptMetrics.prompt_chars,
        estimated_input_tokens: promptMetrics.estimated_input_tokens,
        output_chars: outputMetrics.output_chars,
        estimated_output_tokens: outputMetrics.estimated_output_tokens,
      },
      policies,
      countContract,
    });
  }

  return buildClaudeExplanationEntry({
    explanation: null,
    meta: {
      skipped: true,
      reason: claudeResult.reason,
      error_message: claudeResult.errorMessage,
      panel: panelKey,
    },
    policies,
    countContract,
  });
}

export async function generatePanelClaudeExplanations({
  supabase,
  customerId,
  workingContext = {},
  fetchImpl = fetch,
  env = process.env,
} = {}) {
  const startedAt = Date.now();
  const unified = await loadUnifiedCustomerState(supabase, customerId);
  const policies = unified.policies ?? [];
  const policyFields = resolveActivePolicyCountFromUnified(unified);

  const structuredMemory =
    workingContext.structuredMemory ??
    unified.structured_memory ??
    unified.structuredMemory ??
    null;
  const coverageGapResult = workingContext.coverageGapResult ?? null;
  const underwritingResult = workingContext.underwritingResult ?? null;
  const recommendationResult = workingContext.recommendationResult ?? null;
  const designBundle = workingContext.designBundle ?? null;

  const anthropicApiKey = resolveAnthropicApiKey(env);
  const modelName = resolveClaudeModel(env);
  const explanations = {};

  // FACTORY-SPEAK-03-S1 — underwriting panel Claude blocked; KEY speaks from structured codes.
  const FACTORY_SPEAK_03_S1_BLOCK_UNDERWRITING_CLAUDE = true;
  if (underwritingResult && !FACTORY_SPEAK_03_S1_BLOCK_UNDERWRITING_CLAUDE) {
    const prompt = buildUnderwritingExplanationPrompt(
      structuredMemory,
      coverageGapResult,
      underwritingResult,
      policies,
      policyFields,
    );
    explanations.underwriting = await generatePanelExplanation({
      panelKey: "underwriting",
      prompt,
      policies,
      countContract: policyFields,
      anthropicApiKey,
      modelName,
      fetchImpl,
    });
  }

  // FACTORY-SPEAK-01-S1 — recommendation panel Claude blocked; KEY speaks from structured codes.
  const FACTORY_SPEAK_01_S1_BLOCK_RECOMMENDATION_CLAUDE = true;
  if (recommendationResult && !FACTORY_SPEAK_01_S1_BLOCK_RECOMMENDATION_CLAUDE) {
    const prompt = buildRecommendationExplanationPrompt(
      structuredMemory,
      recommendationResult,
      coverageGapResult,
      underwritingResult,
      policies,
      policyFields,
    );
    explanations.recommendation = await generatePanelExplanation({
      panelKey: "recommendation",
      prompt,
      policies,
      countContract: policyFields,
      anthropicApiKey,
      modelName,
      fetchImpl,
    });
  }

  if (designBundle) {
    const FACTORY_SPEAK_04_S1_BLOCK_DESIGN_CLAUDE = true;
    if (!FACTORY_SPEAK_04_S1_BLOCK_DESIGN_CLAUDE) {
      const prompt = buildInsuranceDesignExplanationPrompt(
        structuredMemory,
        designBundle,
        {
          coverageGapResult,
          underwritingResult,
          recommendationResult,
        },
        policies,
        policyFields,
      );
      explanations.insurance_design = await generatePanelExplanation({
        panelKey: "insurance_design",
        prompt,
        policies,
        countContract: policyFields,
        anthropicApiKey,
        modelName,
        fetchImpl,
        maxTokens: 1600,
      });
    }
  }

  const policySummary = resolvePanelHydrationPolicySummary(unified);

  return {
    explanations,
    active_policy_count: policySummary.active_policy_count,
    active_policy_count_source: policySummary.active_policy_count_source,
    policy_count: policySummary.policy_count,
    policy_ids: policySummary.policy_ids,
    duration_ms: Date.now() - startedAt,
  };
}
