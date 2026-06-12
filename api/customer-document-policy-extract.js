/**
 * POST /api/customer-document-policy-extract
 * Runs OCR chunk → policy extraction → profile_insurance_policies + memory builder.
 */

import { readJsonBody } from "../server/claudeGroundedExecutionCore.js";
import { runDocumentPolicyExtraction } from "../server/documentPolicyExtractionPipeline.js";
import {
  createUserSupabaseClient,
  readCustomerAuthHeader,
  requireCustomerAuth,
} from "../server/requireCustomerAuth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, reason: "METHOD_NOT_ALLOWED" }));
    return;
  }

  const authHeader = readCustomerAuthHeader(req);
  const supabase = createUserSupabaseClient(authHeader);
  const auth = await requireCustomerAuth(supabase);
  if (!auth.ok) {
    res.statusCode = auth.reason === "UNAUTHORIZED" ? 401 : 403;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, reason: auth.reason, error_message: auth.error_message }));
    return;
  }

  let body = {};
  try {
    body = await readJsonBody(req);
  } catch {
    body = {};
  }

  const documentId = String(body.document_id ?? "").trim();

  if (!auth.customerId) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "customer_auth_missing_customer_id" }));
    return;
  }

  if (!documentId) {
    res.statusCode = 422;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "document_id_required" }));
    return;
  }

  try {
    const result = await runDocumentPolicyExtraction({
      customerId: auth.customerId,
      documentId,
      env: process.env,
      invokeMemory: body.invoke_memory !== false,
    });

    res.statusCode = result.ok ? 200 : 422;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: result.ok,
        customer_id: auth.customerId,
        document_id: documentId,
        ...result,
      }),
    );
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: false,
        reason: "policy_extraction_failed",
        error_message: error instanceof Error ? error.message : "policy_extraction_failed",
      }),
    );
  }
}
