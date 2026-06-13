/**
 * PR-C2 Production shadow verification — SELECT only.
 * Discovers post-deploy documents with policy_validation (no hardcoded customer_id).
 */
import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const EXPECTED_DEPLOY_SHA = "8df7b83acaae39abbb7b515755077ca5e62a3ddf";
const DEPLOY_AFTER_ISO = "2026-06-13T08:20:03Z";

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

const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

function maskEmail(email) {
  const text = String(email ?? "");
  const [local, domain] = text.split("@");
  if (!local || !domain) return null;
  return `${local.slice(0, 2)}***@${domain}`;
}

const { data: withValidation, error: valError } = await admin
  .from("customer_documents")
  .select("id, customer_id, original_filename, mime_type, ingest_status, metadata_json, created_at, updated_at")
  .is("deleted_at", null)
  .not("metadata_json->policy_validation", "is", null)
  .order("updated_at", { ascending: false })
  .limit(30);

if (valError) throw new Error(valError.message);

const postDeploy = (withValidation ?? []).filter((row) => (row.updated_at ?? row.created_at) >= DEPLOY_AFTER_ISO);

let target = postDeploy[0] ?? null;

if (!target) {
  const { data: recentExtractions } = await admin
    .from("customer_documents")
    .select("id, customer_id, original_filename, mime_type, ingest_status, metadata_json, created_at, updated_at")
    .is("deleted_at", null)
    .gte("updated_at", DEPLOY_AFTER_ISO)
    .order("updated_at", { ascending: false })
    .limit(20);

  const candidates = (recentExtractions ?? []).filter((row) => {
    const status = row.metadata_json?.policy_extraction_status;
    return row.ingest_status === "ready" || status === "completed" || status === "pending_manual_review";
  });
  target = candidates[0] ?? null;
}

let accountEmail = null;
let policyCountBeforeScope = null;
let policyRowsForDoc = null;

if (target) {
  const { data: profile } = await admin
    .from("customer_profiles")
    .select("id, display_name, user_id")
    .eq("id", target.customer_id)
    .maybeSingle();

  if (profile?.user_id) {
    const { data: authUser } = await admin.auth.admin.getUserById(profile.user_id);
    accountEmail = authUser?.user?.email ?? null;
  }

  const { count: uploadExtractCount } = await admin
    .from("profile_insurance_policies")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", target.customer_id)
    .eq("source", "upload_extract")
    .is("deleted_at", null);

  policyCountBeforeScope = uploadExtractCount ?? 0;

  const { data: policies } = await admin
    .from("profile_insurance_policies")
    .select("id, insurer_name, product_name, is_active, coverage_summary, created_at, updated_at")
    .eq("customer_id", target.customer_id)
    .eq("source", "upload_extract")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(50);

  policyRowsForDoc = (policies ?? []).filter(
    (row) => row.coverage_summary?.source_document_id === target.id,
  );
}

const pv = target?.metadata_json?.policy_validation ?? null;
const meta = target?.metadata_json ?? {};

const report = {
  expected_deploy_sha: EXPECTED_DEPLOY_SHA,
  deploy_after_iso: DEPLOY_AFTER_ISO,
  policy_validation_rows_total: withValidation?.length ?? 0,
  policy_validation_rows_post_deploy: postDeploy.length,
  qa_upload_detected_post_deploy: Boolean(postDeploy.length),
  document: target
    ? {
        document_id: target.id,
        customer_id: target.customer_id,
        test_account_email_masked: maskEmail(accountEmail),
        original_filename: target.original_filename,
        mime_type: target.mime_type,
        ingest_status: target.ingest_status,
        ocr_status: target.ingest_status === "ready" ? "ready" : target.ingest_status,
        policy_extraction_status: meta.policy_extraction_status ?? null,
        policy_extraction_count: meta.policy_extraction_count ?? null,
        created_at: target.created_at,
        updated_at: target.updated_at,
      }
    : null,
  policy_validation: pv
    ? {
        exists: true,
        shadow_mode: pv.shadow_mode ?? null,
        document_route: pv.document_route ?? null,
        document_score: pv.document_score ?? null,
        would_auto_save_count: pv.would_auto_save_count ?? null,
        actually_persisted_count: pv.actually_persisted_count ?? null,
        validator_version: pv.validator_version ?? null,
      }
    : { exists: false },
  persist_compare: target
    ? {
        upload_extract_policy_count_customer: policyCountBeforeScope,
        policies_for_document_count: policyRowsForDoc?.length ?? 0,
        actually_persisted_count: pv?.actually_persisted_count ?? null,
        counts_match:
          pv?.actually_persisted_count != null
            ? policyRowsForDoc?.length === pv.actually_persisted_count
            : null,
      }
    : null,
};

console.log(JSON.stringify(report, null, 2));
