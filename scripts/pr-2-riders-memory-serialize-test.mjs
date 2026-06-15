/**
 * PR-2 — Riders memory serialization + gap keyword detection tests.
 */
import assert from "node:assert/strict";
import { analyzeCoverageGaps } from "../server/coverageGapAnalysisEngine.js";
import { buildCoverageGapInputFromMemory } from "../server/coverageGapInputBuilder.js";
import { assertRidersStringArray } from "../server/coverageRiderPopulation.js";
import {
  buildPolicyRiderMemoryFields,
  serializePolicyRiders,
} from "../server/memoryBuilderRidersSerialize.js";

const POLICY_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function buildMemoryFactsFromPolicy(policy) {
  const { riders, riderSuffix, metadataExtra } = buildPolicyRiderMemoryFields(policy.coverage_summary);
  const facts = [
    {
      fact_key: `insurance.policy.${policy.id}.summary`,
      fact_value: `메리츠/종합보험(유지)${riderSuffix}`,
      fact_type: "insurance",
      source_table: "profile_insurance_policies",
      metadata_json: metadataExtra,
    },
  ];

  if (riders.hasStructuredRiders && riders.text) {
    facts.push({
      fact_key: `insurance.policy.${policy.id}.riders`,
      fact_value: riders.text,
      fact_type: "insurance",
      source_table: "profile_insurance_policies",
      metadata_json: {
        riders: riders.names,
        rider_details: riders.structured,
        riders_status: riders.status,
      },
    });
  }

  return facts;
}

function assertGapDetects(facts, coverageType) {
  const analysis = analyzeCoverageGaps({ customer_id: "test", memory: facts });
  const item = analysis.coverage_gaps.find((entry) => entry.coverage_type === coverageType);
  assert.ok(item, `expected gap item for ${coverageType}`);
  assert.notEqual(item.status, "missing", `${coverageType} should not be missing when riders mention keywords`);
  assert.ok(item.evidence_fact_keys.length > 0, `${coverageType} should have evidence facts`);
  return item;
}

const report = {
  phase: "PR-2",
  tests: {},
};

report.tests.noStringDamage = (() => {
  const coverageSummary = {
    riders: ["암진단비(갑상선암 제외)", "뇌혈관질환진단비", "급성심근경색진단비"],
    rider_details: [
      { rider_name: "암진단비(갑상선암 제외)", coverage_amount: 30000000, category: "cancer" },
      { rider_name: "뇌혈관질환진단비", coverage_amount: 10000000, category: "brain" },
      { rider_name: "급성심근경색진단비", coverage_amount: 10000000, category: "heart" },
    ],
  };
  const serialized = serializePolicyRiders(coverageSummary);
  const facts = buildMemoryFactsFromPolicy({ id: POLICY_ID, coverage_summary: coverageSummary });
  const summaryFact = facts.find((fact) => fact.fact_key.endsWith(".summary"));

  const pass =
    assertRidersStringArray(coverageSummary.riders) &&
    !summaryFact.fact_value.includes("[object Object]") &&
    summaryFact.fact_value.includes("암진단비") &&
    summaryFact.fact_value.includes("뇌혈관") &&
    summaryFact.fact_value.includes("급성심근경색") &&
    serialized.names.length === 3;

  return {
    pass,
    fact_value: summaryFact.fact_value,
    structured_count: serialized.names.length,
  };
})();

report.tests.inputBuilderPath = (() => {
  const coverageSummary = {
    riders: ["암진단비", "뇌혈관질환진단비"],
    rider_details: [
      { rider_name: "암진단비", coverage_amount: 5000000 },
      { rider_name: "뇌혈관질환진단비", coverage_amount: 3000000 },
    ],
  };

  const input = buildCoverageGapInputFromMemory({
    snapshot: { customer_id: "cust-1", facts: [], memory_version: 1 },
    policies: [
      {
        id: POLICY_ID,
        insurer_name: "메리츠화재",
        product_name: "종합보험",
        policy_type: "general",
        coverage_summary: coverageSummary,
        is_active: true,
      },
    ],
  });

  const policyFact = input.memory_facts.find((fact) => fact.fact_key.endsWith(".coverage_input"));
  const pass =
    assertRidersStringArray(coverageSummary.riders) &&
    policyFact.fact_value.includes("암진단비") &&
    policyFact.fact_value.includes("뇌혈관") &&
    !policyFact.fact_value.includes("[object Object]");

  return { pass, fact_value: policyFact?.fact_value ?? null };
})();

