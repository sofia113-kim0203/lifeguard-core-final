/**
 * POST /api/agent-key-chat
 * Agent free KEY — general insurance or gated assigned-customer turns.
 * JSON (default) or SSE when body.stream / Accept: text/event-stream.
 */
import { readJsonBody } from "../server/claudeGroundedExecutionCore.js";
import {
  createUserSupabaseClient,
  readCustomerAuthHeader,
  requireAgentAuth,
} from "../server/agent/requireAgentAuth.js";
import { runAgentFreeKeyTurn } from "../server/agent/agentFreeKeyCore.js";
import {
  initHomeBrainFactSseResponse,
  writeHomeBrainFactSseError,
  writeHomeBrainFactSseEvent,
} from "../server/homeBrainFactStream.js";

function wantsAgentKeyChatStream(req, body) {
  if (body?.stream === true) return true;
  const accept = String(req.headers?.accept ?? "").toLowerCase();
  return accept.includes("text/event-stream");
}

function agentDonePayload(result) {
  return {
    ok: result.ok === true,
    reason: result.reason ?? null,
    error_message: result.error_message ?? null,
    text: result.ok ? result.text : null,
    answerText: result.ok ? result.text : null,
    mode: result.mode ?? null,
    customer_context_used: result.customer_context_used === true,
    access_reason: result.access_reason ?? null,
  };
}

/** @param {import('http').IncomingMessage} req @param {import('http').ServerResponse} res */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

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

  const authHeader = readCustomerAuthHeader(req);
  const userSupabase = createUserSupabaseClient(authHeader);
  const auth = await requireAgentAuth(userSupabase);
  if (!auth.ok) {
    const status = auth.reason === "UNAUTHORIZED" ? 401 : 403;
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: false,
        reason: auth.reason,
        error_message: auth.error_message,
      }),
    );
    return;
  }

  let body = {};
  try {
    body = await readJsonBody(req);
  } catch {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, reason: "INVALID_JSON" }));
    return;
  }

  if (
    Object.prototype.hasOwnProperty.call(body, "customer_id") ||
    Object.prototype.hasOwnProperty.call(body, "agent_user_id")
  ) {
    res.statusCode = 422;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: false,
        reason: "CLIENT_IDENTITY_FORBIDDEN",
        error_message: "customer_id and agent_user_id must not be supplied by client.",
      }),
    );
    return;
  }

  const stream = wantsAgentKeyChatStream(req, body);

  if (stream) {
    initHomeBrainFactSseResponse(res);
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
      onReplace() {
        // KEY monopoly — post-KEY replace forbidden on agent stream
      },
    };

    try {
      const result = await runAgentFreeKeyTurn({
        userSupabase,
        agentUserId: auth.agentUserId,
        question: body.question,
        history: body.history,
        assignmentId: body.assignment_id ?? null,
        streamHandlers,
      });

      if (!result.ok) {
        writeHomeBrainFactSseError(res, {
          ok: false,
          reason: result.reason ?? "KEY_TURN_FAILED",
          error_message: result.error_message ?? null,
        });
        return;
      }

      writeHomeBrainFactSseEvent(res, "done", agentDonePayload(result));
      res.end();
      return;
    } catch (error) {
      writeHomeBrainFactSseError(res, {
        ok: false,
        reason: "KEY_TURN_FAILED",
        error_message: error?.message ?? "KEY turn failed.",
      });
      return;
    }
  }

  const result = await runAgentFreeKeyTurn({
    userSupabase,
    agentUserId: auth.agentUserId,
    question: body.question,
    history: body.history,
    assignmentId: body.assignment_id ?? null,
  });

  res.statusCode = result.status ?? (result.ok ? 200 : 500);
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(agentDonePayload(result)));
}
