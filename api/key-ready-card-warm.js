/**
 * Triangle v2.2 T2 — POST /api/key-ready-card-warm
 * Login / chat entry prewarm. No Claude call. Assembles READY CARD from SSOT only.
 */

import { readJsonBody } from "../server/claudeGroundedExecutionCore.js";
import {
  createUserSupabaseClient,
  readCustomerAuthHeader,
  requireCustomerAuth,
} from "../server/requireCustomerAuth.js";
import { warmAndStoreKeyReadyCard } from "../server/keyCore/keyReadyCardBuild.js";
import {
  extractPoliciesFromContext,
  loadLatestSessionGoalFromConversations,
  loadLatestActiveCustomerGoalFromConversations,
  loadCustomerPriorConsultationForClaude,
} from "../server/keyCore/keyClaudeFirstDirect.js";
import { loadAllowedCorporateContextsForClaude } from "../server/keyCore/keyClaudeCorporateContext.js";
import { loadKeyActiveClaimCases } from "../server/documentPolicyUploadPersist.js";
import {
  loadSalesDirectorTurnContext,
  snapshotToContextBundle,
} from "../server/customerContextSnapshot.js";

async function loadActiveCustomerDocuments({ supabase = null, customerId = null } = {}) {
  const cid = String(customerId ?? "").trim();
  if (!supabase || !cid) return [];
  try {
    const { data, error } = await supabase
      .from("customer_documents")
      .select("id, original_filename")
      .eq("customer_id", cid)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(80);
    if (error) return [];
    return (Array.isArray(data) ? data : []).map((row) => ({
      id: row?.id != null ? String(row.id) : null,
      original_filename: row?.original_filename ?? null,
    }));
  } catch {
    return [];
  }
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
  const auth = await requireCustomerAuth(userSupabase);
  if (!auth.ok) {
    res.statusCode = auth.reason === "UNAUTHORIZED" ? 401 : 403;
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
    body = req.body && typeof req.body === "object" ? req.body : await readJsonBody(req);
  } catch {
    body = {};
  }

  const sessionId = String(body.session_id ?? "").trim() || null;
  const customerId = String(auth.customerId ?? auth.customer_id ?? "").trim();

  try {
    // Existing turn-context SSOT (cached) — policies/profile without a new truth DB.
    let unifiedState = null;
    let customerContextBundle = null;
    let loadedContext = null;
    try {
      const turnCtx = await loadSalesDirectorTurnContext(userSupabase, customerId, {
        requestHistory: [],
      });
      unifiedState = turnCtx?.unifiedState ?? null;
      customerContextBundle = snapshotToContextBundle(turnCtx?.snapshot) ?? null;
      loadedContext = customerContextBundle;
    } catch {
      unifiedState = null;
      customerContextBundle = null;
      loadedContext = null;
    }

    const result = await warmAndStoreKeyReadyCard({
      userSupabase,
      customerId,
      sessionId,
      authUserId: auth.user?.id ?? null,
      loadedContext,
      unifiedState,
      customerContextBundle,
      discardGoal: false,
      extractPoliciesFromContext,
      loadLatestSessionGoalFromConversations,
      loadLatestActiveCustomerGoalFromConversations,
      loadCustomerPriorConsultationForClaude,
      loadAllowedCorporateContextsForClaude,
      loadKeyActiveClaimCases,
      loadActiveCustomerDocuments,
    });

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    // Client gets status only — not the full card (no dump to browser).
    res.end(
      JSON.stringify({
        ok: true,
        claude_called: false,
        status: result.status,
        prepared_at: result.prepared_at,
        card_version: result.card_version,
        ready_card_build_ms: result.build_ms,
        materials_connected: result.materials_connected,
      }),
    );
  } catch (err) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: false,
        claude_called: false,
        status: "miss",
        reason: "warm_failed",
        error_message: String(err?.message ?? err).slice(0, 200),
      }),
    );
  }
}
