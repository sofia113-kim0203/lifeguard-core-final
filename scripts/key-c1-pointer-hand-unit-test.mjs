/**
 * KEY Selective C1 Pointer Hand — Unit U1–U5 (fake-fetch / NO real Provider).
 */
import assert from "node:assert/strict";
import {
  buildClaudeFirstOneShotSelectiveRequest,
  shouldSkipProviderForEmptyContractPackets,
} from "../server/keyCore/keyClaudeFirstOneShotSelectiveShadow.js";
import {
  collectCustomerOwnedContractIds,
  normalizePointedContractIdsInput,
  resolveOwnedPointedContractIds,
} from "../server/keyCore/keySelectivePointedContractHand.js";
import { buildHomeBrainFactRequestBody } from "../src/lib/homeBrainFactRequestBody.js";

const LIVE_TOOLS = [{ type: "web_search_20250305", name: "web_search" }];

const OWNED_CHART = {
  verified_document_coverages: [
    { coverage_name: "암진단비", coverage_amount: 50000000, contract_id: "c1" },
    { coverage_name: "수술비", coverage_amount: 2000000, contract_id: "c2" },
  ],
};

const OWNED_LEDGER = {
  confirmed_contracts: [
    { contract_id: "c1", status: "active", product_name: "A", monthly_premium: 120000 },
    { contract_id: "c2", status: "active", product_name: "B", monthly_premium: 80000 },
  ],
  active_distinct_count: 2,
};

function liveSelective(question, explicit = {}, liveSources = {}) {
  return buildClaudeFirstOneShotSelectiveRequest({
    question,
    explicit,
    liveSources: {
      chart: OWNED_CHART,
      policyTruthContext: OWNED_LEDGER,
      ...liveSources,
    },
    liveTools: LIVE_TOOLS,
  });
}

function selectedPacketIds(req) {
  return (req.selection_plan?.selected_resource_packets || []).map((p) => p.packet_id);
}

function selectedFactScopes(req) {
  return [
    ...new Set(
      (req.selection_plan?.selected_resource_packets || []).flatMap((p) => p.fact_scopes || []),
    ),
  ];
}

function unresolvedList(req) {
  return req.selection_plan?.unresolved_material_selection || [];
}

/** U1 — termination + owned pointer → C1 packets/scopes non-empty */
function testU1() {
  const owned = resolveOwnedPointedContractIds({
    pointedContractIds: ["c1"],
    chart: OWNED_CHART,
    policyTruthContext: OWNED_LEDGER,
  });
  assert.equal(owned.adoption, "owned");
  assert.deepEqual(owned.pointed_contract_ids, ["c1"]);

  const req = liveSelective("이 보험 해지해도 돼?", {
    pointed_contract_ids: owned.pointed_contract_ids,
  });
  assert.equal(req.meta.FULL_DATA_FALLBACK, 0);
  assert.ok(req.selection_plan.selected_prompt_blocks.includes("COND_TERMINATION_CONTEXT"));
  assert.ok(selectedPacketIds(req).length >= 1, "U1 packets empty");
  assert.ok(selectedFactScopes(req).length >= 1, "U1 scopes empty");
  assert.ok(
    !unresolvedList(req).includes("pointed_contract_id"),
    "U1 unresolved pointed",
  );
  const body = JSON.stringify(req.messages);
  assert.ok(!body.includes("해지하세요"));
  console.log("U1=PASS");
}

/** U2 — termination + no pointer → empty packets, HOLD pointed, no fallback */
function testU2() {
  const owned = resolveOwnedPointedContractIds({
    pointedContractIds: [],
    chart: OWNED_CHART,
    policyTruthContext: OWNED_LEDGER,
  });
  assert.equal(owned.adoption, "absent");
  assert.deepEqual(owned.pointed_contract_ids, []);

  const req = liveSelective("이 보험 해지해도 돼?", {
    pointed_contract_ids: owned.pointed_contract_ids,
  });
  assert.equal(req.meta.FULL_DATA_FALLBACK, 0);
  assert.ok(req.selection_plan.selected_prompt_blocks.includes("COND_TERMINATION_CONTEXT"));
  assert.equal(selectedPacketIds(req).length, 0);
  assert.ok(unresolvedList(req).includes("pointed_contract_id"));
  console.log("U2=PASS");
}

/** U3 — request body + ownership → selectiveExplicit-shaped ids drive packets */
function testU3() {
  const body = buildHomeBrainFactRequestBody("이 보험 해지해도 돼?", [], {
    pointedContractIds: ["c1", "c2_ignored"],
  });
  assert.deepEqual(body.pointed_contract_ids, ["c1"]);

  const owned = resolveOwnedPointedContractIds({
    pointedContractIds: body.pointed_contract_ids,
    chart: OWNED_CHART,
    policyTruthContext: OWNED_LEDGER,
  });
  const selectiveExplicit = {
    pointed_contract_ids: owned.pointed_contract_ids,
  };
  const req = liveSelective("이 보험 해지해도 돼?", selectiveExplicit);
  assert.ok(selectedPacketIds(req).some((id) => id.startsWith("premium_packet_") || id === "policy_list_packet" || id.startsWith("coverage_packet_")));
  console.log("U3=PASS");
}

