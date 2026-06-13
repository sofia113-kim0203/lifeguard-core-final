/**
 * PR-C2b coverage_sheet_shadow verification — RLS-only, single DOCUMENT_ID.
 *
 * Usage:
 *   DOCUMENT_ID=<uuid> QA_EMAIL=<email> QA_PASSWORD=<password> node scripts/pr-c2b-coverage-sheet-shadow-rls-verify.mjs
 *   DOCUMENT_ID=<uuid> CUSTOMER_BEARER_TOKEN=<jwt> node scripts/pr-c2b-coverage-sheet-shadow-rls-verify.mjs
 *
 * Optional:
 *   RUN_EXTRACT=1              — POST Production /api/customer-document-policy-extract for this document only
 *   PRODUCTION_API_URL=...     — default https://lifeguard-core-final.vercel.app/api/customer-document-policy-extract
 *
 * Safety (mandatory):
 * - No SUPABASE_SERVICE_ROLE_KEY / SERVICE_ROLE_KEY
 * - No customer_document_chunks queries
 * - No cross-customer document listing
 * - No OCR / sample line output
 * - Shadow summary fields only
 */
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const DOCUMENT_ID = String(process.env.DOCUMENT_ID ?? "").trim();
const RUN_EXTRACT = process.env.RUN_EXTRACT === "1";
const PRODUCTION_API_URL =
  String(process.env.PRODUCTION_API_URL ?? "").trim() ||
  "https://lifeguard-core-final.vercel.app/api/customer-document-policy-extract";

function loadEnvLocal() {
  if (!existsSync(".env.local")) return;
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    if (key === "SERVICE_ROLE_KEY" || key === "SUPABASE_SERVICE_ROLE_KEY") continue;
    if (!process.env[key]) process.env[key] = trimmed.slice(idx + 1).trim();
  }
}

function forbidServiceRoleEnv() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY) {
    throw new Error("SERVICE_ROLE_KEY must not be set for this script");
  }
}

function summarizeCoverageSheetShadow(shadow) {
  if (!shadow || typeof shadow !== "object") return null;
  return {
    extractor_version: shadow.extractor_version ?? null,
    layout: shadow.layout ?? null,
    confidence: shadow.confidence ?? null,
    pass_l1_v1: shadow.pass_l1_v1 ?? null,
    row_count: shadow.row_count ?? null,
    warnings: Array.isArray(shadow.warnings) ? shadow.warnings : [],
  };
}

async function createAuthedSession(url, anonKey) {
  const bearer = String(process.env.CUSTOMER_BEARER_TOKEN ?? "").trim();
  if (bearer) {
    const client = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${bearer}` } },
    });
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) throw new Error("CUSTOMER_BEARER_TOKEN invalid");
    return { client, accessToken: bearer, auth_mode: "bearer_token" };
  }

  const email = String(process.env.QA_EMAIL ?? process.env.PHASE28_TEST_EMAIL ?? "").trim();
  const password = String(
    process.env.QA_PASSWORD ?? process.env.PHASE28_TEST_PASSWORD ?? process.env.PHASE28_TEST_PASS ?? "",
  ).trim();
  if (!email || !password) {
    throw new Error("Provide CUSTOMER_BEARER_TOKEN or QA_EMAIL + QA_PASSWORD");
  }

  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session?.access_token) throw new Error("qa_auth_failed");

  return {
    client,
    accessToken: data.session.access_token,
    auth_mode: "password_sign_in",
    email_masked: `${email.slice(0, 2)}***@${email.split("@")[1] ?? "unknown"}`,
  };
}

async function countPoliciesForDocument(client, documentId) {
  const { data, error } = await client
    .from("profile_insurance_policies")
    .select("id, coverage_summary")
    .eq("source", "upload_extract")
    .is("deleted_at", null);
  if (error) throw new Error(`policy_count_failed:${error.message}`);
  return (data ?? []).filter((row) => row.coverage_summary?.source_document_id === documentId).length;
}

async function main() {
  if (!DOCUMENT_ID) throw new Error("DOCUMENT_ID is required");

  loadEnvLocal();
  forbidServiceRoleEnv();

  const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
  if (!url || !anonKey) throw new Error("missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");

  const { client, accessToken, auth_mode, email_masked } = await createAuthedSession(url, anonKey);

  let extractHttp = null;
  let extractOk = null;

  if (RUN_EXTRACT) {
    const extractRes = await fetch(PRODUCTION_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ document_id: DOCUMENT_ID, invoke_memory: false }),
    });
    extractHttp = extractRes.status;
    const extractBody = await extractRes.json().catch(() => ({}));
    extractOk = extractBody.ok ?? null;
  }

  const { data: doc, error: docError } = await client
    .from("customer_documents")
    .select("id, ingest_status, document_type, metadata_json")
    .eq("id", DOCUMENT_ID)
    .is("deleted_at", null)
    .maybeSingle();

  if (docError) throw new Error(`document_query_failed:${docError.message}`);

  const report = {
    ok: Boolean(doc),
    verification_scope: "single_document_rls_only",
    auth_mode,
    email_masked: email_masked ?? null,
    document_id: DOCUMENT_ID,
    ingest_status: doc?.ingest_status ?? null,
    document_type: doc?.document_type ?? null,
    extract_http: extractHttp,
    extract_ok: extractOk,
    coverage_sheet_shadow_exists: false,
    coverage_sheet_shadow: null,
    policy_extraction_status: null,
    profile_insurance_policies_for_doc: 0,
    verdict: "DOCUMENT_NOT_VISIBLE",
  };

  if (!doc) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(2);
  }

  const meta = doc.metadata_json ?? {};
  const shadow = meta.coverage_sheet_shadow ?? null;
  report.coverage_sheet_shadow_exists = Boolean(shadow);
  report.coverage_sheet_shadow = summarizeCoverageSheetShadow(shadow);
  report.policy_extraction_status = meta.policy_extraction_status ?? null;
  report.profile_insurance_policies_for_doc = await countPoliciesForDocument(client, DOCUMENT_ID);

  if (report.coverage_sheet_shadow_exists && report.coverage_sheet_shadow?.pass_l1_v1 === true) {
    report.verdict = "COVERAGE_SHEET_SHADOW_PASS";
  } else if (report.coverage_sheet_shadow_exists) {
    report.verdict = "COVERAGE_SHEET_SHADOW_PRESENT";
  } else {
    report.verdict = "COVERAGE_SHEET_SHADOW_MISSING";
  }

  report.ok = true;
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
