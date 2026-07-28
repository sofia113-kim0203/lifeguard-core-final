/**
 * P0 — verified document coverage reinjection (next-turn chart, no PDF re-attach).
 * Fixture values stay in this test only — not product hardcoding.
 */
import assert from "node:assert/strict";
import {
  normalizeKeyCoverageBaselineFacts,
  keyValidateCoverageBaselineFacts,
  KEY_BASELINE_FACT_STATUSES,
} from "../src/lib/keyCoverageBaselineFacts.js";
import {
  buildVerifiedCustomerChart,
  buildEarlyBorrowedFactBoundary,
} from "../server/keyCore/keyBorrowedSensesSpeak.js";
import { buildKeyRecordSidecarHint } from "../server/keyCore/keyRecordSidecar.js";

const DOC_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_DOC_ID = "22222222-2222-4222-8222-222222222222";

// Synthetic fixture expectations (test-only)
const FIXTURE = {
  coverage_name: "일반암 진단금",
  coverage_amount: 50_000_000,
  insurer: "한화생명",
  product: "간편가입 The H 건강보험 QA TEST",
  premium: 123450,
};

function makePolicyWithVerifiedBaseline({
  documentId = DOC_ID,
  coverageName = FIXTURE.coverage_name,
  amount = FIXTURE.coverage_amount,
  status = KEY_BASELINE_FACT_STATUSES.VERIFIED,
  includeIdentity = true,
} = {}) {
  const source_content_sha256 =
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  return {
    id: "policy-1",
    customer_id: "cust-1",
    insurer_name: FIXTURE.insurer,
    product_name: FIXTURE.product,
    monthly_premium: FIXTURE.premium,
    is_active: true,
    deleted_at: null,
    source_document_id: documentId,
    contract_identity_key: includeIdentity
      ? `identity:${source_content_sha256}:v1`
      : null,
    source_fact_key: includeIdentity ? `fact:${source_content_sha256}:v1` : null,
    source_content_sha256,
    coverage_summary: {
      source_document_id: documentId,
      key_coverage_baseline_facts: [
        {
          original_coverage_name: coverageName,
          coverage_amount: amount,
          baseline_item_id: "cancer_diagnosis",
          source_document_id: documentId,
          source_content_sha256,
          source_locator: { source_text: coverageName },
          status,
        },
      ],
      rider_details: [],
    },
  };
}

function testSidecarHintAsksForCoverageFacts() {
  const hint = buildKeyRecordSidecarHint({
    documentIds: [DOC_ID],
    primaryDocumentId: DOC_ID,
  });
  assert.match(hint, /coverage_facts/);
  assert.match(hint, /coverage_amount/);
  assert.match(hint, /source_locator/);
  assert.doesNotMatch(hint, /50000000|50,?000,?000|한화생명/);
}

function testNormalizeInfersCancerItemAndLocator() {
  const normalized = normalizeKeyCoverageBaselineFacts(
    [
      {
        coverage_name: FIXTURE.coverage_name,
        coverage_amount: FIXTURE.coverage_amount,
        // no baseline_item_id, no source_locator
      },
    ],
    { source_document_id: DOC_ID },
  );
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].baseline_item_id, "cancer_diagnosis");
  assert.equal(normalized[0].source_document_id, DOC_ID);
  assert.ok(normalized[0].source_locator?.source_text);
  assert.equal(normalized[0].coverage_amount, FIXTURE.coverage_amount);
}

function testValidateMarksVerified() {
  const proposed = normalizeKeyCoverageBaselineFacts(
    [
      {
        coverage_name: FIXTURE.coverage_name,
        coverage_amount: FIXTURE.coverage_amount,
        baseline_item_id: "cancer_diagnosis",
        source_locator: { page: 1, source_text: FIXTURE.coverage_name },
      },
    ],
    { source_document_id: DOC_ID },
  );
  const validated = keyValidateCoverageBaselineFacts(proposed, {
    ownedDocumentIds: [DOC_ID],
    existingFacts: [],
  });
  assert.equal(validated[0].status, KEY_BASELINE_FACT_STATUSES.VERIFIED);
}

function testChartReinjectsVerifiedCoverageWithoutPdf() {
  const policy = makePolicyWithVerifiedBaseline();
  const chart = buildVerifiedCustomerChart({ policies: [policy] });
  assert.ok(chart);
  const contracts = chart.contracts || chart.personal?.contracts || [];
  // chart shape: contracts array with coverages
  const list = Array.isArray(chart.contracts)
    ? chart.contracts
    : Array.isArray(chart?.personal?.contracts)
      ? chart.personal.contracts
      : Array.isArray(chart)
        ? chart
        : [];
  // Prefer top-level contracts from buildVerifiedCustomerChart
  const rows = Array.isArray(chart.contracts) ? chart.contracts : list;
  assert.ok(rows.length >= 1, "expected at least one chart contract");
  const coverages = rows[0].coverages || [];
  const hit = coverages.find(
    (c) =>
      String(c.coverage_name ?? "").includes("일반암") &&
      Number(String(c.coverage_amount ?? "").replace(/,/g, "")) === FIXTURE.coverage_amount,
  );
  assert.ok(hit, "verified cancer benefit must be reinjected into chart coverages");
}

