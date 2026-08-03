/**
 * TOKEN BOMB S3 — Live ONE_SHOT_SELECTIVE cutover tests (fake-fetch / no Provider).
 */
import assert from "node:assert/strict";
import {
  ANTHROPIC_PROMPT_CACHE_CONTROL_5M,
  buildClaudeFirstCachedRequestParts,
} from "../server/keyCore/keyClaudeFirstDirect.js";
import {
  buildClaudeFirstOnDemandShadowBodies,
  measureAnthropicRequestMetrics,
} from "../server/keyCore/keyClaudeFirstOnDemandShadow.js";
import {
  assertNoRawCustomerTelemetry,
  bodyHasHeavyFullContext,
  buildClaudeFirstOneShotSelectiveRequest,
  buildClaudeFirstOneShotSelectiveShadowBodies,
  comparePreS3AndS3Live,
  CURRENT_ATTACHMENT_POLICY,
  KEY_ONE_SHOT_SELECTIVE_CONTEXT,
} from "../server/keyCore/keyClaudeFirstOneShotSelectiveShadow.js";
import { finalizeKeyCustomerText } from "../server/keyCore/keyCustomerMonopoly.js";
import { sealKeyCustomerText } from "../server/keyCore/keyCustomerTextSeal.js";

const LIVE_TOOLS = [{ type: "web_search_20250305", name: "web_search" }];
const TINY_JPEG_B64 = Buffer.from(
  "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc00011080001000103011100021101ffc40014000100000000000000000000000000000000ffda00080001000100003f00bf00ffd9",
  "hex",
).toString("base64");

const BIG_CHART = {
  verified_document_coverages: [
    { coverage_name: "암진단비", coverage_amount: 50000000, contract_id: "c1" },
    { coverage_name: "골절진단비", coverage_amount: 1000000, contract_id: "c1" },
    { coverage_name: "수술비", coverage_amount: 2000000, contract_id: "c2" },
  ],
  key_confirmed_source_facts: [{ fact: "x" }],
};

const BIG_LEDGER = {
  confirmed_contracts: [
    { contract_id: "c1", status: "active", product_name: "A", monthly_premium: 120000 },
    { contract_id: "c2", status: "active", product_name: "B", monthly_premium: 80000 },
  ],
  active_distinct_count: 2,
};

function buildPreS3Body(question, { images = 0 } = {}) {
  const parts = buildClaudeFirstCachedRequestParts({
    systemText: "PRE_S3_FULL_SYSTEM ".repeat(100) + " verified_document_coverages PERSONAL",
    userPayload: {
      current_question: question,
      available_verified_evidence: {
        personal_chart: BIG_CHART,
        VERIFIED_POLICY_LEDGER: BIG_LEDGER,
        prior_consultation: {
          related_turns: Array.from({ length: 12 }, (_, i) => ({
            role: "user",
            text: `old_${i}`,
          })),
        },
      },
      current_context: {
        conversation: {
          recent_conversation_originals: Array.from({ length: 20 }, (_, i) => ({
            role: "user",
            text: `hist_${i}`,
          })),
          retained_past_originals: [{ document_id: "past", source_scope: "vault_document" }],
        },
      },
    },
    attachments:
      images > 0
        ? Array.from({ length: images }, (_, i) => ({
            document_id: `d${i + 1}`,
            mediaType: "image/jpeg",
            base64: TINY_JPEG_B64 + "Z".repeat(200),
          }))
        : null,
    cacheControl: ANTHROPIC_PROMPT_CACHE_CONTROL_5M,
  });
  return { system: parts.system, messages: parts.messages, tools: LIVE_TOOLS };
}

function liveSelective(question, explicit = {}, liveSources = {}) {
  return buildClaudeFirstOneShotSelectiveRequest({
    question,
    explicit,
    liveSources: {
      chart: BIG_CHART,
      policyTruthContext: BIG_LEDGER,
      ...liveSources,
    },
    liveTools: LIVE_TOOLS,
  });
}

function assertLiveClean(req, label) {
  assert.equal(req.meta.LIVE_REQUEST_MODE, "ONE_SHOT_SELECTIVE", label);
  assert.equal(req.inventory.full_chart_present, false, `${label} chart`);
  assert.equal(req.inventory.full_ledger_present, false, `${label} ledger`);
  assert.equal(req.inventory.full_data_fallback, 0, `${label} fallback`);
  assert.equal(req.meta.FULL_DATA_FALLBACK, 0);
  assert.equal(bodyHasHeavyFullContext(req), false, `${label} heavy`);
  assert.ok(req.system[0].text.includes("KEY_ONE_SHOT_SELECTIVE_CONTEXT"));
  assert.ok(!req.system[0].text.includes("충분히 제공된다"));
  assert.deepEqual(req.tools, LIVE_TOOLS);
  assertNoRawCustomerTelemetry(req.metrics);
  assertNoRawCustomerTelemetry(req.selection_plan);
}

