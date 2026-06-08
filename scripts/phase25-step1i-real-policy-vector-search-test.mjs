/**
 * Phase 25 Step 1I — Real policy vector search over policy_knowledge_chunks.
 *
 * Requires:
 *   SUPABASE_URL / VITE_SUPABASE_URL
 *   SERVICE_ROLE_KEY / SUPABASE_SERVICE_ROLE_KEY
 *   OPENAI_API_KEY (for query embeddings on Korean search terms)
 *
 * Does NOT delete or rescan PDF/text/chunks. Count + sample search only.
 */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import {
  DEFAULT_POLICY_PDF_ID,
  POLICY_RAG_MATCH_RPC,
  retrievePolicyKnowledgeChunks,
  searchPolicyKnowledgeByQuery,
} from "../server/realPolicyRagContext.js";
import { createQueryEmbedding } from "../server/documentRagContext.js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const openAiApiKey = process.env.OPENAI_API_KEY?.trim() || null;

const SEARCH_QUERIES = ["암진단비", "면책", "부담보", "수술비", "고지의무"];
const EXPECTED_APPROX_VECTORS = 1798;
const THRESHOLD = 0.25;

if (!url || !serviceRoleKey) {
  throw new Error("SUPABASE_URL and SERVICE_ROLE_KEY are required");
}

const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

async function countRows(table, filters = []) {
  let query = supabase.from(table).select("id", { count: "exact", head: true });
  for (const [col, val] of filters) {
    query = query.eq(col, val);
  }
  const { count, error } = await query;
  if (error) throw new Error(`${table}_count_failed: ${error.message}`);
  return count ?? 0;
}

async function findKnowledgeDocumentForPolicyPdf(policyPdfId) {
  const { data, error } = await supabase
    .from("policy_knowledge_documents")
    .select("id, title, ingest_status, metadata_json, storage_path, document_type")
    .eq("ingest_status", "ready")
    .contains("metadata_json", { policy_pdf_id: policyPdfId })
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) throw new Error(`knowledge_doc_lookup_failed: ${error.message}`);

  const rows = data ?? [];
  const exact = rows.find(
    (row) => String(row.metadata_json?.policy_pdf_id ?? "") === policyPdfId,
  );
  if (exact) return exact;

  const { data: fallback, error: fbError } = await supabase
    .from("policy_knowledge_documents")
    .select("id, title, ingest_status, metadata_json, storage_path, document_type")
    .eq("ingest_status", "ready")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1);

  if (fbError) throw new Error(`knowledge_doc_fallback_failed: ${fbError.message}`);
  return fallback?.[0] ?? null;
}

async function verifyReadyGate(knowledgeDocId, sampleEmbedding) {
  const { data: blocked, error: blockedError } = await supabase.rpc(POLICY_RAG_MATCH_RPC, {
    p_query_embedding: sampleEmbedding,
    p_knowledge_document_id: knowledgeDocId,
    p_policy_pdf_id: null,
    p_carrier_id: null,
    p_product_id: null,
    p_match_threshold: 0.0,
    p_match_count: 1,
  });
  if (blockedError) throw new Error(`ready_search_failed: ${blockedError.message}`);

  const { data: docRow, error: docError } = await supabase
    .from("policy_knowledge_documents")
    .select("ingest_status")
    .eq("id", knowledgeDocId)
    .maybeSingle();
  if (docError) throw new Error(`doc_status_failed: ${docError.message}`);

  return {
    ingest_status: docRow?.ingest_status ?? null,
    ready_results: Array.isArray(blocked) ? blocked.length : 0,
    gate_pass: docRow?.ingest_status === "ready" && (blocked?.length ?? 0) > 0,
  };
}

async function findAnchorChunk(knowledgeDocId, query) {
  const { data, error } = await supabase
    .from("policy_knowledge_chunks")
    .select("id, chunk_order, chunk_text, embedding")
    .eq("document_id", knowledgeDocId)
    .not("embedding", "is", null)
    .ilike("chunk_text", `%${query}%`)
    .order("chunk_order", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`anchor_chunk_lookup_failed:${query}:${error.message}`);
  return data ?? null;
}

