/**
 * resolvePolicyPremium unit tests (PR#1 — resolver only, no consumer wiring).
 */
import assert from "node:assert/strict";
import { resolvePolicyPremium } from "../src/lib/resolvePolicyPremium.js";

function computePremiumStats(policies = []) {
  let premiumKnownCount = 0;
  let premiumUnknownCount = 0;
  let premiumTotal = 0;

  for (const policy of policies) {
    const premium = resolvePolicyPremium(policy);
    if (premium != null) {
      premiumKnownCount += 1;
      premiumTotal += premium;
    } else {
      premiumUnknownCount += 1;
    }
  }

  return { premiumKnownCount, premiumUnknownCount, premiumTotal };
}

function l1Policy(amountValue) {
  return {
    monthly_premium: null,
    premium_amount: null,
    coverage_summary: {
      record_kind: "coverage_sheet_row",
      amount_unit: "won",
      amount_value: amountValue,
    },
  };
}

const cases = [
  ["R1 monthly_premium 45000", () => {
    assert.equal(resolvePolicyPremium({ monthly_premium: 45000 }), 45000);
  }],
  ["R2 premium_amount 42000", () => {
    assert.equal(resolvePolicyPremium({ premium_amount: 42000 }), 42000);
  }],
  ["R3 L1 coverage_sheet_row/won/amount_value 116568", () => {
    assert.equal(resolvePolicyPremium(l1Policy(116568)), 116568);
  }],
  ["R4 top monthly_premium wins over sidecar", () => {
    assert.equal(
      resolvePolicyPremium({
        monthly_premium: 99999,
        coverage_summary: {
          record_kind: "coverage_sheet_row",
          amount_unit: "won",
          amount_value: 116568,
        },
      }),
      99999,
    );
  }],
  ["R5 all null/missing", () => {
    assert.equal(resolvePolicyPremium(null), null);
    assert.equal(resolvePolicyPremium({}), null);
    assert.equal(resolvePolicyPremium({ monthly_premium: null, premium_amount: null }), null);
  }],
  ["R6 monthly_premium 0", () => {
    assert.equal(resolvePolicyPremium({ monthly_premium: 0 }), null);
  }],
  ["R7 monthly_premium -1000", () => {
    assert.equal(resolvePolicyPremium({ monthly_premium: -1000 }), null);
  }],
  ["R8 sidecar amount only, record_kind absent", () => {
    assert.equal(
      resolvePolicyPremium({
        coverage_summary: { amount_unit: "won", amount_value: 116568 },
      }),
      null,
    );
  }],
  ["R9 coverage_sheet_row + amount_unit unknown", () => {
    assert.equal(
      resolvePolicyPremium({
        coverage_summary: {
          record_kind: "coverage_sheet_row",
          amount_unit: "unknown",
          amount_value: 116568,
        },
      }),
      null,
    );
  }],
  ["R10 three L1 policies sum 318683 knownCount 3", () => {
    const stats = computePremiumStats([l1Policy(116568), l1Policy(35560), l1Policy(166555)]);
    assert.equal(stats.premiumTotal, 318683);
    assert.equal(stats.premiumKnownCount, 3);
    assert.equal(stats.premiumUnknownCount, 0);
  }],
  ["R11 three L1 + one unknown", () => {
    const stats = computePremiumStats([
      l1Policy(116568),
      l1Policy(35560),
      l1Policy(166555),
      { monthly_premium: null, premium_amount: null },
    ]);
    assert.equal(stats.premiumKnownCount, 3);
    assert.equal(stats.premiumUnknownCount, 1);
    assert.equal(stats.premiumTotal, 318683);
  }],
];

console.log("resolve-policy-premium-unit-test");

let passed = 0;
let failed = 0;

for (const [name, fn] of cases) {
  try {
    fn();
    console.log(`PASS ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    failed += 1;
  }
}

console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
