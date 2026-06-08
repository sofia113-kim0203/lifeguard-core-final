/**
 * Phase 25 Step 2A-P0 — Customer upload → policy knowledge auto pipeline.
 *
 * Verifies Hanwha policy PDFs bridge from customer_documents to policy_knowledge_documents.
 * Preserves existing registry rows, vectors, and customer documents.
 */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import {
  isPolicyCustomerDocument,
  getPipelineStatus,
  runCustomerPolicyKnowledgeAutoPipeline,
  processCustomerPolicyDocument,
} from "../server/customerPolicyKnowledgePipeline.js";
import { inferHanwhaPolicyMetadataFromFilename } from "../server/hanwhaPolicyMetadataInference.js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) throw new Error("SUPABASE_URL and SERVICE_ROLE_KEY are required");

const HANWHA_TARGET_FILES = [
  "3ten55_se_2(2604)_03_2.pdf",
  "3ten55_yeon(2604)_03_1.pdf",
  "3ten55_yeon(2604)_03_2.pdf",
  "100cancer(2604)_03.pdf",
  "311_yeon(2604)_03_1.pdf",
  "311_yeon(2604)_03_2.pdf",
  "DRIVER(2604)_03.pdf",
  "directmedical2605_03.pdf",
  "directsilson_conver2605_03.pdf",
];

const EXISTING_READY_FILE = "3ten55_se_2(2604)_03_1.pdf";
const EXISTING_POLICY_PDF_ID = "526e2e06-1729-4f95-9bda-0b410b604de2";
const EXISTING_KNOWLEDGE_DOC_ID = "bd44f29e-9330-4a2b-8d92-24c75859ca19";

const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

async function countRows(table, filters = []) {
  let query = supabase.from(table).select("id", { count: "exact", head: true });
  for (const [col, val] of filters) query = query.eq(col, val);
  const { count, error } = await query;
  if (error) throw new Error(`${table}_count_failed: ${error.message}`);
  return count ?? 0;
}

const baseline = {
  registryCount: await countRows("real_policy_pdf_registry"),
  knowledgeCount: await countRows("policy_knowledge_documents"),
  vectorCount: await countRows("policy_knowledge_chunks"),
  customerDocCount: await countRows("customer_documents"),
};

const { data: targetDocs } = await supabase
  .from("customer_documents")
  .select("id, original_filename, doc_class, customer_hint_type, mime_type, metadata_json, deleted_at")
  .in("original_filename", [...HANWHA_TARGET_FILES, EXISTING_READY_FILE])
  .is("deleted_at", null);

assert.equal(targetDocs?.length, 10, "expected 10 Hanwha customer documents including existing ready file");

for (const doc of targetDocs ?? []) {
  assert.equal(isPolicyCustomerDocument(doc), true, `${doc.original_filename} should be policy type`);
}

for (const filename of HANWHA_TARGET_FILES) {
  const metadata = inferHanwhaPolicyMetadataFromFilename(filename);
  assert.equal(metadata.carrier_name, "한화손해보험");
  assert.equal(metadata.source_file_name, filename);
}

const { data: claimDocs } = await supabase
  .from("customer_documents")
  .select("id, doc_class, customer_hint_type, mime_type, deleted_at")
  .in("doc_class", ["claim", "medical", "other"])
  .eq("mime_type", "application/pdf")
  .is("deleted_at", null)
  .limit(5);

for (const doc of claimDocs ?? []) {
  assert.equal(isPolicyCustomerDocument(doc), false, "claim/medical/other must not enter policy pipeline");
}

const existingLink = await processCustomerPolicyDocument({
  supabase,
  supabaseUrl: url,
  serviceRoleKey,
  customerDocumentId: "7a897bce-c8dd-4ca9-b6bb-1d17945c6002",
});
assert.equal(existingLink.pipeline_status, "ready", "existing Hanwha PDF should link to ready knowledge");

const dryRun = await runCustomerPolicyKnowledgeAutoPipeline({
  supabase,
  supabaseUrl: url,
  serviceRoleKey,
  filenames: HANWHA_TARGET_FILES,
  dryRun: true,
});
assert.equal(dryRun.summary.eligible, 9, "dry run should find 9 target policy PDFs");