async function runSearchQueries(policyPdfId, knowledgeDocId) {
  const results = {};
  const searchMode = openAiApiKey ? "openai_query_embedding" : "keyword_anchored_embedding";

  for (const query of SEARCH_QUERIES) {
    let chunks;
    if (openAiApiKey) {
      const search = await searchPolicyKnowledgeByQuery(supabase, {
        query,
        apiKey: openAiApiKey,
        policyPdfId,
        knowledgeDocumentId: knowledgeDocId,
        topK: 5,
        threshold: THRESHOLD,
      });
      chunks = search.chunks;
    } else {
      const anchor = await findAnchorChunk(knowledgeDocId, query);
      assert.ok(anchor?.embedding, `anchor_chunk_required:${query}`);
      chunks = await retrievePolicyKnowledgeChunks(supabase, {
        queryEmbedding: anchor.embedding,
        knowledgeDocumentId: knowledgeDocId,
        policyPdfId,
        topK: 5,
        threshold: THRESHOLD,
      });
    }

    results[query] = {
      search_mode: searchMode,
      result_count: chunks.length,
      top_similarity: chunks[0]?.similarity ?? null,
      sample_chunk_order: chunks[0]?.chunk_order ?? null,
      sample_preview: chunks[0]?.chunk_text?.slice(0, 120) ?? null,
      query_term_in_top_preview: (chunks[0]?.chunk_text ?? "").includes(query),
    };
    assert.ok(chunks.length > 0, `search_should_return_results:${query}`);
  }

  return { skipped: false, search_mode: searchMode, queries: results };
}

const vectorCount = await countRows("policy_knowledge_chunks");
const embeddedCount = await countRows("policy_knowledge_chunks", [
  ["embedding_model", "text-embedding-3-small"],
]);
const knowledgeDoc = await findKnowledgeDocumentForPolicyPdf(DEFAULT_POLICY_PDF_ID);

assert.ok(vectorCount > 0, "policy_knowledge_chunks must contain vectors");
assert.ok(knowledgeDoc?.id, "ready policy_knowledge_documents row required");

let sampleEmbedding = null;
if (openAiApiKey) {
  const embedded = await createQueryEmbedding("약관", { apiKey: openAiApiKey });
  sampleEmbedding = embedded.embedding;
} else {
  const { data: sampleChunk, error: sampleError } = await supabase
    .from("policy_knowledge_chunks")
    .select("embedding")
    .eq("document_id", knowledgeDoc.id)
    .not("embedding", "is", null)
    .limit(1)
    .maybeSingle();
  if (sampleError) throw new Error(`sample_chunk_failed: ${sampleError.message}`);
  assert.ok(sampleChunk?.embedding, "sample chunk embedding required for gate test");
  sampleEmbedding = sampleChunk.embedding;
}

const readyGate = await verifyReadyGate(knowledgeDoc.id, sampleEmbedding);
assert.equal(readyGate.gate_pass, true, "ready gate should allow search on ready document");

const queryResults = await runSearchQueries(DEFAULT_POLICY_PDF_ID, knowledgeDoc.id);

const report = {
  phase: "25-1I",
  policy_pdf_id: DEFAULT_POLICY_PDF_ID,
  knowledge_document_id: knowledgeDoc.id,
  knowledge_document_title: knowledgeDoc.title,
  ingest_status: knowledgeDoc.ingest_status,
  search_target_table: "policy_knowledge_chunks",
  search_rpc: POLICY_RAG_MATCH_RPC,
  vector_count: vectorCount,
  embedded_model_count: embeddedCount,
  expected_approx_vectors: EXPECTED_APPROX_VECTORS,
  ready_gate: readyGate,
  search_queries: queryResults,
  mock_used: false,
  existing_data_preserved: true,
  tests: {
    vectorsPresent: { pass: vectorCount >= EXPECTED_APPROX_VECTORS * 0.9, vectorCount },
    knowledgeDocReady: {
      pass: knowledgeDoc.ingest_status === "ready",
      ingest_status: knowledgeDoc.ingest_status,
    },
    readyGateAllowsSearch: { pass: readyGate.gate_pass, readyGate },
    allSearchQueriesReturnResults: {
      pass: SEARCH_QUERIES.every((q) => (queryResults.queries[q]?.result_count ?? 0) > 0),
      queryResults,
    },
  },
};

report.allPass = Object.values(report.tests).every((t) => t.pass === true);

for (const [name, test] of Object.entries(report.tests)) {
  assert.equal(test.pass, true, `${name} should pass`);
}

console.log(JSON.stringify(report, null, 2));
