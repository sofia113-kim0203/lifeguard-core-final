/**
 * Current-contract fact path only.
 * Does not import dirty Preview files. ASCII fixtures.
 */
import assert from "node:assert/strict";
import { filterCurrentActivePolicies } from "../src/lib/keyInsuranceScreenFacts.js";
import {
  collectCurrentContractFactStore,
  executeCurrentContractFactRequest,
} from "../server/keyCore/keyCurrentContractFactPath.js";
import {
  KEY_EXACT_FACT_TOOL_NAME,
  buildKeyExactFactToolResults,
  retrieveExactCustomerFact,
} from "../server/keyCore/keyExactFactRetrieval.js";

const checks = [];
const check = (name, fn) => {
  fn();
  checks.push(name);
  console.log(`PASS ${name}`);
};

check("unknown is not none when coverage list is absent", () => {
  const store = collectCurrentContractFactStore({ customerId: "cust-a" });
  const unknown = executeCurrentContractFactRequest({
    slot: "coverages",
    topic: "cancer",
    customerId: "cust-a",
    store,
  });
  assert.equal(unknown.status, "unknown");
  assert.notEqual(unknown.status, "none");
});

check("empty confirmed list is none for current contracts", () => {
  const store = collectCurrentContractFactStore({
    customerId: "cust-a",
    policyTruthContext: { confirmed_contracts: [] },
  });
  const none = executeCurrentContractFactRequest({
    slot: "current_contracts",
    customerId: "cust-a",
    store,
  });
  assert.equal(none.status, "none");
  assert.equal(none.complete, true);
});

check("ended contracts are not current", () => {
  const store = collectCurrentContractFactStore({
    customerId: "cust-a",
    policyTruthContext: {
      confirmed_contracts: [
        {
          customer_id: "cust-a",
          contract_id: "c-live",
          insurer: "LiveCo",
          product_name: "LiveMed",
          status: "active",
        },
        {
          customer_id: "cust-a",
          contract_id: "c-ended",
          insurer: "EndedCo",
          product_name: "EndedMed",
          status: "terminated",
        },
      ],
    },
  });
  const contracts = executeCurrentContractFactRequest({
    slot: "current_contracts",
    customerId: "cust-a",
    store,
  });
  assert.equal(contracts.facts.some((f) => f.contract_id === "c-ended"), false);
  assert.equal(contracts.facts.some((f) => f.contract_id === "c-live"), true);
});

check("live HomeChat policies keep current contracts without factory trust tokens", () => {
  const livePolicies = [
    {
      id: "p-pending",
      customer_id: "cust-a",
      insurer_name: "Test Sonbo",
      product_name: "Test Silson",
      is_active: true,
      monthly_premium: 12300,
      source: "upload_extract",
      coverage_summary: {
        factory_verification_status: "pending_unverified",
        factory_analysis_status: "pending_unverified",
        rider_details: [{ rider_name: "indemnity", coverage_amount: 10000 }],
      },
    },
    {
      id: "p-review",
      customer_id: "cust-a",
      insurer_name: "Hanwha",
      product_name: "Hanwha Simple",
      is_active: true,
      source: "manual",
    },
    {
      id: "p-ended",
      customer_id: "cust-a",
      insurer_name: "EndedCo",
      is_active: false,
      policy_status: "retired",
    },
  ];
  const current = filterCurrentActivePolicies(livePolicies);
  const store = collectCurrentContractFactStore({
    customerId: "cust-a",
    policyTruthContext: { VERIFIED_POLICY_LEDGER: { confirmed_contracts: [] } },
    chart: { confirmed_contracts: [], personal_review_candidates: [] },
    readyCardSsot: { policies: current },
  });
  const contracts = executeCurrentContractFactRequest({
    slot: "current_contracts",
    customerId: "cust-a",
    store,
  });
  assert.equal(contracts.status, "partial");
  assert.deepEqual(
    contracts.facts.map((f) => f.contract_id).sort(),
    ["p-pending", "p-review"],
  );
  assert.equal(
    contracts.facts.find((f) => f.contract_id === "p-pending").evidence,
    "목록에 있으나 원본으로 아직 확정 전",
  );
  assert.equal(
    contracts.facts.every((f) => !JSON.stringify(f).includes("pending_unverified")),
    true,
  );
  assert.equal(
    contracts.facts.every((f) => f.evidence !== "원본으로 확인됨"),
    true,
  );
  const cancer = executeCurrentContractFactRequest({
    slot: "coverages",
    topic: "cancer",
    customerId: "cust-a",
    store,
  });
  assert.equal(cancer.status, "unknown");
  assert.notEqual(cancer.status, "none");
  const indemnity = executeCurrentContractFactRequest({
    slot: "coverages",
    topic: "indemnity",
    customerId: "cust-a",
    store,
  });
  assert.equal(indemnity.status, "partial");
  assert.equal(indemnity.facts[0].coverage_name, "indemnity");
  const premiums = executeCurrentContractFactRequest({
    slot: "premiums",
    customerId: "cust-a",
    store,
  });
  assert.equal(
    premiums.facts.some((f) => f.contract_id === "p-pending" && f.monthly_premium === 12300),
    true,
  );
});

check("other customer rows stay out; forbidden customer id is rejected", () => {
  const store = collectCurrentContractFactStore({
    customerId: "cust-a",
    policyTruthContext: {
      confirmed_contracts: [
        { customer_id: "cust-b", contract_id: "other", insurer: "OtherCo" },
        { customer_id: "cust-a", contract_id: "mine", insurer: "MineCo", status: "active" },
      ],
    },
  });
  const mine = executeCurrentContractFactRequest({
    slot: "current_contracts",
    customerId: "cust-a",
    store,
  });
  assert.equal(mine.facts.every((f) => f.insurer !== "OtherCo"), true);
  const banned = executeCurrentContractFactRequest({
    slot: "current_contracts",
    customerId: "cust-a",
    store,
    input: { slot: "current_contracts", customerId: "cust-b" },
  });
  assert.equal(banned.rejected, "forbidden_argument");
});

check("existing exact get path is unchanged", () => {
  const hit = retrieveExactCustomerFact({
    customerId: "cust-a",
    coverageName: "cancer_dx",
    contractId: "c-1",
    rows: [
      {
        customer_id: "cust-a",
        contract_id: "c-1",
        coverage_name: "cancer_dx",
        coverage_amount: 1000,
      },
    ],
  });
  assert.equal(hit.status, "hit");
  assert.equal(hit.value, 1000);
});

await (async () => {
  const store = collectCurrentContractFactStore({
    customerId: "cust-a",
    policyTruthContext: {
      confirmed_contracts: [
        {
          customer_id: "cust-a",
          contract_id: "c-1",
          insurer: "LiveCo",
          status: "active",
        },
      ],
    },
  });
  const batch = await buildKeyExactFactToolResults(
    [
      {
        type: "tool_use",
        id: "1",
        name: KEY_EXACT_FACT_TOOL_NAME,
        input: { slot: "current_contracts" },
      },
    ],
    { customerId: "cust-a", store, rows: [] },
  );
  const returned = JSON.parse(batch[0].content);
  assert.equal(returned.facts[0].contract_id, "c-1");
  checks.push("slot tool_result uses current-contract path");
  console.log("PASS slot tool_result uses current-contract path");
})();

assert.equal(checks.length >= 6, true);
console.log(`CURRENT_CONTRACT_FACT_PATH ${checks.length} checks PASS`);