function testOpinionAndForeignCoverageNotPromoted() {
  // Unverified / pending must not enter chart coverages via baseline path
  const pendingPolicy = makePolicyWithVerifiedBaseline({
    status: KEY_BASELINE_FACT_STATUSES.PENDING,
  });
  const chartPending = buildVerifiedCustomerChart({ policies: [pendingPolicy] });
  const coveragesPending = chartPending.contracts?.[0]?.coverages || [];
  assert.equal(
    coveragesPending.filter((c) => String(c.coverage_name ?? "").includes("일반암")).length,
    0,
    "pending baseline must not reinject as verified coverage",
  );

  // Foreign contract coverages stay on their own policy
  const own = makePolicyWithVerifiedBaseline({ documentId: DOC_ID });
  const foreign = makePolicyWithVerifiedBaseline({
    documentId: OTHER_DOC_ID,
    coverageName: "외국인 암진단",
    amount: 99_999_999,
  });
  foreign.id = "policy-foreign";
  foreign.insurer_name = "타보험사";
  foreign.product_name = "타상품";
  foreign.contract_identity_key = "identity:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:v1";
  foreign.source_fact_key = "fact:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:v1";
  foreign.source_content_sha256 =
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  foreign.coverage_summary.source_content_sha256 = foreign.source_content_sha256;

  const chart = buildVerifiedCustomerChart({ policies: [own, foreign] });
  const ownContract = (chart.contracts || []).find((c) =>
    String(c.product_name || c.product || "").includes("The H"),
  );
  const foreignContract = (chart.contracts || []).find((c) =>
    String(c.insurer_name || c.insurer || "").includes("타보험사"),
  );
  assert.ok(ownContract);
  assert.ok(foreignContract);
  const ownHasForeignAmount = (ownContract.coverages || []).some(
    (c) => Number(String(c.coverage_amount ?? "").replace(/,/g, "")) === 99_999_999,
  );
  assert.equal(ownHasForeignAmount, false, "foreign coverage must not mix into own contract");
}

function testNoHardcodedProductInHint() {
  const hint = buildKeyRecordSidecarHint({ primaryDocumentId: DOC_ID });
  assert.doesNotMatch(hint, /The H|QA TEST|123,?450|한화/);
}

function testWeakIdentityReviewCandidateKeepsVerifiedCoverage() {
  const weak = makePolicyWithVerifiedBaseline({ includeIdentity: false });
  weak.policy_number = null;
  weak.contract_identity_key = null;
  weak.source_fact_key = null;
  weak.source_content_sha256 = null;
  weak.coverage_summary.source_content_sha256 = null;

  const chart = buildVerifiedCustomerChart({ policies: [weak] });
  assert.equal((chart.contracts || []).length, 0, "weak identity must not inflate confirmed count");
  assert.ok((chart.review_candidates || []).length >= 1, "weak identity stays review candidate");
  const review = chart.review_candidates[0];
  const hit = (review.coverages || []).find(
    (c) =>
      String(c.coverage_name ?? "").includes("일반암") &&
      Number(String(c.coverage_amount ?? "").replace(/,/g, "")) === FIXTURE.coverage_amount,
  );
  assert.ok(hit, "verified coverage must reach Claude via review_candidates coverages");
  const baselineHit = (review.key_coverage_baseline_facts || []).find(
    (f) =>
      String(f.status || "").toLowerCase() === "verified" &&
      Number(f.coverage_amount) === FIXTURE.coverage_amount,
  );
  assert.ok(baselineHit, "verified baseline facts must be exposed on review candidate");

  const early = buildEarlyBorrowedFactBoundary({
    reality: { policies: [weak], policy_count: 1 },
    question: "암 진단금이 부족한 것 같아",
  });
  const nums = new Set((early.allowed_numbers || []).map(String));
  assert.ok(
    nums.has(String(FIXTURE.coverage_amount)) || nums.has("50000000"),
    "verified coverage amount must be speak-allowed without PDF re-attach",
  );
}

let failed = 0;
for (const [name, fn] of [
  ["sidecar_hint_coverage_facts", testSidecarHintAsksForCoverageFacts],
  ["normalize_infer_cancer_item_locator", testNormalizeInfersCancerItemAndLocator],
  ["validate_marks_verified", testValidateMarksVerified],
  ["chart_reinjects_verified_coverage", testChartReinjectsVerifiedCoverageWithoutPdf],
  ["opinion_foreign_not_promoted", testOpinionAndForeignCoverageNotPromoted],
  ["no_hardcoded_product_in_hint", testNoHardcodedProductInHint],
  [
    "weak_identity_review_keeps_verified_coverage",
    testWeakIdentityReviewCandidateKeepsVerifiedCoverage,
  ],
]) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}:`, err?.message || err);
  }
}

if (failed) {
  console.error(`FAILED ${failed}`);
  process.exit(1);
}
console.log("ALL_PASS key-verified-coverage-reinjection-unit-test");
