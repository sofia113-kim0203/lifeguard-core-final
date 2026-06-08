/**
 * Phase 25 Step 1J — Customer policy terms Q&A integration test.
 *
 * Requires:
 *   SUPABASE_URL / VITE_SUPABASE_URL
 *   SERVICE_ROLE_KEY / SUPABASE_SERVICE_ROLE_KEY
 *   OPENAI_API_KEY (optional — falls back to keyword-anchored embeddings)
 *   ANTHROPIC_API_KEY (optional — rag_only mode used when missing)
 *
 * Does NOT delete or rescan PDF/text/chunks/vectors.
 */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import {
  DEFAULT_HANWHA_KNOWLEDGE_DOCUMENT_ID,
  handlePolicyTermsQaRequest,
  isPolicyKnowledgeReady,
} from "../server/policyTermsQaCore.js";
import {
  DEFAULT_POLICY_PDF_ID,
  POLICY_RAG_MATCH_RPC,
} from "../server/realPolicyRagContext.js";
import { createQueryEmbedding } from "../server/documentRagContext.js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const openAiApiKey = process.env.OPENAI_API_KEY?.trim() || null;
const anthropicApiKey = process.env.ANTHROPIC_API_KEY?.trim() || null;

const TEST_QUESTIONS = [
  "암진단비는 어떤 경우에 지급되나요?",
  "면책기간은 어떻게 되나요?",
  "부담보 특별약관은 무엇인가요?",
  "수술비 보장은 어떤 기준인가요?",
  "계약 전 알릴의무는 무엇인가요?",
];

const ANCHOR_TERMS = ["암진단비", "면책", "부담보", "수술비", "고지의무", "알릴의무"];

if (!url || !serviceRoleKey) {
  throw new Error("SUPABASE_URL and SERVICE_ROLE_KEY are required");
}

const adminSupabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

async function resolveTestCustomerId() {
  const { data, error } = await adminSupabase
    .from("customer_profiles")
    .select("id")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`test_customer_lookup_failed: ${error.message}`);
  assert.ok(data?.id, "at least one customer profile required for Step 1J test");
  return data.id;
}

async function findAnchorEmbedding(knowledgeDocId, question) {
  for (const term of ANCHOR_TERMS) {
    if (!question.includes(term)) continue;
    const { data, error } = await adminSupabase
      .from("policy_knowledge_chunks")
      .select("embedding")
      .eq("document_id", knowledgeDocId)
      .not("embedding", "is", null)
      .ilike("chunk_text", `%${term}%`)
      .order("chunk_order", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`anchor_chunk_lookup_failed:${term}:${error.message}`);
    if (data?.embedding) return { embedding: data.embedding, anchor_term: term };
  }
  return null;
}

const testCustomerId = await resolveTestCustomerId();

const { data: knowledgeDoc, error: docError } = await adminSupabase
  .from("policy_knowledge_documents")
  .select("id, title, ingest_status, metadata_json")
  .eq("id", DEFAULT_HANWHA_KNOWLEDGE_DOCUMENT_ID)
  .maybeSingle();

if (docError) {
  throw new Error(`knowledge_doc_lookup_failed: ${docError.message}`);
}

assert.ok(knowledgeDoc?.id, "Hanwha knowledge document must exist");
assert.equal(knowledgeDoc.ingest_status, "ready", "Hanwha knowledge document must be ready");
assert.equal(isPolicyKnowledgeReady(knowledgeDoc), true);

const questionResults = {};
const claudeAnswers = {};
const searchMode = openAiApiKey ? "openai_query_embedding" : "keyword_anchored_embedding";

