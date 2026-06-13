/**
 * Read-only Production PR-C2 shadow verification.
 * SELECT only — no mutations, no PII in output.
 */
import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const DEPLOY_SHA = "8df7b83";
const DEPLOY_AFTER_ISO = "2026-06-13T08:15:00Z";

function loadEnvLocal() {
  if (!existsSync(".env.local")) return;
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    if (!process.env[key]) process.env[key] = trimmed.slice(idx + 1).trim();
  }
}

loadEnvLocal();

const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY ?? "";

if (!url || !serviceRoleKey) {
  console.error("BLOCKER: missing Supabase credentials");
  process.exit(1);
}

const host = new URL(url).host;
const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

function maskId(value) {
  const text = String(value ?? "");
  if (text.length <= 8) return "***";
  return `${text.slice(0, 8)}...`;
}

const { data: withValidation, error: valError } = await admin
  .from("customer_documents")
  .select("id, customer_id, original_filename, ingest_status, metadata_json, updated_at, created_at")
  .is("deleted_at", null)
  .not("metadata_json->policy_validation", "is", null)
  .order("updated_at", { ascending: false })
  .limit(20);

if (valError) {
  console.error("query_error:", valError.message);
  process.exit(1);
}

const postDeploy = (withValidation ?? []).filter((row) => {
  const updated = row.updated_at ?? row.created_at;
  return updated && updated >= DEPLOY_AFTER_ISO;
});

const { data: recentReady } = await admin
  .from("customer_documents")
  .select("id, customer_id, original_filename, ingest_status, metadata_json, updated_at")
  .is("deleted_at", null)
  .eq("ingest_status", "ready")
  .gte("updated_at", DEPLOY_AFTER_ISO)
  .order("updated_at", { ascending: false })
  .limit(20);

const report = {
  production_host: host,
  deploy_sha: DEPLOY_SHA,
  policy_validation_rows_total: withValidation?.length ?? 0,
  policy_validation_rows_post_deploy: postDeploy.length,
  recent_ready_post_deploy: recentReady?.length ?? 0,
};

if (postDeploy.length > 0) {
  const row = postDeploy[0];
  const pv = row.metadata_json?.policy_validation ?? {};
  const customerId = row.customer_id;

  const { count: policyCount } = await admin
    .from("profile_insurance_policies")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId)
    .eq("source", "upload_extract")
    .is("deleted_at", null);

  report.sample = {
    document_id_masked: maskId(row.id),
    customer_id_masked: maskId(customerId),
    original_filename: row.original_filename,
    ingest_status: row.ingest_status,
    policy_extraction_status: row.metadata_json?.policy_extraction_status ?? null,
    policy_validation_present: Boolean(pv && Object.keys(pv).length),
    shadow_mode: pv.shadow_mode ?? null,
    document_route: pv.document_route ?? null,
    document_score: pv.document_score ?? null,
    would_auto_save_count: pv.would_auto_save_count ?? null,
    actually_persisted_count: pv.actually_persisted_count ?? null,
    upload_extract_policy_count: policyCount ?? 0,
    updated_at: row.updated_at,
  };
}

console.log(JSON.stringify(report, null, 2));
