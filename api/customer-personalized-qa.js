/**
 * Phase 26 Step 1A — POST /api/customer-personalized-qa
 * Customer Memory + Policy RAG + Claude personalized answer.
 */

import { readJsonBody } from "../server/claudeGroundedExecutionCore.js";

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
    const body = req.body && typeof req.body === "object" ? req.body : await readJsonBody(req);
    const { handleCustomerPersonalizedQaRequest, parseCustomerPersonalizedQaBody } =
      await import("../server/customerPersonalizedQaCore.js");
    const parsed = parseCustomerPersonalizedQaBody(body);
    if (!parsed) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, reason: "INVALID_BODY" }));
      return;
    }

    const authHeader = req.headers?.authorization ?? req.headers?.Authorization ?? null;
    const result = await handleCustomerPersonalizedQaRequest({
      question: parsed.question,
      mode: parsed.mode,
      knowledgeDocumentId: parsed.knowledgeDocumentId,
      policyPdfId: parsed.policyPdfId,
      authHeader,
    });

    const statusCode = result.ok
      ? 200
      : result.reason === "UNAUTHORIZED"
        ? 401
        : result.reason === "CUSTOMER_PROFILE_NOT_FOUND"
          ? 403
          : 500;

    res.statusCode = statusCode;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(result));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: false,
        reason: "SERVER_ERROR",
        error_message: error instanceof Error ? error.message : "Customer personalized Q&A failed.",
      }),
    );
  }
}