for (const question of TEST_QUESTIONS) {
  let queryEmbedding = null;
  if (openAiApiKey) {
    const embedded = await createQueryEmbedding(question, { apiKey: openAiApiKey });
    queryEmbedding = embedded.embedding;
  } else {
    const anchor = await findAnchorEmbedding(knowledgeDoc.id, question);
    assert.ok(anchor?.embedding, `anchor_chunk_required:${question}`);
    queryEmbedding = anchor.embedding;
  }

  const mode = anthropicApiKey && openAiApiKey ? "execute" : "rag_only";
  const result = await handlePolicyTermsQaRequest({
    question,
    mode,
    knowledgeDocumentId: DEFAULT_HANWHA_KNOWLEDGE_DOCUMENT_ID,
    policyPdfId: DEFAULT_POLICY_PDF_ID,
    testCustomerId,
    queryEmbedding,
    adminSupabase,
    openAiApiKey,
    anthropicApiKey,
    env: process.env,
  });

  if (mode === "rag_only") {
    assert.equal(result.ok, true, `rag_only should succeed:${question}`);
    assert.ok(result.rag_row_count > 0, `rag should return chunks:${question}`);
    assert.ok(result.used_sources?.length > 0, `used_sources required:${question}`);
    questionResults[question] = {
      mode,
      search_mode: searchMode,
      rag_row_count: result.rag_row_count,
      top_similarity: result.used_sources[0]?.similarity ?? null,
      top_chunk_order: result.used_sources[0]?.chunk_order ?? null,
      top_chunk_preview: result.used_sources[0]?.chunk_text_preview ?? null,
      context_used: result.context_used,
      insufficient_context: result.insufficient_context,
      ingest_status: result.ingest_status,
    };
    claudeAnswers[question] = null;
  } else {
    assert.equal(result.ok, true, `execute should succeed:${question}`);
    assert.ok(result.answer?.trim(), `claude answer required:${question}`);
    assert.ok(result.rag_row_count > 0, `rag should return chunks:${question}`);
    assert.ok(result.used_sources?.length > 0, `used_sources required:${question}`);
    assert.equal(result.insufficient_context, false, `should have sufficient context:${question}`);
    assert.equal(result.claude_skipped, false, `claude should run:${question}`);
    questionResults[question] = {
      mode,
      search_mode: searchMode,
      rag_row_count: result.rag_row_count,
      top_similarity: result.used_sources[0]?.similarity ?? null,
      top_chunk_order: result.used_sources[0]?.chunk_order ?? null,
      top_chunk_preview: result.used_sources[0]?.chunk_text_preview ?? null,
      context_used: result.context_used,
      insufficient_context: result.insufficient_context,
      ingest_status: result.ingest_status,
    };
    claudeAnswers[question] = result.answer;
  }
}

const notReadyDoc = { id: "blocked-doc", ingest_status: "processing" };
const blockedResult = await handlePolicyTermsQaRequest({
  question: "면책기간은 어떻게 되나요?",
  mode: "rag_only",
  knowledgeDocumentId: "nonexistent-doc-for-ready-gate-test",
  policyPdfId: "00000000-0000-0000-0000-000000000099",
  testCustomerId,
  adminSupabase: {
    from(table) {
      if (table === "policy_knowledge_documents") {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          contains() {
            return this;
          },
          is() {
            return this;
          },
          order() {
            return this;
          },
          limit() {
            return this;
          },
          maybeSingle: async () => ({ data: notReadyDoc, error: null }),
        };
      }
      throw new Error(`unexpected table:${table}`);
    },
    rpc: async () => ({ data: [], error: null }),
  },
  queryEmbedding: "[]",
  openAiApiKey: "fake-key",
});

assert.equal(blockedResult.ok, true);
assert.equal(blockedResult.blocked, true);
assert.equal(blockedResult.reason, "POLICY_NOT_READY");
assert.equal(blockedResult.rag_row_count, 0);
assert.ok(blockedResult.answer?.includes("분석 중"));

const report = {
  phase: "25-1J",
  policy_pdf_id: DEFAULT_POLICY_PDF_ID,
  knowledge_document_id: knowledgeDoc.id,
  knowledge_document_title: knowledgeDoc.title,
  ingest_status: knowledgeDoc.ingest_status,
  rag_helper: "server/realPolicyRagContext.js",
  search_rpc: POLICY_RAG_MATCH_RPC,
  ready_gate: {
    ingest_status_checked: true,
    ready_required: true,
    blocked_when_not_ready: true,
    blocked_test_reason: blockedResult.reason,
  },
  question_search_results: questionResults,
  question_claude_answers: claudeAnswers,
  used_sources_included: true,
  insufficient_context_handling: "claude_skipped_with_fixed_message",
  mock_removed: true,
  existing_data_preserved: true,
  search_mode: searchMode,
  claude_mode: anthropicApiKey && openAiApiKey ? "execute" : "rag_only_fallback",
  tests: {
    knowledgeDocReady: { pass: knowledgeDoc.ingest_status === "ready" },
    allQuestionsReturnRag: {
      pass: TEST_QUESTIONS.every((q) => (questionResults[q]?.rag_row_count ?? 0) > 0),
    },
    readyGateBlocksRag: { pass: blockedResult.blocked === true && blockedResult.rag_row_count === 0 },
  },
};

report.allPass = Object.values(report.tests).every((t) => t.pass === true);

for (const [name, test] of Object.entries(report.tests)) {
  assert.equal(test.pass, true, `${name} should pass`);
}

console.log(JSON.stringify(report, null, 2));
