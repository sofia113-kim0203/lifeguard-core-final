import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import {
  DEFAULT_HANWHA_POLICY_DOCUMENT_ID,
  promoteCustomerDocumentToSharedPolicy,
} from "../server/customerDocumentToSharedPolicyPromotion.js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  throw new Error("SUPABASE_URL and SERVICE_ROLE_KEY are required");
}
const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
const result = await promoteCustomerDocumentToSharedPolicy({ supabase });
const { data: targetList, error: targetListError } = await supabase.storage
  .from("policy-pdfs")
  .list(result.target_storage_path.split("/").slice(0, -1).join("/"), { limit: 100 });
if (targetListError) throw new Error(targetListError.message);
const targetName = result.target_storage_path.split("/").at(-1);
const targetExists = targetList.some((item) => item.name === targetName);
const { count: customerDocCount } = await supabase
  .from("customer_documents")
  .select("id", { count: "exact", head: true })
  .eq("id", DEFAULT_HANWHA_POLICY_DOCUMENT_ID)
  .is("deleted_at", null);
const { count: chunkCount } = await supabase
  .from("real_policy_chunk_items")
  .select("id", { count: "exact", head: true })
  .eq("policy_pdf_id", result.policy_pdf.id);
const { count: vectorCount } = await supabase
  .from("policy_vector_registry")
  .select("id", { count: "exact", head: true });

const report = {
  phase: "25-1D-promote",
  customer_document_id: DEFAULT_HANWHA_POLICY_DOCUMENT_ID,
  tests: {
    actualCustomerDocumentExists: {
      pass: result.source_customer_document.original_filename === "3ten55_se_2(2604)_03_1.pdf",
      file: result.source_customer_document.original_filename,
      ingest_status: result.source_customer_document.ingest_status,
    },
    customerStorageCopied: {
      pass: targetExists && result.target_storage_path.startsWith("hanwha/"),
      target_storage_path: result.target_storage_path,
      storage: result.storage,
    },
    carrierSeed: {
      pass: result.carrier.carrier_name === "한화손해보험" && result.carrier.is_active === true,
      carrier: result.carrier,
    },
    productSeed: {
      pass: result.product.product_name === "한화 더 경증 간편건강보험Ⅱ" && result.product.is_active === true,
      product: result.product,
    },
    sharedPolicyRegistry: {
      pass:
        result.policy_pdf.upload_status === "uploaded" &&
        result.policy_pdf.file_name === "3ten55_se_2(2604)_03_1.pdf" &&
        result.shared_policy_metadata.visibility === "shared" &&
        result.shared_policy_metadata.knowledge_type === "policy_terms" &&
        result.shared_policy_metadata.customer_id === null,
      policy_pdf: result.policy_pdf,
      policy_source: result.policy_source,
      metadata: result.shared_policy_metadata,
    },
    originalCustomerDocumentPreserved: {
      pass: customerDocCount === 1 && result.original_customer_document_preserved === true,
      customerDocCount,
    },
    noTextChunkEmbeddingYet: {
      pass: result.policy_pdf.upload_status === "uploaded" && chunkCount === 0 && vectorCount >= 0,
      chunkCount,
      vectorCount,
    },
  },
};
report.allPass = Object.values(report.tests).every((test) => test.pass === true);
for (const [name, test] of Object.entries(report.tests)) assert.equal(test.pass, true, `${name} should pass`);
console.log(JSON.stringify({ ...report, result }, null, 2));
