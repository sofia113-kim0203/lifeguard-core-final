/**
 * P3 — POST /api/customer-home-brain-fact
 * JWT/RLS read-only home Tom brain. Gap Tom + casual chat may call Claude; no writes.
 */

import { readJsonBody } from "../server/claudeGroundedExecutionCore.js";
import {
  createUserSupabaseClient,
  readCustomerAuthHeader,
  requireCustomerAuth,
} from "../server/requireCustomerAuth.js";
import { handleHomeBrainFactRequest } from "../server/homeBrainFactCore.js";
import {
  initHomeBrainFactSseResponse,
  writeHomeBrainFactSseError,
  writeHomeBrainFactSseEvent,
} from "../server/homeBrainFactStream.js";

function wantsStream(body, req) {
  if (body?.stream === true) return true;
  const accept = String(req.headers?.accept ?? "");
  return accept.includes("text/event-stream");
}

/** @param {import('http').IncomingMessage} req @param {import('http').ServerResponse} res */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept");

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, reason: "METHOD_NOT_ALLOWED" }));
    return;
  }

  try {
    const body = req.body && typeof req.body === "object" ? req.body : await readJsonBody(req);
    const question = String(body?.question ?? "").trim();
    const history = Array.isArray(body?.history) ? body.history : [];
    const stream = wantsStream(body, req);

    const authHeader = readCustomerAuthHeader(req);
    const userSupabase = createUserSupabaseClient(authHeader);
    const resolved = await requireCustomerAuth(userSupabase);

    if (!resolved.ok && resolved.reason === "SUPABASE_NOT_CONFIGURED") {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(resolved));
      return;
    }
    if (!resolved.ok) {
      res.statusCode = resolved.reason === "UNAUTHORIZED" ? 401 : 403;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(resolved));
      return;
    }

    if (stream) {
      initHomeBrainFactSseResponse(res);
      const requestStartedAt = Date.now();
      const streamHandlers = {
        _emitted: false,
        onKeyWaitAck(text) {
          writeHomeBrainFactSseEvent(res, "ack", { text: String(text ?? "") });
        },
        onDelta(text) {
          streamHandlers._emitted = true;
          writeHomeBrainFactSseEvent(res, "delta", { text: String(text ?? "") });
        },
        onFirstToken(ttftMs) {
          writeHomeBrainFactSseEvent(res, "ttft", { ttft_ms: ttftMs });
        },
        onReplace(text) {
          writeHomeBrainFactSseEvent(res, "replace", { text: String(text ?? "") });
        },
      };

      const result = await handleHomeBrainFactRequest({
        userSupabase,
        customerId: resolved.customerId,
        question,
        history,
        streamHandlers,
        requestStartedAt,
      });

      if (!result.ok) {
        writeHomeBrainFactSseError(res, result);
        return;
      }

      writeHomeBrainFactSseEvent(res, "done", result);
      res.end();
      return;
    }

    const result = await handleHomeBrainFactRequest({
      userSupabase,
      customerId: resolved.customerId,
      question,
      history,
    });

    if (!result.ok) {
      res.statusCode = result.reason === "INVALID_BODY" ? 400 : 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(result));
      return;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(result));
  } catch (error) {
    if (res.getHeader("Content-Type") === "text/event-stream; charset=utf-8") {
      writeHomeBrainFactSseError(res, {
        ok: false,
        reason: "SERVER_ERROR",
        error_message: error instanceof Error ? error.message : "Home brain fact lookup failed.",
      });
      return;
    }
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: false,
        reason: "SERVER_ERROR",
        error_message: error instanceof Error ? error.message : "Home brain fact lookup failed.",
      }),
    );
  }
}
