/**
 * coverageGapInputBuilder — riders normalize for legacy object[] / mixed[] rows.
 */
import assert from "node:assert/strict";
import {
  buildCoverageGapInputFromMemory,
  normalizeRidersForGapInput,
} from "../server/coverageGapInputBuilder.js";

const POLICY_ID = "policy-gap-riders-normalize-0001";

function buildInput(policies) {
  return buildCoverageGapInputFromMemory({
    snapshot: { customer_id: "cust-1", facts: [], memory_version: 1 },
    policies,
  });
}

function coverageInputFact(input) {
  return input.memory_facts.find((fact) => fact.fact_key === `insurance.policy.${POLICY_ID}.coverage_input`);
}

function assertNoObjectObject(value) {
  assert.ok(!String(value ?? "").includes("[object Object]"), "fact_value must not contain [object Object]");
}

function assertHoldingsStringArrayOnly(holdings) {
  assert.ok(Array.isArray(holdings.riders));
  assert.ok(holdings.riders.every((entry) => typeof entry === "string"));
}

let passed = 0;
let failed = 0;

function runCase(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    failed += 1;
  }
}

console.log("coverage-gap-input-builder-riders-normalize-test");

runCase("string[] matches riders.join(\",\") exactly", () => {
  const riders = ["암진단비", "뇌혈관질환진단비"];
  const legacyJoin = riders.join(",");
  const input = buildInput([
    {
      id: POLICY_ID,
      insurer_name: "삼성생명",
      product_name: "실손의료비",
      policy_type: "indemnity",
      monthly_premium: 45000,
      coverage_summary: { riders },
      is_active: true,
    },
  ]);
  const fact = coverageInputFact(input);
  assert.ok(fact);
  assert.equal(fact.fact_value, `삼성생명/실손의료비(indemnity) 보험료:45000 특약:${legacyJoin} 상태:유지`);
  assert.deepEqual(normalizeRidersForGapInput(riders), riders);
  assert.deepEqual(input.insurance_holdings[0].riders, riders);
  assertHoldingsStringArrayOnly(input.insurance_holdings[0]);
  assertNoObjectObject(fact.fact_value);
});

runCase("object[] rider_name eligible → 특약:암진단비", () => {
  const input = buildInput([
    {
      id: POLICY_ID,
      insurer_name: "메리츠화재",
      product_name: "건강보험",
      policy_type: "general",
      coverage_summary: {
        riders: [{ rider_name: "암진단비", coverage_amount: 30000000 }],
      },
      is_active: true,
    },
  ]);
  const fact = coverageInputFact(input);
  assert.ok(fact);
  assert.match(fact.fact_value, /특약:암진단비/);
  assert.deepEqual(input.insurance_holdings[0].riders, ["암진단비"]);
  assertHoldingsStringArrayOnly(input.insurance_holdings[0]);
  assertNoObjectObject(fact.fact_value);
});

runCase("object[] coverage_name eligible → 통과", () => {
  const input = buildInput([
    {
      id: POLICY_ID,
      insurer_name: "한화생명",
      product_name: "종신보험",
      coverage_summary: {
        riders: [{ coverage_name: "뇌혈관질환진단비", coverage_amount: 10000000 }],
      },
      is_active: true,
    },
  ]);
  const fact = coverageInputFact(input);
  assert.ok(fact);
  assert.match(fact.fact_value, /특약:뇌혈관질환진단비/);
  assert.deepEqual(input.insurance_holdings[0].riders, ["뇌혈관질환진단비"]);
  assertNoObjectObject(fact.fact_value);
});

runCase("legacy object rider_name \"명\" → 특약:미기록", () => {
  const input = buildInput([
    {
      id: POLICY_ID,
      insurer_name: "삼성화재",
      product_name: "종합보험",
      coverage_summary: {
        riders: [{ rider_name: "명", coverage_amount: null, source_line: "담보명" }],
      },
      is_active: true,
    },
  ]);
  const fact = coverageInputFact(input);
  assert.ok(fact);
  assert.match(fact.fact_value, /특약:미기록/);
  assert.deepEqual(input.insurance_holdings[0].riders, []);
  assertNoObjectObject(fact.fact_value);
});

