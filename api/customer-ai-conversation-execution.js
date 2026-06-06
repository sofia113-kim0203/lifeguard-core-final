/**
 * Phase 14-9 — POST /api/customer-ai-conversation-execution (server-side AI conversation).
 * Modes: prepare, execute, store
 * Env: ANTHROPIC_API_KEY, SUPABASE_URL/VITE_SUPABASE_URL, SUPABASE_ANON_KEY/VITE_SUPABASE_ANON_KEY
 */

import {
  handleExecuteCustomerAiConversation,
  handlePrepareCustomerAiConversation,
  handleStoreCustomerAiResponse,
  parseCustomerAiConversationExecutionBody,
  readJsonBody,
} from "../server/customerAiConversationExecutionCore.js";

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

  try {
    const body = req.body && typeof body === "object" ? req.body : await readJsonBody(req);
    const parsed = parseCustomerAiConversationExecutionBody(body);
    if (!parsed) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, reason: "INVALID_BODY" }));
      return;
    }

    const authHeader = req.headers?.authorization ?? req.headers?.Authorization ?? null;
    let result;

    if (parsed.mode === "prepare") {
      result = await handlePrepareCustomerAiConversation({
        customerId: parsed.customerId,
        conversationId: parsed.conversationId,
        query: parsed.query,
        policyPdfId: parsed.policyPdfId,
        carrierId: parsed.carrierId,
        productId: parsed.productId,
        authHeader,
      });
    } else if (parsed.mode === "execute") {
      result = await handleExecuteCustomerAiConversation({
        aiConversationRunId: parsed.aiConversationRunId,
        authHeader,
      });
    } else {
      result = await handleStoreCustomerAiResponse({
        aiConversationRunId: parsed.aiConversationRunId,
        responseText: parsed.responseText,
        responseSourceCount: parsed.responseSourceCount,
        authHeader,
      });
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(result));
  } catch {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: false,
        reason: "SERVER_ERROR",
        error_message: "Customer AI conversation execution failed on the server.",
      }),
    );
  }
}