const pipeline = await runCustomerPolicyKnowledgeAutoPipeline({
  supabase,
  supabaseUrl: url,
  serviceRoleKey,
  filenames: HANWHA_TARGET_FILES,
  limit: 20,
});

const after = {
  registryCount: await countRows("real_policy_pdf_registry"),
  knowledgeCount: await countRows("policy_knowledge_documents"),
  vectorCount: await countRows("policy_knowledge_chunks"),
  customerDocCount: await countRows("customer_documents"),
};

const { data: registryRows } = await supabase
  .from("real_policy_pdf_registry")
  .select("id, file_name")
  .in(
    "file_name",
    [...HANWHA_TARGET_FILES, EXISTING_READY_FILE],
  );

const registryFileNames = new Set((registryRows ?? []).map((row) => row.file_name));

const { data: knowledgeRows } = await supabase
  .from("policy_knowledge_documents")
  .select("id, title, ingest_status, metadata_json")
  .in("title", [...HANWHA_TARGET_FILES, EXISTING_READY_FILE])
  .is("deleted_at", null);

const readyKnowledge = (knowledgeRows ?? []).filter((row) => row.ingest_status === "ready");

const { data: refreshedTargets } = await supabase
  .from("customer_documents")
  .select("id, original_filename, metadata_json")
  .in("original_filename", HANWHA_TARGET_FILES)
  .is("deleted_at", null);

const targetStatuses = Object.fromEntries(
  (refreshedTargets ?? []).map((doc) => [doc.original_filename, getPipelineStatus(doc)]),
);

const { data: existingReadyDoc } = await supabase
  .from("customer_documents")
  .select("id, metadata_json")
  .eq("original_filename", EXISTING_READY_FILE)
  .is("deleted_at", null)
  .single();

const report = {
  phase: "25-2A-P0",
  baseline,
  after,
  pipeline_summary: pipeline.summary,
  tests: {
    metadataInference: { pass: true },
    policyTypeGateExcludesClaim: { pass: true },
    dryRunEligible9: { pass: dryRun.summary.eligible === 9 },
    customerDocumentsPreserved: {
      pass: after.customerDocCount >= baseline.customerDocCount,
      baseline: baseline.customerDocCount,
      after: after.customerDocCount,
    },
    existingRegistryPreserved: {
      pass: registryFileNames.has(EXISTING_READY_FILE),
      existing_policy_pdf_id: EXISTING_POLICY_PDF_ID,
    },
    existingVectorsPreserved: {
      pass: after.vectorCount >= baseline.vectorCount,
      baseline_vectors: baseline.vectorCount,
      after_vectors: after.vectorCount,
    },
    registryPromotedForTargets: {
      pass: HANWHA_TARGET_FILES.every((file) => registryFileNames.has(file)),
      registry_count: after.registryCount,
      promoted_files: [...registryFileNames],
    },
    knowledgeDocsReady: {
      pass: HANWHA_TARGET_FILES.every((file) => readyKnowledge.some((row) => row.title === file)),
      ready_count: readyKnowledge.length,
    },
    pipelineStatusesReady: {
      pass: HANWHA_TARGET_FILES.every((file) => targetStatuses[file] === "ready"),
      targetStatuses,
    },
    existingReadyDocLinked: {
      pass:
        getPipelineStatus(existingReadyDoc) === "ready" &&
        existingReadyDoc?.metadata_json?.policy_knowledge_pipeline?.policy_pdf_id === EXISTING_POLICY_PDF_ID,
      pipeline: existingReadyDoc?.metadata_json?.policy_knowledge_pipeline ?? null,
      existing_knowledge_doc_id: EXISTING_KNOWLEDGE_DOC_ID,
    },
    noPipelineFailures: {
      pass: pipeline.summary.failed === 0,
      failed: pipeline.summary.failed,
      results: pipeline.results.map((row) => ({
        file: row.original_filename,
        status: row.pipeline_status,
        failed: row.failed ?? false,
        error: row.error_message ?? null,
      })),
    },
  },
};

report.allPass = Object.values(report.tests).every((test) => test.pass === true);
for (const [name, test] of Object.entries(report.tests)) {
  assert.equal(test.pass, true, `${name} should pass`);
}
console.log(JSON.stringify(report, null, 2));