runCase("object[] name/title/label only → excluded", () => {
  const input = buildInput([
    {
      id: POLICY_ID,
      insurer_name: "DB손해보험",
      product_name: "운전자보험",
      coverage_summary: {
        riders: [
          { name: "암진단비" },
          { title: "뇌혈관질환진단비" },
          { label: "허혈성심장질환진단비" },
          { normalized_name: "질병입원일당" },
        ],
      },
      is_active: true,
    },
  ]);
  const fact = coverageInputFact(input);
  assert.ok(fact);
  assert.match(fact.fact_value, /특약:미기록/);
  assert.deepEqual(input.insurance_holdings[0].riders, []);
});

runCase("insurer/product-like labels excluded in mixed[]", () => {
  const input = buildInput([
    {
      id: POLICY_ID,
      insurer_name: "삼성화재",
      product_name: "건강보험(II)2306",
      coverage_summary: {
        riders: [
          "삼성화재",
          "건강보험(II)2306",
          { rider_name: "암진단비" },
          "급성심근경색진단비",
        ],
      },
      is_active: true,
    },
  ]);
  const fact = coverageInputFact(input);
  assert.ok(fact);
  assert.match(fact.fact_value, /특약:암진단비,급성심근경색진단비/);
  assert.deepEqual(input.insurance_holdings[0].riders, ["암진단비", "급성심근경색진단비"]);
  assertNoObjectObject(fact.fact_value);
});

runCase("null and empty → 미기록", () => {
  for (const riders of [null, undefined, []]) {
    const input = buildInput([
      {
        id: POLICY_ID,
        insurer_name: "DB손해보험",
        product_name: "운전자보험",
        coverage_summary: { riders },
        is_active: true,
      },
    ]);
    const fact = coverageInputFact(input);
    assert.ok(fact);
    assert.match(fact.fact_value, /특약:미기록/);
    assert.deepEqual(input.insurance_holdings[0].riders, []);
    assertNoObjectObject(fact.fact_value);
  }
});

runCase("[object Object] never appears in fact_value", () => {
  const input = buildInput([
    {
      id: POLICY_ID,
      insurer_name: "삼성화재",
      product_name: "종합보험",
      coverage_summary: {
        riders: [{ rider_name: "암진단비" }, {}, { rider_name: "[object Object]" }, "뇌졸중진단비"],
      },
      is_active: true,
    },
  ]);
  const fact = coverageInputFact(input);
  assert.ok(fact);
  assert.match(fact.fact_value, /특약:암진단비,뇌졸중진단비/);
  assertNoObjectObject(fact.fact_value);
});

runCase("L1 coverage_sheet_row amount_value → fact 보험료 + holdings monthly_premium", () => {
  const input = buildInput([
    {
      id: POLICY_ID,
      insurer_name: "KB손보",
      product_name: "건강보험",
      policy_type: "general",
      monthly_premium: null,
      premium_amount: null,
      coverage_summary: {
        record_kind: "coverage_sheet_row",
        amount_unit: "won",
        amount_value: 116568,
      },
      is_active: true,
    },
  ]);
  const fact = coverageInputFact(input);
  assert.ok(fact);
  assert.match(fact.fact_value, /보험료:116568/);
  assert.equal(input.insurance_holdings[0].monthly_premium, 116568);
});

runCase("L1 three L1 policies holdings sum 318683", () => {
  const l1 = (amount) => ({
    id: `${POLICY_ID}-${amount}`,
    insurer_name: "KB손보",
    product_name: "건강보험",
    policy_type: "general",
    monthly_premium: null,
    premium_amount: null,
    coverage_summary: {
      record_kind: "coverage_sheet_row",
      amount_unit: "won",
      amount_value: amount,
    },
    is_active: true,
  });
  const input = buildInput([l1(116568), l1(35560), l1(166555)]);
  const total = input.insurance_holdings.reduce(
    (sum, holding) => sum + (holding.monthly_premium ?? 0),
    0,
  );
  assert.equal(total, 318683);
});

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
