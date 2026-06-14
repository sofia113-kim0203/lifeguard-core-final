/**
 * POST /api/customer-analysis-all
 * One-shot analysis: computes coverage gap + underwriting risk + recommendation +
 * insurance design in a single LLM-free server pass and returns them together, so the
 * recommendation screen renders immediately without creating an analysis_job or polling
 * stage-by-stage. Claude explanations are hydrated separately/lazily by the client.
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
    // Body is currently unused (auth identifies the customer) but read it for parity/robustness.
    if (!(req.body && typeof req.body === "object")) {
      await readJsonBody(req);
    }
    const { handleAllAnalysisPanelsRequest } = await import(
      "../server/customerInsuranceDesignCore.js"
    );
    const authHeader = req.headers?.authorization ?? req.headers?.Authorization ?? null;

    const result = await handleAllAnalysisPanelsRequest({ authHeader });

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
        error_message: error instanceof Error ? error.message : "Customer analysis (all) failed.",
      }),
    );
  }
}
