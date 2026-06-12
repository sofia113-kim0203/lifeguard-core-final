/**
 * Step 3 — document-ingest-worker / CLOVA OCR live verification (generic new customer).
 * Usage: node scripts/step3-document-ingest-ocr-verify.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import {
  assertBeforeTestSignUp,
  assertSafeTestScriptExecution,
  loadEnvLocal,
} from "./lib/productionSafetyGuard.mjs";

const SCRIPT_NAME = "step3-document-ingest-ocr-verify";

loadEnvLocal();
assertSafeTestScriptExecution({ scriptName: SCRIPT_NAME, createsTestAccount: true });

const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceRoleKey) {
  console.error("BLOCKER: missing Supabase URL, anon key, or service role key");
  process.exit(1);
}

const SAMPLES_DIR = join(import.meta.dirname, "samples/korean-insurance");
const SAMPLE_FILE = "ko-insurance-terms-1.png";

function ensureSampleImage() {
  const samplePath = join(SAMPLES_DIR, SAMPLE_FILE);
  if (existsSync(samplePath)) return samplePath;
  const gen = spawnSync("python", [join(import.meta.dirname, "korean-insurance-image-gen.py")], {
    stdio: "inherit",
    shell: true,
  });
  if (gen.status !== 0 || !existsSync(samplePath)) {
    throw new Error(`sample_image_missing: ${samplePath}`);
  }
  return samplePath;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollDocument(admin, documentId, maxAttempts = 30) {
  const timeline = [];
  for (let i = 0; i < maxAttempts; i += 1) {
    const { data, error } = await admin
      .from("customer_documents")
      .select("ingest_status, error_message, metadata_json, page_count, document_type, updated_at")
      .eq("id", documentId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const status = data?.ingest_status ?? "unknown";
    if (!timeline.length || timeline.at(-1).status !== status) {
      timeline.push({ status, at: data?.updated_at ?? new Date().toISOString() });
    }
    if (status === "ready" || status === "failed") {
      return { doc: data, timeline };
    }
    await sleep(2000);
  }
  const { data } = await admin
    .from("customer_documents")
    .select("ingest_status, error_message, metadata_json, page_count, document_type, updated_at")
    .eq("id", documentId)
    .maybeSingle();
  timeline.push({ status: data?.ingest_status ?? "timeout", at: data?.updated_at ?? null });
  return { doc: data, timeline };
}

async function main() {
  const stamp = Date.now();
  const email = `step3-ingest-ocr-${stamp}@example.com`;
  const password = `Step3Ocr!${stamp}`;
  const sb = createClient(url, anonKey, { auth: { persistSession: false } });
  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

  const report = {
    email,
    customerId: null,
    documentId: null,
    rpcResult: null,
    workerCalled: false,
    workerStatus: null,
    workerBody: null,
    ingestStatusTimeline: [],
    finalIngestStatus: null,
    errorMessage: null,
    traceCount: 0,
    traceRows: [],
    chunkCount: 0,
    ocrTextLength: 0,
    ocrPreview: null,
    clovaEnvOnEdge: "unknown (edge secrets not readable from client)",
    storageDownloadOk: null,
    nextFixNeeded: null,
  };

  console.log("=== Step 3 ingest/OCR verification ===");
  console.log(`test_email: ${email}`);

  const samplePath = ensureSampleImage();
  const bytes = readFileSync(samplePath);

  assertBeforeTestSignUp(email, SCRIPT_NAME);
  const signUp = await sb.auth.signUp({ email, password });
  if (signUp.error) throw new Error(`signup_failed: ${signUp.error.message}`);

  const signIn = await sb.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`signin_failed: ${signIn.error.message}`);

  const authUid = (await sb.auth.getUser()).data.user?.id;
  if (!authUid) throw new Error("auth_uid_missing");

  await sb.rpc("lifeguard_bootstrap_customer_signup", {
    p_display_name: "step3-ingest-ocr",
    p_consent_version: "2026-01-01-ko",
  });

  const { data: profile, error: profileError } = await sb
    .from("customer_profiles")
    .select("id")
    .eq("user_id", authUid)
    .single();
  if (profileError || !profile?.id) throw new Error("customer_profile_missing");

  report.customerId = profile.id;

  const consentBase = {
    customer_id: profile.id,
    consent_version: "2026-06-07-ko-doc",
    granted: true,
    granted_at: new Date().toISOString(),
    source: "step3_verify",
    purpose: "ingest_ocr_verify",
    required: true,
  };
  for (const consentType of ["document_storage", "document_analysis"]) {
    const { error: consentError } = await sb
      .from("customer_consents")
      .insert({ ...consentBase, consent_type: consentType });
    if (consentError) throw new Error(`consent_insert_failed:${consentType}:${consentError.message}`);
  }

  const documentId = crypto.randomUUID();
  report.documentId = documentId;
  const storagePath = `${profile.id}/${documentId}/document-${documentId}.png`;

  const uploadRes = await sb.storage
    .from("customer-documents")
    .upload(storagePath, new Blob([bytes], { type: "image/png" }), { contentType: "image/png" });
  if (uploadRes.error) throw new Error(`storage_upload_failed: ${uploadRes.error.message}`);
  report.storageDownloadOk = true;

  const { error: insertError } = await sb.from("customer_documents").insert({
    id: documentId,
    customer_id: profile.id,
    storage_path: storagePath,
    mime_type: "image/png",
    original_filename: SAMPLE_FILE,
    doc_class: "policy_certificate",
    ingest_status: "uploaded",
    customer_hint_type: "insurance_policy",
    metadata_json: { byte_size: bytes.length, upload_source: "step3_verify" },
    consent_snapshot: {
      document_storage: { granted: true, consent_version: "2026-06-07-ko-doc" },
      document_analysis: { granted: true, consent_version: "2026-06-07-ko-doc-analysis" },
    },
  });
  if (insertError) throw new Error(`document_insert_failed: ${insertError.message}`);

  const { data: rpcData, error: rpcError } = await sb.rpc(
    "lifeguard_request_customer_document_ingest",
    { p_document_id: documentId },
  );
  if (rpcError) throw new Error(`rpc_failed: ${rpcError.message}`);
  report.rpcResult = rpcData;

  const { data: sessionData } = await sb.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error("access_token_missing");

  const workerUrl = `${url}/functions/v1/document-ingest-worker`;
  const workerRes = await fetch(workerUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ document_id: documentId }),
  });

  report.workerCalled = true;
  report.workerStatus = workerRes.status;
  const workerText = await workerRes.text();
  try {
    report.workerBody = JSON.parse(workerText);
  } catch {
    report.workerBody = { raw: workerText.slice(0, 2000) };
  }

  const polled = await pollDocument(admin, documentId);
  report.ingestStatusTimeline = [
    { status: "uploaded", at: "insert" },
    ...(report.rpcResult?.ingest_status
      ? [{ status: report.rpcResult.ingest_status, at: "rpc" }]
      : []),
    ...polled.timeline,
  ];
  report.finalIngestStatus = polled.doc?.ingest_status ?? null;
  report.errorMessage = polled.doc?.error_message ?? report.workerBody?.message ?? null;

  const { data: traces } = await admin
    .from("document_ingest_traces")
    .select("id, status, error_code, chunk_count, ocr_confidence_avg, steps_json, created_at, completed_at")
    .eq("document_id", documentId)
    .order("created_at", { ascending: false });
  report.traceCount = traces?.length ?? 0;
  report.traceRows = traces ?? [];

  const { data: chunks, count: chunkCount, error: chunkError } = await admin
    .from("customer_document_chunks")
    .select("id, chunk_index, content, metadata, embedding_model", { count: "exact" })
    .eq("document_id", documentId)
    .is("deleted_at", null)
    .order("chunk_index", { ascending: true });
  if (chunkError) {
    report.chunkQueryError = chunkError.message;
  }

  report.chunkCount = chunkCount ?? chunks?.length ?? 0;
  const fullText = (chunks ?? []).map((c) => c.content ?? "").join("\n").trim();
  report.ocrTextLength = fullText.length;
  report.ocrPreview = fullText ? fullText.slice(0, 400) : null;

  const ocrProvider =
    chunks?.[0]?.metadata?.ocr_provider ?? polled.doc?.metadata_json?.ocr_provider ?? null;
  const clovaFromTrace = traces?.[0]?.steps_json?.ocr_provider ?? null;

  report.nextFixNeeded =
    report.finalIngestStatus === "ready" && report.chunkCount > 0
      ? "no — OCR/chunk pipeline OK; proceed to step 4 (policy/memory extraction)"
      : report.errorMessage?.includes("clova_not_configured")
        ? "yes — set CLOVA_OCR_API_URL and CLOVA_OCR_SECRET_KEY on document-ingest-worker edge function"
        : report.errorMessage?.includes("worker_not_configured")
          ? "yes — edge function missing SUPABASE_SERVICE_ROLE_KEY / anon key"
          : report.workerStatus === 409
            ? "yes — document not queued before worker call; check RPC ingest_status transition"
            : "yes — investigate failure from error_message / trace / worker body";

  console.log("\n--- REPORT ---");
  console.log("1. document_id:", report.documentId);
  console.log("2. ingest_status_timeline:", JSON.stringify(report.ingestStatusTimeline, null, 2));
  console.log("3. worker_called:", report.workerCalled, "status:", report.workerStatus);
  console.log("   worker_body:", JSON.stringify(report.workerBody, null, 2));
  console.log("4. rpc_result:", JSON.stringify(report.rpcResult, null, 2));
  console.log("5. CLOVA OCR status:", {
    ocr_provider: ocrProvider ?? clovaFromTrace,
    worker_ocr_provider: report.workerBody?.ocr_provider ?? null,
    trace_ocr_confidence: traces?.[0]?.ocr_confidence_avg ?? null,
  });
  console.log("6. OCR text length:", report.ocrTextLength);
  console.log("7. customer_document_chunks count:", report.chunkCount);
  console.log("8. final ingest_status:", report.finalIngestStatus);
  if (report.errorMessage) console.log("9. failure error_message:", report.errorMessage);
  if (report.traceRows.length) {
    console.log("10. document_ingest_traces:", JSON.stringify(report.traceRows, null, 2));
  }
  if (report.ocrPreview) console.log("11. OCR preview:", report.ocrPreview);
  console.log("12. next_fix_needed:", report.nextFixNeeded);

  const pass =
    report.finalIngestStatus === "ready" &&
    report.chunkCount > 0 &&
    report.ocrTextLength > 0 &&
    report.workerStatus === 200;

  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL:", err instanceof Error ? err.message : err);
  process.exit(1);
});
