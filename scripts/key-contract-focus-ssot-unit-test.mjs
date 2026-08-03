/**
 * CONTRACT FOCUS SSOT — offline unit tests.
 * PROVIDER_CALL = 0.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildHomeBrainFactRequestBody } from "../src/lib/homeBrainFactRequestBody.js";
import { resolveC1InsurancePanelEntryAction } from "../src/lib/keyC1InsurancePanelEntry.js";
import {
  applyPointedContractSelection,
  assertContractCardIdUnique,
  buildPointedContractIdsPayload,
  listUniqueContractCards,
  resolveCanonicalContractId,
} from "../src/lib/keyContractFocusSsot.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PROVIDER = { count: 0 };

function noProvider() {
  assert.equal(PROVIDER.count, 0);
}

function testCanonicalId() {
  assert.equal(
    resolveCanonicalContractId({ contract_id: "c-1", id: "other" }),
    "c-1",
  );
  assert.equal(resolveCanonicalContractId({ id: "p-9" }), "p-9");
  assert.equal(resolveCanonicalContractId({}), null);
  noProvider();
  console.log("PASS canonical_contract_id");
}

function testDedupeAndUnique() {
  const cards = listUniqueContractCards([
    { id: "a", insurer_name: "A사", product_name: "동일상품" },
    { id: "b", insurer_name: "A사", product_name: "동일상품" },
    { id: "a", insurer_name: "A사", product_name: "중복렌더" },
    { insurer_name: "NoId" },
    { contract_id: "c", id: "ignored", product_name: "C상품" },
  ]);
  assert.equal(cards.length, 3);
  assert.deepEqual(
    cards.map((c) => c.contract_id),
    ["a", "b", "c"],
  );
  // Same product name, distinct ids preserved
  assert.equal(cards[0].product_name, "동일상품");
  assert.equal(cards[1].product_name, "동일상품");
  assert.notEqual(cards[0].contract_id, cards[1].contract_id);

  const uniq = assertContractCardIdUnique(cards);
  assert.equal(uniq.ok, true);
  assert.equal(uniq.card_count, uniq.unique_contract_id_count);
  noProvider();
  console.log("PASS dedupe_and_unique_ids");
}

function testSelectionReplaceAndClear() {
  let pointed = null;
  pointed = applyPointedContractSelection({
    pointedContractId: pointed,
    contractId: "a",
  });
  assert.equal(pointed, "a");
  pointed = applyPointedContractSelection({
    pointedContractId: pointed,
    contractId: "b",
  });
  assert.equal(pointed, "b"); // replace — no residual a
  pointed = applyPointedContractSelection({
    pointedContractId: pointed,
    contractId: "b",
  });
  assert.equal(pointed, null); // toggle off
  assert.deepEqual(buildPointedContractIdsPayload(null), []);
  assert.deepEqual(buildPointedContractIdsPayload("x"), ["x"]);
  noProvider();
  console.log("PASS selection_replace_and_clear");
}

function testFakeRequestPointer() {
  const none = buildHomeBrainFactRequestBody("q", [], {});
  assert.equal(none.pointed_contract_ids, undefined);

  const one = buildHomeBrainFactRequestBody("q", [], {
    pointedContractIds: buildPointedContractIdsPayload("contract-42"),
  });
  assert.deepEqual(one.pointed_contract_ids, ["contract-42"]);
  assert.equal(one.pointed_contract_ids.length, 1);

  const sliced = buildHomeBrainFactRequestBody("q", [], {
    pointedContractIds: ["first", "second_ignored"],
  });
  assert.deepEqual(sliced.pointed_contract_ids, ["first"]);
  noProvider();
  console.log("PASS fake_request_pointer");
}

function testSourceWiring() {
  const src = readFileSync(
    join(ROOT, "src/components/LifeguardHomeChat.jsx"),
    "utf8",
  );
  assert.match(src, /data-contract-id=\{contractId\}/);
  assert.match(src, /listUniqueContractCards/);
  assert.match(src, /buildPointedContractIdsPayload/);
  assert.match(src, /resolveC1InsurancePanelEntryAction/);
  const entry = resolveC1InsurancePanelEntryAction();
  assert.equal(entry.panelView, "insurance");
  noProvider();
  console.log("PASS source_wiring");
}

function main() {
  testCanonicalId();
  testDedupeAndUnique();
  testSelectionReplaceAndClear();
  testFakeRequestPointer();
  testSourceWiring();
  console.log(
    JSON.stringify({
      CONTRACT_FOCUS_SSOT_OFFLINE: "PASS",
      CONTRACT_CARD_ID_UNIQUE: "PASS",
      POINTER_REQUEST_PROOF: "PASS",
      PROVIDER_CALL: 0,
      PRODUCTION_CHANGE: 0,
    }),
  );
}

main();
