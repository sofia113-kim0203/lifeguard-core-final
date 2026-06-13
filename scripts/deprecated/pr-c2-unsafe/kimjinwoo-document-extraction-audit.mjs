/**
 * Audit 김진우.jpg upload — OCR, chunks, insurance extraction, policies, memory facts.
 * Usage: node scripts/kimjinwoo-document-extraction-audit.mjs
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const ENV_LOCAL = ".env.local";
const FILENAME_PATTERN = process.env.AUDIT_FILENAME ?? "김진우.jpg";

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
const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error("BLOCKER: missing Supabase credentials");
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

const { data: docs, error: docsError } = await admin
  .from("customer_documents")
  .select(
    "id, customer_id, original_filename, mime_type, ingest_status, document_type, doc_class, page_count, storage_path, metadata_json, error_message, created_at, updated_at, deleted_at"
  )
  .ilike("original_filename", `%${FILENAME_PATTERN.replace(/\.jpg$/i, "")}%`)
  .order("created_at", { ascending: false })
  .limit(10);

if (docsError) throw new Error(docsError.message);

const doc = (docs ?? []).find((d) => !d.deleted_at) ?? docs?.[0] ?? null;
if (!doc) {
  console.error(`BLOCKER: no document matching filename pattern: ${FILENAME_PATTERN}`);
  console.log("Recent documents (any name):");
  const { data: recent } = await admin
    .from("customer_documents")
    .select("id, customer_id, original_filename, ingest_status, created_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(15);
  for (const row of recent ?? []) {
    console.log(`  ${row.original_filename} | ${row.id} | ${row.ingest_status} | ${row.created_at}`);
  }
  process.exit(1);
}

const customerId = doc.customer_id;

const { data: profile } = await admin
  .from("customer_profiles")
  .select("id, display_name, memory_version, user_id")
  .eq("id", customerId)
  .maybeSingle();

const { data: pubUser } = profile?.user_id
  ? await admin.from("users").select("email").eq("id", profile.user_id).maybeSingle()
  : { data: null };

const { data: consents } = await admin
  .from("customer_consents")
  .select("consent_type, granted, consent_version, created_at")
  .eq("customer_id", customerId);

const { data: allCustomerDocs } = await admin
  .from("customer_documents")
  .select("id, original_filename, ingest_status, created_at")
  .eq("customer_id", customerId)
  .is("deleted_at", null)
  .order("created_at", { ascending: false });

const { data: chunks } = await admin
  .from("customer_document_chunks")
  .select("id, chunk_index, content, page, metadata, embedding_model")
  .eq("document_id", doc.id)
  .order("chunk_index", { ascending: true });

const { data: traces } = await admin
  .from("document_ingest_traces")
  .select("*")
  .eq("document_id", doc.id)
  .order("started_at", { ascending: false })
  .limit(3);

const { count: policiesCount } = await admin
  .from("profile_insurance_policies")
  .select("id", { count: "exact", head: true })
  .eq("customer_id", customerId);

const { data: policies } = await admin
  .from("profile_insurance_policies")
  .select("*")
  .eq("customer_id", customerId)
  .order("created_at", { ascending: false })
  .limit(20);

const { count: memoryFactsCount } = await admin
  .from("customer_memory_facts")
  .select("id", { count: "exact", head: true })
  .eq("customer_id", customerId);

const { data: memoryFacts } = await admin
  .from("customer_memory_facts")
  .select("id, fact_key, fact_value, fact_type, source_table, source_id, metadata_json, created_at")
  .eq("customer_id", customerId)
  .order("created_at", { ascending: false })
  .limit(50);

const { data: workerJobs } = await admin
  .from("worker_jobs")
  .select("id, job_type, status, payload_json, result_json, error_message, created_at")
  .eq("customer_id", customerId)
  .order("created_at", { ascending: false })
  .limit(10);

const ocrLines = (chunks ?? [])
  .map((c) => c.content ?? "")
  .join("\n")
  .split(/\r?\n/);

const metadata = doc.metadata_json ?? {};
const insuranceExtraction =
  metadata.insurance_extraction ??
  metadata.policy_extraction ??
  metadata.extracted_insurance ??
  metadata.policy_knowledge_pipeline ??
  metadata.extraction_result ??
  null;

console.log("=== 김진우.jpg Document Extraction Audit ===\n");

console.log("--- customer context ---");
console.log(JSON.stringify({
  customer_id: customerId,
  display_name: profile?.display_name ?? null,
  email: pubUser?.email ?? null,
  memory_version: profile?.memory_version ?? null,
  consents: consents ?? [],
  all_documents: allCustomerDocs ?? [],
}, null, 2));

console.log("\n--- 1. document id ---");
console.log(JSON.stringify({
  document_id: doc.id,
  original_filename: doc.original_filename,
  customer_id: customerId,
  display_name: profile?.display_name ?? null,
  ingest_status: doc.ingest_status,
  document_type: doc.document_type,
  doc_class: doc.doc_class,
  page_count: doc.page_count,
  created_at: doc.created_at,
  error_message: doc.error_message,
}, null, 2));

console.log("\n--- 2. OCR 원문 (customer_document_chunks.content, line-by-line) ---");
console.log(`total_lines: ${ocrLines.length}`);
console.log(`total_chunks: ${chunks?.length ?? 0}`);
console.log("--- OCR START ---");
for (let i = 0; i < ocrLines.length; i++) {
  console.log(`${String(i + 1).padStart(3, "0")}|${ocrLines[i]}`);
}
console.log("--- OCR END ---");

console.log("\n--- 3. customer_document_chunks count ---");
console.log(chunks?.length ?? 0);

console.log("\n--- 4. insurance extraction result JSON ---");
console.log(JSON.stringify({
  metadata_json_full: metadata,
  insurance_extraction_candidate: insuranceExtraction,
  document_ingest_traces: traces ?? [],
}, null, 2));

console.log("\n--- 5. profile_insurance_policies ---");
console.log(JSON.stringify({ count: policiesCount, rows: policies ?? [] }, null, 2));

console.log("\n--- 6. customer_memory_facts ---");
console.log(JSON.stringify({ count: memoryFactsCount, rows: memoryFacts ?? [] }, null, 2));

console.log("\n--- extractor fields found (from metadata + chunks metadata) ---");
const chunkMeta = (chunks ?? []).map((c) => c.metadata).filter(Boolean);
console.log(JSON.stringify({
  classified_document_type: metadata.classified_document_type ?? doc.document_type,
  extraction_route: metadata.extraction_route,
  ocr_provider: metadata.ocr_provider,
  ocr_confidence_avg: metadata.ocr_confidence_avg,
  chunk_count_metadata: metadata.chunk_count,
  category_key: metadata.category_key,
  policy_knowledge_pipeline: metadata.policy_knowledge_pipeline ?? null,
  chunk_metadata_samples: chunkMeta.slice(0, 3),
}, null, 2));

console.log("\n--- worker_jobs (recent) ---");
console.log(JSON.stringify(workerJobs ?? [], null, 2));

const outDir = join("scripts", "backups");
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outPath = join(outDir, `kimjinwoo-ocr-audit-${stamp}.txt`);
writeFileSync(
  outPath,
  ocrLines.map((line, i) => `${String(i + 1).padStart(3, "0")}|${line}`).join("\n"),
  "utf8"
);
console.log(`\nOCR full text saved: ${outPath}`);
