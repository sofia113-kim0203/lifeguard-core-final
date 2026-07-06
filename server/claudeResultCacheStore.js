/**
 * Phase 26 Step 2B — Claude final explanation result cache.
 */
import { createHash } from "node:crypto";

function sha256(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

export function normalizeQuestionForHash(question) {
  return String(question ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function buildAnalysisFingerprint(workingContext) {
  const summary = {
    memory_version: workingContext?.snapshot?.memory_version ?? workingContext?.structuredMemory?.memory_version,
    gap_score: workingContext?.coverageGapResult?.gap_score,
    gap_top: (workingContext?.coverageGapResult?.top_gaps ?? []).slice(0, 3).map((i) => i.coverage_category),
    uw_risk: workingContext?.underwritingResult?.overall_underwriting_risk,
    uw_score: workingContext?.underwritingResult?.risk_score,
    rec_top2: (workingContext?.recommendationResult?.customer_visible_top2 ?? []).map((i) => i.coverage_category),
    design_id: workingContext?.designBundle?.insurance_design?.design_id ?? null,
    design_plan_steps: (workingContext?.designBundle?.customer_visible_design?.plan_step_codes ?? []).slice(
      0,
      3,
    ),
  };
  return sha256(JSON.stringify(summary));
}

export function buildClaudeResultCacheKey({ customerId, memoryVersion, question, workingContext }) {
  const questionHash = sha256(normalizeQuestionForHash(question));
  const analysisFingerprint = buildAnalysisFingerprint(workingContext);
  return {
    customer_id: customerId,
    memory_version: memoryVersion,
    question_hash: questionHash,
    analysis_cache_version: analysisFingerprint,
    cache_key: `${customerId}:${memoryVersion}:${questionHash}:${analysisFingerprint}`,
  };
}

export async function loadClaudeResultCache(supabase, cacheKeyParts) {
  const { data, error } = await supabase
    .from("claude_result_cache")
    .select("*")
    .eq("customer_id", cacheKeyParts.customer_id)
    .eq("memory_version", cacheKeyParts.memory_version)
    .eq("question_hash", cacheKeyParts.question_hash)
    .eq("analysis_cache_version", cacheKeyParts.analysis_cache_version)
    .maybeSingle();

  if (error) {
    throw new Error(`claude_result_cache_load_failed: ${error.message}`);
  }
  return data;
}

export async function saveClaudeResultCache(supabase, cacheKeyParts, payload) {
  const row = {
    customer_id: cacheKeyParts.customer_id,
    memory_version: cacheKeyParts.memory_version,
    question_hash: cacheKeyParts.question_hash,
    analysis_cache_version: cacheKeyParts.analysis_cache_version,
    question_text: payload.question,
    explanation_text: payload.explanation_text,
    explanation_mode: payload.explanation_mode ?? "short",
    prompt_chars: payload.prompt_chars ?? 0,
    estimated_input_tokens: payload.estimated_input_tokens ?? 0,
    output_chars: payload.output_chars ?? 0,
    estimated_output_tokens: payload.estimated_output_tokens ?? 0,
    claude_time_ms: payload.claude_time_ms ?? 0,
    model_name: payload.model_name ?? null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("claude_result_cache").upsert(row, {
    onConflict: "customer_id,memory_version,question_hash,analysis_cache_version",
  });

  if (error) {
    throw new Error(`claude_result_cache_save_failed: ${error.message}`);
  }
  return row;
}

export async function logClaudePerformance(supabase, entry) {
  const { error } = await supabase.from("claude_performance_logs").insert({
    customer_id: entry.customer_id ?? null,
    endpoint: entry.endpoint,
    prompt_chars: entry.prompt_chars ?? 0,
    estimated_input_tokens: entry.estimated_input_tokens ?? 0,
    output_chars: entry.output_chars ?? 0,
    estimated_output_tokens: entry.estimated_output_tokens ?? 0,
    claude_time_ms: entry.claude_time_ms ?? 0,
    cache_hit: entry.cache_hit ?? false,
    model_name: entry.model_name ?? null,
    analysis_job_id: entry.analysis_job_id ?? null,
    metadata_json: entry.metadata_json ?? {},
  });

  if (error) {
    // Logging must not break the main flow.
    console.error("claude_performance_log_failed", error.message);
  }
}
