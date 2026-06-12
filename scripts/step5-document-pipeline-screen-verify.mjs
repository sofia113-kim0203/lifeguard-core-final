/**
 * Step 5 — full document → policy → analysis pipeline verification (customers A/B).
 */
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { runDocumentPolicyExtraction } from "../server/documentPolicyExtractionPipeline.js";
import { handleDocumentPolicyAnalysisRefreshRequest } from "../server/documentPolicyAnalysisRefresh.js";
import { loadUnifiedCustomerState } from "../server/unifiedCustomerState.js";

function mapJobResultsToAnalysisPanels(job) {
  if (!job?.result_json) return null;
  const result = job.result_json;
  return {
    coverageGapResult: result.coverage_gap ?? null,
    underwritingResult: result.underwriting_risk ?? null,
    recommendationResult: result.recommendation ?? null,
    designBundle: result.insurance_design ?? null,
  };
}

function pickCustomerVisibleTop2(recResult) {
  if (!recResult) return [];
  const direct =
    recResult.customerVisibleTop2 ??
    recResult.customer_visible_top2 ??
    recResult.recommendationResult?.customer_visible_top2 ??
    recResult.recommendationResult?.customerVisibleTop2;
  return Array.isArray(direct) ? direct : [];
}

const ENV_LOCAL = ".env.local";
const SAMPLES_DIR = join(import.meta.dirname, "samples/korean-insurance");
const RICH_SAMPLE = "ko-policy-certificate-rich.png";

function loadEnvLocal() {
  if (!existsSync(ENV_LOCAL)) return;
  for (const line of readFileSync(ENV_LOCAL, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    if (!process.env[key]) process.env[key] = trimmed.slice(idx + 1).trim();
  }
}
loadEnvLocal();

const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceRoleKey) {
  console.error("BLOCKER: missing Supabase credentials");
  process.exit(1);
}

function ensureRichSample() {
  mkdirSync(SAMPLES_DIR, { recursive: true });
  const out = join(SAMPLES_DIR, RICH_SAMPLE);
  if (existsSync(out)) return out;
  const ps = `Add-Type -AssemblyName System.Drawing; $bmp = New-Object System.Drawing.Bitmap 1200, 1100; $g = [System.Drawing.Graphics]::FromImage($bmp); $g.Clear([System.Drawing.Color]::White); $font = New-Object System.Drawing.Font 'Malgun Gothic', 30; $brush = [System.Drawing.Brushes]::Black; $lines = @('보험증권','보험사: 삼성생명','상품명: 실손의료비보험','계약자: 홍길동','피보험자: 홍길동','월 보험료: 45,000원','납입기간: 20년','보험기간: 종신','가입금액: 5,000만원','특약: 암진단비 3천만원','실손의료비 보장'); $y=40; foreach($line in $lines){$g.DrawString($line,$font,$brush,40,$y); $y+=52}; $bmp.Save('${out.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()`;
  spawnSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" });
  if (!existsSync(out)) throw new Error("rich_sample_missing");
  return out;
}

async function setupCustomer(label) {
  const stamp = Date.now() + Math.floor(Math.random() * 1000);
  const email = `step5-pipeline-${label}-${stamp}@example.com`;
  const password = `Step5Pipe!${stamp}`;
  const sb = createClient(url, anonKey, { auth: { persistSession: false } });
  await sb.auth.signUp({ email, password });
  await sb.auth.signInWithPassword({ email, password });
  const authUid = (await sb.auth.getUser()).data.user?.id;
  await sb.rpc("lifeguard_bootstrap_customer_signup", {
    p_display_name: `step5-${label}`,
    p_consent_version: "2026-01-01-ko",
  });
  const { data: profile } = await sb
    .from("customer_profiles")
    .select("id")
    .eq("user_id", authUid)
    .single();
  for (const entry of [
    { consent_type: "document_storage", consent_version: "2026-06-07-ko-doc" },
    { consent_type: "document_analysis", consent_version: "2026-06-07-ko-doc-analysis" },
    { consent_type: "insurance_data_processing", consent_version: "2026-01-01-ko" },
  ]) {
    await sb.from("customer_consents").insert({
      customer_id: profile.id,
      ...entry,
      granted: true,
      granted_at: new Date().toISOString(),
      source: "step5_verify",
      purpose: "pipeline_verify",
      required: true,
    });
  }
  const { data: session } = await sb.auth.getSession();
  return { email, password, customerId: profile.id, accessToken: session.session.access_token, sb };
}

