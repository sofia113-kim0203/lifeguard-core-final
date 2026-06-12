/**
 * Phase 28 Step 1B — POST /api/customer-unified-state
 * Returns the unified customer state contract for the authenticated customer.
 */

import { createClient } from "@supabase/supabase-js";
import { readJsonBody } from "../server/claudeGroundedExecutionCore.js";
import {
  createUserSupabaseClient,
  readCustomerAuthHeader,
  requireCustomerAuth,
} from "../server/requireCustomerAuth.js";

function createServiceRoleSupabaseClient(env = process.env) {
  const url = String(env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? "").trim();
  const serviceRoleKey = String(env.SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

function mapUnifiedStateForClient(state) {
  if (!state) return null;
  return {
    contract_version: state.contract_version,
    customer_id: state.customer_id,
    memory_version: state.memory_version,
    state_hash: state.state_hash,
    loaded_at: state.loaded_at,
    last_event: state.last_event,
    policy_count: state.policy_count,
    policy_ids: state.policy_ids,
    document_count: state.document_count,
    documents_preview_count: state.documents_preview_count ?? state.documents?.length ?? 0,
    memory_fact_count: state.memory_fact_count,
    insurance_policy_count_fact: state.insurance_policy_count_fact,
    profile: state.profile
      ? {
          display_name: state.profile.display_name ?? null,
          memory_version: state.profile.memory_version ?? state.memory_version ?? 0,
        }
      : null,
    policies: (state.policies ?? []).map((policy) => ({
      id: policy.id,
      insurer_name: policy.insurer_name,
      product_name: policy.product_name,
      policy_type: policy.policy_type,
      is_active: policy.is_active,
      source: policy.source ?? null,
    })),
    documents: (state.documents ?? []).map((doc) => ({
      id: doc.id,
      doc_class: doc.doc_class,
      ingest_status: doc.ingest_status,
      original_filename: doc.original_filename,
    })),
    provenance: state.provenance ?? null,
    flags: state.flags ?? null,
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

  try {
    const body = req.body && typeof req.body === "object" ? req.body : await readJsonBody(req);
    const lastEvent = body?.last_event ? String(body.last_event).trim() : null;
    const authHeader = readCustomerAuthHeader(req);

    const userSupabase = createUserSupabaseClient(authHeader);
    const resolved = await requireCustomerAuth(userSupabase);
    if (!resolved.ok && resolved.reason === "SUPABASE_NOT_CONFIGURED") {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(resolved));
      return;
    }
    if (!resolved.ok) {
      res.statusCode = resolved.reason === "UNAUTHORIZED" ? 401 : 403;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(resolved));
      return;
    }

    const adminSupabase = createServiceRoleSupabaseClient();
    if (!adminSupabase) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, reason: "SERVICE_ROLE_NOT_CONFIGURED" }));
      return;
    }

    const { loadUnifiedCustomerState } = await import("../server/unifiedCustomerState.js");
    const unified = await loadUnifiedCustomerState(adminSupabase, resolved.customerId, {
      lastEvent,
    });

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: true,
        unified_state: mapUnifiedStateForClient(unified),
      }),
    );
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: false,
        reason: "SERVER_ERROR",
        error_message: error instanceof Error ? error.message : "Unified state load failed.",
      }),
    );
  }
}
