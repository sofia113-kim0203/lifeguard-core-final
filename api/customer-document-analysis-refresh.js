/**
 * POST /api/customer-document-analysis-refresh
 * Runs analysis pipeline after document policy extraction.
 */

import { readJsonBody } from "../server/claudeGroundedExecutionCore.js";
import { handleDocumentPolicyAnalysisRefreshRequest } from "../server/documentPolicyAnalysisRefresh.js";
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

  try {
    const result = await handleDocumentPolicyAnalysisRefreshRequest({
      authHeader,
      documentId: body.document_id ?? body.documentId ?? null,
    });

    res.statusCode = result.ok ? 200 : 422;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(result));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: false,
        reason: "analysis_refresh_failed",
        error_message: error instanceof Error ? error.message : "analysis_refresh_failed",
      }),
    );
  }
}
