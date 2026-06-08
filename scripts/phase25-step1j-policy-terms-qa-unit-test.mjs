/**
 * Phase 25 Step 1J — local unit tests for policyTermsQaCore helpers.
 */
import assert from "node:assert/strict";
import {
  buildPolicyTermsQaPrompt,
  DEFAULT_HANWHA_KNOWLEDGE_DOCUMENT_ID,
  findPolicyKnowledgeDocument,
  INSUFFICIENT_CONTEXT_MESSAGE,
  isPolicyKnowledgeReady,
  mapPolicyChunksForSufficiency,
  mapPolicyChunksToUsedSources,
  POLICY_NOT_READY_MESSAGE,
} from "../server/policyTermsQaCore.js";
import { evaluateContextSufficiency } from "../server/documentRagContext.js";

assert.equal(DEFAULT_HANWHA_KNOWLEDGE_DOCUMENT_ID, "bd44f29e-9330-4a2b-8d92-24c75859ca19");

assert.equal(isPolicyKnowledgeReady({ ingest_status: "ready" }), true);
assert.equal(isPolicyKnowledgeReady({ ingest_status: "processing" }), false);
assert.equal(isPolicyKnowledgeReady(null), false);

const mapped = mapPolicyChunksToUsedSources([
  {
    id: "chunk-1",
    document_id: "doc-1",
    knowledge_document_id: "doc-1",
    document_title: "Hanwha Policy",
    policy_pdf_id: "526e2e06-1729-4f95-9bda-0b410b604de2",
    chunk_order: 12,
    chunk_text: "암진단비 지급 조건에 대한 약관 조항",
    similarity: 0.82,
  },
]);
assert.equal(mapped.length, 1);
assert.equal(mapped[0].chunk_text_preview, "암진단비 지급 조건에 대한 약관 조항");
assert.equal(mapped[0].similarity, 0.82);

const evalChunks = mapPolicyChunksForSufficiency(mapped);
const sufficiency = evaluateContextSufficiency(evalChunks, {
  threshold: 0.3,
  question: "암진단비는 어떤 경우에 지급되나요?",
});
assert.equal(sufficiency.contextUsed, true);
assert.equal(sufficiency.insufficientContext, false);

const prompt = buildPolicyTermsQaPrompt("면책기간은 어떻게 되나요?", "[P1]\n면책기간 90일");
assert.ok(prompt.system.includes("policy terms"));
assert.ok(prompt.user.includes("면책기간"));

assert.ok(POLICY_NOT_READY_MESSAGE.includes("분석 중"));
assert.ok(INSUFFICIENT_CONTEXT_MESSAGE.includes("충분한 근거"));

const fakeAdmin = {
  from() {
    return {
      select() {
        return this;
      },
      eq() {
        return this;
      },
      is() {
        return this;
      },
      maybeSingle: async () => ({
        data: { id: "doc-1", ingest_status: "ready", metadata_json: {} },
        error: null,
      }),
    };
  },
};

const doc = await findPolicyKnowledgeDocument(fakeAdmin, { knowledgeDocumentId: "doc-1" });
assert.equal(doc.id, "doc-1");

console.log(
  JSON.stringify(
    {
      phase: "25-1J-unit",
      tests: {
        readyGateHelper: true,
        usedSourcesMapping: true,
        sufficiencyMapping: true,
        promptBuilder: true,
        knowledgeDocLookup: true,
      },
      allPass: true,
    },
    null,
    2,
  ),
);
