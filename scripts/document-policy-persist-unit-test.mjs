/**
 * Unit tests for multi-policy upload_extract persistence planning (no Supabase).
 */
import { extractPoliciesFromOcrText } from "../server/documentPolicyExtractor.js";
import {
  buildCoverageSummaryFromCandidate,
  buildUploadExtractKey,
  planRetiredPolicyIds,
  resolveExistingPolicyForCandidate,
} from "../server/documentPolicyUploadPersist.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const documentId = "doc-1111-2222-3333-4444";

const multiPolicySample = `
보장분석
삼성생명
상품명: 실손의료비보험
월보험료 45,000원
특약: 암진단비 3,000만원

한화생명
상품명: 종신보험
월보험료 120,000원

현대해상
상품명: 운전자보험
월보험료 18,500원
`;

console.log("document-policy-persist-unit-test");

const multi = extractPoliciesFromOcrText(multiPolicySample);
assert(multi.policy_count === 3, `expected 3 candidates, got ${multi.policy_count}`);

const keys = multi.policies.map((candidate) => buildUploadExtractKey(documentId, candidate.fields));
assert(new Set(keys).size === 3, "upload_extract_key values must be unique per policy");

const samsung = multi.policies.find((policy) => policy.fields.insurer_name === "삼성생명");
const summary = buildCoverageSummaryFromCandidate(documentId, samsung);
assert(Array.isArray(summary.riders), "coverage_summary.riders must be an array");
assert(summary.riders.length >= 1, "samsung policy should include riders[]");
assert(summary.upload_extract_key, "coverage_summary.upload_extract_key required");
assert(summary.source_document_id === documentId, "source_document_id mismatch");

const existingRows = [
  {
    id: "legacy-policy-1",
    is_active: true,
    coverage_summary: {
      source_document_id: documentId,
      upload_extract_key: keys[0],
    },
  },
  {
    id: "stale-policy-2",
    is_active: true,
    coverage_summary: {
      source_document_id: documentId,
      upload_extract_key: `${documentId}|old|product||99999`,
    },
  },
];

const resolved = resolveExistingPolicyForCandidate(existingRows, documentId, samsung, 3);
assert(resolved.row?.id === "legacy-policy-1", "existing key should resolve to update target");

const retireIds = planRetiredPolicyIds(existingRows, documentId, keys);
assert(retireIds.includes("stale-policy-2"), "stale upload_extract row should be retired");
assert(!retireIds.includes("legacy-policy-1"), "active key row must not be retired");

const sameKeyA = buildUploadExtractKey(documentId, samsung.fields);
const sameKeyB = buildUploadExtractKey(documentId, samsung.fields);
assert(sameKeyA === sameKeyB, "re-extract must produce identical upload_extract_key");

console.log("PASS");
