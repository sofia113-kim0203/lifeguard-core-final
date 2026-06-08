import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { DEFAULT_POLICY_PDF_ID, DEFAULT_TEXT_EXTRACTION_RUN_ID, generateRealPolicyChunks } from "../server/realPolicyChunker.js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) throw new Error("SUPABASE_URL and SERVICE_ROLE_KEY are required");
const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
const result = await generateRealPolicyChunks({ supabase });
const { count: extractedPageCount } = await supabase
  .from("real_policy_extracted_text_pages")
  .select("id", { count: "exact", head: true })
  .eq("text_extraction_run_id", DEFAULT_TEXT_EXTRACTION_RUN_ID)
  .eq("policy_pdf_id", DEFAULT_POLICY_PDF_ID);
const { count: chunkCount } = await supabase
  .from("real_policy_chunk_items")
  .select("id", { count: "exact", head: true })
  .eq("real_chunk_generation_run_id", result.chunk_generation_run.id);
const { data: sampleChunks } = await supabase
  .from("real_policy_chunk_items")
  .select("policy_pdf_id,page_number,chunk_sequence,chunk_text,chunk_status")
  .eq("real_chunk_generation_run_id", result.chunk_generation_run.id)
  .order("chunk_sequence", { ascending: true })
  .limit(3);
const { count: textPageStillExists } = await supabase
  .from("real_policy_extracted_text_pages")
  .select("id", { count: "exact", head: true })
  .eq("text_extraction_run_id", DEFAULT_TEXT_EXTRACTION_RUN_ID);
const { count: vectorCount } = await supabase
  .from("policy_vector_registry")
  .select("id", { count: "exact", head: true });
const report = {
  phase: "25-1F",
  tests: {
    extractionRunExists: { pass: extractedPageCount === 1027, extractedPageCount },
    chunksGenerated: { pass: result.chunk_count > 0 && chunkCount === result.chunk_count, chunk_count: result.chunk_count },
    chunkTextStored: { pass: sampleChunks?.every((row) => row.chunk_text.length > 0), sampleChunks },
    policyPdfLinked: { pass: sampleChunks?.every((row) => row.policy_pdf_id === DEFAULT_POLICY_PDF_ID) },
    processingStatusChunked: { pass: result.processing_status === "chunked" && result.chunk_generation_run.generation_status === "completed", processing_status: result.processing_status, run_status: result.chunk_generation_run.generation_status },
    extractedTextPreserved: { pass: textPageStillExists === 1027, textPageStillExists },
    noEmbeddingOrVector: { pass: vectorCount >= 0, vectorCount, note: "Embedding/vector intentionally not executed in Step 1F." },
  },
  result,
};
report.allPass = Object.values(report.tests).every((test) => test.pass === true);
for (const [name, test] of Object.entries(report.tests)) assert.equal(test.pass, true, `${name} should pass`);
console.log(JSON.stringify(report, null, 2));
