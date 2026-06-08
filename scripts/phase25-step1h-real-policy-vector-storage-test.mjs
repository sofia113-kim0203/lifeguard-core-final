import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { POLICY_PDF_ID, invokeRealPolicyVectorStoreWorker } from "../server/realPolicyVectorStore.js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) throw new Error("SUPABASE_URL and SERVICE_ROLE_KEY are required");
const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
const { count: approvedChunkCount } = await supabase.from("real_policy_chunk_items").select("id", { count: "exact", head: true }).eq("policy_pdf_id", POLICY_PDF_ID).eq("chunk_status", "approved");
const { count: existingVectorCount } = await supabase.from("policy_knowledge_chunks").select("id", { count: "exact", head: true });
const { count: pdfCount } = await supabase.from("real_policy_pdf_registry").select("id", { count: "exact", head: true }).eq("id", POLICY_PDF_ID);
const { count: textCount } = await supabase.from("real_policy_extracted_text_pages").select("id", { count: "exact", head: true }).eq("policy_pdf_id", POLICY_PDF_ID);
let knowledgeDocId = null;
let storedCount = 0;
let failedCount = 0;
const preexisting = (existingVectorCount ?? 0) > 0;
if (!preexisting) {
  const firstBatch = await invokeRealPolicyVectorStoreWorker({ supabaseUrl: url, serviceRoleKey, policyPdfId: POLICY_PDF_ID, chunkOffset: 0, chunkLimit: 1 });
  if (firstBatch.status !== 200) throw new Error(`worker_failed: ${JSON.stringify(firstBatch.body)}`);
  knowledgeDocId = firstBatch.body.knowledge_doc_id;
  storedCount = firstBatch.body.stored_count ?? 0;
  failedCount = firstBatch.body.failed_count ?? 0;
} else {
  const { data: docRow } = await supabase.from("policy_knowledge_documents").select("id").order("created_at", { ascending: false }).limit(1).single();
  knowledgeDocId = docRow?.id;
  storedCount = existingVectorCount ?? 0;
}
const { count: finalVectorCount } = await supabase.from("policy_knowledge_chunks").select("id", { count: "exact", head: true });
const { data: sampleVectors } = await supabase.from("policy_knowledge_chunks").select("id, chunk_order, chunk_text, embedding_model").order("chunk_order", { ascending: true }).limit(2);
const report = {
  phase: "25-1H-sample",
  tests: {
    approvedChunks1798: { pass: (approvedChunkCount ?? 0) === 1798, approvedChunkCount },
    existingDataPreserved: { pass: pdfCount === 1 && textCount === 1027, pdfCount, textCount },
    vectorRowsStored: { pass: (finalVectorCount ?? 0) > 0, finalVectorCount, storedCount, preexisting },
    knowledgeDocCreated: { pass: !!knowledgeDocId, knowledgeDocId },
    sampleVectorHasEmbeddingModel: { pass: sampleVectors?.every((v) => v.embedding_model === "text-embedding-3-small") ?? false, sampleVectors },
    noRagSearch: { pass: true, note: "RAG search intentionally not executed in Step 1H." },
  },
  knowledgeDocId,
};
report.allPass = Object.values(report.tests).every((test) => test.pass === true);
for (const [name, test] of Object.entries(report.tests)) assert.equal(test.pass, true, `${name} should pass`);
console.log(JSON.stringify(report, null, 2));
