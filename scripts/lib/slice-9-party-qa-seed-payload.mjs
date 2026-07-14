/**
 * Slice 9 — non-identified party positive fixtures for QA seed / unit tests.
 * Staging only. No production. No migration.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertSafeTestScriptExecution,
  loadEnvLocal,
  resolveSupabaseUrl,
} from "./productionSafetyGuard.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
export const SLICE9_FIXTURE_PATH = join(
  ROOT,
  "fixtures",
  "key-judgment-validation-v1",
  "slice-9-party-positive-fixtures.json",
);

export const SLICE9_CASE_A_SEED_TAG = "slice_9_party_case_a_v1";
export const SLICE9_CASE_B_SEED_TAG = "slice_9_party_case_b_v1";

export function loadSlice9PartyPositiveFixtures() {
  return JSON.parse(readFileSync(SLICE9_FIXTURE_PATH, "utf8"));
}

export function getSlice9Case(caseId) {
  const pack = loadSlice9PartyPositiveFixtures();
  const row = (pack.cases ?? []).find((c) => c.id === caseId);
  if (!row) throw new Error(`slice9_case_not_found:${caseId}`);
  return row;
}

export function buildSlice9CombinedReality() {
  const a = getSlice9Case("slice-9-case-a").reality;
  const b = getSlice9Case("slice-9-case-b").reality;
  return {
    policy_count: 2,
    policies: [...(a.policies ?? []), ...(b.policies ?? [])],
  };
}

export function buildSlice9PolicyRowFromCase(customerId, caseId) {
  const c = getSlice9Case(caseId);
  const p = c.reality.policies[0];
  const summary = { ...(p.coverage_summary ?? {}) };
  return {
    customer_id: customerId,
    insurer_name: p.insurer_name,
    product_name: p.product_name,
    policy_type: p.policy_type ?? "whole_life",
    monthly_premium: p.monthly_premium ?? null,
    effective_from: summary.effective_from ?? null,
    coverage_summary: summary,
    source: "manual",
    is_active: true,
    updated_at: new Date().toISOString(),
  };
}

export function resolveServiceRoleClient(createClient, { root = ROOT } = {}) {
  loadEnvLocal(join(root, ".env.local"));
  loadEnvLocal(join(root, ".env.preview.pulled"));
  loadEnvLocal(join(root, "../lifeguard-core-final/.env.local"));
  assertSafeTestScriptExecution({
    scriptName: "slice-9-party-preview-qa-seed",
    createsTestAccount: false,
    usesServiceRoleAuthAdmin: false,
  });
  const url = resolveSupabaseUrl();
  const serviceRole = String(
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY ?? "",
  ).trim();
  if (!url || !serviceRole) {
    throw new Error("missing_supabase_url_or_service_role");
  }
  return createClient(url, serviceRole, { auth: { persistSession: false } });
}
