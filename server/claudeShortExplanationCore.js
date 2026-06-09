/**
 * Phase 26 Step 2B — Short Claude explanation with cache + performance logging.
 */
import { resolveAnthropicApiKey } from "./claudeGroundedExecutionCore.js";
import { resolveClaudeModel } from "./policyTermsQaCore.js";
import {
  auditExplanationContext,
  buildShortExplanationPrompt,
  measureOutput,
  measurePrompt,
} from "./claudePerformanceAudit.js";
import {
  buildClaudeResultCacheKey,
  loadClaudeResultCache,
  logClaudePerformance,
  saveClaudeResultCache,
} from "./claudeResultCacheStore.js";

const SHORT_MAX_TOKENS = 500;
const SHORT_MAX_CHARS = 800;

async function callAnthropicShort({
  apiKey,
  modelName,
  system,
  user,
  fetchImpl = fetch,
  maxTokens = SHORT_MAX_TOKENS,
}) {
  const started = Date.now();
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

  const claudeTimeMs = Date.now() - started;

  if (!response.ok) {
    return {
      ok: false,
      reason: "CLAUDE_API_ERROR",
      errorMessage: `Claude API error (${response.status})`,
      claude_time_ms: claudeTimeMs,
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

  if (!text) {
    return {
      ok: false,
      reason: "CLAUDE_EMPTY_RESPONSE",
      errorMessage: "Claude returned empty response.",
      claude_time_ms: claudeTimeMs,
    };
  }

  return {
    ok: true,
    answer: text.slice(0, SHORT_MAX_CHARS),
    model: modelName,
    provider: "anthropic",
    claude_time_ms: claudeTimeMs,
    usage: data?.usage ?? null,
  };
}

function buildFallbackShortExplanation(question, workingContext) {
  const audit = auditExplanationContext(workingContext, question);
  const summary = audit;
  const gaps = workingContext.coverageGapResult?.top_gaps?.slice(0, 3).map((i) => i.coverage_label).join(", ");
  const top2 = workingContext.recommendationResult?.customer_visible_top2?.map((i) => i.coverage_label).join(", ");
  const design = workingContext.designBundle?.customer_visible_design?.design_title;
  const medication = workingContext.snapshot?.facts?.find((f) => /medication/.test(f.fact_key))?.fact_value;

  return [
    `질문("${question}")에 대해 Memory와 분석 결과를 연결해 안내드립니다.`,
    gaps ? `보장 공백 우선 항목은 ${gaps}입니다.` : null,
    medication ? `건강 Memory에 ${medication} 정보가 반영되었습니다.` : null,
    top2 ? `우선 검토 추천은 ${top2}입니다.` : null,
    design ? `보험설계안은 "${design}" 기준으로 정리되었습니다.` : null,
    "자세한 항목별 설명은 AI 보험 추천 화면에서 확인하실 수 있습니다.",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, SHORT_MAX_CHARS);
}

export async function generateShortConnectedExplanation({
  supabase,
  customerId,
  question,
  workingContext,
  memoryVersion,
  analysisJobId = null,
  fetchImpl = fetch,
  env = process.env,
} = {}) {
  const audit = auditExplanationContext(workingContext, question);
  const cacheKeyParts = buildClaudeResultCacheKey({
    customerId,
    memoryVersion,
    question,
    workingContext,
  });

  const cached = await loadClaudeResultCache(supabase, cacheKeyParts).catch(() => null);
  if (cached?.explanation_text) {
    await logClaudePerformance(supabase, {
      customer_id: customerId,
      endpoint: "result_claude_short",
      prompt_chars: cached.prompt_chars ?? 0,
      estimated_input_tokens: cached.estimated_input_tokens ?? 0,
      output_chars: cached.output_chars ?? cached.explanation_text.length,
      estimated_output_tokens: cached.estimated_output_tokens ?? 0,
      claude_time_ms: 0,
      cache_hit: true,
      model_name: cached.model_name,
      analysis_job_id: analysisJobId,
      metadata_json: { cache_key: cacheKeyParts.cache_key },
    });

    return {
      text: cached.explanation_text,
      cache_hit: true,
      explanation_mode: cached.explanation_mode ?? "short",
      performance: {
        prompt_chars: cached.prompt_chars ?? 0,
        estimated_input_tokens: cached.estimated_input_tokens ?? 0,
        output_chars: cached.output_chars ?? cached.explanation_text.length,
        estimated_output_tokens: cached.estimated_output_tokens ?? 0,
        claude_time_ms: 0,
        cache_hit: true,
      },
      audit,
      detailed_available: true,
    };
  }

  const prompt = buildShortExplanationPrompt(question, workingContext);
  const promptMetrics = measurePrompt(prompt);
  const anthropicApiKey = resolveAnthropicApiKey(env);
  const modelName = resolveClaudeModel(env);

  if (!anthropicApiKey) {
    const fallback = buildFallbackShortExplanation(question, workingContext);
    const outputMetrics = measureOutput(fallback);
    await saveClaudeResultCache(supabase, cacheKeyParts, {
      question,
      explanation_text: fallback,
      explanation_mode: "fallback",
      prompt_chars: promptMetrics.prompt_chars,
      estimated_input_tokens: promptMetrics.estimated_input_tokens,
      output_chars: outputMetrics.output_chars,
      estimated_output_tokens: outputMetrics.estimated_output_tokens,
      claude_time_ms: 0,
      model_name: null,
    }).catch(() => null);
    return {
      text: fallback,
      cache_hit: false,
      skipped: true,
      reason: "ANTHROPIC_NOT_CONFIGURED",
      explanation_mode: "fallback",
      performance: {
        ...promptMetrics,
        ...outputMetrics,
        claude_time_ms: 0,
        cache_hit: false,
      },
      audit,
      detailed_available: false,
    };
  }

  const claudeResult = await callAnthropicShort({
    apiKey: anthropicApiKey,
    modelName,
    system: prompt.system,
    user: prompt.user,
    fetchImpl,
  });

  if (!claudeResult.ok) {
    const fallback = buildFallbackShortExplanation(question, workingContext);
    const outputMetrics = measureOutput(fallback);
    await logClaudePerformance(supabase, {
      customer_id: customerId,
      endpoint: "result_claude_short",
      prompt_chars: promptMetrics.prompt_chars,
      estimated_input_tokens: promptMetrics.estimated_input_tokens,
      output_chars: outputMetrics.output_chars,
      estimated_output_tokens: outputMetrics.estimated_output_tokens,
      claude_time_ms: claudeResult.claude_time_ms ?? 0,
      cache_hit: false,
      model_name: modelName,
      analysis_job_id: analysisJobId,
      metadata_json: { error: claudeResult.reason },
    });

    return {
      text: fallback,
      cache_hit: false,
      skipped: true,
      reason: claudeResult.reason,
      explanation_mode: "fallback",
      performance: {
        ...promptMetrics,
        ...outputMetrics,
        claude_time_ms: claudeResult.claude_time_ms ?? 0,
        cache_hit: false,
      },
      audit,
      detailed_available: false,
    };
  }

  const outputMetrics = measureOutput(claudeResult.answer);
  await saveClaudeResultCache(supabase, cacheKeyParts, {
    question,
    explanation_text: claudeResult.answer,
    explanation_mode: "short",
    prompt_chars: promptMetrics.prompt_chars,
    estimated_input_tokens: promptMetrics.estimated_input_tokens,
    output_chars: outputMetrics.output_chars,
    estimated_output_tokens: outputMetrics.estimated_output_tokens,
    claude_time_ms: claudeResult.claude_time_ms,
    model_name: claudeResult.model,
  });

  await logClaudePerformance(supabase, {
    customer_id: customerId,
    endpoint: "result_claude_short",
    prompt_chars: promptMetrics.prompt_chars,
    estimated_input_tokens: promptMetrics.estimated_input_tokens,
    output_chars: outputMetrics.output_chars,
    estimated_output_tokens: outputMetrics.estimated_output_tokens,
    claude_time_ms: claudeResult.claude_time_ms,
    cache_hit: false,
    model_name: claudeResult.model,
    analysis_job_id: analysisJobId,
    metadata_json: {
      cache_key: cacheKeyParts.cache_key,
      usage: claudeResult.usage,
    },
  });

  return {
    text: claudeResult.answer,
    cache_hit: false,
    explanation_mode: "short",
    model_name: claudeResult.model,
    provider: claudeResult.provider,
    performance: {
      ...promptMetrics,
      ...outputMetrics,
      claude_time_ms: claudeResult.claude_time_ms,
      cache_hit: false,
    },
    audit,
    detailed_available: true,
  };
}
