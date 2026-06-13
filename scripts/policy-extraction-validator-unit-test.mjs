/**
 * Unit tests for policy extraction validator (no DB, no Claude).
 */
import { readFileSync } from "node:fs";
import { extractPoliciesFromOcrText, segmentOcrIntoPolicyBlocks } from "../server/documentPolicyExtractor.js";
import {
  inferDocumentType,
  validatePolicyExtraction,
  VALIDATOR_VERSION,
} from "../server/policyExtractionValidator.js";

const certificateSample = `
보험증권
보험사: 삼성생명
상품명: 실손의료비보험
계약자: 홍길동
피보험자: 홍길동
월 보험료: 45,000원
증권번호: AB1234567890
가입일: 2020년 03월 15일
특약: 암진단비 3,000만원
실손의료비 보장
`;

const coverageAnalysisSample = `
보장분석
삼성생명
상품명: 실손의료비보험
계약자 김진우
피보험자 김진우
월보험료 52,300원
특약: 암진단비 3,000만원
담보 수술비 500만원
`;

const overSplitSample = `
보장분석
삼성생명
상품명: 실손의료비보험
월보험료 45,000원
특약: 암진단비 3,000만원

메리츠화재
(2)

메리츠화재
(3)

메리츠화재
(4)
상품명: 건강보험(II)2306
`;

const duplicateSample = `
보장분석
한화생명
상품명: 건강보험
월보험료 50,000원

한화생명
상품명: 건강보험
월보험료 52,000원
`;

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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validateFromOcr(ocrText, documentMeta = {}) {
  const multiExtraction = extractPoliciesFromOcrText(ocrText);
  const segmentation = segmentOcrIntoPolicyBlocks(ocrText);
  return validatePolicyExtraction({ ocrText, multiExtraction, segmentation, documentMeta });
}

console.log("policy-extraction-validator-unit-test");

let passed = 0;
let failed = 0;

