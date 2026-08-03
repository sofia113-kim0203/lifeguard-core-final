/**
 * Phase 25 Step 1J — POST /api/policy-terms-qa
 * Customer policy terms Q&A: ready gate → policy RAG → Claude answer.
 */

import {
  handlePolicyTermsQaRequest,
  parsePolicyTermsQaBody,
} from "../server/policyTermsQaCore.js";
import { readJsonBody } from "../server/claudeGroundedExecutionCore.js";
import {
  createUserSupabaseClient,
  readCustomerAuthHeader,
  requireAdminAuth,
} from "../server/agent/requireAdminAuth.js";

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
  const auth = await requireAdminAuth(createUserSupabaseClient(authHeader));
  if (!auth.ok) {
    res.statusCode = auth.reason === "UNAUTHORIZED" ? 401 : 403;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, reason: auth.reason }));
    return;
  }

  try {
    const body = req.body && typeof req.body === "object" ? req.body : await readJsonBody(req);
    const parsed = parsePolicyTermsQaBody(body);
    if (!parsed) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, reason: "INVALID_BODY" }));
      return;
    }

    const result = await handlePolicyTermsQaRequest({
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
        error_message: error instanceof Error ? error.message : "Policy terms Q&A failed.",
      }),
    );
  }
}
