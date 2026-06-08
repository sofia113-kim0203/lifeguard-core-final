import assert from "node:assert/strict";
import {
  buildCustomerDocumentMetadata,
  buildHanwhaPolicyMetadata,
  buildSharedPolicyMetadata,
  transitionSharedPolicyStatus,
  assertDocumentScopesDoNotMix,
} from "../server/sharedPolicyRegistry.js";

const now = new Date("2026-06-08T13:00:00.000Z");
const customerDoc = buildCustomerDocumentMetadata({
  customer_id: "customer-a",
  source_file_name: "customer-policy.pdf",
  storage_path: "customer-documents/customer-a/customer-policy.pdf",
  now,
});
const hanwha = buildHanwhaPolicyMetadata({
  product_name: "3N5 더간편건강보험",
  product_code: "3ten55_se_2_2604",
  effective_date: "2026-04-01",
  source_file_name: "3ten55_se_2(2604)_03_1.pdf",
  storage_path: "policy-pdfs/hanwha/3ten55_se_2(2604)_03_1.pdf",
  now,
});
const textExtracted = transitionSharedPolicyStatus(hanwha, "text_extracted", { now: new Date("2026-06-08T13:10:00.000Z") });
const chunked = transitionSharedPolicyStatus(textExtracted, "chunked", { chunk_count: 42, now: new Date("2026-06-08T13:20:00.000Z") });
const embedded = transitionSharedPolicyStatus(chunked, "embedded", { embedding_count: 42, now: new Date("2026-06-08T13:30:00.000Z") });
const searchable = transitionSharedPolicyStatus(embedded, "searchable", { now: new Date("2026-06-08T13:40:00.000Z") });

let missingCustomerRejected = false;
try { buildCustomerDocumentMetadata({ source_file_name: "x.pdf", storage_path: "customer-documents/x.pdf" }); } catch { missingCustomerRejected = true; }
let sharedCustomerRejected = false;
try { buildSharedPolicyMetadata({ carrier_name: "한화", product_name: "상품", source_file_name: "x.pdf", storage_path: "policy-pdfs/x.pdf", customer_id: "customer-a" }); } catch { sharedCustomerRejected = true; }
let invalidStatusRejected = false;
try { transitionSharedPolicyStatus(hanwha, "ocr_started"); } catch { invalidStatusRejected = true; }

const report = {
  phase: "25-1C",
  tests: {
    customerDocumentRequiresCustomerId: { pass: customerDoc.customer_id === "customer-a" && missingCustomerRejected, customerDoc },
    sharedPolicyWithoutCustomer: { pass: hanwha.customer_id == null && hanwha.visibility === "shared" && hanwha.knowledge_type === "policy_terms" && sharedCustomerRejected, hanwha },
    metadataCreated: { pass: hanwha.carrier_name === "한화" && hanwha.product_name.includes("3N5") && hanwha.source_file_name.endsWith(".pdf") },
    uploadedInitialStatus: { pass: hanwha.processing_status === "uploaded" && hanwha.chunk_count === 0 && hanwha.embedding_count === 0 },
    scopesDoNotMix: { pass: assertDocumentScopesDoNotMix(customerDoc) && assertDocumentScopesDoNotMix(hanwha) },
    hanwhaMetadata: { pass: hanwha.carrier_name === "한화" && hanwha.storage_path.startsWith("policy-pdfs/hanwha/") },
    futureStatusTransitions: { pass: searchable.processing_status === "searchable" && searchable.chunk_count === 42 && searchable.embedding_count === 42 && invalidStatusRejected, searchable },
  },
};
report.allPass = Object.values(report.tests).every((test) => test.pass === true);
for (const [name, test] of Object.entries(report.tests)) assert.equal(test.pass, true, `${name} should pass`);
console.log(JSON.stringify(report, null, 2));