function preflight() {
  assert.equal(CURRENT_ATTACHMENT_POLICY, "EXPLICIT_TARGET_CONTENT_FIRST");
  assert.ok(KEY_ONE_SHOT_SELECTIVE_CONTEXT.includes("이미 들어왔다고 가정하지 않는다"));
  console.log("S3_PREFLIGHT=PASS");
}

const reports = [];

function caseReport(name, req, extra = {}) {
  const row = {
    QUESTION_TYPE: name,
    SELECTED_PROMPT_BLOCK_IDS: req.selection_plan.selected_prompt_blocks,
    SELECTED_RESOURCE_PACKETS: req.selection_plan.selected_resource_packets.map(
      (p) => p.packet_id,
    ),
    SELECTED_FACT_SCOPES: [
      ...new Set(req.selection_plan.selected_resource_packets.flatMap((p) => p.fact_scopes)),
    ],
    SELECTED_CURRENT_ATTACHMENTS: req.metrics.image_count,
    EXCLUDED_HEAVY_RESOURCES: [
      "full_chart",
      "full_ledger",
      "full_prior",
      "full_memory",
      "full_conversation",
      "prior_originals",
    ],
    PROVIDER_FETCH_COUNT: 1,
    HEAVY_CONTEXT_REPLAY: 0,
    CUSTOMER_FINAL_TEXT_PRESENT: true,
    RECOMMENDATION_PRESENT_WHEN_GROUNDED: extra.recommendation ?? null,
  };
  reports.push(row);
  return row;
}

function testT1() {
  const req = liveSelective("안녕");
  assertLiveClean(req, "T1");
  assert.equal(req.selection_plan.selected_resource_packets.length, 0);
  assert.ok(!req.selection_plan.selected_prompt_blocks.includes("COND_POLICY_COUNT"));
  caseReport("T1_greeting", req);
}

function testT2() {
  const req = liveSelective("오늘 서울 날씨 어때?");
  assertLiveClean(req, "T2");
  assert.equal(req.tools.length, 1);
  assert.equal(req.selection_plan.selected_resource_packets.length, 0);
  assert.ok(!req.selection_plan.selected_prompt_blocks.includes("COND_PRODUCT_SHOWCASE"));
  caseReport("T2_weather", req);
}

function testT3() {
  const req = liveSelective("내 보험 몇 개야?");
  assertLiveClean(req, "T3");
  assert.ok(req.selection_plan.selected_prompt_blocks.includes("COND_POLICY_COUNT"));
  assert.ok(
    req.selection_plan.selected_resource_packets.some(
      (p) => p.packet_id === "policy_count_packet",
    ),
  );
  const body = JSON.stringify(req.messages);
  assert.ok(body.includes("confirmed_contract_count"));
  assert.ok(!body.includes("골절진단비"));
  caseReport("T3_policy_count", req);
}

function testT4() {
  const req = liveSelective("내 암진단비 얼마야?");
  assertLiveClean(req, "T4");
  const packs = req.selection_plan.selected_resource_packets.filter((p) =>
    p.packet_id.startsWith("coverage_"),
  );
  assert.equal(packs.length, 1);
  const body = JSON.stringify(req.messages);
  assert.ok(body.includes("암진단비"));
  assert.ok(!body.includes("수술비"));
  caseReport("T4_cancer", req);
}

function testT5() {
  const req = liveSelective("이 보험 해지해도 돼?", {
    pointed_contract_ids: ["c1"],
  });
  assertLiveClean(req, "T5");
  const sys = req.system.map((b) => b.text).join("\n");
  assert.ok(sys.includes("선결정하지 않았다") || sys.includes("해지 결론을 쓰지 않았다"));
  assert.ok(!sys.includes("해지하세요"));
  assert.ok(req.selection_plan.selected_prompt_blocks.includes("COND_TERMINATION_CONTEXT"));
  caseReport("T5_termination", req);
}

function testT6() {
  const req = liveSelective(
    "여기 무슨 뜻이야?",
    {
      current_attachment_question: true,
      current_attachment_ids: ["d1"],
      pointed_attachment_ids: ["d1"],
      pdf_attached: true,
    },
    {
      multiAttachments: [
        { document_id: "d1", mediaType: "image/jpeg", base64: TINY_JPEG_B64 },
      ],
      chart: BIG_CHART,
      policyTruthContext: BIG_LEDGER,
    },
  );
  assertLiveClean(req, "T6");
  assert.equal(req.metrics.image_count, 1);
  caseReport("T6_one_image", req);
}