report.tests.memoryFactReadable = (() => {
  const coverageSummary = {
    riders: ["암진단비", "뇌졸중진단비"],
    rider_details: [
      { rider_name: "암진단비", coverage_amount: 5000000 },
      { rider_name: "뇌졸중진단비", coverage_amount: 3000000 },
    ],
  };
  const facts = buildMemoryFactsFromPolicy({ id: POLICY_ID, coverage_summary: coverageSummary });
  const summaryFact = facts.find((fact) => fact.fact_key.endsWith(".summary"));
  const ridersFact = facts.find((fact) => fact.fact_key.endsWith(".riders"));

  const ridersMeta = summaryFact.metadata_json.riders;
  const pass =
    assertRidersStringArray(coverageSummary.riders) &&
    Array.isArray(ridersMeta) &&
    ridersMeta.every((row) => typeof row === "string") &&
    ridersMeta.includes("암진단비") &&
    ridersMeta.includes("뇌졸중진단비") &&
    Array.isArray(summaryFact.metadata_json.rider_details) &&
    !!ridersFact;

  return {
    pass,
    riders_meta: ridersMeta,
    riders_fact_value: ridersFact?.fact_value ?? null,
  };
})();

report.tests.gapKeywordDetection = (() => {
  const coverageSummary = {
    riders: ["암진단비", "뇌혈관질환진단비", "급성심근경색진단비"],
  };
  const facts = buildMemoryFactsFromPolicy({ id: POLICY_ID, coverage_summary: coverageSummary });

  try {
    const cancer = assertGapDetects(facts, "cancer");
    const brain = assertGapDetects(facts, "brain");
    const heart = assertGapDetects(facts, "heart");
    return {
      pass: true,
      cancer_status: cancer.status,
      brain_status: brain.status,
      heart_status: heart.status,
    };
  } catch (error) {
    return {
      pass: false,
      error: error.message,
    };
  }
})();

report.tests.noRidersUnknownGuard = (() => {
  const coverageSummary = { riders: [], extractor_origin: "ocr" };
  const serialized = serializePolicyRiders(coverageSummary);
  const facts = buildMemoryFactsFromPolicy({ id: POLICY_ID, coverage_summary: coverageSummary });
  const summaryFact = facts.find((fact) => fact.fact_key.endsWith(".summary"));
  const ridersFact = facts.find((fact) => fact.fact_key.endsWith(".riders"));

  const analysis = analyzeCoverageGaps({ customer_id: "test", memory: facts });
  const cancer = analysis.coverage_gaps.find((entry) => entry.coverage_type === "cancer");

  const pass =
    assertRidersStringArray(coverageSummary.riders) &&
    serialized.status === "unknown" &&
    !summaryFact.fact_value.includes("특약") &&
    !summaryFact.fact_value.includes("미보유") &&
    !summaryFact.fact_value.includes("없음") &&
    !ridersFact &&
    cancer?.status === "missing" &&
    !String(summaryFact.fact_value).includes("미보유");

  return {
    pass,
    riders_status: serialized.status,
    summary_fact_value: summaryFact.fact_value,
    cancer_status: cancer?.status ?? null,
  };
})();

report.tests.legacyStringRiders = (() => {
  const coverageSummary = {
    riders: ["암진단비", "뇌혈관질환진단비"],
  };
  const serialized = serializePolicyRiders(coverageSummary);
  const pass =
    assertRidersStringArray(coverageSummary.riders) &&
    serialized.names.length === 2 &&
    serialized.text.includes("암진단비");

  return { pass, text: serialized.text, names: serialized.names };
})();

report.allPass = Object.values(report.tests).every((test) => test.pass === true);

console.log(JSON.stringify(report, null, 2));
process.exit(report.allPass ? 0 : 1);
