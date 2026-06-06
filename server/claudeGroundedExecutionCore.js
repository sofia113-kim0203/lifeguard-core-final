/**
 * Phase 12-3 — server-side Claude grounded execution handler.
 * Env: ANTHROPIC_API_KEY, SUPABASE_URL/VITE_SUPABASE_URL, SUPABASE_ANON_KEY/VITE_SUPABASE_ANON_KEY
 */

import { createClient } from "@supabase/supabase-js";

export function resolveAnthropicApiKey(env = process.env) {
  return String(env.ANTHROPIC_API_KEY ?? env.CLAUDE_API_KEY ?? "").trim() || null;
}

export function resolveSupabaseConfig(env = process.env) {
  const url = String(env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? "").trim();
  const anonKey = String(env.SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY ?? "").trim();
  return { url, anonKey };
}

/**
 * @param {import('http').IncomingMessage} req
 */
export async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

function createSupabaseClient(authHeader, env = process.env) {
  const { url, anonKey } = resolveSupabaseConfig(env);
  if (!url || !anonKey) {
    return null;
  }

  const token = String(authHeader ?? "").replace(/^Bearer\s+/i, "").trim();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers },
  });
}

function buildGroundedPrompt(requestContext) {
  const query = String(requestContext?.query ?? "").trim();
  const sources = Array.isArray(requestContext?.sources) ? requestContext.sources : [];

  const sourceLines = sources.map((source, index) => {
    const ref = String(source?.source_reference ?? `source-${index + 1}`);
    const ctx = source?.source_context ?? {};
    return `[${ref}] ${JSON.stringify(ctx)}`;
  });

  const user = [
    "Answer using only the grounded sources below.",
    "Do not make underwriting approval/decline or product recommendation decisions.",
    "",
    `Query: ${query}`,
    "",
    "Sources:",
    ...(sourceLines.length ? sourceLines : ["(no sources)"]),
  ].join("\n");

  const system = [
    "You are a LIFEGUARD grounded knowledge assistant.",
    "Use only the provided sources.",
    "If context is insufficient, say what is missing.",
    "Do not output approval, decline, underwriting, or enrollment eligibility decisions.",
  ].join(" ");

  return { system, user, query };
}

function previewResponseContext(responseContext) {
  if (!responseContext || typeof responseContext !== "object") {
    return {};
  }

  const answer = String(responseContext.answer_preview ?? responseContext.answer ?? "");
  const preview = answer.length > 600 ? `${answer.slice(0, 600)}…` : answer;

  return {
    answer_preview: preview,
    response_reference: responseContext.response_reference ?? null,
    model_name: responseContext.model_name ?? null,
    provider: responseContext.provider ?? "anthropic",
    grounded: responseContext.grounded ?? true,
  };
}

async function storeExecutionResult(supabase, runId, { executionStatus, responseContext, errorMessage }) {
  const { data, error } = await supabase.rpc("lifeguard_store_claude_execution_result", {
    p_claude_execution_run_id: runId,
    p_response_context: responseContext ?? {},
    p_execution_status: executionStatus,
    p_error_message: errorMessage ?? null,
  });

  if (error) {
    throw new Error(error.message || "store_execution_result_failed");
  }

  return data;
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
      max_tokens: 1024,
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

  if (!text) {
    return { ok: false, reason: "CLAUDE_EMPTY_RESPONSE", errorMessage: "Claude returned an empty response." };
  }

  return { ok: true, answer: text, model: modelName, provider: "anthropic" };
}

/**
 * @param {{
 *   claudeExecutionRunId: string,
 *   authHeader?: string|null,
 *   apiKey?: string|null,
 *   env?: NodeJS.ProcessEnv,
 * }}
 */
