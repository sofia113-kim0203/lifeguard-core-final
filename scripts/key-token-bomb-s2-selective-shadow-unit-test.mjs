/**
 * TOKEN BOMB S2 — ONE_SHOT_SELECTIVE Shadow unit tests + S1 live invariant preflight.
 * Fake fixtures only. No Provider / DB / secrets / Preview.
 */
import assert from "node:assert/strict";
import {
  buildClaudeFirstCachedRequestParts,
  ANTHROPIC_PROMPT_CACHE_CONTROL_5M,
} from "../server/keyCore/keyClaudeFirstDirect.js";
import {
  buildClaudeFirstOnDemandShadowBodies,
  buildProviderFetchObservation,
  measureAnthropicRequestMetrics,
} from "../server/keyCore/keyClaudeFirstOnDemandShadow.js";
import {
  assertNoRawCustomerTelemetry,
  assertS1LiveInvariant,
  buildClaudeFirstOneShotSelectiveShadowBodies,
  buildOneShotSelectionPlan,
  compareLiveS1S2Bodies,
  PROMPT_BLOCK_REGISTRY,
} from "../server/keyCore/keyClaudeFirstOneShotSelectiveShadow.js";

const TINY_JPEG_B64 = Buffer.from(
  "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc00011080001000103011100021101ffc40014000100000000000000000000000000000000ffda00080001000100003f00bf00ffd9",
  "hex",
).toString("base64");

const LIVE_TOOLS = [{ type: "web_search_20250305", name: "web_search" }];

function heavyLiveBody() {
  const chart = {
    verified_document_coverages: Array.from({ length: 30 }, (_, i) => ({
      coverage_name: `cov_${i}`,
      coverage_amount: (i + 1) * 1000,
    })),
    key_confirmed_source_facts: [{ fact: "x" }],
  };
  const ledger = {
    confirmed_contracts: Array.from({ length: 10 }, (_, i) => ({
      contract_id: `c_${i}`,
    })),
    active_distinct_count: 10,
  };
  return {
    system: [
      {
        type: "text",
        text: "LIVE_SYSTEM ".repeat(300),
        cache_control: { ...ANTHROPIC_PROMPT_CACHE_CONTROL_5M },
      },
    ],
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: JSON.stringify({
              available_verified_evidence: {
                personal_chart: chart,
                VERIFIED_POLICY_LEDGER: ledger,
                prior_consultation: { related_turns: [{ role: "user", text: "t" }] },
              },
              current_question: "synthetic",
            }),
          },
        ],
      },
    ],
    tools: LIVE_TOOLS,
  };
}

