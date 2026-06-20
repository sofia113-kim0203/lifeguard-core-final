/**
 * P1-A — Coverage Sheet Golden Fixture Suite (Cases A–E).
 * Offline only: fixtures + existing engine helpers. No DB/network/service-role.
 *
 * Usage: node scripts/coverage-sheet-p1-a-golden-fixture-test.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractCoverageSheetFromOcrText } from "../server/coverageSheetExtractor.js";
import {
  filterPassingSheetRows,
  hasSheetRowPremiumUnavailableSlot,
} from "../server/coverageSheetRowFilter.js";
import { buildPolicyRowFromSheetRow } from "../server/coverageSheetPersist.js";
import {
  computePolicyExplorerStats,
  formatPolicyPremium,
} from "../src/lib/policyExplorer.js";
import { resolvePolicyPremium } from "../src/lib/resolvePolicyPremium.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(__dirname, "..", "fixtures", "coverage-sheet-p1-a");

const STAT_KEYS = ["totalCount", "premiumKnownCount", "premiumUnknownCount", "premiumTotal"];

function loadJson(relativePath) {
  return JSON.parse(readFileSync(join(FIXTURE_ROOT, relativePath), "utf8"));
}

function loadText(relativePath) {
  return readFileSync(join(FIXTURE_ROOT, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertStats(actual, expected, label) {
  for (const key of STAT_KEYS) {
    assert(
      actual[key] === expected[key],
      `${label}.${key}: got ${actual[key]} expected ${expected[key]}`,
    );
  }
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

console.log("coverage-sheet-p1-a-golden-fixture-test");

let passed = 0;
let failed = 0;

const syntheticIds = loadJson("synthetic-ids.json");
const { customerId, documentId } = syntheticIds;

const tests = [
  [
    "Case A — Curve B slot-alignment (mis-attribution 0)",
    () => {
      const expected = loadJson("case-a-curve-b-slot-alignment/expected.json");
      const ocrText = loadText("case-a-curve-b-slot-alignment/ocr-text.txt");

      const extraction = extractCoverageSheetFromOcrText(ocrText);
      const passing = filterPassingSheetRows(extraction.rows);

      assert(extraction.row_count === expected.row_count, `row_count=${extraction.row_count}`);
      assert(
        extraction.rows.map((row) => row.insurer_name).join("|") === expected.insurers.join("|"),
        "insurer order mismatch",
      );
      assert(passing.length === expected.passing_count, `passing.length=${passing.length}`);

      const samsung = findPassingRow(passing, "삼성화재");
      const hyundai = findPassingRow(passing, "현대해상");
      const db = findPassingRow(passing, "DB손보");
      const hwa = findPassingRow(passing, "한화생명");

      assert(samsung?.amount_value === expected.samsung_amount_value, "삼성화재 amount");
      assert(hyundai?.amount_value === expected.hyundai_amount_value, "현대해상 amount");
      assert(db?.amount_value === expected.db_amount_value, "DB손보 amount_value");
      assert(db?.amount_unit === expected.db_amount_unit, "DB손보 amount_unit");
      assert(hasSheetRowPremiumUnavailableSlot(db), "DB손보 premium_unavailable slot");
      assert(hwa?.amount_value === expected.hwa_amount_value, "한화생명 amount");

      const misattributed = passing.filter(
        (row) => row.insurer_name === "DB손보" && row.amount_value === 166555,
      ).length;
      assert(misattributed === expected.misattribution_count, `misattribution_count=${misattributed}`);

      const policies = passing.map((row) => buildPolicyRowFromSheetRow(customerId, documentId, row));
      const premiumTotal = policies.reduce(
        (sum, policy) => sum + (resolvePolicyPremium(policy) ?? 0),
        0,
      );
      assert(premiumTotal === expected.premium_total, `premium_total=${premiumTotal}`);

      const stats = computePolicyExplorerStats(policies);
      assertStats(
        stats,
        {
          totalCount: 4,
          premiumKnownCount: 3,
          premiumUnknownCount: 1,
          premiumTotal: 318683,
        },
        "Case A stats",
      );
    },
  ],
  [
    "Case B — premium_unavailable display",
    () => {
      const policy = loadJson("case-b-premium-unavailable/policy.json");
      const expected = loadJson("case-b-premium-unavailable/expected.json");
      assert(
        formatPolicyPremium(policy) === expected.formatPolicyPremium,
        `formatPolicyPremium=${formatPolicyPremium(policy)}`,
      );
      assert(resolvePolicyPremium(policy) == null, "resolvePolicyPremium must be null");
    },
  ],
  [
    "Case C — Baseline Contract stats",
    () => {
      const policies = loadJson("case-c-baseline-contract/policies.json");
      const expected = loadJson("case-c-baseline-contract/expected.json");
      const stats = computePolicyExplorerStats(policies);
      assertStats(stats, expected, "Case C");
    },
  ],
  [
    "Case D — All Known (premiumUnknownCount 0, full sum)",
    () => {
      const policies = loadJson("case-d-all-known/policies.json");
      const expected = loadJson("case-d-all-known/expected.json");
      const stats = computePolicyExplorerStats(policies);
      assertStats(stats, expected, "Case D");
      assert(stats.premiumUnknownCount === 0, "premiumUnknownCount must be 0");
    },
  ],
  [
    "Case E — Multi Unknown (exclude unknown from sum)",
    () => {
      const policies = loadJson("case-e-multi-unknown/policies.json");
      const expected = loadJson("case-e-multi-unknown/expected.json");
      const stats = computePolicyExplorerStats(policies);
      assertStats(stats, expected, "Case E");
      assert(expected.premiumUnknownCount >= 2, "fixture must model multi-unknown");
    },
  ],
];

for (const [name, fn] of tests) {
  if (runCase(name, fn)) passed += 1;
  else failed += 1;
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
