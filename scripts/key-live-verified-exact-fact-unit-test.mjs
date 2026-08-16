/**
 * Live verified store is the request_key_fact truth source.
 * Card / selectedInternalCard amounts are not used as the final value.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LIVE_VERIFIED_FACT_HELPER,
  LIVE_VERIFIED_FACT_SOURCE_KIND,
  LIVE_VERIFIED_FACT_STORE,
  attachLiveFactProvenance,
  collectExactFactRowsFromLiveVerifiedPolicies,
  loadLiveVerifiedExactFactRows,
} from "../server/keyCore/keyLiveVerifiedExactFactStore.js";
import {
  KEY_EXACT_FACT_TOOL_NAME,
  buildKeyExactFactToolResults,
  collectExactFactRowsFromKeyStore,
  listExactCoverageNames,
  retrieveExactCustomerFact,
} from "../server/keyCore/keyExactFactRetrieval.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CID = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

const LIVE_POLICIES = [
  {
    id: "c-hanwha",
    customer_id: CID,
    insurer_name: "한화손해보험",
    product_name: "한화실손",
    coverage_summary: {
      source_document_id: "doc-1",
      key_coverage_baseline_facts: [
        {
          original_coverage_name: "질병수술비",
          coverage_amount: "30만원",
          status: "verified",
        },
        {
          coverage_name: "입원비",
          coverage_amount: "10만원",
          status: "unverified",
        },
      ],
    },
  },
];

test("exact one-row hit from live verified baseline facts", () => {
  const rows = collectExactFactRowsFromLiveVerifiedPolicies({
    customerId: CID,
    policies: LIVE_POLICIES,
  });
  const got = retrieveExactCustomerFact({
    rows,
    customerId: CID,
    contractId: "c-hanwha",
    coverageName: "질병수술비",
    field: "amount",
  });
  assert.equal(got.status, "hit");
  assert.equal(got.value, "30만원");
  assert.equal(got.facts.length, 1);
});

test("unverified baseline facts are not live truth", () => {
  const rows = collectExactFactRowsFromLiveVerifiedPolicies({
    customerId: CID,
    policies: LIVE_POLICIES,
  });
  const got = retrieveExactCustomerFact({
    rows,
    customerId: CID,
    coverageName: "입원비",
    field: "amount",
  });
  assert.equal(got.status, "unknown");
  assert.equal(got.value, null);
});

test("same coverage on two contracts without contract_id is ambiguous", () => {
  const rows = collectExactFactRowsFromLiveVerifiedPolicies({
    customerId: CID,
    policies: [
      {
        id: "c1",
        customer_id: CID,
        coverage_summary: {
          key_coverage_baseline_facts: [
            { coverage_name: "질병수술비", coverage_amount: "30만원", status: "verified" },
          ],
        },
      },
      {
        id: "c2",
        customer_id: CID,
        coverage_summary: {
          key_coverage_baseline_facts: [
            { coverage_name: "질병수술비", coverage_amount: "50만원", status: "verified" },
          ],
        },
      },
    ],
  });
  const got = retrieveExactCustomerFact({
    rows,
    customerId: CID,
    coverageName: "질병수술비",
    field: "amount",
  });
  assert.equal(got.status, "ambiguous");
  assert.equal(got.value, null);
  assert.equal(got.matching_contracts.length, 2);
});

test("missing coverage is unknown — no guess", () => {
  const rows = collectExactFactRowsFromLiveVerifiedPolicies({
    customerId: CID,
    policies: LIVE_POLICIES,
  });
  const got = retrieveExactCustomerFact({
    rows,
    customerId: CID,
    coverageName: "암진단비",
    field: "amount",
  });
  assert.equal(got.status, "unknown");
  assert.equal(got.value, null);
});

test("other customer live rows are never returned", () => {
  const rows = collectExactFactRowsFromLiveVerifiedPolicies({
    customerId: CID,
    policies: [
      {
        id: "c-other",
        customer_id: OTHER,
        coverage_summary: {
          key_coverage_baseline_facts: [
            { coverage_name: "질병수술비", coverage_amount: "99만원", status: "verified" },
          ],
        },
      },
      ...LIVE_POLICIES,
    ],
  });
  assert.equal(rows.every((r) => r.customer_id === CID), true);
  const leaked = retrieveExactCustomerFact({
    rows,
    customerId: CID,
    coverageName: "질병수술비",
    field: "amount",
  });
  assert.equal(leaked.value, "30만원");
  const other = retrieveExactCustomerFact({
    rows,
    customerId: OTHER,
    coverageName: "질병수술비",
    field: "amount",
  });
  assert.equal(other.status, "unknown");
  assert.equal(other.value, null);
});

test("card amount is not used when live store rows are empty", () => {
  const cardRows = collectExactFactRowsFromKeyStore({
    customerId: CID,
    chart: {
      insurance_contracts: [
        {
          contract_id: "c-card",
          coverages: [{ coverage_name: "질병수술비", coverage_amount: "30만원" }],
        },
      ],
    },
  });
  assert.equal(cardRows.length, 1);
  const liveRows = collectExactFactRowsFromLiveVerifiedPolicies({
    customerId: CID,
    policies: [],
  });
  const results = buildKeyExactFactToolResults(
    [
      {
        type: "tool_use",
        id: "tu_1",
        name: "request_key_fact",
        input: { action: "get", coverage_name: "질병수술비", field: "amount" },
      },
    ],
    { customerId: CID, rows: liveRows },
  );
  const body = JSON.parse(results[0].content);
  assert.equal(body.status, "unknown");
  assert.equal(body.value, null);
});

test("FIND list_names returns live addresses, no amounts, no other customer", () => {
  const rows = collectExactFactRowsFromLiveVerifiedPolicies({
    customerId: CID,
    policies: [
      ...LIVE_POLICIES,
      {
        id: "c-other",
        customer_id: OTHER,
        insurer_name: "다른보험",
        product_name: "다른상품",
        coverage_summary: {
          key_coverage_baseline_facts: [
            { coverage_name: "질병수술비", coverage_amount: "99만원", status: "verified" },
          ],
        },
      },
    ],
  });
  const found = listExactCoverageNames({ rows, customerId: CID });
  assert.equal(found.status, "hit");
  assert.equal(found.coverage_names.length, 1);
  assert.equal(found.coverage_names[0].contract_id, "c-hanwha");
  assert.equal(found.coverage_names[0].coverage_name, "질병수술비");
  assert.equal(found.coverage_names[0].insurer_name, "한화손해보험");
  assert.equal(found.coverage_names[0].product_name, "한화실손");
  const dumped = JSON.stringify(found);
  assert.equal(dumped.includes("30만원"), false);
  assert.equal(dumped.includes("99만원"), false);
  assert.equal(dumped.includes("다른보험"), false);
});

test("FIND address then GET exact amount is one path", () => {
  const rows = collectExactFactRowsFromLiveVerifiedPolicies({
    customerId: CID,
    policies: LIVE_POLICIES,
  });
  const found = listExactCoverageNames({ rows, customerId: CID });
  const addr = found.coverage_names[0];
  const results = buildKeyExactFactToolResults(
    [
      {
        type: "tool_use",
        id: "tu_find",
        name: KEY_EXACT_FACT_TOOL_NAME,
        input: { action: "list_names" },
      },
      {
        type: "tool_use",
        id: "tu_get",
        name: KEY_EXACT_FACT_TOOL_NAME,
        input: {
          action: "get",
          contract_id: addr.contract_id,
          coverage_name: addr.coverage_name,
          field: "amount",
        },
      },
    ],
    { customerId: CID, rows },
  );
  const listBody = JSON.parse(results[0].content);
  const getBody = JSON.parse(results[1].content);
  assert.equal(listBody.status, "hit");
  assert.equal(JSON.stringify(listBody).includes("30만원"), false);
  assert.equal(getBody.status, "hit");
  assert.equal(getBody.value, "30만원");
});

test("empty live FIND is unknown — card names are not addresses", () => {
  const cardRows = collectExactFactRowsFromKeyStore({
    customerId: CID,
    chart: {
      insurance_contracts: [
        {
          contract_id: "c-card",
          coverages: [{ coverage_name: "질병수술비", coverage_amount: "30만원" }],
        },
      ],
    },
  });
  assert.equal(cardRows.length, 1);
  const liveRows = collectExactFactRowsFromLiveVerifiedPolicies({
    customerId: CID,
    policies: [],
  });
  const found = listExactCoverageNames({ rows: liveRows, customerId: CID });
  assert.equal(found.status, "unknown");
  assert.equal(found.coverage_names.length, 0);
});

test("live hit attaches safe provenance only — no fact_ref invented", () => {
  const rows = collectExactFactRowsFromLiveVerifiedPolicies({
    customerId: CID,
    policies: LIVE_POLICIES,
  });
  const raw = retrieveExactCustomerFact({
    rows,
    customerId: CID,
    contractId: "c-hanwha",
    coverageName: "질병수술비",
    field: "amount",
  });
  const got = attachLiveFactProvenance(
    raw,
    {
      source_kind: LIVE_VERIFIED_FACT_SOURCE_KIND,
      store: LIVE_VERIFIED_FACT_STORE,
      helper: LIVE_VERIFIED_FACT_HELPER,
      live_store_read: true,
    },
    { contractId: "c-hanwha", coverageName: "질병수술비", field: "amount" },
  );
  assert.equal(got.metadata.source_kind, LIVE_VERIFIED_FACT_SOURCE_KIND);
  assert.equal(got.metadata.store, LIVE_VERIFIED_FACT_STORE);
  assert.equal(got.metadata.helper, LIVE_VERIFIED_FACT_HELPER);
  assert.equal(got.metadata.contract_ref, "c-hanwha");
  assert.equal(got.metadata.coverage_ref, "질병수술비");
  assert.equal(got.metadata.field, "amount");
  assert.equal(got.metadata.result_status, "hit");
  assert.equal("fact_ref" in got.metadata, false);
  assert.equal(JSON.stringify(got.metadata).includes("30만원"), false);
});

await testAsync("missing supabase fails closed to empty live rows", async () => {
  const loaded = await loadLiveVerifiedExactFactRows({
    supabase: null,
    customerId: CID,
  });
  assert.equal(loaded.rows.length, 0);
  assert.equal(loaded.provenance.live_store_read, false);
  assert.equal(loaded.provenance.store, LIVE_VERIFIED_FACT_STORE);
});

test("same-ledger confirmed name+amount pair is GET truth, not the card", () => {
  const rows = collectExactFactRowsFromLiveVerifiedPolicies({
    customerId: CID,
    policies: [
      {
        id: "c-hanwha",
        customer_id: CID,
        insurer_name: "한화손해보험",
        product_name: "한화실손",
        coverage_summary: {
          source_document_id: "doc-1",
          key_coverage_baseline_facts: [],
          key_confirmed_source_facts: [
            {
              fact_type: "coverage_name",
              literal_value: "질병수술비",
              source_document_id: "doc-1",
              confirmation_source: "key_claude_original_document",
            },
            {
              fact_type: "coverage_amount",
              literal_value: "30만원",
              source_document_id: "doc-1",
              confirmation_source: "key_claude_original_document",
            },
          ],
        },
      },
    ],
  });
  const found = listExactCoverageNames({ rows, customerId: CID });
  assert.equal(found.status, "hit");
  assert.equal(found.coverage_names[0].coverage_name, "질병수술비");
  const got = retrieveExactCustomerFact({
    rows,
    customerId: CID,
    contractId: "c-hanwha",
    coverageName: "질병수술비",
    field: "amount",
  });
  assert.equal(got.status, "hit");
  assert.equal(got.value, "30만원");
});

test("unpaired confirmed name is FIND-only — GET stays unknown", () => {
  const rows = collectExactFactRowsFromLiveVerifiedPolicies({
    customerId: CID,
    policies: [
      {
        id: "c-hanwha",
        customer_id: CID,
        coverage_summary: {
          key_confirmed_source_facts: [
            {
              fact_type: "coverage_name",
              literal_value: "질병수술비",
              source_document_id: "doc-1",
            },
          ],
        },
      },
    ],
  });
  const found = listExactCoverageNames({ rows, customerId: CID });
  assert.equal(found.coverage_names[0].coverage_name, "질병수술비");
  const got = retrieveExactCustomerFact({
    rows,
    customerId: CID,
    coverageName: "질병수술비",
    field: "amount",
  });
  assert.equal(got.status, "unknown");
  assert.equal(got.value, null);
});

test("product live-store module has no hardcoded B amount", () => {
  const src = readFileSync(
    join(ROOT, "server/keyCore/keyLiveVerifiedExactFactStore.js"),
    "utf8",
  );
  assert.equal(src.includes("30만원"), false);
  assert.equal(src.includes("keyJamo"), false);
  assert.equal(src.includes("wordComposition"), false);
  const wire = readFileSync(join(ROOT, "server/keyCore/keyClaudeFirstDirect.js"), "utf8");
  assert.equal(wire.includes("loadLiveVerifiedExactFactRows"), true);
  assert.equal(/rows:\s*keyFactRows/.test(wire), false);
});
