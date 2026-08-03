/**
 * POLICY ROW QUALITY — offline.
 * Coverage dumps must not become selectable contract cards / new policy inserts.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { shouldPersistSheetRowAsPolicyContract } from "../server/coverageSheetPersist.js";
import { listUniqueContractCards } from "../src/lib/keyContractFocusSsot.js";
import {
  hasInvalidPolicyIdentityFields,
  isNonContractPolicyRow,
  isPollutedPolicyIdentityField,
} from "../src/lib/policyIdentityPollution.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const DUMP =
  "보장내용 가입금액 보험/납입기간 상해수술비(3.10.5간편) 보험기간 중 상해의 직접적인 치료를 목적으로 수술을 받은 경우 보험가입금액 지급 100만원 2024.12.03 ~ 2069.12.03";
const CLEAN_PRODUCT = "한화 3.10.5 간편건강보험(세만기형) 무배당2411";

function testPollutionDetector() {
  assert.equal(isPollutedPolicyIdentityField(DUMP), true);
  assert.equal(isPollutedPolicyIdentityField(CLEAN_PRODUCT), false);
  assert.equal(isPollutedPolicyIdentityField("간편가입 The H 건강보험"), false);
  assert.equal(
    hasInvalidPolicyIdentityFields({
      insurer_name: "한화손해보험",
      product_name: DUMP,
    }),
    true,
  );
  assert.equal(isNonContractPolicyRow({ id: "1", product_name: DUMP }), true);
  assert.equal(
    isNonContractPolicyRow({
      id: "2",
      insurer_name: "한화손해보험",
      product_name: CLEAN_PRODUCT,
    }),
    false,
  );
  console.log("PASS pollution_detector");
}

function testUiContractCardsExcludeDumps() {
  const cards = listUniqueContractCards([
    {
      id: "dump-1",
      insurer_name: "한화손해보험",
      product_name: DUMP,
    },
    {
      id: "real-1",
      insurer_name: "한화손해보험",
      product_name: CLEAN_PRODUCT,
      monthly_premium: 100000,
    },
    {
      id: "real-2",
      insurer_name: "한화손해보험",
      product_name: CLEAN_PRODUCT,
      monthly_premium: 100000,
    },
    {
      id: "dump-1",
      insurer_name: "한화손해보험",
      product_name: DUMP,
    },
  ]);
  assert.equal(cards.length, 2);
  assert.deepEqual(
    cards.map((c) => c.contract_id).sort(),
    ["real-1", "real-2"],
  );
  assert.ok(cards.every((c) => !isPollutedPolicyIdentityField(c.product_name)));
  console.log("PASS ui_cards_exclude_dumps_keep_distinct_contracts");
}

function testSheetPersistGate() {
  assert.equal(
    shouldPersistSheetRowAsPolicyContract({
      insurer_name: "한화손해보험",
      product_name: DUMP,
      coverage_name: "상해수술비",
    }),
    false,
  );
  assert.equal(
    shouldPersistSheetRowAsPolicyContract({
      insurer_name: "한화손해보험",
      product_name: null,
      coverage_name: "상해수술비",
    }),
    false,
  );
  assert.equal(
    shouldPersistSheetRowAsPolicyContract({
      insurer_name: "한화손해보험",
      product_name: CLEAN_PRODUCT,
    }),
    true,
  );
  console.log("PASS sheet_persist_gate");
}

function testSourceWiring() {
  const extractor = readFileSync(
    join(ROOT, "server/documentPolicyExtractor.js"),
    "utf8",
  );
  const productRule = extractor.slice(
    extractor.indexOf('field: "product_name"'),
    extractor.indexOf('field: "policyholder"'),
  );
  assert.ok(
    !/new RegExp\(`담보\\s/.test(productRule),
    "product_name LABEL_RULES must not match 담보 labels",
  );
  const pipeline = readFileSync(
    join(ROOT, "server/documentPolicyExtractionPipeline.js"),
    "utf8",
  );
  assert.match(pipeline, /skipped_polluted_identity/);
  console.log("PASS source_wiring");
}

function main() {
  testPollutionDetector();
  testUiContractCardsExcludeDumps();
  testSheetPersistGate();
  testSourceWiring();
  console.log(
    JSON.stringify({
      POLICY_ROW_QUALITY_OFFLINE: "PASS",
      PROVIDER_CALL: 0,
    }),
  );
}

main();
