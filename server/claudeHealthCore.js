/**
 * Claude connectivity smoke test — direct Anthropic Messages API only.
 * No Supabase, customer, document, or insurance logic.
 */
import { resolveAnthropicApiKey } from "./claudeGroundedExecutionCore.js";
import { resolveClaudeModel } from "./policyTermsQaCore.js";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const SMOKE_PROMPT = "Reply with exactly: CLAUDE_OK";
const MAX_TOKENS = 16;
const PREVIEW_LIMIT = 300;

function previewText(value, limit = PREVIEW_LIMIT) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function extractResponseText(body) {
  if (!Array.isArray(body?.content)) return "";
  return body.content
    .filter((block) => block?.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

export async function handleClaudeHealthCheck({ fetchImpl = fetch, env = process.env } = {}) {
  const apiKey = resolveAnthropicApiKey(env);
  if (!apiKey) {
    return {
      ok: false,
      status: 503,
      reason: "ANTHROPIC_API_KEY_MISSING",
      error_type: "configuration_error",
      error_body_preview: "ANTHROPIC_API_KEY is not configured on the server.",
    };
  }

  const model = resolveClaudeModel(env);
  const startedAt = Date.now();

  let response;
  try {
    response = await fetchImpl(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        messages: [{ role: "user", content: SMOKE_PROMPT }],
      }),
    });
  } catch (error) {
    return {
      ok: false,
      status: 502,
      reason: "ANTHROPIC_NETWORK_ERROR",
      error_type: "network_error",
      error_body_preview: previewText(error instanceof Error ? error.message : "network_request_failed"),
      latency_ms: Date.now() - startedAt,
      model,
    };
  }

  const requestId =
    response.headers.get("request-id") ?? response.headers.get("x-request-id") ?? null;
  const rawBody = await response.text();
  let body = {};
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    body = { raw_preview: previewText(rawBody) };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      reason: "ANTHROPIC_API_ERROR",
      error_type: body?.error?.type ?? "api_error",
      error_body_preview: previewText(body?.error?.message ?? rawBody),
      request_id: requestId,
      latency_ms: Date.now() - startedAt,
      model,
    };
  }

  const responseText = extractResponseText(body);
  if (!responseText) {
    return {
      ok: false,
      status: 502,
      reason: "ANTHROPIC_EMPTY_RESPONSE",
      error_type: "empty_response",
      error_body_preview: previewText(rawBody),
      request_id: requestId,
      latency_ms: Date.now() - startedAt,
      model: body?.model ?? model,
    };
  }

  return {
    ok: true,
    status: 200,
    source: "claude",
    model: body?.model ?? model,
    response_id: body?.id ?? null,
    request_id: requestId,
    response_text_preview: previewText(responseText),
    stop_reason: body?.stop_reason ?? null,
    latency_ms: Date.now() - startedAt,
  };
}
