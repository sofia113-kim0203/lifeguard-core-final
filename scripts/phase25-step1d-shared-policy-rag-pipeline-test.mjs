import assert from "node:assert/strict";
import {
  registerSharedPolicyPdf,
  extractSharedPolicyText,
  generateSharedPolicyChunks,
  generateSharedPolicyEmbeddings,
  storeSharedPolicyVectors,
} from "../server/sharedPolicyRagPipeline.js";

const baseInput = {
  policy_pdf_id: "policy-hanwha-001",
  carrier_name: "한화",
  product_name: "3N5 더간편건강보험",
  product_code: "3ten55_se_2_2604",
  policy_type: "terms",
  version: "2604",
  effective_date: "2026-04-01",
  source_file_name: "3ten55_se_2(2604)_03_1.pdf",
  storage_path: "policy-pdfs/hanwha/3ten55_se_2(2604)_03_1.pdf",
  now: new Date("2026-06-08T13:00:00.000Z"),
};

const uploaded = registerSharedPolicyPdf(baseInput);
const extracted = extractSharedPolicyText(uploaded, {
  extractedText: "암진단비는 약관에서 정한 암 진단확정 시 지급합니다.\n\n유사암은 별도 보장 조건과 면책기간을 확인해야 합니다.\n\n실손 보장은 자기부담금과 보상하지 않는 사항을 확인해야 합니다.",
  now: new Date("2026-06-08T13:05:00.000Z"),
});
const chunked = generateSharedPolicyChunks(extracted, { maxChars: 60, now: new Date("2026-06-08T13:10:00.000Z") });
const blocked = await generateSharedPolicyEmbeddings(chunked, { openAiApiKey: "", now: new Date("2026-06-08T13:15:00.000Z") });
const embedded = await generateSharedPolicyEmbeddings(chunked, {
  openAiApiKey: "test-key",
  embedText: async (text, chunk) => [chunk.chunk_index, text.length, 0.1],
  now: new Date("2026-06-08T13:20:00.000Z"),
});
const searchable = await storeSharedPolicyVectors(embedded, {
  storeVector: async (embedding) => ({ chunk_id: embedding.chunk_id, vector_id: `vector-${embedding.chunk_id}`, stored: true }),
  now: new Date("2026-06-08T13:25:00.000Z"),
});

let customerRejected = false;
try {
  registerSharedPolicyPdf({ ...baseInput, customer_id: "customer-a" });
} catch {
  customerRejected = true;
}

const report = {
  phase: "25-1D",
  tests: {
    uploadedState: {
      pass: uploaded.processing_status === "uploaded" && uploaded.text_extraction_status === "pending" && uploaded.searchable === false,
      uploaded,
    },
    textExtractedState: {
      pass: extracted.processing_status === "text_extracted" && extracted.text_extraction_status === "completed" && extracted.extracted_text.includes("암진단비"),
    },
    chunkedState: {
      pass: chunked.processing_status === "chunked" && chunked.chunk_generation_status === "completed" && chunked.chunk_count === chunked.chunks.length && chunked.chunk_count >= 3,
      chunk_count: chunked.chunk_count,
    },
    missingOpenAiBlocksEmbedding: {
      pass: blocked.embedding_status === "blocked" && blocked.errors.includes("embedding_blocked_missing_openai_api_key") && blocked.processing_status === "chunked",
      blocked,
    },
    mockEmbeddingEmbedded: {
      pass: embedded.processing_status === "embedded" && embedded.embedding_status === "completed" && embedded.embedding_count === chunked.chunk_count,
      embedding_count: embedded.embedding_count,
    },
    vectorStorageSearchable: {
      pass: searchable.processing_status === "searchable" && searchable.vector_storage_status === "completed" && searchable.searchable === true && searchable.vectors.length === embedded.embedding_count,
      vector_count: searchable.vectors.length,
    },
    customerIdRejected: { pass: customerRejected },
    scopesSeparated: {
      pass: uploaded.metadata.document_scope === "shared_policy" && uploaded.metadata.customer_id == null && uploaded.metadata.visibility === "shared",
    },
    reusableMetadata: {
      pass: chunked.chunks.every((chunk) => ["claims_intelligence", "monthly_report", "rebalancing"].every((key) => chunk.metadata.reusable_for.includes(key))),
      reusable_for: chunked.chunks[0]?.metadata.reusable_for ?? [],
    },
    requiredFields: {
      pass: [
        "policy_pdf_id",
        "carrier_name",
        "product_name",
        "source_file_name",
        "processing_status",
        "text_extraction_status",
        "chunk_generation_status",
        "embedding_status",
        "vector_storage_status",
        "chunk_count",
        "embedding_count",
        "searchable",
        "errors",
        "generated_at",
      ].every((key) => Object.hasOwn(searchable, key)),
    },
  },
};
report.allPass = Object.values(report.tests).every((test) => test.pass === true);
for (const [name, test] of Object.entries(report.tests)) assert.equal(test.pass, true, `${name} should pass`);
console.log(JSON.stringify(report, null, 2));
