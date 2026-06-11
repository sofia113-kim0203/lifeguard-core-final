/**
 * Phase 28 — Audit/repair is_active flags for 김진우 maintained policies.
 *
 * Tom rule: 8 maintained policies; is_active=false may be data error unless truly terminated.
 *
 * Usage:
 *   SERVICE_ROLE_KEY=... node scripts/phase28-policy-is-active-audit.mjs
 *   SERVICE_ROLE_KEY=... node scripts/phase28-policy-is-active-audit.mjs --repair
 */
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { resolveAuditCustomerId } from "./lib/sandboxAuthGuard.js";

const ENV_LOCAL = ".env.local";

const CUSTOMER_ID = resolveAuditCustomerId(process.env.AUDIT_CUSTOMER_ID);
const EXPECTED_COUNT = Number(process.env.AUDIT_EXPECTED_POLICY_COUNT ?? "8");
const REPAIR = process.argv.includes("--repair");

const TERMINATED_STATUS = /해지|cancel|terminat|lapse|만기|비활성/i;

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

function isTerminatedPolicy(policy) {
  const status = String(policy.policy_status ?? "").trim();
  if (!status) return false;
  return TERMINATED_STATUS.test(status);
}

function shouldRepairToMaintained(policy) {
  if (policy.deleted_at) return false;
  if (policy.is_active !== false) return false;
  if (isTerminatedPolicy(policy)) return false;
  return true;
}

loadEnvLocal();

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const serviceRoleKey = await resolveServiceRoleKey();

if (!url || !serviceRoleKey) {
  console.error("Missing SUPABASE_URL or SERVICE_ROLE_KEY (or SUPABASE_ACCESS_TOKEN).");
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

const { data: policies, error } = await supabase
  .from("profile_insurance_policies")
  .select(
    "id, insurer_name, product_name, policy_type, is_active, policy_status, source, deleted_at, updated_at",
  )
  .eq("customer_id", CUSTOMER_ID)
  .is("deleted_at", null)
  .order("created_at", { ascending: false });

if (error) {
  console.error("policy_lookup_failed:", error.message);
  process.exit(1);
}

const rows = policies ?? [];
const inactiveRows = rows.filter((row) => row.is_active === false);
const repairCandidates = inactiveRows.filter((row) => shouldRepairToMaintained(row));
const terminatedInactive = inactiveRows.filter((row) => isTerminatedPolicy(row));

const report = {
  phase: "28-policy-is-active-audit",
  customer_id: CUSTOMER_ID,
  expected_maintained_count: EXPECTED_COUNT,
  total_non_deleted: rows.length,
  is_active_true: rows.filter((row) => row.is_active === true).length,
  is_active_false: inactiveRows.length,
  repair_candidates: repairCandidates.map((row) => ({
    id: row.id,
    insurer: row.insurer_name,
    product: row.product_name,
    policy_status: row.policy_status,
    source: row.source,
    reason: "is_active=false but not terminated — likely maintained policy mis-flagged",
  })),
  terminated_inactive: terminatedInactive.map((row) => ({
    id: row.id,
    insurer: row.insurer_name,
    product: row.product_name,
    policy_status: row.policy_status,
  })),
  policies: rows.map((row) => ({
    id: row.id,
    insurer: row.insurer_name,
    product: row.product_name,
    is_active: row.is_active,
    policy_status: row.policy_status,
    source: row.source,
  })),
  repair_mode: REPAIR,
  repairs_applied: [],
};

if (REPAIR && repairCandidates.length > 0) {
  for (const row of repairCandidates) {
    const { error: updateError } = await supabase
      .from("profile_insurance_policies")
      .update({ is_active: true })
      .eq("id", row.id)
      .eq("customer_id", CUSTOMER_ID);

    report.repairs_applied.push({
      id: row.id,
      insurer: row.insurer_name,
      product: row.product_name,
      ok: !updateError,
      error: updateError?.message ?? null,
    });
  }
}

report.pass =
  rows.length === EXPECTED_COUNT &&
  (repairCandidates.length === 0 || (REPAIR && report.repairs_applied.every((item) => item.ok)));

console.log(JSON.stringify(report, null, 2));

if (!report.pass) {
  if (repairCandidates.length > 0 && !REPAIR) {
    console.error(
      "\nFound is_active=false policies that appear maintained. Re-run with --repair after review.\n",
    );
  }
  process.exit(1);
}

console.log("\n✅ Policy is_active audit passed — maintained count aligns with expectation.\n");
