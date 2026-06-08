/**
 * Phase 25 Step 2A-P0 — POST /api/customer-policy-knowledge-pipeline
 * Bridge customer_documents (policy types only) → real_policy_pdf_registry → full RAG pipeline.
 */

import { readJsonBody } from "../server/claudeGroundedExecutionCore.js";
import { createClient } from "@supabase/supabase-js";

function resolveServiceRoleKey() {
  return (
    process.env.SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    null
  );
}

function resolveSupabaseUrl() {
  return process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim() || null;
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

  const serviceRoleKey = resolveServiceRoleKey();
  const supabaseUrl = resolveSupabaseUrl();
  if (!serviceRoleKey || !supabaseUrl) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, reason: "WORKER_NOT_CONFIGURED" }));
    return;
  }

  const authHeader = req.headers?.authorization ?? req.headers?.Authorization ?? "";
  const token = String(authHeader).replace(/^Bearer\s+/i, "").trim();
  if (!token || token !== serviceRoleKey) {
    res.statusCode = 403;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, reason: "SERVICE_ROLE_REQUIRED" }));
    return;
  }

  try {
    const body = req.body && typeof req.body === "object" ? req.body : await readJsonBody(req);
    const customerDocumentIds = Array.isArray(body?.customer_document_ids)
      ? body.customer_document_ids.map(String).filter(Boolean)
      : null;
    const filenames = Array.isArray(body?.filenames)
      ? body.filenames.map(String).filter(Boolean)
      : null;
    const limit = typeof body?.limit === "number" ? body.limit : 50;
    const dryRun = body?.dry_run === true;

    const { runCustomerPolicyKnowledgeAutoPipeline } = await import("../server/customerPolicyKnowledgePipeline.js");
    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const result = await runCustomerPolicyKnowledgeAutoPipeline({
      supabase,
      supabaseUrl,
      serviceRoleKey,
      customerDocumentIds,
      filenames,
      limit,
      dryRun,
    });

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, ...result }));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: false,
        reason: "SERVER_ERROR",
        error_message: error instanceof Error ? error.message : "Customer policy knowledge pipeline failed.",
      }),
    );
  }
}
