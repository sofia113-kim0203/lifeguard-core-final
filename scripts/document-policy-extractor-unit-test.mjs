/**
 * Unit tests for OCR policy field extraction (no Supabase).
 */
import {
  buildOcrSnippet,
  extractPolicyFieldsFromOcrText,
  isPolicyExtractionRetryEligible,
} from "../server/documentPolicyExtractor.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const certificateSample = `
보험증권
보험사: 삼성생명
상품명: 실손의료비보험
계약자: 홍길동
피보험자: 홍길동
월 보험료: 45,000원
가입일: 2020년 03월 15일
실손의료비 보장
`;

const coverageAnalysisSample = `
보장분석
삼성생명
실손의료비보험
계약자 김진우
피보험자 김진우
월보험료 52,300원
암진단비 보장
`;

const sparseSample = `
안내 문서
문의하세요
`;

console.log("document-policy-extractor-unit-test");

const cert = extractPolicyFieldsFromOcrText(certificateSample);
assert(cert.success, "certificate sample should succeed");
assert(cert.field_count >= 4, `certificate field_count expected >=4, got ${cert.field_count}`);
assert(cert.fields.insurer_name === "삼성생명", "certificate insurer mismatch");
assert(cert.fields.monthly_premium === 45000, "certificate premium mismatch");

const analysis = extractPolicyFieldsFromOcrText(coverageAnalysisSample);
assert(analysis.success, "coverage analysis sample should succeed");
assert(analysis.fields.insurer_name === "삼성생명", "analysis insurer mismatch");
assert(analysis.fields.insured === "김진우", "analysis insured mismatch");

const sparse = extractPolicyFieldsFromOcrText(sparseSample);
assert(!sparse.success, "sparse sample should not succeed");
assert(sparse.requires_manual_review, "sparse sample should require manual review");
assert(sparse.missing_fields.length > 0, "sparse sample should list missing fields");

const snippet = buildOcrSnippet("가".repeat(1000), 100);
assert(snippet.length <= 101, "snippet should be truncated");

assert(
  isPolicyExtractionRetryEligible({ ingestStatus: "ready", metadataJson: {} }),
  "null status should be retry eligible",
);
assert(
  isPolicyExtractionRetryEligible({
    ingestStatus: "ready",
    metadataJson: { policy_extraction_status: "extraction_failed" },
  }),
  "extraction_failed should be retry eligible",
);
assert(
  !isPolicyExtractionRetryEligible({
    ingestStatus: "ready",
    metadataJson: { policy_extraction_status: "completed" },
  }),
  "completed should not be retry eligible",
);

console.log("PASS");
