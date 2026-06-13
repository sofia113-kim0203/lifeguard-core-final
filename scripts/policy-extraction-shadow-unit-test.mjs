/**
 * Shadow-mode regression tests (no Supabase, no persist mutation).
 */
import { readFileSync } from "node:fs";
import { extractPoliciesFromOcrText } from "../server/documentPolicyExtractor.js";
import {
  buildMetadataPatchWithShadow,
  buildPolicyValidationMetadata,
  buildValidatorDocumentMeta,
  runShadowPolicyValidation,
  runShadowPolicyValidationSafe,
} from "../server/policyExtractionShadow.js";
import { buildUploadExtractKey } from "../server/documentPolicyUploadPersist.js";

const certificateSample = `
보험증권
보험사: 삼성생명
상품명: 실손의료비보험
월 보험료: 45,000원
증권번호: AB1234567890
`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runCase(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
    return true;
  } catch (error) {
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

console.log("policy-extraction-shadow-unit-test");

let passed = 0;
let failed = 0;

const documentId = "doc-shadow-0001-0002-0003";
const documentWithType = {
  document_type: "insurance_certificate",
  customer_hint_type: "insurance_policy",
  metadata_json: { category_key: "insurance_policy" },
};
const documentWithoutType = {
  customer_hint_type: "coverage_analysis_sheet",
  metadata_json: { category_key: "coverage_analysis_sheet" },
};

const tests = [
  ["pipeline hook is after extractPoliciesFromOcrText", () => {
    const source = readFileSync(new URL("../server/documentPolicyExtractionPipeline.js", import.meta.url), "utf8");
    const extractIndex = source.indexOf("extractPoliciesFromOcrText(ocrText)");
    const shadowIndex = source.indexOf("runShadowPolicyValidationSafe(");
    assert(extractIndex >= 0 && shadowIndex > extractIndex, "shadow hook must follow parser extraction");
  }],
  ["pipeline does not gate persist on validator route", () => {
    const source = readFileSync(new URL("../server/documentPolicyExtractionPipeline.js", import.meta.url), "utf8");
    assert(!source.includes("document_route === \"auto_save\""), "persist must not branch on document_route");
    assert(!source.includes("would_auto_save_count"), "persist must not branch on would_auto_save_count");
    assert(source.includes("persistExtractedPolicies(admin, customerId, documentId, multiExtraction)"), "persist call unchanged");
  }],
  ["shadow module has no supabase import", () => {
    const source = readFileSync(new URL("../server/policyExtractionShadow.js", import.meta.url), "utf8");
    assert(!source.includes("@supabase/supabase-js"), "shadow helper must not import supabase");
    assert(!source.includes("createClient"), "shadow helper must not create db client");
  }],
  ["buildValidatorDocumentMeta uses document_type when present", () => {
    const meta = buildValidatorDocumentMeta(documentWithType);
    assert(meta.doc_class === "insurance_certificate", `got ${meta.doc_class}`);
  }],
  ["buildValidatorDocumentMeta without document_type passes category_key only", () => {
    const meta = buildValidatorDocumentMeta(documentWithoutType);
    assert(!meta.doc_class, "doc_class must not be synthesized");
    assert(meta.category_key === "coverage_analysis_sheet", `got ${meta.category_key}`);
    assert(meta.customer_hint_type === "coverage_analysis_sheet", `got ${meta.customer_hint_type}`);
  }],
  ["shadow validation does not mutate parser output", () => {
    const multi = extractPoliciesFromOcrText(certificateSample);
    const snapshot = JSON.stringify(multi);
    runShadowPolicyValidation({
      ocrText: certificateSample,
      multiExtraction: multi,
      document: documentWithType,
    });
    assert(JSON.stringify(multi) === snapshot, "parser output mutated");
  }],
  ["policy_validation metadata shape", () => {
    const multi = extractPoliciesFromOcrText(certificateSample);
    const shadowState = runShadowPolicyValidation({
      ocrText: certificateSample,
      multiExtraction: multi,
      document: documentWithType,
    });
    const record = buildPolicyValidationMetadata(shadowState, { policy_count: multi.policy_count });
    assert(record.shadow_mode === true, "shadow_mode must be true");
    assert(record.validator_version, "validator_version required");
    assert(record.document_route, "document_route required");
    assert(typeof record.document_score === "number", "document_score required");
    assert(record.doc_profile, "doc_profile required");
    assert(Array.isArray(record.document_flags), "document_flags required");
    assert(record.summary, "summary required");
    assert(Array.isArray(record.candidates), "candidates required");
    assert(typeof record.would_auto_save_count === "number", "would_auto_save_count required");
    assert(record.actually_persisted_count === multi.policy_count, "actually_persisted_count is observational only");
  }],
  ["persist candidate count unchanged by shadow hook", () => {
    const multi = extractPoliciesFromOcrText(certificateSample);
    const beforeCount = multi.policies.length;
    const beforeKeys = multi.policies.map((candidate) => buildUploadExtractKey(documentId, candidate.fields));

    const shadowState = runShadowPolicyValidation({
      ocrText: certificateSample,
      multiExtraction: multi,
      document: documentWithType,
    });
    const record = buildPolicyValidationMetadata(shadowState, { policy_count: beforeCount });

    const afterCount = multi.policies.length;
    const afterKeys = multi.policies.map((candidate) => buildUploadExtractKey(documentId, candidate.fields));

    assert(beforeCount === afterCount, "policy candidate count changed");
    assert(JSON.stringify(beforeKeys) === JSON.stringify(afterKeys), "upload_extract keys changed");
    assert(record.actually_persisted_count === beforeCount, "observational count should mirror persist count");
    if (record.would_auto_save_count !== beforeCount) {
      assert(record.would_auto_save_count >= 0, "would_auto_save_count must not affect persist");
    }
  }],
  ["validator failure is swallowed by safe wrapper", () => {
    const broken = runShadowPolicyValidationSafe({
      ocrText: certificateSample,
      multiExtraction: null,
      document: documentWithType,
    });
    assert(broken.ok === false, "broken validator must return ok=false");
    assert(broken.error, "error message required");
  }],
  ["metadata patch builder tolerates broken shadow state", () => {
    const patch = buildMetadataPatchWithShadow({ policy_extraction_status: "completed" }, { ok: false }, { policy_count: 2 });
    assert(patch.policy_extraction_status === "completed", "base patch must remain");
    assert(!patch.policy_validation, "no policy_validation when shadow failed");
  }],
];

for (const [name, fn] of tests) {
  if (runCase(name, fn)) passed += 1;
  else failed += 1;
}

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