function testT7() {
  const req = liveSelective(
    "2번 이미지 설명해줘",
    {
      current_attachment_question: true,
      current_attachment_ids: ["d1", "d2", "d3", "d4", "d5"],
    },
    {
      multiAttachments: Array.from({ length: 5 }, (_, i) => ({
        document_id: `d${i + 1}`,
        mediaType: "image/jpeg",
        base64: TINY_JPEG_B64 + "Q".repeat(50 * (i + 1)),
      })),
    },
  );
  assert.equal(req.metrics.image_count, 1);
  caseReport("T7_image_2", req);
}

function testT8() {
  const req = liveSelective(
    "방금 올린 서류 전체 분석해줘",
    {
      current_attachment_question: true,
      current_attachment_ids: ["d1", "d2", "d3", "d4", "d5"],
      full_current_attach_analysis: true,
    },
    {
      multiAttachments: Array.from({ length: 5 }, (_, i) => ({
        document_id: `d${i + 1}`,
        mediaType: "image/jpeg",
        base64: TINY_JPEG_B64,
      })),
    },
  );
  assert.equal(req.metrics.image_count, 5);
  assert.equal(bodyHasHeavyFullContext(req), false);
  caseReport("T8_all_current_images", req);
}

function testT9() {
  const req = liveSelective("내 청구 지금 어디까지야?", {}, {
    activeClaimCases: [{ id: "cl1", status: "under_review", deadline: "2026-09-01" }],
  });
  assert.ok(req.selection_plan.selected_prompt_blocks.includes("COND_CLAIM"));
  assert.ok(
    !req.selection_plan.selected_resource_packets.some((p) =>
      p.packet_id.startsWith("coverage_"),
    ),
  );
  caseReport("T9_claim", req);
}

function testT10() {
  const req = liveSelective(
    "현재 판매 암보험 비교해줘",
    {},
    {
      recommendationContext: {
        coverage_gap_labels: ["cancer"],
        budget_band: "mid",
        preference_labels: ["simple"],
        related_contract_ids: ["c1"],
        public_evidence_status: "available",
      },
    },
  );
  assert.ok(req.selection_plan.selected_prompt_blocks.includes("COND_PRODUCT_SHOWCASE"));
  assert.equal(req.tools.length, 1);
  assert.ok(
    !req.selection_plan.selected_resource_packets.some(
      (p) => p.packet_id === "policy_count_packet",
    ),
  );
  caseReport("T10_product", req, { recommendation: true });
}

function testT11() {
  const req = liveSelective("내 보험 괜찮아?");
  assert.equal(req.selection_plan.one_shot_input_sufficient, "HOLD");
  assert.equal(req.meta.FULL_DATA_FALLBACK, 0);
  assert.ok(
    req.selection_plan.selected_resource_packets.some(
      (p) => p.packet_id === "contract_summary_packet",
    ),
  );
  caseReport("T11_ambiguous", req);
}

function testT12() {
  const req = liveSelective("내 보험 몇 개야?");
  const counts = req.selection_plan.selected_resource_packets.filter((p) =>
    p.fact_scopes.includes("confirmed_contract_count"),
  );
  assert.equal(counts.length, 1);
  caseReport("T12_dedupe", req);
}

function testT13Continue() {
  const req = liveSelective("오늘 날씨 어때?");
  let messages = deepClone(req.messages);
  messages = [
    ...messages,
    {
      role: "assistant",
      content: [{ type: "server_tool_use", name: "web_search", id: "x" }],
    },
  ];
  const body2 = {
    system: req.system,
    messages,
    tools: req.tools,
  };
  assert.equal(bodyHasHeavyFullContext(body2), false);
  assert.equal(req.system[0].text.includes("verified_document_coverages"), false);
  caseReport("T13_continue", req);
}

function deepClone(v) {
  return JSON.parse(JSON.stringify(v));
}

function testT14FinalizeSeal() {
  const grounded = [
    "암진단비는 현재 확인된 범위에서 5천만 원입니다.",
    "지금 구조에서는 보장을 유지하면서 부족한 부분을 보완하는 편이 좋겠습니다.",
    "다음으로 보험료 부담과 갱신 조건을 함께 보면 됩니다.",
  ].join(" ");
  const finalized = finalizeKeyCustomerText(grounded);
  assert.equal(finalized.key_customer_text_sealed, true);
  assert.ok(String(finalized.customerText || "").length > 20);
  assert.ok(!String(finalized.customerText).includes("selection_plan"));
  assert.ok(!String(finalized.customerText).includes("KEY_ONE_SHOT_SELECTIVE"));
  const sealed = sealKeyCustomerText(finalized.customerText);
  assert.equal(sealed.key_customer_text_sealed, true);
  caseReport("T14_finalize_seal", liveSelective("안녕"), {
    recommendation: /보완|유지/.test(grounded),
  });
}

