/**
 * Phase 28 Step 1B — POST /api/customer-unified-state
 * Returns the unified customer state contract for the authenticated customer.
 */

import { createClient } from "@supabase/supabase-js";
import { readJsonBody } from "../server/claudeGroundedExecutionCore.js";
import { resolvePolicyPremium } from "../src/lib/resolvePolicyPremium.js";
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
    memory_status: state.memory_status ?? "ready",
    memory_sync_assessment: state.memory_sync_assessment ?? null,
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
      policy_status: policy.policy_status ?? null,
      source: policy.source ?? null,
      monthly_premium: resolvePolicyPremium(policy),
      premium_amount: policy.premium_amount ?? null,
      coverage_summary: policy.coverage_summary ?? null,
      created_at: policy.created_at ?? null,
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

    // M2 — 로그인 시 메모리 자동 빌드 트리거 (비어 있고 소스 있을 때 1회, 백그라운드·멱등).
    // M1 원칙(실패를 숨기지 않는다)을 유지하기 위해:
    //   - 이 빌드는 백그라운드라 호출부로 에러를 돌려줄 수 없으므로, 실패를 서버 로그로 '관측 가능'하게 남긴다.
    //   - 사용자 측 비-침묵: 빌드 실패 시 facts가 여전히 0 → 다음 로드의 memory_status가 "degraded"로 노출됨.
    //     (실패 사유의 per-source 표면화는 M3에서 추가.)
    //   - 비차단: waitUntil로 백그라운드 실행 → unified 응답은 즉시 반환(클라이언트 15초 세션 타임아웃 회피).
    try {
      const factCount = unified?.memory_fact_count ?? 0;
      const hasSource =
        Boolean(unified?.flags?.has_profile) ||
        Boolean(unified?.flags?.has_health) ||
        Boolean(unified?.flags?.has_policies) ||
        (unified?.policy_count ?? 0) > 0 ||
        (unified?.document_count ?? 0) > 0;

      if (factCount === 0 && hasSource) {
        const { loadCustomerMemoryOnLogin } = await import(
          "../server/customerMemoryFoundation.js"
        );
        const memoryBuildPromise = loadCustomerMemoryOnLogin({
          supabase: adminSupabase,
          customerId: resolved.customerId,
          rebuild: true,
        })
          .then((result) => {
            if (result?.memory_status === "failed") {
              console.error("[M2] login memory rebuild failed", {
                customer_id: resolved.customerId,
                rebuild_error: result.rebuild_error ?? null,
              });
            }
            return result;
          })
          .catch((error) => {
            console.error("[M2] login memory rebuild threw", {
              customer_id: resolved.customerId,
              error: error instanceof Error ? error.message : String(error),
            });
          });

        try {
          const { waitUntil } = await import("@vercel/functions");
          waitUntil(memoryBuildPromise);
        } catch (error) {
          console.warn("[M2] waitUntil unavailable; background build not scheduled", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch (error) {
      console.error("[M2] login memory trigger scheduling error", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

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
