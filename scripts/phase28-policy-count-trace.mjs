/**
 * Phase 28 — Trace policy_count 8→5 drop for "나의 보험 총 건수는?"
 *
 * Usage:
 *   SERVICE_ROLE_KEY=... node scripts/phase28-policy-count-trace.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { loadUnifiedCustomerState, getInsurancePolicyCountFact } from "../server/unifiedCustomerState.js";
import { ensureCustomerMemoryContext } from "../server/customerMemoryContextSync.js";
import {
  buildDirectFactualAnswer,
  extractCustomerSituation,
} from "../server/customerConversationalTone.js";
import { buildFastConversationalResponse } from "../server/fastResponseLayer.js";

const ENV_LOCAL = ".env.local";
const CUSTOMER_ID = process.env.AUDIT_CUSTOMER_ID ?? "2d61e1eb-4b8e-43f4-9d31-ad2300ed554e";
const QUESTION = "나의 보험 총 건수는?";

function loadEnvLocal() {
  if (!existsSync(ENV_LOCAL)) return;
  for (const line of readFileSync(ENV_LOCAL, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

async function resolveServiceRoleKey() {
  let key = process.env.SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (key) return key;
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  if (!accessToken) return null;
  const keysRes = await fetch("https://api.supabase.com/v1/projects/fhvlxcguvjvtftttfrix/api-keys", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!keysRes.ok) return null;
  const keys = await keysRes.json();
  return keys.find((entry) => entry.name === "service_role")?.api_key ?? null;
}

loadEnvLocal();

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const serviceRoleKey = await resolveServiceRoleKey();

if (!url || !serviceRoleKey) {
  console.error("Missing SUPABASE_URL or SERVICE_ROLE_KEY (or SUPABASE_ACCESS_TOKEN).");
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

const { data: dbPolicies, error } = await supabase
  .from("profile_insurance_policies")
  .select("id, insurer_name, product_name, is_active, policy_status, deleted_at")
  .eq("customer_id", CUSTOMER_ID)
  .is("deleted_at", null)
  .order("created_at", { ascending: false });

if (error) {
  console.error("DB lookup failed:", error.message);
  process.exit(1);
}

const policies = dbPolicies ?? [];
const activeTrue = policies.filter((p) => p.is_active === true);
const activeFalse = policies.filter((p) => p.is_active === false);
const activeNull = policies.filter((p) => p.is_active == null);
const activeNotFalse = policies.filter((p) => p.is_active !== false);

const unified = await loadUnifiedCustomerState(supabase, CUSTOMER_ID);
const memoryContext = await ensureCustomerMemoryContext({ supabase, customerId: CUSTOMER_ID });

const workingContext = {
  snapshot: memoryContext.snapshot,
  sourceContext: memoryContext.sourceContext,
  sourceSummary: memoryContext.sourceSummary,
};

const situation = extractCustomerSituation(workingContext);
const directAnswer = buildDirectFactualAnswer(QUESTION, workingContext);
const fastResponse = buildFastConversationalResponse({
  question: QUESTION,
  memorySnapshot: memoryContext.snapshot,
  cachePayload: { cache_status: "fresh", background_refresh_types: [] },
  sourceContext: memoryContext.sourceContext,
  sourceSummary: memoryContext.sourceSummary,
});

const countFact = getInsurancePolicyCountFact(memoryContext.snapshot);
const summaryPolicies = memoryContext.sourceSummary?.insurance ?? [];
const summaryActiveNotFalse = summaryPolicies.filter((p) => p.is_active !== false);

const report = {
  customer_id: CUSTOMER_ID,
  question: QUESTION,
  stages: {
    "1_db.profile_insurance_policies": {
      policy_count: policies.length,
      is_active_true: activeTrue.length,
      is_active_false: activeFalse.length,
      is_active_null: activeNull.length,
      is_active_not_false: activeNotFalse.length,
      inactive_policy_ids: activeFalse.map((p) => p.id),
      policies: policies.map((p) => ({
        id: p.id,
        insurer: p.insurer_name,
        product: p.product_name,
        is_active: p.is_active,
        policy_status: p.policy_status,
      })),
    },
    "2_loadUnifiedCustomerState": {
      policy_count: unified.policy_count,
      policy_ids: unified.policy_ids,
      insurance_policy_count_fact: unified.insurance_policy_count_fact,
    },
    "3_ensureCustomerMemoryContext": {
      source_summary_policy_count: memoryContext.sourceSummary?.policy_count ?? null,
      source_summary_insurance_rows: summaryPolicies.length,
      source_summary_active_not_false: summaryActiveNotFalse.length,
      memory_insurance_policy_count_fact: countFact,
      memory_version: memoryContext.snapshot?.memory_version ?? null,
    },
    "4_extractCustomerSituation": {
      policy_count: situation.policyCount,
      policy_descriptions_count: situation.policyDescriptions.length,
      policy_descriptions: situation.policyDescriptions,
    },
    "5_buildDirectFactualAnswer": {
      answer_preview: directAnswer?.slice(0, 280) ?? null,
      count_in_answer: directAnswer?.match(/총\s*(\d+)\s*건/)?.[1] ?? null,
    },
    "6_buildFastConversationalResponse": {
      response_preview: fastResponse?.slice(0, 280) ?? null,
      count_in_response: fastResponse?.match(/총\s*(\d+)\s*건/)?.[1] ?? null,
    },
  },
  drop_analysis: {
    db_to_unified: policies.length === unified.policy_count ? "same" : `db=${policies.length} unified=${unified.policy_count}`,
    unified_to_situation:
      unified.policy_count === situation.policyCount
        ? "same"
        : `unified=${unified.policy_count} situation=${situation.policyCount}`,
    likely_drop_stage:
      unified.policy_count !== situation.policyCount
        ? "customerConversationalTone.resolveUnifiedPolicyView mismatch"
        : policies.length !== unified.policy_count
          ? "loadUnifiedCustomerState"
          : activeFalse.length > 0 && situation.policyCount < policies.length
            ? "legacy is_active filter or stale memory fact — run phase28-policy-is-active-audit"
            : "no drop detected",
    dashboard_shows: unified.policy_count,
    chat_shows: situation.policyCount,
  },
};

console.log(JSON.stringify(report, null, 2));
