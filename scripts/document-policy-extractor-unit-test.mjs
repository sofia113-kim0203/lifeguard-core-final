/**
 * Unit tests for OCR policy field extraction (no Supabase).
 */
import {
  buildOcrSnippet,
  extractPoliciesFromOcrText,
  extractPolicyFieldsFromBlock,
  extractPolicyFieldsFromOcrText,
  extractRidersFromBlock,
  isPolicyExtractionRetryEligible,
  segmentOcrIntoPolicyBlocks,
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

const multiPolicySample = `
보장분석
삼성생명
상품명: 실손의료비보험
월보험료 45,000원
특약: 암진단비 3,000만원
담보 수술비 500만원

한화생명
상품명: 종신보험
월보험료 120,000원
특약: 뇌졸중진단비 2,000만원

현대해상
상품명: 운전자보험
월보험료 18,500원
담보 교통상해 1억원
`;

const sparseSample = `
안내 문서
문의하세요
`;

const mixedQualitySample = `
보장분석
삼성생명
상품명: 실손의료비보험
월보험료 45,000원
특약: 암진단비 3,000만원

상품명: 확인필요
실손의료비
암진단비
`;

console.log("document-policy-extractor-unit-test");

// --- v2 backward compatibility ---
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

// --- v3 multi-policy core ---
const singleSegmentation = segmentOcrIntoPolicyBlocks(certificateSample);
assert(singleSegmentation.blocks_detected === 1, "single certificate should produce 1 block");

const singleMulti = extractPoliciesFromOcrText(certificateSample);
assert(singleMulti.policy_count === 1, "single certificate should produce 1 policy candidate");
assert(singleMulti.policies[0].fields.insurer_name === "삼성생명", "single policy insurer mismatch");

const multiSegmentation = segmentOcrIntoPolicyBlocks(multiPolicySample);
assert(multiSegmentation.blocks_detected === 3, `expected 3 blocks, got ${multiSegmentation.blocks_detected}`);

const multi = extractPoliciesFromOcrText(multiPolicySample);
assert(multi.success, "multi policy sample should succeed");
assert(multi.policy_count === 3, `expected 3 policy candidates, got ${multi.policy_count}`);

const insurers = multi.policies.map((policy) => policy.fields.insurer_name);
assert(insurers.includes("삼성생명"), "missing 삼성생명 policy");
assert(insurers.includes("한화생명"), "missing 한화생명 policy");
assert(insurers.includes("현대해상"), "missing 현대해상 policy");

const premiums = multi.policies.map((policy) => policy.fields.monthly_premium);
assert(premiums.includes(45000), "missing 45000 premium");
assert(premiums.includes(120000), "missing 120000 premium");
assert(premiums.includes(18500), "missing 18500 premium");

const samsung = multi.policies.find((policy) => policy.fields.insurer_name === "삼성생명");
assert(samsung?.riders?.length >= 2, "samsung block should include multiple riders");
assert(
  samsung.riders.some((rider) => rider.rider_name.includes("암진단비")),
  "samsung riders should include 암진단비",
);

const ridersOnly = extractRidersFromBlock(`
특약: 암진단비 3,000만원
담보 수술비 500만원
`);
assert(ridersOnly.length >= 2, "rider parser should extract multiple riders");
assert(ridersOnly[0].coverage_amount != null, "rider parser should parse coverage amount");

const mixed = extractPoliciesFromOcrText(mixedQualitySample);
assert(mixed.policy_count >= 1, "mixed sample should keep valid policy candidate");
assert(mixed.review_blocks.length >= 1, "mixed sample should move weak block to review_blocks");
assert(
  mixed.review_blocks.every((block) => !block.fields?.insurer_name || block.reason),
  "review blocks must not be promoted as fake policies",
);
assert(
  mixed.policies.every((policy) => policy.candidate_tier),
  "persistable policy candidates must have tier A/B/C",
);

const blockOnly = extractPolicyFieldsFromBlock("실손의료비\n암진단비");
assert(!blockOnly.success, "identity-free block must not become fake policy");
assert(blockOnly.requires_manual_review, "weak block should require manual review");

// --- Slice 8.1: beneficiaries / optional actual_premium_funder (no premium_payers) ---
{
  const partySample = `
보험증권
보험사: 삼성생명
상품명: 종신보험
계약자: 홍길동
피보험자: 홍길동
사망보험금 수익자: 김영희 60%, 이철수 40%
만기보험금 수익자: 박민수
보험료 납입자: 최수진
월 보험료: 120,000원
수익자 변경: 김영희 → 정수린
효력발생일: 2024년 05월 01일
`;
  const party = extractPolicyFieldsFromBlock(partySample);
  assert(party.success, "party sample should succeed");
  assert(party.fields.policyholder === "홍길동", "policyholder preserved");
  assert(party.fields.insured === "홍길동", "insured preserved");
  assert(party.fields.beneficiaries.length >= 3, "death+maturity beneficiaries");
  const death = party.fields.beneficiaries.filter((b) => b.beneficiary_type === "death_benefit");
  assert(death.length === 2, "two death beneficiaries");
  assert(death.some((b) => b.name === "김영희" && b.share === "60%"), "share 60%");
  assert(death.some((b) => b.name === "이철수" && b.share === "40%"), "share 40%");
  const maturity = party.fields.beneficiaries.find((b) => b.beneficiary_type === "maturity_benefit");
  assert(maturity?.name === "박민수", "maturity beneficiary separated");
  assert(party.fields.premium_payers == null, "premium_payers not a standard field");
  assert(party.fields.actual_premium_funder?.name === "최수진", "distinct funder evidenced");
  assert(party.fields.actual_premium_funder.name !== party.fields.policyholder, "funder != policyholder");
  assert(party.fields.party_changes.length >= 1, "party change extracted");
  assert(party.fields.party_changes[0].previous_value === "김영희", "change from");
  assert(party.fields.party_changes[0].new_value === "정수린", "change to");
  assert(String(party.fields.party_changes[0].effective_date || "").includes("2024"), "effective date");
}

{
  const noParty = extractPolicyFieldsFromBlock(certificateSample);
  assert(Array.isArray(noParty.fields.beneficiaries), "beneficiaries array always present");
  assert(noParty.fields.beneficiaries.length === 0, "missing beneficiary → empty, no invent");
  assert(noParty.fields.actual_premium_funder == null, "no funder evidence → omit");
  assert(noParty.fields.premium_payers == null, "no premium_payers array");
}

{
  // 납입의무자 alone is contractual duty — not actual_premium_funder
  const dutyOnly = extractPolicyFieldsFromBlock(`
보험사: A생명
상품명: A종신
계약자: 갑
피보험자: 갑
납입의무자: 갑
`);
  assert(dutyOnly.fields.policyholder === "갑", "policyholder present");
  assert(dutyOnly.fields.actual_premium_funder == null, "납입의무자 does not create funder");
}

{
  // Same name as policyholder on 보험료 납입자 → do not clone
  const same = extractPolicyFieldsFromBlock(`
보험사: A생명
상품명: A종신
계약자: 갑
피보험자: 갑
보험료 납입자: 갑
`);
  assert(same.fields.actual_premium_funder == null, "same-as-policyholder funder omitted");
}

{
  const a = extractPolicyFieldsFromBlock(`
보험사: A생명
상품명: A종신
계약자: 갑
피보험자: 갑
수익자: 을
`);
  const b = extractPolicyFieldsFromBlock(`
보험사: B생명
상품명: B종신
계약자: 병
피보험자: 병
수익자: 정
`);
  assert(a.fields.beneficiaries[0].name === "을", "contract A beneficiary");
  assert(b.fields.beneficiaries[0].name === "정", "contract B beneficiary");
  assert(a.fields.beneficiaries.every((x) => x.name !== "정"), "no cross-contract mix A");
  assert(b.fields.beneficiaries.every((x) => x.name !== "을"), "no cross-contract mix B");
}

console.log("PASS");
