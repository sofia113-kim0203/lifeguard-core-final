/**
 * GET /api/openai-health
 * Direct OpenAI Embeddings API smoke test (no business logic).
 */

import { handleOpenAiHealthCheck } from "../server/openaiHealthCore.js";

/** @param {import('http').IncomingMessage} req @param {import('http').ServerResponse} res */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    res.end();
    return;
  }

  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, reason: "METHOD_NOT_ALLOWED" }));
    return;
  }

  try {
    const result = await handleOpenAiHealthCheck();
    res.statusCode = result.status ?? (result.ok ? 200 : 500);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(result));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: false,
        status: 500,
        reason: "SERVER_ERROR",
        error_type: "server_error",
        error_body_preview:
          error instanceof Error ? String(error.message).slice(0, 300) : "openai_health_failed",
      }),
    );
  }
}