const tests = [
  ["certificate document_route is auto_save", () => {
    const result = validateFromOcr(certificateSample, { doc_class: "policy_certificate" });
    assert(result.document_route === "auto_save", `expected auto_save, got ${result.document_route}`);
  }],
  ["certificate candidate route is auto_save", () => {
    const result = validateFromOcr(certificateSample);
    assert(result.candidates[0]?.route === "auto_save", `got ${result.candidates[0]?.route}`);
  }],
  ["certificate validation_score >= 75", () => {
    const result = validateFromOcr(certificateSample);
    assert(result.candidates[0]?.validation_score >= 75, `score=${result.candidates[0]?.validation_score}`);
  }],
  ["certificate confidence >= 0.75", () => {
    const result = validateFromOcr(certificateSample);
    assert(result.candidates[0]?.confidence >= 0.75, `confidence=${result.candidates[0]?.confidence}`);
  }],
  ["coverage analysis document_route is auto_save", () => {
    const result = validateFromOcr(coverageAnalysisSample, { doc_class: "coverage_analysis" });
    assert(result.document_route === "auto_save", `got ${result.document_route}`);
  }],
  ["coverage analysis candidate route is auto_save", () => {
    const result = validateFromOcr(coverageAnalysisSample);
    assert(result.candidates[0]?.route === "auto_save", `got ${result.candidates[0]?.route}`);
  }],
  ["coverage analysis infers document_type from body", () => {
    const type = inferDocumentType(coverageAnalysisSample, { doc_class: "unknown" });
    assert(type === "coverage_analysis", `got ${type}`);
  }],
  ["certificate infers document_type from body", () => {
    const type = inferDocumentType(certificateSample, { doc_class: "other" });
    assert(type === "policy_certificate", `got ${type}`);
  }],
  ["insurer-only fragment routes manual_review or reject", () => {
    const result = validatePolicyExtraction({
      ocrText: "메리츠화재\n(5)",
      multiExtraction: {
        policy_count: 1,
        blocks_detected: 1,
        policies: [
          {
            block_index: 0,
            block_text: "메리츠화재\n(5)",
            fields: { insurer_name: "메리츠화재", product_name: null, monthly_premium: null },
            riders: [],
            field_count: 1,
            candidate_tier: "B",
            success: true,
          },
        ],
        review_blocks: [],
      },
    });
    assert(
      ["manual_review", "reject"].includes(result.candidates[0]?.route),
      `got ${result.candidates[0]?.route}`,
    );
  }],
  ["insurer-only fragment is not auto_save", () => {
    const result = validatePolicyExtraction({
      ocrText: "메리츠화재\n(5)",
      multiExtraction: {
        policy_count: 1,
        blocks_detected: 1,
        policies: [
          {
            block_index: 0,
            block_text: "메리츠화재\n(5)",
            fields: { insurer_name: "메리츠화재", product_name: null },
            riders: [],
          },
        ],
      },
    });
    assert(result.candidates[0]?.route !== "auto_save", "fragment must not auto_save");
  }],
  ["over-split sets DOC_OVER_SPLIT flag", () => {
    const result = validateFromOcr(overSplitSample);
    assert(result.flags.includes("DOC_OVER_SPLIT"), `flags=${JSON.stringify(result.flags)}`);
  }],
  ["over-split fragment candidate is reject", () => {
    const result = validateFromOcr(overSplitSample);
    assert(result.candidates.some((item) => item.route === "reject"), "expected reject candidate");
  }],
  ["over-split document_route is not auto_save", () => {
    const result = validateFromOcr(overSplitSample);
    assert(result.document_route !== "auto_save", `got ${result.document_route}`);
  }],
  ["duplicate insurer+product yields two candidates", () => {
    const multi = extractPoliciesFromOcrText(duplicateSample);
    assert(multi.policy_count === 2, `policy_count=${multi.policy_count}`);
  }],
  ["duplicate insurer+product routes claude_review", () => {
    const result = validateFromOcr(duplicateSample);
    assert(
      result.candidates.every((item) => item.route === "claude_review"),
      `routes=${result.candidates.map((item) => item.route).join(",")}`,
    );
  }],
  ["duplicate insurer+product document_route is claude_review", () => {
    const result = validateFromOcr(duplicateSample);
    assert(result.document_route === "claude_review", `got ${result.document_route}`);
  }],
  ["duplicate does not merge candidates", () => {
    const multi = extractPoliciesFromOcrText(duplicateSample);
    const result = validateFromOcr(duplicateSample);
    assert(multi.policy_count === result.candidates.length, "validator must keep separate candidates");
  }],
  ["contaminated field routes reject", () => {
    const result = validatePolicyExtraction({
      ocrText: "삼성화재 제,해약환급금",
      multiExtraction: {
        policy_count: 1,
        blocks_detected: 1,
        policies: [
          {
            block_index: 0,
            block_text: "삼성화재\n제,해약환급금 미지급형)",
            fields: {
              insurer_name: "삼성화재",
              product_name: "제,해약환급금 미지급형)",
              monthly_premium: 45000,
            },
            riders: [],
          },
        ],
      },
    });
    assert(result.candidates[0]?.route === "reject", `got ${result.candidates[0]?.route}`);
  }],
  ["contaminated field flags fail check", () => {
    const result = validatePolicyExtraction({
      ocrText: "제,해약환급금",
      multiExtraction: {
        policy_count: 1,
        policies: [
          {
            fields: { insurer_name: "삼성화재", product_name: "제,해약환급금 미지급형)", monthly_premium: 10000 },
            riders: [],
          },
        ],
      },
    });
    assert(result.candidates[0]?.checks?.contaminated_field?.status === "fail", "expected contaminated fail");
  }],
  ["validator_version present", () => {
    const result = validateFromOcr(certificateSample);
    assert(result.validator_version === VALIDATOR_VERSION, result.validator_version);
  }],
  ["summary counts present", () => {
    const result = validateFromOcr(certificateSample);
    assert(result.summary.auto_save_count >= 1, "auto_save_count missing");
    assert(typeof result.summary.reject_count === "number", "reject_count missing");
  }],
  ["document_score is 0-100", () => {
    const result = validateFromOcr(certificateSample);
    assert(result.document_score >= 0 && result.document_score <= 100, String(result.document_score));
  }],
  ["review_blocks preserved", () => {
    const result = validateFromOcr(overSplitSample);
    assert(Array.isArray(result.review_blocks), "review_blocks must be array");
    assert(result.review_blocks.length >= 1, "expected parser review blocks");
  }],
  ["validator module has no supabase import", () => {
    const source = readFileSync(new URL("../server/policyExtractionValidator.js", import.meta.url), "utf8");
    assert(!source.includes("@supabase/supabase-js"), "validator must not import supabase");
    assert(!source.includes("createClient"), "validator must not create db client");
  }],
  ["validator module has no claude/anthropic call", () => {
    const source = readFileSync(new URL("../server/policyExtractionValidator.js", import.meta.url), "utf8");
    assert(!/anthropic|claude/i.test(source), "validator must not call Claude");
    assert(!source.includes("fetch("), "validator must not perform network fetch");
  }],
  ["validator is pure (input unchanged)", () => {
    const multi = extractPoliciesFromOcrText(certificateSample);
    const snapshot = JSON.stringify(multi);
    validatePolicyExtraction({ ocrText: certificateSample, multiExtraction: multi });
    assert(JSON.stringify(multi) === snapshot, "validator mutated parser output");
  }],
  ["validator marks pure_validation_only", () => {
    const result = validateFromOcr(certificateSample);
    assert(result.pure_validation_only === true, "pure_validation_only must be true");
  }],
  ["reject candidates excluded from auto_save summary", () => {
    const result = validateFromOcr(overSplitSample);
    assert(result.summary.auto_save_count === 0 || result.flags.includes("DOC_OVER_SPLIT"), "over-split should not auto_save all");
  }],
];

for (const [name, fn] of tests) {
  if (runCase(name, fn)) passed += 1;
  else failed += 1;
}

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
