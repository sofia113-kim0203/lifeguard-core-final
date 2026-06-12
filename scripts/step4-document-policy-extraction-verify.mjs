/**
 * Step 4 — OCR chunk → policy extraction → policies/memory verification (2 new customers).
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { runDocumentPolicyExtraction } from "../server/documentPolicyExtractionPipeline.js";

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

  const ps = `
Add-Type -AssemblyName System.Drawing
$dir = '${SAMPLES_DIR.replace(/'/g, "''")}'
$bmp = New-Object System.Drawing.Bitmap 1200, 1100
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::White)
$font = New-Object System.Drawing.Font "Malgun Gothic", 30
$brush = [System.Drawing.Brushes]::Black
$lines = @(
  '보험증권',
  '보험사: 삼성생명',
  '상품명: 실손의료비보험',
  '계약자: 홍길동',
  '피보험자: 홍길동',
  '월 보험료: 45,000원',
  '납입기간: 20년',
  '보험기간: 종신',
  '가입금액: 5,000만원',
  '특약: 암진단비 3천만원',
  '실손의료비 보장',
  '암진단비 1회 지급'
)
$y = 40
foreach ($line in $lines) { $g.DrawString($line, $font, $brush, 40, $y); $y += 52 }
$bmp.Save('${out.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
`;
  const result = spawnSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" });
  if (result.status !== 0 || !existsSync(out)) {
    throw new Error(`rich_sample_generation_failed: ${result.stderr || result.stdout}`);
  }
  return out;
}

async function ingestDocument(sb, customerId, accessToken, bytes) {
  const documentId = crypto.randomUUID();
  const storagePath = `${customerId}/${documentId}/document-${documentId}.png`;
  const workerUrl = `${url}/functions/v1/document-ingest-worker`;

  await sb.storage
    .from("customer-documents")
    .upload(storagePath, new Blob([bytes], { type: "image/png" }), { contentType: "image/png" });

  await sb.from("customer_documents").insert({
    id: documentId,
    customer_id: customerId,
    storage_path: storagePath,
    mime_type: "image/png",
    original_filename: RICH_SAMPLE,
    doc_class: "policy_certificate",
    ingest_status: "uploaded",
    customer_hint_type: "insurance_policy",
    metadata_json: { byte_size: bytes.length, upload_source: "step4_verify" },
    consent_snapshot: {
      document_storage: { granted: true },
      document_analysis: { granted: true },
    },
  });

  await sb.rpc("lifeguard_request_customer_document_ingest", { p_document_id: documentId });
  const workerRes = await fetch(workerUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ document_id: documentId }),
  });
  const workerBody = await workerRes.json().catch(() => ({}));
  if (!workerRes.ok) {
    throw new Error(`worker_failed:${workerRes.status}:${JSON.stringify(workerBody)}`);
  }

  const extraction = await runDocumentPolicyExtraction({
    customerId,
    documentId,
    env: process.env,
    invokeMemory: true,
  });

  return { documentId, workerBody, extraction };
}

async function setupCustomer(label) {
  const stamp = Date.now() + Math.floor(Math.random() * 1000);
  const email = `step4-policy-${label}-${stamp}@example.com`;
  const password = `Step4Policy!${stamp}`;
  const sb = createClient(url, anonKey, { auth: { persistSession: false } });
  await sb.auth.signUp({ email, password });
  await sb.auth.signInWithPassword({ email, password });
  const authUid = (await sb.auth.getUser()).data.user?.id;
  await sb.rpc("lifeguard_bootstrap_customer_signup", {
    p_display_name: `step4-${label}`,
    p_consent_version: "2026-01-01-ko",
  });
  const { data: profile } = await sb
    .from("customer_profiles")
    .select("id, memory_version")
    .eq("user_id", authUid)
    .single();

  for (const entry of [
    { consent_type: "document_storage", consent_version: "2026-06-07-ko-doc" },
    { consent_type: "document_analysis", consent_version: "2026-06-07-ko-doc-analysis" },
    { consent_type: "insurance_data_processing", consent_version: "2026-01-01-ko" },
  ]) {
    await sb.from("customer_consents").insert({
      customer_id: profile.id,
      consent_type: entry.consent_type,
      consent_version: entry.consent_version,
      granted: true,
      granted_at: new Date().toISOString(),
      source: "step4_verify",
      purpose: "policy_extraction_verify",
      required: true,
    });
  }

  const { data: session } = await sb.auth.getSession();
  return {
    email,
    customerId: profile.id,
    accessToken: session.session.access_token,
    sb,
  };
}

async function loadCounts(admin, customerId) {
  const { count: policyCount } = await admin
    .from("profile_insurance_policies")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId)
    .is("deleted_at", null);
  const { count: memoryCount } = await admin
    .from("customer_memory_facts")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId)
    .is("superseded_at", null);
  return { policyCount: policyCount ?? 0, memoryCount: memoryCount ?? 0 };
}

async function main() {
  const samplePath = ensureRichSample();
  const bytes = readFileSync(samplePath);
  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  const reports = [];

  for (const label of ["A", "B"]) {
    const customer = await setupCustomer(label);
    const before = await loadCounts(admin, customer.customerId);
    const result = await ingestDocument(customer.sb, customer.customerId, customer.accessToken, bytes);
    const after = await loadCounts(admin, customer.customerId);

    reports.push({
      label,
      email: customer.email,
      customer_id: customer.customerId,
      document_id: result.documentId,
      chunk_count: result.extraction.chunk_count,
      ocr_text_length: result.extraction.ocr_text_length,
      extraction_json: result.extraction.extraction,
      extraction_reason: result.extraction.reason ?? null,
      profile_insurance_policies_count: after.policyCount,
      customer_memory_facts_count: after.memoryCount,
      policy_count_delta: after.policyCount - before.policyCount,
      memory_count_delta: after.memoryCount - before.memoryCount,
      policy_id: result.extraction.policy_id,
      extraction_ok: result.extraction.ok,
      worker_ingest_status: result.workerBody.ingest_status,
      memory_builder_status: result.extraction.memory_builder?.status ?? null,
    });
  }

  const pass = reports.every(
    (row) =>
      row.extraction_ok &&
      row.chunk_count > 0 &&
      row.ocr_text_length > 0 &&
      row.profile_insurance_policies_count > 0 &&
      row.customer_memory_facts_count > 0 &&
      row.policy_count_delta > 0,
  );

  console.log("=== Step 4 policy extraction verification ===");
  console.log(JSON.stringify(reports, null, 2));
  console.log("PASS:", pass);
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL:", err instanceof Error ? err.message : err);
  process.exit(1);
});
