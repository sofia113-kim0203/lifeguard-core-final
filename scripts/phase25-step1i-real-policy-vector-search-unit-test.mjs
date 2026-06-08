/**
 * Phase 25 Step 1I — local unit tests for realPolicyRagContext helpers.
 */
import assert from "node:assert/strict";
import {
  formatPolicyKnowledgeContextForPrompt,
  mapPolicyKnowledgeChunks,
  POLICY_RAG_MATCH_RPC,
} from "../server/realPolicyRagContext.js";

assert.equal(POLICY_RAG_MATCH_RPC, "match_policy_knowledge_chunks");

const mapped = mapPolicyKnowledgeChunks([
  {
    id: "chunk-1",
    document_id: "doc-1",
    knowledge_document_id: "doc-1",
    document_title: "Hanwha Policy",
    chunk_order: 12,
    chunk_text: "암진단비 지급 조건",
    similarity: 0.82,
  },
]);
assert.equal(mapped.length, 1);
assert.equal(mapped[0].chunk_text, "암진단비 지급 조건");
assert.equal(mapped[0].similarity, 0.82);

const formatted = formatPolicyKnowledgeContextForPrompt(mapped);
assert.ok(formatted.includes("[P1]"));
assert.ok(formatted.includes("암진단비"));

console.log(
  JSON.stringify(
    {
      phase: "25-1I-unit",
      tests: { rpcName: true, mapChunks: true, formatContext: true },
      allPass: true,
    },
    null,
    2,
  ),
);
