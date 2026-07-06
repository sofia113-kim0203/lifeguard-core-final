/**
 * CONN-002 Visual Confirm-2 — QA-only gap top_concern seed payload (Preview seat).
 */
import { join } from "node:path";
import { buildCoverageGapContextFromPayload } from "../../server/salesDirectorCoverageGapContext.js";
import {
  buildRecommendationContextFromPayload,
  extractRecommendationTop2Items,
} from "../../server/salesDirectorRecommendationContext.js";
import { jobHasStoredCoverageGap } from "../../server/keyBrain/returnJudgmentFirstSpeak.js";
import {
  assertSafeTestScriptExecution,
  loadEnvLocal,
  resolveSupabaseUrl,
} from "./productionSafetyGuard.mjs";

export const CONN_002_QA_SEED_TAG = "conn_002_qa_gap_top_concern_v1";

export function buildConn002CoverageGapPanel() {
  return {
    seed_tag: CONN_002_QA_SEED_TAG,
    gap_score: 88,
    overall_risk: "high",
    top_gaps: [
      {
        coverage_type: "cancer",
        coverage_label: "암",
        gap_level: "critical",
        current_status: "insufficient",
      },
    ],
    items: [
      {
        coverage_type: "cancer",
        coverage_label: "암",
        gap_level: "critical",
        current_status: "insufficient",
      },
    ],
  };
}

export function buildConn002ExpectedGapSentence(topConcerns = []) {
  const first = String(topConcerns[0] ?? "암").trim();
  if (!first) return null;
  const axis = first.includes("보장") ? first : `${first} 보장`;
  return `${axis} 쪽부터 먼저 같이 짚어보면 좋겠습니다.`;
}

/**
 * Mirrors CONN-002 product gate in returnJudgmentFirstSpeak.finalizeReturnJudgmentSentence
 * using stored job payload + orchestrator-equivalent recommendation load semantics.
 * gap_used_assumed: true when coverage_gap panel is wired (tool on plan).
 */
export function evaluateConn002ProductGateFromJob(job = {}) {
  const resultJson = job.result_json ?? {};
  const hasStoredGap = jobHasStoredCoverageGap(job);
  const recoCtx = buildRecommendationContextFromPayload(resultJson.recommendation ?? null, {
    jobId: job.id ?? null,
  });
  const recommendationPriorityLabels = recoCtx.priority_labels ?? [];
  const recommendationUsedPredicted = recoCtx.loaded === true;
  const hasRecommendation =
    recommendationPriorityLabels.length > 0 || recommendationUsedPredicted === true;
  const gapUsedAssumed = hasStoredGap;
  const conn002PathEligible = hasStoredGap && gapUsedAssumed;

  return {
    has_stored_gap: hasStoredGap,
    has_recommendation: hasRecommendation,
    recommendation_used: recommendationUsedPredicted,
    recommendation_priority_labels: recommendationPriorityLabels,
    gap_used_assumed: gapUsedAssumed,
    conn_002_path_eligible: conn002PathEligible,
  };
}

export function buildConn002SeedResultJson(existing = {}) {
  const next = { ...(existing ?? {}) };
  next.coverage_gap = {
    ...(existing?.coverage_gap ?? {}),
    ...buildConn002CoverageGapPanel(),
  };
  if (next.recommendation && typeof next.recommendation === "object") {
    next.recommendation = {
      ...next.recommendation,
      customer_visible_top2: [],
      conn_002_qa_seed_stripped_top2: true,
    };
  } else {
    next.recommendation = {
      customer_visible_top2: [],
      conn_002_qa_seed_stripped_top2: true,
    };
  }
  next.conn_002_qa_seed = {
    tag: CONN_002_QA_SEED_TAG,
    purpose: "P5-C Visual Confirm-2 only",
    patched_at: new Date().toISOString(),
  };
  return next;
}

export function summarizeConn002Job(job = {}) {
  const gapCtx = buildCoverageGapContextFromPayload(job.result_json?.coverage_gap ?? null, {
    jobId: job.id ?? null,
  });
  const recoTop2 = extractRecommendationTop2Items(job.result_json?.recommendation ?? null);
  const productGate = evaluateConn002ProductGateFromJob(job);
  return {
    job_id: job.id ?? null,
    top_concerns: gapCtx.top_concerns ?? [],
    recommendation_top2_count: recoTop2.length,
    expected_gap_sentence: buildConn002ExpectedGapSentence(gapCtx.top_concerns ?? []),
    product_gate: productGate,
    conn_002_panel_fireable: productGate.conn_002_path_eligible === true,
  };
}

export function resolveServiceRoleClient(createClient, { loadEnvFileFn = null, root = null } = {}) {
  if (loadEnvFileFn && root) {
    loadEnvFileFn(join(root, ".env.local"), {
      forceKeys: ["SUPABASE_SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY", "VITE_SUPABASE_URL", "SUPABASE_URL"],
    });
    loadEnvFileFn(join(root, ".env.preview.pulled"));
  } else {
    loadEnvLocal();
  }
  assertSafeTestScriptExecution({
    scriptName: "conn-002-qa-gap-seed",
    usesServiceRoleAuthAdmin: false,
  });
  const url = resolveSupabaseUrl();
  const serviceRole =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY ?? "";
  if (!url || !serviceRole) {
    throw new Error("missing_supabase_url_or_service_role");
  }
  return createClient(url, serviceRole, { auth: { persistSession: false } });
}

export async function patchAnalysisJobForConn002(client, { jobId, customerId } = {}) {
  if (!client || !jobId || !customerId) {
    throw new Error("client_job_or_customer_missing");
  }
  const { data: before, error: readError } = await client
    .from("analysis_jobs")
    .select("id,customer_id,status,result_json")
    .eq("id", jobId)
    .eq("customer_id", customerId)
    .maybeSingle();
  if (readError) throw new Error(readError.message ?? "job_read_failed");
  if (!before) throw new Error("job_not_found_for_customer");
  if (before.status !== "completed") throw new Error("job_not_completed");

  const result_json = buildConn002SeedResultJson(before.result_json ?? {});
  const { data: after, error: writeError } = await client
    .from("analysis_jobs")
    .update({ result_json })
    .eq("id", jobId)
    .eq("customer_id", customerId)
    .select("id,customer_id,status,result_json")
    .maybeSingle();
  if (writeError) throw new Error(writeError.message ?? "job_patch_failed");

  return {
    before: summarizeConn002Job(before),
    after: summarizeConn002Job(after ?? { ...before, result_json }),
    result_json,
  };
}

export async function fetchLatestCompletedJob(client, customerId) {
  const { data, error } = await client
    .from("analysis_jobs")
    .select("id,customer_id,status,result_json,completed_at")
    .eq("customer_id", customerId)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message ?? "latest_job_read_failed");
  return data ?? null;
}
