/**
 * Track L1 curve B P0 — premium slot alignment + null-premium persist gate regression.
 * Usage: node scripts/coverage-sheet-l1-curve-b-p0-regression-test.mjs
 */
import { extractCoverageSheetFromOcrText } from "../server/coverageSheetExtractor.js";
import {
  filterPassingSheetRows,
  hasSheetRowPremiumUnavailableSlot,
  hasSheetRowResolvablePremium,
  isPassingSheetRow,
} from "../server/coverageSheetRowFilter.js";
import { buildPolicyRowFromSheetRow } from "../server/coverageSheetPersist.js";
import { resolvePolicyPremium } from "../src/lib/resolvePolicyPremium.js";

/** Production OCR sample — customer 284020a8 / 김진우.jpg (curve B reproduction). */
const jinwooCurveBSample = `
SUCCESS
품별
가입현황
13:28:40
2025-10-27
기본형(37개)/표준형
기준담보/권장금액
삼성화재
(9)
현대해상
(10)
DB손보
(11)
한화생명
(12)
내돈
건강보험
삼성화재
무배당
제,해약환급금
미지급형)
한화생명
건강보험
H
The
간편가입
무배당뉴하이카운전자상해보험
보험(Hi2304)1종(연만기)
실손의료비보험2004
해약환
간편가입형(5년)
무배당
(Basic)
기본플랜
원
만기
36년납/90세
만기
20년납/73세
만기
30년납/9999세
만기
65세
2024.03.29~2060.03.29
2023.08.02~2043.08.02
2020.09.11~2035.09.11
2024.03.29~9999.12.31
116,568원
35,560원
보험료미제공
166,555원
,200만
1,000만
1,000만
,850만
,000만
1,000만
2,000만
4,000만
,005만
25만
25만
0%,
급금미지급형(납입기간중
납
60(2402.4)
내삼41
4종(납입면
`;

const documentId = "0489a9cf-e108-430f-9c41-a986310b6f30";
const customerId = "284020a8-7bcb-40d6-9b0d-15ff3aca998f";

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

function findPassingRow(passing, insurerName) {
  return passing.find((row) => row.insurer_name === insurerName) ?? null;
}

console.log("coverage-sheet-l1-curve-b-p0-regression-test");

let passed = 0;
let failed = 0;

const extraction = extractCoverageSheetFromOcrText(jinwooCurveBSample);
const passing = filterPassingSheetRows(extraction.rows);

const tests = [
  ["L1 extracts exactly 4 stack carriers (not duplicate OCR carriers)", () => {
    assert(extraction.row_count === 4, `row_count=${extraction.row_count}`);
    const insurers = extraction.rows.map((row) => row.insurer_name);
    assert(insurers.join("|") === "삼성화재|현대해상|DB손보|한화생명", `insurers=${insurers.join("|")}`);
  }],
  ["persist gate yields 4 passing policies", () => {
    assert(passing.length === 4, `passing.length=${passing.length}`);
  }],
  ["DB손보 exists with null premium (보험료미제공 slot)", () => {
    const db = findPassingRow(passing, "DB손보");
    assert(db, "DB손보 row missing from passing");
    assert(isPassingSheetRow(db), "DB손보 must pass persist gate");
    assert(hasSheetRowPremiumUnavailableSlot(db), "DB손보 must have premium_unavailable slot");
    assert(!hasSheetRowResolvablePremium(db), "DB손보 must not have resolvable premium");
    assert(db.amount_value == null, `DB손보 amount_value=${db.amount_value}`);
    assert(db.amount_unit === "premium_unavailable", `DB손보 amount_unit=${db.amount_unit}`);
    assert(db.warnings.includes("PREMIUM_UNAVAILABLE"), `warnings=${db.warnings.join(",")}`);
  }],
  ["DB손보 does not receive 166,555", () => {
    const db = findPassingRow(passing, "DB손보");
    assert(db.amount_value !== 166555, "166,555 mis-attributed to DB손보");
    const policy = buildPolicyRowFromSheetRow(customerId, documentId, db);
    assert(resolvePolicyPremium(policy) == null, "resolved premium must be null for DB손보");
  }],
  ["한화생명 exists with premium 166,555", () => {
    const hwa = findPassingRow(passing, "한화생명");
    assert(hwa, "한화생명 row missing");
    assert(hwa.amount_value === 166555, `한화생명 amount_value=${hwa.amount_value}`);
    assert(hwa.amount_unit === "won", `한화생명 amount_unit=${hwa.amount_unit}`);
    const policy = buildPolicyRowFromSheetRow(customerId, documentId, hwa);
    assert(resolvePolicyPremium(policy) === 166555, "한화생명 resolved premium");
  }],
  ["삼성화재 and 현대해상 premiums unchanged after amount realignment", () => {
    const samsung = findPassingRow(passing, "삼성화재");
    const hyundai = findPassingRow(passing, "현대해상");
    assert(samsung?.amount_value === 116568, `삼성 amount=${samsung?.amount_value}`);
    assert(hyundai?.amount_value === 35560, `현대 amount=${hyundai?.amount_value}`);
  }],
  ["persist simulation total premium = 318,683", () => {
    const policies = passing.map((row) => buildPolicyRowFromSheetRow(customerId, documentId, row));
    const total = policies.reduce((sum, policy) => sum + (resolvePolicyPremium(policy) ?? 0), 0);
    assert(total === 318683, `total=${total}`);
  }],
  ["premium_unavailable slot passes gate without product pairing (P0)", () => {
    assert(
      isPassingSheetRow({
        insurer_name: "DB손보",
        product_name: null,
        amount_value: null,
        amount_unit: "premium_unavailable",
      }),
      "premium_unavailable slot must pass",
    );
    assert(
      !isPassingSheetRow({
        insurer_name: "DB손보",
        product_name: null,
        coverage_name: null,
        amount_value: null,
        amount_unit: null,
      }),
      "carrier-only with no premium slot must not pass",
    );
  }],
];

for (const [name, fn] of tests) {
  if (runCase(name, fn)) passed += 1;
  else failed += 1;
}

if (failed === 0) {
  console.log("\n--- before/after snapshot ---");
  console.log(
    JSON.stringify(
      {
        before: {
          passing_policies: 3,
          db_premium: 166555,
          hwa_policy: false,
          insurers_passing: ["삼성화재", "현대해상", "DB손보"],
        },
        after: {
          passing_policies: passing.length,
          rows: passing.map((row) => ({
            insurer: row.insurer_name,
            amount_value: row.amount_value,
            amount_unit: row.amount_unit,
            resolved_premium: resolvePolicyPremium(buildPolicyRowFromSheetRow(customerId, documentId, row)),
          })),
          premium_total: passing.reduce(
            (sum, row) => sum + (resolvePolicyPremium(buildPolicyRowFromSheetRow(customerId, documentId, row)) ?? 0),
            0,
          ),
        },
      },
      null,
      2,
    ),
  );
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
