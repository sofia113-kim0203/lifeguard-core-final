/**
 * R12 — resolvePolicyPremium JS ↔ TS port parity (shared test vectors).
 */
import assert from "node:assert/strict";
import { resolvePolicyPremium as resolvePolicyPremiumJs } from "../src/lib/resolvePolicyPremium.js";
import { resolvePolicyPremium as resolvePolicyPremiumTs } from "../supabase/functions/memory-builder-worker/resolvePolicyPremium.ts";

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

const vectors = [
  { monthly_premium: 45000 },
  { premium_amount: 42000 },
  l1Policy(116568),
  {
    monthly_premium: 99999,
    coverage_summary: {
      record_kind: "coverage_sheet_row",
      amount_unit: "won",
      amount_value: 116568,
    },
  },
  null,
  {},
  { monthly_premium: null, premium_amount: null },
  { monthly_premium: 0 },
  { monthly_premium: -1000 },
  { coverage_summary: { amount_unit: "won", amount_value: 116568 } },
  {
    coverage_summary: {
      record_kind: "coverage_sheet_row",
      amount_unit: "unknown",
      amount_value: 116568,
    },
  },
];

console.log("resolve-policy-premium-ts-parity-test");

let passed = 0;
let failed = 0;

for (const [index, policy] of vectors.entries()) {
  try {
    const js = resolvePolicyPremiumJs(policy);
    const ts = resolvePolicyPremiumTs(policy);
    assert.equal(ts, js, `vector ${index}: TS ${ts} !== JS ${js}`);
    console.log(`PASS vector ${index}`);
    passed += 1;
  } catch (error) {
    console.log(`FAIL vector ${index}: ${error instanceof Error ? error.message : String(error)}`);
    failed += 1;
  }
}

const jinwooSum = [l1Policy(116568), l1Policy(35560), l1Policy(166555)].reduce(
  (sum, policy) => sum + (resolvePolicyPremiumTs(policy) ?? 0),
  0,
);
try {
  assert.equal(jinwooSum, 318683);
  console.log("PASS jinwoo three-policy sum 318683");
  passed += 1;
} catch (error) {
  console.log(`FAIL jinwoo sum: ${error instanceof Error ? error.message : String(error)}`);
  failed += 1;
}

console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
