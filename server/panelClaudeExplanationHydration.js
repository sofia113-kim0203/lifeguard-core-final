/**
 * Phase 28 Step 1C — Generate and persist panel-level Claude explanations for analysis jobs.
 */
import { loadUnifiedCustomerState } from "./unifiedCustomerState.js";
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

export function buildClaudeExplanationEntry({ explanation = null, meta = {}, policies = [] } = {}) {
  return {
    explanation,
    meta: attachPolicyMeta(meta, policies),
  };
}

async function generatePanelExplanation({
  panelKey,
  prompt,
  policies,
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
    });
  }

  if (!anthropicApiKey) {
    return buildClaudeExplanationEntry({
      explanation: null,
      meta: { skipped: true, reason: "ANTHROPIC_NOT_CONFIGURED", panel: panelKey },
      policies,
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

  if (underwritingResult) {
    const prompt = buildUnderwritingExplanationPrompt(
      structuredMemory,
      coverageGapResult,
      underwritingResult,
      policies,
    );
    explanations.underwriting = await generatePanelExplanation({
      panelKey: "underwriting",
      prompt,
      policies,
      anthropicApiKey,
      modelName,
      fetchImpl,
    });
  }

  if (recommendationResult) {
    const prompt = buildRecommendationExplanationPrompt(
      structuredMemory,
      recommendationResult,
      coverageGapResult,
      underwritingResult,
      policies,
    );
    explanations.recommendation = await generatePanelExplanation({
      panelKey: "recommendation",
      prompt,
      policies,
      anthropicApiKey,
      modelName,
      fetchImpl,
    });
  }

  if (designBundle) {
    const prompt = buildInsuranceDesignExplanationPrompt(
      structuredMemory,
      designBundle,
      {
        coverageGapResult,
        underwritingResult,
        recommendationResult,
      },
      policies,
    );
    explanations.insurance_design = await generatePanelExplanation({
      panelKey: "insurance_design",
      prompt,
      policies,
      anthropicApiKey,
      modelName,
      fetchImpl,
      maxTokens: 1600,
    });
  }

  return {
    explanations,
    policy_count: policies.length,
    policy_ids: policies.map((policy) => String(policy.id)),
    duration_ms: Date.now() - startedAt,
  };
}