export async function handleClaudeGroundedExecutionReadiness({
  claudeExecutionRunId,
  authHeader,
  apiKey = resolveAnthropicApiKey(),
  env = process.env,
}) {
  const missing = [];
  const warnings = [];

  if (!claudeExecutionRunId) {
    missing.push("execution_run_id_required");
    return {
      ok: true,
      mode: "readiness",
      ready: false,
      claude_execution_run_id: null,
      execution_status: null,
      missing_information: missing,
      warning_messages: warnings,
    };
  }

  if (!apiKey) {
    missing.push("claude_api_not_configured");
  }

  const supabase = createSupabaseClient(authHeader, env);
  if (!supabase) {
    missing.push("supabase_not_configured");
    return {
      ok: true,
      mode: "readiness",
      ready: false,
      claude_execution_run_id: claudeExecutionRunId,
      execution_status: null,
      missing_information: missing,
      warning_messages: warnings,
    };
  }

  const { data: runRow, error: runError } = await supabase
    .from("claude_execution_runs")
    .select("id, execution_status, model_name, request_context, source_count, claude_grounding_run_id")
    .eq("id", claudeExecutionRunId)
    .maybeSingle();

  if (runError) {
    missing.push("execution_run_load_failed");
    return {
      ok: true,
      mode: "readiness",
      ready: false,
      claude_execution_run_id: claudeExecutionRunId,
      execution_status: null,
      missing_information: missing,
      warning_messages: warnings,
      error_message: runError.message,
    };
  }

  if (!runRow) {
    missing.push("execution_run_not_found");
    return {
      ok: true,
      mode: "readiness",
      ready: false,
      claude_execution_run_id: claudeExecutionRunId,
      execution_status: null,
      missing_information: missing,
      warning_messages: warnings,
    };
  }

  const requestContext = runRow.request_context ?? {};
  if (!requestContext || typeof requestContext !== "object" || Object.keys(requestContext).length === 0) {
    missing.push("request_context_missing");
  }

  const query = String(requestContext?.query ?? "").trim();
  if (!query) {
    missing.push("query_missing");
  }

  if (!String(runRow.model_name ?? "").trim()) {
    missing.push("model_name_missing");
  }

  const sourceCount = Number(runRow.source_count ?? 0);
  if (sourceCount === 0) {
    warnings.push("no_grounding_sources");
  }

  if (!["ready", "pending"].includes(runRow.execution_status)) {
    missing.push("invalid_execution_status");
  }

  const ready = missing.length === 0;

  return {
    ok: true,
    mode: "readiness",
    ready,
    claude_execution_run_id: claudeExecutionRunId,
    execution_status: runRow.execution_status,
    source_count: sourceCount,
    missing_information: missing,
    warning_messages: warnings,
  };
}

/**
 * @param {{
 *   claudeExecutionRunId: string,
 *   authHeader?: string|null,
 *   apiKey?: string|null,
 *   fetchImpl?: typeof fetch,
 *   env?: NodeJS.ProcessEnv,
 * }}
 */