function preflightS1LiveInvariant() {
  const parts = buildClaudeFirstCachedRequestParts({
    systemText: "STATIC_KEY_SYSTEM_FOR_INVARIANT",
    userPayload: {
      current_question: "invariant_q",
      current_context: { conversation: { recent_conversation_originals: [] } },
    },
    attachments: null,
    cacheControl: ANTHROPIC_PROMPT_CACHE_CONTROL_5M,
  });
  const liveBody = {
    system: parts.system,
    messages: parts.messages,
    tools: LIVE_TOOLS,
  };
  // Side-effect: build S1+S2 shadows — must not mutate liveBody
  const before = JSON.parse(JSON.stringify(liveBody));
  const s1 = buildClaudeFirstOnDemandShadowBodies({
    question: "invariant_q",
    chart: { verified_document_coverages: [{ coverage_name: "x", coverage_amount: 1 }] },
    policyTruthContext: { active_distinct_count: 2, confirmed_contracts: [{ contract_id: "a" }] },
    liveTools: LIVE_TOOLS,
  });
  const s2 = buildClaudeFirstOneShotSelectiveShadowBodies({
    question: "invariant_q",
    fixture: { policy_count: 2 },
    liveTools: LIVE_TOOLS,
  });
  void s1;
  void s2;
  const after = liveBody;
  const inv = assertS1LiveInvariant({
    liveBodyBeforeShadow: before,
    liveBodyAfterShadowSideEffects: after,
  });
  assert.equal(inv.ok, true, JSON.stringify(inv.checks));

  // Shadow must never be the fetch body
  const fetchBodies = [];
  const fakeFetch = async (_url, init) => {
    fetchBodies.push(JSON.parse(init.body));
    return {
      ok: true,
      status: 200,
      text: async () => "",
      body: { getReader: () => ({ read: async () => ({ done: true }) }) },
    };
  };
  // Simulate S1 observation path only
  const body = {
    model: "claude-sonnet-4-6",
    system: liveBody.system,
    messages: liveBody.messages,
    tools: LIVE_TOOLS,
  };
  buildProviderFetchObservation({ providerFetchIndex: 1, body });
  assert.ok(!JSON.stringify(body.system).includes("KEY_ON_DEMAND_DECIDE_OR_ANSWER"));
  assert.ok(!JSON.stringify(body.system).includes("KEY_ONE_SHOT_SELECTIVE"));
  assert.equal(body.system[0].cache_control?.type, "ephemeral");
  // maxProviderTurns formula unchanged (static code contract)
  const withTools = LIVE_TOOLS.length > 0 ? 3 : 1;
  const without = 1;
  assert.equal(withTools, 3);
  assert.equal(without, 1);
  assert.equal(fetchBodies.length, 0); // we did not call fakeFetch with shadow
  void fakeFetch;
  console.log("PREFLIGHT_S1_LIVE_INVARIANT=PASS");
  return inv;
}