/** U4 — policy count regression (pointer irrelevant) */
function testU4() {
  const req = liveSelective("내가 가입한 보험은 총 몇 개야?", {
    pointed_contract_ids: ["c1"],
  });
  assert.ok(req.selection_plan.selected_prompt_blocks.includes("COND_POLICY_COUNT"));
  assert.ok(selectedPacketIds(req).includes("policy_count_packet"));
  assert.equal(req.meta.FULL_DATA_FALLBACK, 0);
  console.log("U4=PASS");
}

/** U5 — foreign / unknown id → empty packets (no guess, no dump) */
function testU5() {
  assert.deepEqual(normalizePointedContractIdsInput(["x", "y"]), ["x"]);
  const ownedSet = collectCustomerOwnedContractIds({
    chart: OWNED_CHART,
    policyTruthContext: OWNED_LEDGER,
  });
  assert.equal(ownedSet.has("c1"), true);
  assert.equal(ownedSet.has("foreign_c9"), false);

  const owned = resolveOwnedPointedContractIds({
    pointedContractIds: ["foreign_c9"],
    chart: OWNED_CHART,
    policyTruthContext: OWNED_LEDGER,
  });
  assert.equal(owned.adoption, "not_owned");
  assert.deepEqual(owned.pointed_contract_ids, []);

  const req = liveSelective("이 보험 해지해도 돼?", {
    pointed_contract_ids: owned.pointed_contract_ids,
  });
  assert.equal(selectedPacketIds(req).length, 0);
  assert.equal(req.meta.FULL_DATA_FALLBACK, 0);
  assert.ok(unresolvedList(req).includes("pointed_contract_id"));
  console.log("U5=PASS");
}

/** U6 — 주요 보장 + owned pointer → C1 coverage packets only; web_search off */
function testU6() {
  const req = liveSelective("이 보험의 주요 보장만 알려줘", {
    pointed_contract_ids: ["c1"],
  });
  assert.equal(req.meta.FULL_DATA_FALLBACK, 0);
  assert.equal(req.meta.PRE_S3_FULL_ASSEMBLE, 0);
  assert.equal(req.meta.WEB_SEARCH_TOOL_MOUNTED, false);
  assert.equal((req.tools || []).length, 0);
  assert.ok(req.selection_plan.selected_prompt_blocks.includes("COND_COVERAGE"));
  const ids = selectedPacketIds(req);
  assert.ok(
    ids.some((id) => id.startsWith("coverage_packet_") || id === "policy_list_packet"),
    "U6 expected pointed coverage/list packets",
  );
  // Must not carry foreign contract coverage as selected authority dump:
  // c2 coverage exists in chart but must not be selected without pointer c2.
  const covReasons = (req.selection_plan.selected_resource_packets || []).filter(
    (p) => String(p.packet_id).startsWith("coverage_packet_"),
  );
  assert.ok(covReasons.length >= 1);
  assert.ok(
    covReasons.every((p) => p.selection_reason === "pointed_contract_coverage"),
  );
  assert.equal(
    shouldSkipProviderForEmptyContractPackets({
      selectionPlan: req.selection_plan,
      pointedContractIds: ["c1"],
      question: "이 보험의 주요 보장만 알려줘",
    }),
    false,
  );
  console.log("U6=PASS");
}

/** U7 — this-insurance + no pointer → empty packets → Provider skip */
function testU7() {
  const req = liveSelective("이 보험의 주요 보장만 알려줘", {
    pointed_contract_ids: [],
  });
  assert.equal(selectedPacketIds(req).length, 0);
  assert.ok(unresolvedList(req).includes("pointed_contract_id"));
  assert.equal(
    shouldSkipProviderForEmptyContractPackets({
      selectionPlan: req.selection_plan,
      pointedContractIds: [],
      question: "이 보험의 주요 보장만 알려줘",
    }),
    true,
  );
  console.log("U7=PASS");
}

/** U8 — pointed coverage with list but no coverage evidence → Provider skip */
function testU8() {
  const req = liveSelective(
    "이 보험의 주요 보장만 알려줘",
    { pointed_contract_ids: ["c1"] },
    {
      chart: {
        verified_document_coverages: [
          { coverage_name: "수술비", coverage_amount: 2000000, contract_id: "c2" },
        ],
      },
    },
  );
  assert.ok(selectedPacketIds(req).includes("policy_list_packet"));
  assert.equal(
    selectedPacketIds(req).filter((id) => id.startsWith("coverage_packet_")).length,
    0,
  );
  assert.ok(req.selection_plan.selected_prompt_blocks.includes("COND_COVERAGE"));
  assert.equal(
    shouldSkipProviderForEmptyContractPackets({
      selectionPlan: req.selection_plan,
      pointedContractIds: ["c1"],
      question: "이 보험의 주요 보장만 알려줘",
    }),
    true,
  );
  assert.equal(req.meta.FULL_DATA_FALLBACK, 0);
  console.log("U8=PASS");
}

function main() {
  testU1();
  testU2();
  testU3();
  testU4();
  testU5();
  testU6();
  testU7();
  testU8();
  console.log(
    JSON.stringify({
      KEY_C1_POINTER_HAND_UNIT: "PASS",
      REAL_PROVIDER_CALL: 0,
      FULL_DATA_FALLBACK: 0,
      tests: ["U1", "U2", "U3", "U4", "U5", "U6", "U7", "U8"],
    }),
  );
}

main();
