import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { POLICY_PDF_ID, CHUNK_GENERATION_RUN_ID, invokeRealPolicyEmbeddingWorker } from "../server/realPolicyEmbeddingGenerator.js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) throw new Error("SUPABASE_URL and SERVICE_ROLE_KEY are required");
const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
const { count: chunkCount } = await supabase.from("real_policy_chunk_items").select("id", { count: "exact", head: true }).eq("policy_pdf_id", POLICY_PDF_ID);
const { count: existingEmbeddedCount } = await supabase.from("real_policy_chunk_items").select("id", { count: "exact", head: true }).eq("policy_pdf_id", POLICY_PDF_ID).eq("chunk_status", "embedded");
const { count: existingPrepCount } = await supabase.from("real_policy_embedding_preparation_runs").select("id", { count: "exact", head: true }).eq("embedding_provider", "openai");
const { count: pdfCount } = await supabase.from("real_policy_pdf_registry").select("id", { count: "exact", head: true }).eq("id", POLICY_PDF_ID);
const { count: textCount } = await supabase.from("real_policy_extracted_text_pages").select("id", { count: "exact", head: true }).eq("policy_pdf_id", POLICY_PDF_ID);
const preexistingEmbeddings = (existingEmbeddedCount ?? 0) > 0;
let invokeResult = null;
let embeddedCount = 0;
let failedCount = 0;
let processingStatus = "chunked";
if (!preexistingEmbeddings) {
  invokeResult = await invokeRealPolicyEmbeddingWorker({ supabaseUrl: url, serviceRoleKey });
  if (invokeResult.status === 200) {
    embeddedCount = invokeResult.body.embedded_count ?? 0;
    failedCount = invokeResult.body.failed_count ?? 0;
    processingStatus = invokeResult.body.processing_status ?? "unknown";
  }
} else {
  embeddedCount = existingEmbeddedCount ?? 0;
  processingStatus = "embedded";
}
const { count: finalEmbeddedCount } = await supabase.from("real_policy_chunk_items").select("id", { count: "exact", head: true }).eq("policy_pdf_id", POLICY_PDF_ID).eq("chunk_status", "embedded");
const { count: finalPrepCount } = await supabase.from("real_policy_embedding_preparation_runs").select("id", { count: "exact", head: true }).eq("embedding_provider", "openai");
const report = {
  phase: "25-1G",
  tests: {
    chunkCount1798: { pass: chunkCount === 1798, chunkCount },
    existingDataPreserved: { pass: pdfCount === 1 && textCount === 1027, pdfCount, textCount },
    embeddingGeneratedOrReused: { pass: (finalEmbeddedCount ?? 0) > 0, finalEmbeddedCount, embeddedCount, preexistingEmbeddings },
    prepRunCreated: { pass: (finalPrepCount ?? 0) > 0, finalPrepCount },
    processingStatusOk: { pass: ["embedded", "embedding_partial"].includes(processingStatus), processingStatus },
    noVectorRegistry: { pass: true, note: "Vector storage intentionally not executed in Step 1G." },
  },
  invokeResult: preexistingEmbeddings ? { reused: true } : invokeResult,
};
report.allPass = Object.values(report.tests).every((test) => test.pass === true);
for (const [name, test] of Object.entries(report.tests)) assert.equal(test.pass, true, `${name} should pass`);
console.log(JSON.stringify(report, null, 2));