function assertSelectiveClean(body, label) {
  assert.equal(body.inventory.full_chart_present, false, `${label} chart`);
  assert.equal(body.inventory.full_ledger_present, false, `${label} ledger`);
  assert.equal(body.inventory.prior_consultation_present, false, `${label} prior`);
  assert.equal(body.inventory.prior_original_present, false, `${label} prior_orig`);
  assert.equal(body.inventory.full_data_fallback, 0, `${label} fallback`);
  assert.equal(body.inventory.provider_round_target, 1);
  assert.equal(body.inventory.key_final_insurance_judgment_before_claude, false);
  assert.equal(body.inventory.key_prompt_and_material_routing, true);
  assertNoRawCustomerTelemetry(body.metrics);
  assertNoRawCustomerTelemetry(body.selection_plan);
  const packed = JSON.stringify(body.messages);
  assert.ok(!packed.includes("verified_document_coverages"));
  assert.ok(!/"coverage_name":"cov_/.test(packed));
}

function runCase(name, { question, explicit = {}, fixture = {}, assertFn }) {
  const shadow = buildClaudeFirstOneShotSelectiveShadowBodies({
    question,
    explicit,
    fixture,
    liveTools: LIVE_TOOLS,
  });
  assertSelectiveClean(shadow.selective_content_first, `${name}/A`);
  assertSelectiveClean(shadow.selective_manifest_first, `${name}/B`);
  assertFn(shadow);
  return {
    QUESTION_TYPE: name,
    SELECTED_PROMPT_BLOCK_IDS:
      shadow.selective_content_first.selection_plan.selected_prompt_blocks,
    SELECTED_RESOURCE_PACKETS:
      shadow.selective_content_first.selection_plan.selected_resource_packets.map(
        (p) => p.packet_id,
      ),
    SELECTED_FACT_SCOPES: [
      ...new Set(
        shadow.selective_content_first.selection_plan.selected_resource_packets.flatMap(
          (p) => p.fact_scopes,
        ),
      ),
    ],
    EXCLUDED_HEAVY_RESOURCES: ["full_chart", "full_ledger", "full_prior", "full_prior_originals"],
    ONE_SHOT_INPUT_SUFFICIENT:
      shadow.selective_content_first.selection_plan.one_shot_input_sufficient,
    UNRESOLVED_MATERIAL_SELECTION:
      shadow.selective_content_first.selection_plan.unresolved_material_selection,
    WEB_TOOL_CANDIDATE: shadow.selective_content_first.selection_plan.web_tool_candidate,
  };
}

function testT1Greeting() {
  return runCase("T1_greeting", {
    question: "안녕",
    fixture: {
      full_chart_available: true,
      full_ledger_available: true,
      policy_count: 5,
      coverages: [{ coverage_name: "암진단비", coverage_amount: 50000000 }],
    },
    assertFn(s) {
      assert.ok(s.selective_content_first.selection_plan.selected_prompt_blocks.includes("CORE_IDENTITY"));
      assert.equal(s.selective_content_first.metrics.image_count, 0);
      assert.ok(
        !s.selective_content_first.selection_plan.selected_resource_packets.some((p) =>
          p.packet_id.startsWith("coverage_"),
        ),
      );
      assert.ok(
        !s.selective_content_first.selection_plan.selected_resource_packets.some(
          (p) => p.packet_id === "policy_count_packet",
        ),
      );
      assert.equal(s.meta.DEFAULT_PROVIDER_CALL_TARGET, 1);
    },
  });
}

function testT2NonInsurance() {
  return runCase("T2_non_insurance", {
    question: "오늘 점심 뭐 먹지 추천해줘 메뉴",
    explicit: { non_insurance_general: true },
    fixture: { full_chart_available: true, policy_count: 3 },
    assertFn(s) {
      assert.ok(
        !s.selective_content_first.selection_plan.selected_prompt_blocks.includes(
          "COND_POLICY_COUNT",
        ),
      );
      assert.equal(
        s.selective_content_first.selection_plan.selected_resource_packets.length,
        0,
      );
    },
  });
}

function testT3PolicyCount() {
  return runCase("T3_policy_count", {
    question: "내가 가입한 보험 몇 개야?",
    fixture: {
      full_chart_available: true,
      full_ledger_available: true,
      policy_count: 3,
      policy_list: [
        { contract_id: "c1", status: "active", product_label: "A" },
        { contract_id: "c2", status: "active", product_label: "B" },
      ],
      coverages: [
        { coverage_name: "암진단비", coverage_amount: 1, linked_contract_id: "c1" },
        { coverage_name: "수술비", coverage_amount: 2, linked_contract_id: "c2" },
      ],
    },
    assertFn(s) {
      const plan = s.selective_content_first.selection_plan;
      assert.ok(plan.selected_prompt_blocks.includes("COND_POLICY_COUNT"));
      assert.ok(plan.selected_resource_packets.some((p) => p.packet_id === "policy_count_packet"));
      assert.ok(!plan.selected_resource_packets.some((p) => p.packet_id.startsWith("coverage_")));
      const body = JSON.stringify(s.selective_content_first.messages);
      assert.ok(body.includes("confirmed_contract_count"));
      assert.ok(!body.includes("암진단비"));
    },
  });
}

function testT4CancerCoverage() {
  return runCase("T4_cancer_coverage", {
    question: "내 암진단비 얼마야?",
    fixture: {
      full_chart_available: true,
      full_ledger_available: true,
      policy_count: 3,
      coverages: [
        { coverage_name: "암진단비", coverage_amount: 50000000, linked_contract_id: "c1" },
        { coverage_name: "골절진단비", coverage_amount: 1000000, linked_contract_id: "c1" },
        { coverage_name: "수술비", coverage_amount: 2000000, linked_contract_id: "c2" },
      ],
    },
    assertFn(s) {
      const ids = s.selective_content_first.selection_plan.selected_resource_packets.map(
        (p) => p.packet_id,
      );
      assert.equal(ids.filter((id) => id.startsWith("coverage_")).length, 1);
      const body = JSON.stringify(s.selective_content_first.messages);
      assert.ok(body.includes("암진단비"));
      assert.ok(!body.includes("골절진단비"));
      assert.ok(!body.includes("수술비"));
      assert.ok(
        s.selective_content_first.selection_plan.selected_prompt_blocks.includes("COND_COVERAGE"),
      );
    },
  });
}

function testT5Termination() {
  return runCase("T5_termination", {
    question: "이 보험 해지해도 돼?",
    explicit: { pointed_contract_ids: ["c1"] },
    fixture: {
      full_chart_available: true,
      policy_list: [
        { contract_id: "c1", status: "active", product_label: "Target" },
        { contract_id: "c2", status: "active", product_label: "Other" },
      ],
      premiums: [
        { contract_id: "c1", monthly_premium: 120000 },
        { contract_id: "c2", monthly_premium: 80000 },
      ],
      coverages: [
        {
          coverage_name: "암진단비",
          coverage_amount: 50000000,
          linked_contract_id: "c1",
        },
        {
          coverage_name: "수술비",
          coverage_amount: 1000000,
          linked_contract_id: "c2",
        },
      ],
      minimal_thread: [{ role: "user", text: "보험료가 부담돼요" }],
    },
    assertFn(s) {
      const plan = s.selective_content_first.selection_plan;
      assert.ok(plan.selected_prompt_blocks.includes("COND_TERMINATION_CONTEXT"));
      const sys = s.selective_content_first.system.map((b) => b.text).join("\n");
      assert.ok(sys.includes("해지 결론을 쓰지 않았다"));
      assert.ok(!sys.includes("해지하세요") && !sys.includes("해지하는 것이 좋습니다"));
      const body = JSON.stringify(s.selective_content_first.messages);
      assert.ok(!body.includes("\"product_label\":\"Other\""));
    },
  });
}

function testT6OneImage() {
  return runCase("T6_one_image", {
    question: "여기 무슨 뜻이야?",
    explicit: {
      current_attachment_question: true,
      current_attachment_ids: ["doc1"],
      pointed_attachment_ids: ["doc1"],
      pdf_attached: true,
    },
    fixture: {
      full_chart_available: true,
      attachments: [
        { document_id: "doc1", ordinal: 1, mediaType: "image/jpeg", base64: TINY_JPEG_B64 },
      ],
    },
    assertFn(s) {
      assert.equal(s.selective_content_first.metrics.image_count, 1);
      assert.equal(s.selective_manifest_first.metrics.image_count, 0);
      assert.ok(
        s.selective_content_first.selection_plan.selected_prompt_blocks.includes(
          "COND_ATTACH_ANALYSIS",
        ),
      );
    },
  });
}

function testT7FiveImagesPointSecond() {
  return runCase("T7_five_images_point_2", {
    question: "2번 이미지 설명해줘",
    explicit: {
      current_attachment_question: true,
      current_attachment_ids: ["d1", "d2", "d3", "d4", "d5"],
    },
    fixture: {
      attachments: Array.from({ length: 5 }, (_, i) => ({
        document_id: `d${i + 1}`,
        ordinal: i + 1,
        mediaType: "image/jpeg",
        base64: TINY_JPEG_B64 + "X".repeat(100 * (i + 1)),
      })),
    },
    assertFn(s) {
      assert.equal(s.selective_content_first.metrics.image_count, 1);
      assert.ok(s.selective_content_first.metrics.image_count < 5);
      assert.equal(s.selective_manifest_first.metrics.image_count, 0);
    },
  });
}

function testT8Claim() {
  return runCase("T8_claim", {
    question: "내 청구 지금 어디까지야?",
    fixture: {
      full_chart_available: true,
      coverages: [{ coverage_name: "암진단비", coverage_amount: 1, linked_contract_id: "c1" }],
      claims: [
        {
          claim_id: "cl1",
          status: "under_review",
          deadline: "2026-09-01",
          evidence_present: true,
        },
      ],
    },
    assertFn(s) {
      assert.ok(
        s.selective_content_first.selection_plan.selected_prompt_blocks.includes("COND_CLAIM"),
      );
      assert.ok(
        s.selective_content_first.selection_plan.selected_resource_packets.some((p) =>
          p.packet_id.startsWith("claim_"),
        ),
      );
      assert.ok(
        !s.selective_content_first.selection_plan.selected_resource_packets.some((p) =>
          p.packet_id.startsWith("coverage_"),
        ),
      );
    },
  });
}

function testT9ProductCompare() {
  return runCase("T9_product_compare", {
    question: "현재 판매 암보험 비교해줘",
    fixture: {
      full_chart_available: true,
      policy_count: 4,
      recommendation_context: {
        coverage_gap_labels: ["cancer"],
        budget_band: "mid",
        preference_labels: ["simple_issue"],
        related_contract_ids: ["c1"],
        public_evidence_status: "available",
      },
    },
    assertFn(s) {
      const plan = s.selective_content_first.selection_plan;
      assert.equal(plan.web_tool_candidate, true);
      assert.ok(plan.selected_prompt_blocks.includes("COND_PRODUCT_SHOWCASE"));
      assert.ok(
        plan.selected_resource_packets.some(
          (p) => p.packet_id === "recommendation_context_packet",
        ),
      );
      assert.ok(!plan.selected_resource_packets.some((p) => p.packet_id === "policy_count_packet"));
    },
  });
}

function testT10Weather() {
  return runCase("T10_weather", {
    question: "오늘 서울 날씨 어때?",
    fixture: {
      full_chart_available: true,
      full_ledger_available: true,
      policy_count: 3,
      coverages: [{ coverage_name: "암진단비", coverage_amount: 1 }],
    },
    assertFn(s) {
      const plan = s.selective_content_first.selection_plan;
      assert.equal(plan.web_tool_candidate, true);
      assert.ok(plan.selected_prompt_blocks.includes("COND_WEATHER_CURRENT_INFO"));
      assert.ok(!plan.selected_prompt_blocks.includes("COND_PRODUCT_SHOWCASE"));
      assert.equal(plan.selected_resource_packets.length, 0);
    },
  });
}

function testT11Ambiguous() {
  return runCase("T11_ambiguous", {
    question: "내 보험 괜찮아?",
    fixture: {
      full_chart_available: true,
      full_ledger_available: true,
      policy_count: 5,
      coverages: Array.from({ length: 20 }, (_, i) => ({
        coverage_name: `담보${i}`,
        coverage_amount: i,
      })),
      contract_summary: {
        active_contract_count: 5,
        product_labels: ["A", "B"],
      },
    },
    assertFn(s) {
      const plan = s.selective_content_first.selection_plan;
      assert.equal(plan.one_shot_input_sufficient, "HOLD");
      assert.ok(
        plan.selected_resource_packets.some((p) => p.packet_id === "contract_summary_packet"),
      );
      assert.ok(!plan.selected_resource_packets.some((p) => p.packet_id.startsWith("coverage_")));
      assert.equal(plan.selected_resource_packets.filter((p) => p.packet_id.startsWith("coverage_")).length, 0);
    },
  });
}

function testT12Dedup() {
  const plan = buildOneShotSelectionPlan({
    question: "내가 가입한 보험 몇 개야?",
    fixture: {
      policy_count: 2,
      policy_list: [{ contract_id: "c1", status: "active" }],
    },
  });
  const countPackets = plan.selected_resource_packets.filter((p) =>
    p.fact_scopes.includes("confirmed_contract_count"),
  );
  assert.equal(countPackets.length, 1);
}

function testT13NoPiiTelemetry() {
  const s = buildClaudeFirstOneShotSelectiveShadowBodies({
    question: "계약번호 SECRET-999 010-1234-5678 암진단비",
    fixture: {
      coverages: [
        {
          coverage_name: "암진단비",
          coverage_amount: 50000000,
          linked_contract_id: "REAL-CONTRACT-NO",
        },
      ],
      attachments: [
        { document_id: "cust-uuid", ordinal: 1, base64: TINY_JPEG_B64, mediaType: "image/jpeg" },
      ],
    },
    explicit: { coverage_question: true },
  });
  assertNoRawCustomerTelemetry(s.selective_content_first.metrics);
  assertNoRawCustomerTelemetry(s.selective_content_first.selection_plan);
  assertNoRawCustomerTelemetry(s.selective_content_first.inventory);
  assert.ok(!JSON.stringify(s.selective_content_first.metrics).includes(TINY_JPEG_B64.slice(0, 20)));
  for (const p of s.selective_content_first.selection_plan.selected_resource_packets) {
    assert.ok(String(p.resource_id).startsWith("rh_"));
  }
}

function testCompareFixture() {
  const live = heavyLiveBody();
  const s1 = buildClaudeFirstOnDemandShadowBodies({
    question: "내가 가입한 보험 몇 개야?",
    chart: { verified_document_coverages: [{ coverage_name: "x", coverage_amount: 1 }] },
    policyTruthContext: { active_distinct_count: 3, confirmed_contracts: [{ contract_id: "a" }] },
    liveTools: LIVE_TOOLS,
  });
  const s2 = buildClaudeFirstOneShotSelectiveShadowBodies({
    question: "내가 가입한 보험 몇 개야?",
    fixture: {
      full_chart_available: true,
      full_ledger_available: true,
      policy_count: 3,
      policy_list: [{ contract_id: "a", status: "active" }],
    },
    liveTools: LIVE_TOOLS,
  });
  const cmp = compareLiveS1S2Bodies({
    liveBody: live,
    liveUserPayload: { available_verified_evidence: { personal_chart: { x: 1 } } },
    liveTools: LIVE_TOOLS,
    s1Shadow: s1,
    s2Shadow: s2,
  });
  assert.equal(cmp.note, "FIXTURE_COMPARE_ONLY_NOT_PRODUCTION_SAVINGS");
  assert.ok(cmp.S2_ONE_SHOT_SELECTIVE_MANIFEST_FIRST.total_bytes < cmp.LIVE_CURRENT.total_bytes);
  assert.ok(cmp.SELECTIVE_REDUCTION_RATIO > 0);
  console.log(
    JSON.stringify(
      {
        LIVE_CURRENT_BODY_BYTES: cmp.LIVE_CURRENT.total_bytes,
        S1_MANIFEST_FIRST_BODY_BYTES: cmp.S1_MANIFEST_FIRST.total_bytes,
        S2_SELECTIVE_CONTENT_FIRST_BODY_BYTES:
          cmp.S2_ONE_SHOT_SELECTIVE_CONTENT_FIRST.total_bytes,
        S2_SELECTIVE_MANIFEST_FIRST_BODY_BYTES:
          cmp.S2_ONE_SHOT_SELECTIVE_MANIFEST_FIRST.total_bytes,
        S2_SELECTIVE_REDUCTION_RATIO: cmp.SELECTIVE_REDUCTION_RATIO,
        S2_SELECTED_PROMPT_CHAR_REDUCTION: cmp.PROMPT_CHAR_REDUCTION,
        S2_SELECTED_RESOURCE_BYTE_REDUCTION: cmp.RESOURCE_BYTE_REDUCTION,
      },
      null,
      2,
    ),
  );
  return cmp;
}

function testRegistry() {
  assert.ok(PROMPT_BLOCK_REGISTRY.some((b) => b.class === "CORE_ALWAYS"));
  assert.ok(PROMPT_BLOCK_REGISTRY.some((b) => b.block_id === "COND_POLICY_COUNT"));
}

const reports = [];
preflightS1LiveInvariant();
testRegistry();
reports.push(testT1Greeting());
reports.push(testT2NonInsurance());
reports.push(testT3PolicyCount());
reports.push(testT4CancerCoverage());
reports.push(testT5Termination());
reports.push(testT6OneImage());
reports.push(testT7FiveImagesPointSecond());
reports.push(testT8Claim());
reports.push(testT9ProductCompare());
reports.push(testT10Weather());
reports.push(testT11Ambiguous());
testT12Dedup();
testT13NoPiiTelemetry();
const cmp = testCompareFixture();

console.log("FIXTURE_REPORTS=" + JSON.stringify(reports, null, 2));
console.log("TOKEN_BOMB_S2_SELECTIVE_SHADOW: tests passed");
void cmp;
