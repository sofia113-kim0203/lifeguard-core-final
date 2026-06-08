/**
 * Phase 22D Step 4 — unit tests for document RAG context helpers (no Supabase).
 */
import assert from "node:assert/strict";
import {
  evaluateContextSufficiency,
  formatDocumentContextForPrompt,
  hasQueryTermOverlap,
  mapChunksToUsedSources,
} from "../server/documentRagContext.js";

const sampleChunks = [
  {
    id: "chunk-1",
    document_id: "doc-1",
    doc_title: "실손약관",
    section: "제4조",
    page: 12,
    content: "실손의료비 보장 및 암진단비 지급 기준",
    similarity: 0.71,
    chunk_index: 0,
  },
  {
    id: "chunk-2",
    document_id: "doc-2",
    doc_title: "특약",
    section: "K603",
    page: 3,
    content: "K603 골절진단특약 보험금 청구",
    similarity: 0.65,
    chunk_index: 1,
  },
];

assert.match(
  formatDocumentContextForPrompt(sampleChunks),
  /\[D1\].*실손의료비/s,
  "D1 block should include first chunk content",
);
assert.match(
  formatDocumentContextForPrompt(sampleChunks),
  /\[D2\].*K603/s,
  "D2 block should include second chunk content",
);
assert.equal(
  formatDocumentContextForPrompt([]),
  "(no customer document context retrieved)",
);

const usedSources = mapChunksToUsedSources(sampleChunks);
assert.equal(usedSources.length, 2);
assert.equal(usedSources[0].chunk_id, "chunk-1");
assert.ok(usedSources[0].content_preview.length <= 200);

assert.equal(hasQueryTermOverlap("암진단비 청구 가능해?", sampleChunks[0].content), true);
assert.equal(hasQueryTermOverlap("미국 주식 추천", sampleChunks[0].content), false);

const sufficient = evaluateContextSufficiency(sampleChunks, {
  threshold: 0.3,
  question: "실손의료비 보장 내용 알려줘",
});
assert.equal(sufficient.contextUsed, true);
assert.equal(sufficient.insufficientContext, false);

const insufficient = evaluateContextSufficiency([], { threshold: 0.3, question: "test" });
assert.equal(insufficient.insufficientContext, true);

const weakMatch = evaluateContextSufficiency(
  [{ ...sampleChunks[0], similarity: 0.31, content: "무관한 내용" }],
  { threshold: 0.3, question: "미국 주식 투자 추천" },
);
assert.equal(weakMatch.insufficientContext, true);

console.log(
  JSON.stringify(
    {
      phase: "22D-step4-unit",
      tests: 8,
      pass: true,
    },
    null,
    2,
  ),
);
