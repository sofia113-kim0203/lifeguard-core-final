/**
 * Local official-evidence door proof.
 * request_key_fact → adapter → lookupProduct → lookupLocators → originalPath → range.
 * Not Preview. Not AWS. Does not rewrite factory lookup.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectCurrentContractFactStore } from "../server/keyCore/keyCurrentContractFactPath.js";
import {
  KEY_EXACT_FACT_TOOL_NAME,
  buildKeyExactFactToolResults,
  executeKeyExactFactRequest,
} from "../server/keyCore/keyExactFactRetrieval.js";
import { locatorPageRange } from "../server/keyCore/keyOfficialRangeReader.js";
import { OFFICIAL_EVIDENCE_SLOT } from "../server/keyCore/keyOfficialEvidenceAdapter.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIBRARY_ROOT =
  process.env.LIFEGUARD_LIBRARY_ROOT ||
  path.resolve(ROOT, "..", "terms-raw-library");
const CID = "local-official-e2e";
const ANICA_SHA =
  "751740c42dd4a4fab08cf109b6d910dca631035be2367a017006e20c5a14a385";
const ANICA_PAGES = 282;

function storeFor(contract) {
  return collectCurrentContractFactStore({
    customerId: CID,
    policyTruthContext: {
      confirmed_contracts: [
        {
          customer_id: CID,
          status: "active",
          ...contract,
        },
      ],
    },
  });
}

const anicaStore = storeFor({
  contract_id: "c-anica",
  insurer: "삼성화재",
  product_name: "개인용애니카자동차보험",
  contract_date: "20260611",
});

assert.equal(anicaStore.contracts[0].contract_date, "20260611");

const noPage = locatorPageRange({
  row_kind: "locator",
  locator_status: "MACHINE_VALIDATED_LOCATOR",
});
assert.equal(noPage.ok, false);
assert.equal(noPage.reason, "NO_LOCATOR");

const prevRoot = process.env.LIFEGUARD_LIBRARY_ROOT;
delete process.env.LIFEGUARD_LIBRARY_ROOT;
const noLocalRoot = await executeKeyExactFactRequest({
  slot: OFFICIAL_EVIDENCE_SLOT,
  customerId: CID,
  contractId: "c-anica",
  topic: "제52조",
  store: anicaStore,
});
if (noLocalRoot.status === "hit") {
  assert.equal(noLocalRoot.provenance.original_source, "aws");
  assert.equal(JSON.stringify(noLocalRoot).includes("C:\\\\Users\\\\sofia"), false);
} else {
  assert.equal(noLocalRoot.status, "EVIDENCE_UNAVAILABLE");
}

if (!fs.existsSync(path.join(LIBRARY_ROOT, "direct-find-lookup.mjs"))) {
  console.log(
    JSON.stringify(
      {
        LOCAL_LIBRARY_E2E: "STOP",
        PREVIEW_LIBRARY_E2E: "BLOCKED_BY_RUNTIME_SOURCE",
        reason: "library_root_missing",
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

process.env.LIFEGUARD_LIBRARY_ROOT = LIBRARY_ROOT;

const noTopic = await executeKeyExactFactRequest({
  slot: OFFICIAL_EVIDENCE_SLOT,
  customerId: CID,
  contractId: "c-anica",
  topic: "",
  store: anicaStore,
});
assert.equal(noTopic.status, "EVIDENCE_UNAVAILABLE");
assert.equal(noTopic.reason, "NO_TOPIC");

const noLocator = await executeKeyExactFactRequest({
  slot: OFFICIAL_EVIDENCE_SLOT,
  customerId: CID,
  contractId: "c-anica",
  topic: "존재하지않는조항XYZ999",
  store: anicaStore,
});
assert.equal(noLocator.status, "EVIDENCE_UNAVAILABLE");
assert.equal(noLocator.reason, "NO_LOCATOR");

const wrongVersion = await executeKeyExactFactRequest({
  slot: OFFICIAL_EVIDENCE_SLOT,
  customerId: CID,
  contractId: "c-old",
  topic: "제52조",
  store: storeFor({
    contract_id: "c-old",
    insurer: "삼성화재",
    product_name: "개인용애니카자동차보험",
    contract_date: "20100101",
  }),
});
assert.equal(wrongVersion.status, "EVIDENCE_UNAVAILABLE");
assert.notEqual(wrongVersion.provenance?.sha, ANICA_SHA);
assert.equal(String(JSON.stringify(wrongVersion)).includes(ANICA_SHA), false);

const similar = await executeKeyExactFactRequest({
  slot: OFFICIAL_EVIDENCE_SLOT,
  customerId: CID,
  contractId: "c-ghost",
  topic: "제52조",
  store: storeFor({
    contract_id: "c-ghost",
    insurer: "삼성화재",
    product_name: "없는유사상품자동차보험",
    contract_date: "20260611",
  }),
});
assert.equal(similar.status, "EVIDENCE_UNAVAILABLE");
assert.equal(similar.reason, "RELATION_NOT_EXACT");
assert.equal(String(JSON.stringify(similar)).includes(ANICA_SHA), false);

const toolResults = await buildKeyExactFactToolResults(
  [
    {
      type: "tool_use",
      id: "tu_official",
      name: KEY_EXACT_FACT_TOOL_NAME,
      input: {
        slot: OFFICIAL_EVIDENCE_SLOT,
        contract_id: "c-anica",
        topic: "제52조",
      },
    },
  ],
  { customerId: CID, store: anicaStore, rows: [] },
);
const slice = JSON.parse(toolResults[0].content);
assert.equal(slice.status, "hit");
assert.equal(slice.slot, OFFICIAL_EVIDENCE_SLOT);
assert.equal(slice.provenance.sha, ANICA_SHA);
assert.equal(slice.provenance.lookup_status, "EXACT");
assert.equal(slice.facts.length >= 1, true);
assert.equal(slice.facts[0].product_exact, "개인용애니카자동차보험");
assert.equal(slice.facts[0].version, "20260611");
assert.equal(slice.facts[0].article_number_exact, "제52조");
assert.equal(slice.facts[0].occurrence_class, "HEADING_START");
assert.equal(Number(slice.facts[0].pdf_start_page) >= 1, true);
assert.equal(Number(slice.provenance.page_count) >= 1, true);
assert.equal(Number(slice.provenance.page_count) < ANICA_PAGES, true);
assert.equal(Number(slice.provenance.source_page_count), ANICA_PAGES);
assert.equal(String(slice.facts[0].text || "").includes("제52조"), true);
assert.equal(slice.provenance.preview_library_e2e, "BLOCKED_BY_RUNTIME_SOURCE");
assert.match(JSON.stringify(slice), /locator_id/);
assert.equal(JSON.stringify(slice).includes("C:\\\\Users\\\\sofia"), false);

const report = {
  at: new Date().toISOString(),
  LOCAL_LIBRARY_E2E: "PASS",
  PREVIEW_LIBRARY_E2E: "BLOCKED_BY_RUNTIME_SOURCE",
  door: "request_key_fact.slot=official_evidence",
  chain:
    "contract identity → lookupProduct EXACT → SHA → lookupLocators → originalPath → range slice → same Claude tool_result",
  checks: {
    wrong_version: 0,
    similar_product_substitute: 0,
    full_pdf_dump: 0,
    locatorless_extract: 0,
    t7_path_in_slice: 0,
  },
  slice: {
    sha: slice.provenance.sha,
    product_exact: slice.facts[0].product_exact,
    version: slice.facts[0].version,
    article_number_exact: slice.facts[0].article_number_exact,
    page_count: slice.provenance.page_count,
    source_page_count: slice.provenance.source_page_count,
    char_count: slice.provenance.char_count,
    locator_count: slice.provenance.locator_count,
  },
};

if (prevRoot == null) delete process.env.LIFEGUARD_LIBRARY_ROOT;
else process.env.LIFEGUARD_LIBRARY_ROOT = prevRoot;

console.log(JSON.stringify(report, null, 2));
console.log("LOCAL_LIBRARY_E2E=PASS");
console.log("PREVIEW_LIBRARY_E2E=BLOCKED_BY_RUNTIME_SOURCE");
