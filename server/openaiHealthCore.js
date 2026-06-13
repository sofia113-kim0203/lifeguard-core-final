/**
 * OpenAI Embeddings connectivity smoke test — direct API only.
 * No customer data, Supabase, or business logic.
 */
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  resolveOpenAiApiKey,
} from "./documentRagContext.js";

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const SMOKE_INPUT = "OPENAI_OK";
const PREVIEW_LIMIT = 300;

function previewText(value, limit = PREVIEW_LIMIT) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

export async function handleOpenAiHealthCheck({ fetchImpl = fetch, env = process.env } = {}) {
  const apiKey = resolveOpenAiApiKey(env);
  if (!apiKey) {
    return {
      ok: false,
      status: 503,
      reason: "OPENAI_API_KEY_MISSING",
      error_type: "configuration_error",
      error_body_preview: "OPENAI_API_KEY is not configured on the server.",
    };
  }

  const model = EMBEDDING_MODEL;
  const startedAt = Date.now();

  let response;
  try {
    response = await fetchImpl(OPENAI_EMBEDDINGS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: SMOKE_INPUT,
        dimensions: EMBEDDING_DIMENSIONS,
      }),
    });
  } catch (error) {
    return {
      ok: false,
      status: 502,
      reason: "OPENAI_NETWORK_ERROR",
      error_type: "network_error",
      error_body_preview: previewText(error instanceof Error ? error.message : "network_request_failed"),
      latency_ms: Date.now() - startedAt,
      model,
    };
  }

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
      reason: "OPENAI_API_ERROR",
      error_type: body?.error?.type ?? body?.error?.code ?? "api_error",
      error_body_preview: previewText(body?.error?.message ?? rawBody),
      latency_ms: Date.now() - startedAt,
      model,
    };
  }

  const vector = body?.data?.[0]?.embedding;
  const dimensions = Array.isArray(vector) ? vector.length : 0;
  if (!Array.isArray(vector) || dimensions !== EMBEDDING_DIMENSIONS) {
    return {
      ok: false,
      status: 502,
      reason: "OPENAI_INVALID_EMBEDDING",
      error_type: "invalid_response",
      error_body_preview: previewText(
        dimensions
          ? `expected ${EMBEDDING_DIMENSIONS} dimensions, got ${dimensions}`
          : rawBody,
      ),
      latency_ms: Date.now() - startedAt,
      model: body?.model ?? model,
    };
  }

  return {
    ok: true,
    status: 200,
    source: "openai",
    model: body?.model ?? model,
    embedding_dimensions: dimensions,
    latency_ms: Date.now() - startedAt,
  };
}
