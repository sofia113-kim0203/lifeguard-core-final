/**
 * H — Staging QA exact-duplicate soft-delete (official QA customer only).
 * Default: dry-run. Pass --apply to execute soft deletes.
 * Forbidden: insurer+product+premium-only merge, hard delete, other customers.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildContractIdentityKey,
  buildSourceFactKey,
} from "../src/lib/keyInsuranceScreenFacts.js";

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    if (process.env[k]) continue;
    process.env[k] = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
  }
}

const APPLY = process.argv.includes("--apply");
const ROOT = process.cwd();
const EXPORT = join(ROOT, "..");
const processPw = String(process.env.QA_PASSWORD || "").trim();
for (const k of ["QA_EMAIL", "QA_TEST_EMAIL", "QA_PASSWORD", "QA_TEST_PASSWORD"]) {
  delete process.env[k];
}
loadEnv(join(EXPORT, "lifeguard-core-final", ".env.local"));
loadEnv(join(ROOT, ".env.local"));
if (processPw) process.env.QA_PASSWORD = processPw;

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
const service =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
const email = process.env.QA_EMAIL || process.env.QA_TEST_EMAIL || "";
const password = process.env.QA_PASSWORD || "";
const ref = (() => {
  try {
    return new URL(url).hostname.split(".")[0];
  } catch {
    return null;
  }
})();
if (ref !== "inwswsruvvzaeioqkelq") {
  console.log(JSON.stringify({ error: "STAGING_REF_MISMATCH", ref }, null, 2));
  process.exit(1);
}
if (ref === "fhvlxcguvjvtftttfrix") {
  console.log(JSON.stringify({ error: "PRODUCTION_REF_FORBIDDEN" }, null, 2));
  process.exit(1);
}

const auth = createClient(url, anon, { auth: { persistSession: false } });
const admin = createClient(url, service, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: sess, error: aerr } = await auth.auth.signInWithPassword({
  email,
  password,
});
if (aerr || !sess.session?.access_token) {
  console.log(JSON.stringify({ error: "QA_LOGIN_FAILED" }, null, 2));
  process.exit(1);
}
const { data: userData } = await auth.auth.getUser(sess.session.access_token);
const authUserId = userData?.user?.id;
const { data: prof } = await admin
  .from("customer_profiles")
  .select("id")
  .eq("user_id", authUserId)
  .maybeSingle();
const customerId = prof?.id;
if (!customerId) {
  console.log(JSON.stringify({ error: "PROFILE_NOT_FOUND" }, null, 2));
  process.exit(1);
}

let active = [];
{
  const wide = await admin
    .from("profile_insurance_policies")
    .select(
      "id, insurer_name, product_name, monthly_premium, coverage_summary, is_active, deleted_at, created_at, source, source_fact_key, contract_identity_key, source_content_sha256",
    )
    .eq("customer_id", customerId)
    .eq("is_active", true)
    .is("deleted_at", null);
  if (
    wide.error &&
    /source_fact_key|contract_identity_key|source_content_sha256|column/i.test(
      String(wide.error.message ?? ""),
    )
  ) {
    const narrow = await admin
      .from("profile_insurance_policies")
      .select(
        "id, insurer_name, product_name, monthly_premium, coverage_summary, is_active, deleted_at, created_at, source",
      )
      .eq("customer_id", customerId)
      .eq("is_active", true)
      .is("deleted_at", null);
    if (narrow.error) {
      console.log(
        JSON.stringify({ error: "SELECT_FAILED", message: narrow.error.message }, null, 2),
      );
      process.exit(1);
    }
    active = narrow.data ?? [];
  } else if (wide.error) {
    console.log(JSON.stringify({ error: "SELECT_FAILED", message: wide.error.message }, null, 2));
    process.exit(1);
  } else {
    active = wide.data ?? [];
  }
}

function verificationScore(row) {
  const s = row.coverage_summary && typeof row.coverage_summary === "object" ? row.coverage_summary : {};
  let score = 0;
  const st = String(s.verification_status ?? s.key_verification_status ?? "").toLowerCase();
  if (st === "insurer_verified") score += 40;
  else if (st === "document_read") score += 20;
  else if (st === "customer_reported") score += 5;
  if (s.source_document_id) score += 10;
  if (s.source_content_sha256 || row.source_content_sha256) score += 10;
  if (s.policy_number) score += 15;
  if (Array.isArray(s.key_confirmed_source_facts) && s.key_confirmed_source_facts.length) {
    score += 15;
  }
  if (Array.isArray(s.source_document_links)) {
    score += Math.min(s.source_document_links.length, 5);
  }
  return score;
}

function pickKeeper(group) {
  return [...group].sort((a, b) => {
    const ds = verificationScore(b) - verificationScore(a);
    if (ds !== 0) return ds;
    return String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
  })[0];
}

const enriched = active.map((row) => {
  const source_fact_key =
    String(row.source_fact_key ?? row.coverage_summary?.source_fact_key ?? "").trim() ||
    buildSourceFactKey(row);
  const contract_identity_key =
    String(row.contract_identity_key ?? row.coverage_summary?.contract_identity_key ?? "").trim() ||
    buildContractIdentityKey(row);
  return { ...row, source_fact_key, contract_identity_key };
});

const softDeleteIds = new Set();
const mergePlans = [];
const sourceFactGroups = new Map();
const identityGroups = new Map();

for (const row of enriched) {
  if (row.source_fact_key) {
    const list = sourceFactGroups.get(row.source_fact_key) ?? [];
    list.push(row);
    sourceFactGroups.set(row.source_fact_key, list);
  }
  if (row.contract_identity_key) {
    const list = identityGroups.get(row.contract_identity_key) ?? [];
    list.push(row);
    identityGroups.set(row.contract_identity_key, list);
  }
}

let dryRunSourceFactDupes = 0;
for (const [key, group] of sourceFactGroups.entries()) {
  if (group.length < 2) continue;
  const keeper = pickKeeper(group);
  const victims = group.filter((r) => r.id !== keeper.id);
  dryRunSourceFactDupes += victims.length;
  for (const v of victims) softDeleteIds.add(v.id);
  mergePlans.push({
    kind: "source_fact_key",
    key_present: true,
    key_prefix: String(key).slice(0, 24),
    keep_id_hash: String(keeper.id).slice(0, 8),
    soft_delete_count: victims.length,
  });
}

let dryRunIdentityMerges = 0;
for (const [key, group] of identityGroups.entries()) {
  if (group.length < 2) continue;
  const still = group.filter((r) => !softDeleteIds.has(r.id));
  if (still.length < 2) continue;
  const keeper = pickKeeper(still);
  const victims = still.filter((r) => r.id !== keeper.id);
  dryRunIdentityMerges += victims.length;
  for (const v of victims) softDeleteIds.add(v.id);
  mergePlans.push({
    kind: "contract_identity_key",
    key_present: true,
    key_prefix: String(key).slice(0, 24),
    keep_id_hash: String(keeper.id).slice(0, 8),
    soft_delete_count: victims.length,
  });
}

const ambiguousLeft = enriched.filter(
  (r) => !softDeleteIds.has(r.id) && !r.contract_identity_key && !r.source_fact_key,
).length;

const report = {
  STAGING_REF: ref,
  MODE: APPLY ? "APPLY" : "DRY_RUN",
  ACTIVE_BEFORE: active.length,
  DRY_RUN_DUPLICATES: softDeleteIds.size,
  DRY_RUN_SOURCE_FACT_DUPES: dryRunSourceFactDupes,
  MERGED_STRONG_IDENTITIES: dryRunIdentityMerges,
  AMBIGUOUS_ROWS_LEFT: ambiguousLeft,
  PLANS: mergePlans.slice(0, 40),
  ORIGINALS_MODIFIED: "NO",
  EVIDENCE_MODIFIED: "NO",
  SOFT_DELETED: 0,
};

if (APPLY && softDeleteIds.size > 0) {
  const now = new Date().toISOString();
  let deleted = 0;
  for (const id of softDeleteIds) {
    const row = enriched.find((r) => r.id === id);
    const prior =
      row?.coverage_summary && typeof row.coverage_summary === "object"
        ? row.coverage_summary
        : {};
    const { error: updErr } = await admin
      .from("profile_insurance_policies")
      .update({
        is_active: false,
        deleted_at: now,
        coverage_summary: {
          ...prior,
          retired_reason: "exact_duplicate_soft_delete_canonical_p0",
          retired_at: now,
        },
        updated_at: now,
      })
      .eq("id", id)
      .eq("customer_id", customerId);
    if (!updErr) deleted += 1;
  }
  report.SOFT_DELETED = deleted;
  const after = await admin
    .from("profile_insurance_policies")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId)
    .eq("is_active", true)
    .is("deleted_at", null);
  report.ACTIVE_AFTER = after.count ?? null;
}

const out = join(ROOT, ".tmp-p0-qa-exact-dupe-repair.json");
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
