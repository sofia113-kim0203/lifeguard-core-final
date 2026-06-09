/**
 * Phase 26 Step 2A — POST /api/customer-analysis-job
 * Poll analysis job status or process next background stage.
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
    const {
      handleAnalysisJobStatusRequest,
      handleLatestAnalysisJobRequest,
      parseAnalysisJobBody,
    } = await import("../server/conversationalBackgroundAnalysisCore.js");

    const authHeader = req.headers?.authorization ?? req.headers?.Authorization ?? null;
    const mode = String(body?.mode ?? "status").trim().toLowerCase();

    if (mode === "latest") {
      const result = await handleLatestAnalysisJobRequest({ authHeader });
      const statusCode = result.ok ? 200 : result.reason === "UNAUTHORIZED" ? 401 : 500;
      res.statusCode = statusCode;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(result));
      return;
    }

    const parsed = parseAnalysisJobBody(body);
    if (!parsed) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, reason: "INVALID_BODY" }));
      return;
    }

    const result = await handleAnalysisJobStatusRequest({
      jobId: parsed.jobId,
      action: parsed.action,
      authHeader,
    });

    const statusCode = result.ok
      ? 200
      : result.reason === "UNAUTHORIZED"
        ? 401
        : result.reason === "FORBIDDEN" || result.reason === "JOB_NOT_FOUND"
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
        error_message: error instanceof Error ? error.message : "Analysis job request failed.",
      }),
    );
  }
}