async function runCustomerFlow(label, bytes) {
  const customer = await setupCustomer(label);
  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  const documentId = crypto.randomUUID();
  const storagePath = `${customer.customerId}/${documentId}/document-${documentId}.png`;
  const workerUrl = `${url}/functions/v1/document-ingest-worker`;

  await customer.sb.storage
    .from("customer-documents")
    .upload(storagePath, new Blob([bytes], { type: "image/png" }), { contentType: "image/png" });
  await customer.sb.from("customer_documents").insert({
    id: documentId,
    customer_id: customer.customerId,
    storage_path: storagePath,
    mime_type: "image/png",
    original_filename: RICH_SAMPLE,
    doc_class: "policy_certificate",
    ingest_status: "uploaded",
    customer_hint_type: "insurance_policy",
  });
  await customer.sb.rpc("lifeguard_request_customer_document_ingest", { p_document_id: documentId });
  const workerRes = await fetch(workerUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${customer.accessToken}`,
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ document_id: documentId }),
  });
  const workerBody = await workerRes.json().catch(() => ({}));

  const extraction = await runDocumentPolicyExtraction({
    customerId: customer.customerId,
    documentId,
    env: process.env,
    invokeMemory: true,
  });

  const refresh = await handleDocumentPolicyAnalysisRefreshRequest({
    authHeader: `Bearer ${customer.accessToken}`,
    documentId,
    env: process.env,
  });

  const unified = await loadUnifiedCustomerState(admin, customer.customerId);
  const mapped = mapJobResultsToAnalysisPanels(refresh.analysis_job);
  const top2 = pickCustomerVisibleTop2(mapped?.recommendationResult ?? {});

  return {
    label,
    email: customer.email,
    password: customer.password,
    customer_id: customer.customerId,
    document_id: documentId,
    worker_status: workerRes.status,
    ingest_status: workerBody.ingest_status,
    extraction_ok: extraction.ok,
    policy_count: unified.policy_count,
    memory_fact_count: unified.memory_fact_count,
    analysis_job_status: refresh.analysis_job?.status,
    panel_stages: refresh.panel_stages,
    has_coverage_gap: Boolean(mapped?.coverageGapResult),
    has_underwriting: Boolean(mapped?.underwritingResult),
    top2_count: top2.length,
    has_insurance_design: Boolean(mapped?.designBundle?.customer_visible_design || mapped?.designBundle?.insurance_design),
    refresh_ok: refresh.ok,
  };
}

async function main() {
  const bytes = readFileSync(ensureRichSample());
  const reports = [];
  for (const label of ["A", "B"]) {
    reports.push(await runCustomerFlow(label, bytes));
  }

  const pass = reports.every(
    (row) =>
      row.ingest_status === "ready" &&
      row.extraction_ok &&
      row.policy_count >= 1 &&
      row.memory_fact_count >= 1 &&
      row.analysis_job_status === "completed" &&
      row.has_coverage_gap &&
      row.has_underwriting &&
      row.top2_count >= 1 &&
      row.has_insurance_design &&
      row.refresh_ok,
  );

  console.log("=== Step 5 pipeline screen verify ===");
  console.log(JSON.stringify(reports, null, 2));
  console.log("PASS:", pass);
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL:", err instanceof Error ? err.message : err);
  process.exit(1);
});
