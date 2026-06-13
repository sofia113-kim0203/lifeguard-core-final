/**
 * Document upload category + ingest classify unit tests.
 */
import { DOCUMENT_CATEGORIES, resolveLegacyDocClass } from "../src/lib/documentCategories.js";
import { classifyDocumentType } from "../supabase/functions/document-ingest-worker/classify.ts";

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

function getCategory(categoryKey) {
  const category = DOCUMENT_CATEGORIES.find((entry) => entry.key === categoryKey);
  if (!category) throw new Error(`missing category: ${categoryKey}`);
  return category;
}

function buildUploadInsertFields(categoryKey) {
  const category = getCategory(categoryKey);
  return {
    doc_class: resolveLegacyDocClass(category),
    customer_hint_type: category.hintType,
    category_key: category.key,
    canonical_doc_class: category.docClass,
  };
}

console.log("document-upload-category-unit-test");

let passed = 0;
let failed = 0;

const tests = [
  ["DOCUMENT_CATEGORIES includes coverage_analysis_sheet", () => {
    const category = DOCUMENT_CATEGORIES.find((entry) => entry.key === "coverage_analysis_sheet");
    assert(category, "coverage_analysis_sheet missing");
    assert(category.label === "보장분석표", `label=${category.label}`);
    assert(category.docClass === "coverage_analysis_sheet", `docClass=${category.docClass}`);
    assert(category.hintType === "coverage_analysis_sheet", `hintType=${category.hintType}`);
  }],
  ["DOCUMENT_CATEGORIES keeps insurance_policy unchanged", () => {
    const category = DOCUMENT_CATEGORIES.find((entry) => entry.key === "insurance_policy");
    assert(category?.label === "보험증권", `label=${category?.label}`);
    assert(category?.docClass === "policy_certificate", `docClass=${category?.docClass}`);
    assert(category?.hintType === "insurance_policy", `hintType=${category?.hintType}`);
  }],
  ["upload fields for coverage_analysis_sheet", () => {
    const fields = buildUploadInsertFields("coverage_analysis_sheet");
    assert(fields.category_key === "coverage_analysis_sheet", `category_key=${fields.category_key}`);
    assert(fields.customer_hint_type === "coverage_analysis_sheet", `hint=${fields.customer_hint_type}`);
    assert(fields.canonical_doc_class === "coverage_analysis_sheet", `canonical=${fields.canonical_doc_class}`);
    assert(fields.doc_class === "other", `legacy doc_class=${fields.doc_class}`);
  }],
  ["upload fields for insurance_policy", () => {
    const fields = buildUploadInsertFields("insurance_policy");
    assert(fields.category_key === "insurance_policy", `category_key=${fields.category_key}`);
    assert(fields.customer_hint_type === "insurance_policy", `hint=${fields.customer_hint_type}`);
    assert(fields.doc_class === "policy_certificate", `doc_class=${fields.doc_class}`);
  }],
  ["classifyDocumentType maps coverage_analysis_sheet", () => {
    const result = classifyDocumentType({
      customer_hint_type: "coverage_analysis_sheet",
      metadata_json: { category_key: "coverage_analysis_sheet" },
      document_type: null,
    });
    assert(result === "coverage_analysis_sheet", `got ${result}`);
  }],
  ["classifyDocumentType maps insurance_policy to insurance_certificate", () => {
    const result = classifyDocumentType({
      customer_hint_type: "insurance_policy",
      metadata_json: { category_key: "insurance_policy" },
      document_type: null,
    });
    assert(result === "insurance_certificate", `got ${result}`);
  }],
];

for (const [name, fn] of tests) {
  if (runCase(name, fn)) passed += 1;
  else failed += 1;
}

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