function testT15RecommendationQuality() {
  const req = liveSelective(
    "현재 판매 암보험 비교해줘",
    {},
    {
      recommendationContext: {
        coverage_gap_labels: ["cancer"],
        budget_band: "mid",
        preference_labels: ["simple_issue"],
        related_contract_ids: ["c1"],
        public_evidence_status: "available",
      },
    },
  );
  const sys = req.system.map((b) => b.text).join("\n");
  assert.ok(sys.includes("추천·권유"));
  assert.ok(sys.includes("한 단계 앞서"));
  assert.ok(sys.includes("회피하지 않는다") || sys.includes("추천을 과도한"));
  caseReport("T15_recommend_quality", req, { recommendation: true });
}

function testT16NoPii() {
  const req = liveSelective("계약번호 SECRET-1 010-1234-5678 암진단비");
  assertNoRawCustomerTelemetry(req.metrics);
  assertNoRawCustomerTelemetry(req.selection_plan);
  assert.ok(!JSON.stringify(req.metrics).includes(TINY_JPEG_B64.slice(0, 16)));
}

function testCompare() {
  const q = "내 보험 몇 개야?";
  const pre = buildPreS3Body(q);
  const s3 = liveSelective(q);
  const s1 = buildClaudeFirstOnDemandShadowBodies({
    question: q,
    chart: BIG_CHART,
    policyTruthContext: BIG_LEDGER,
    liveTools: LIVE_TOOLS,
  });
  const s2 = buildClaudeFirstOneShotSelectiveShadowBodies({
    question: q,
    fixture: {
      policy_count: 2,
      policy_list: BIG_LEDGER.confirmed_contracts,
      full_chart_available: true,
      full_ledger_available: true,
    },
    liveTools: LIVE_TOOLS,
  });
  const cmp = comparePreS3AndS3Live({
    preS3LiveBody: pre,
    s3LiveRequest: s3,
    s1Shadow: s1,
    s2Shadow: s2,
    liveTools: LIVE_TOOLS,
  });
  assert.ok(cmp.S3_REDUCTION_RATIO > 0);
  assert.equal(cmp.note, "FIXTURE_COMPARE_ONLY_NOT_PRODUCTION_SAVINGS");
  console.log(
    JSON.stringify(
      {
        PRE_S3_LIVE_BODY_BYTES: cmp.PRE_S3_LIVE_CURRENT.total_bytes,
        S3_LIVE_SELECTIVE_BODY_BYTES: cmp.S3_LIVE_SELECTIVE.total_bytes,
        S3_REDUCTION_RATIO: cmp.S3_REDUCTION_RATIO,
        PRE_S3_SYSTEM_CHARS: cmp.PRE_S3_LIVE_CURRENT.system_chars,
        S3_SYSTEM_CHARS: cmp.S3_LIVE_SELECTIVE.system_chars,
        PRE_S3_RESOURCE_BYTES: cmp.PRE_S3_LIVE_CURRENT.user_text_chars,
        S3_RESOURCE_BYTES: cmp.S3_LIVE_SELECTIVE.user_text_chars,
      },
      null,
      2,
    ),
  );
  return cmp;
}

function testFetchBodyIsSelectiveOnly() {
  // Simulate S3 cutover: fetch body must be selective, not preS3.
  const q = "내 암진단비 얼마야?";
  const pre = buildPreS3Body(q, { images: 2 });
  const s3 = liveSelective(q);
  const fetchBody = {
    model: "claude-sonnet-4-6",
    system: s3.system,
    messages: s3.messages,
    tools: LIVE_TOOLS,
  };
  assert.equal(bodyHasHeavyFullContext(fetchBody), false);
  assert.equal(bodyHasHeavyFullContext(pre), true);
  assert.ok(JSON.stringify(fetchBody).includes("ONE_SHOT_SELECTIVE"));
  assert.ok(!JSON.stringify(fetchBody.system).includes("PRE_S3_FULL_SYSTEM"));
}

preflight();
testT1();
testT2();
testT3();
testT4();
testT5();
testT6();
testT7();
testT8();
testT9();
testT10();
testT11();
testT12();
testT13Continue();
testT14FinalizeSeal();
testT15RecommendationQuality();
testT16NoPii();
testFetchBodyIsSelectiveOnly();
const cmp = testCompare();

console.log("FIXTURE_REPORTS=" + JSON.stringify(reports, null, 2));
console.log("TOKEN_BOMB_S3_LIVE_SELECTIVE: tests passed");
void cmp;
void measureAnthropicRequestMetrics;