export async function handleClaudeGroundedExecutionRequest({
  claudeExecutionRunId,
  authHeader,
  apiKey = resolveAnthropicApiKey(),
  fetchImpl = fetch,
  env = process.env,
}) {
  if (!claudeExecutionRunId) {
    return { ok: false, reason: "EXECUTION_RUN_ID_REQUIRED", error_message: "claude_execution_run_id is required." };
  }

  const supabase = createSupabaseClient(authHeader, env);
  if (!supabase) {
    return { ok: false, reason: "SUPABASE_NOT_CONFIGURED", error_message: "Supabase server configuration is missing." };
  }

  const { data: runRow, error: runError } = await supabase
    .from("claude_execution_runs")
    .select("id, execution_status, model_name, request_context, source_count")
    .eq("id", claudeExecutionRunId)
    .maybeSingle();

  if (runError) {
    return { ok: false, reason: "RUN_LOAD_FAILED", error_message: runError.message };
  }

  if (!runRow) {
    return { ok: false, reason: "RUN_NOT_FOUND", error_message: "Claude execution run not found." };
  }

  if (!["ready", "pending"].includes(runRow.execution_status)) {
    return {
      ok: false,
      reason: "INVALID_EXECUTION_STATUS",
      execution_status: runRow.execution_status,
      error_message: `Execution status must be ready or pending (current: ${runRow.execution_status}).`,
    };
  }

  const modelName = String(runRow.model_name ?? "").trim();
  if (!modelName) {
    return { ok: false, reason: "MODEL_REQUIRED", error_message: "Model name is missing on execution run." };
  }

  try {
    await storeExecutionResult(supabase, claudeExecutionRunId, {
      executionStatus: "processing",
      responseContext: {
        processing_started_at: new Date().toISOString(),
        no_api_keys_stored: true,
      },
    });
  } catch (err) {
    return {
      ok: false,
      reason: "PROCESSING_UPDATE_FAILED",
      error_message: err instanceof Error ? err.message : "Failed to mark execution as processing.",
    };
  }

  if (!apiKey) {
    try {
      await storeExecutionResult(supabase, claudeExecutionRunId, {
        executionStatus: "failed",
        responseContext: {},
        errorMessage: "ANTHROPIC_API_KEY is not configured on the server.",
      });
    } catch {
      // ignore secondary store failure
    }
    return {
      ok: false,
      reason: "ANTHROPIC_NOT_CONFIGURED",
      execution_status: "failed",
      error_message: "Claude API key is not configured on the server.",
    };
  }

  const { system, user } = buildGroundedPrompt(runRow.request_context ?? {});

  const claudeResult = await callAnthropic({
    apiKey,
    modelName,
    system,
    user,
    fetchImpl,
  });

  if (!claudeResult.ok) {
    try {
      await storeExecutionResult(supabase, claudeExecutionRunId, {
        executionStatus: "failed",
        responseContext: {
          provider: "anthropic",
          model_name: modelName,
          grounded: true,
          failed_at: new Date().toISOString(),
        },
        errorMessage: claudeResult.errorMessage,
      });
    } catch {
      // ignore secondary store failure
    }

    return {
      ok: false,
      reason: claudeResult.reason,
      execution_status: "failed",
      error_message: claudeResult.errorMessage,
      response_preview: {},
    };
  }

  const responseContext = {
    answer_preview: claudeResult.answer,
    answer: claudeResult.answer,
    response_reference: `claude-exec-${claudeExecutionRunId}`,
    model_name: modelName,
    provider: claudeResult.provider,
    grounded: true,
    source_count: runRow.source_count ?? 0,
    no_underwriting_decision: true,
    no_recommendation_decision: true,
    completed_at: new Date().toISOString(),
  };

  let stored;
  try {
    stored = await storeExecutionResult(supabase, claudeExecutionRunId, {
      executionStatus: "completed",
      responseContext,
    });
  } catch (err) {
    return {
      ok: false,
      reason: "STORE_RESULT_FAILED",
      execution_status: "failed",
      error_message: err instanceof Error ? err.message : "Failed to store Claude execution result.",
      response_preview: previewResponseContext(responseContext),
    };
  }

  return {
    ok: true,
    claude_execution_run_id: claudeExecutionRunId,
    execution_status: stored?.execution_status ?? "completed",
    response_preview: previewResponseContext(stored?.response_context ?? responseContext),
    error_message: null,
  };
}

/**
 * @param {unknown} body
 */
export function parseClaudeGroundedExecutionBody(body) {
  if (!body || typeof body !== "object") return null;
  const runId = String(body.claude_execution_run_id ?? body.claudeExecutionRunId ?? "").trim();
  if (!runId) return null;
  const modeRaw = String(body.mode ?? "execute").trim().toLowerCase();
  const mode = modeRaw === "readiness" ? "readiness" : "execute";
  return { claudeExecutionRunId: runId, mode };
}
