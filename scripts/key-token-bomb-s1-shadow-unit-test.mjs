/**
 * TOKEN BOMB S1 — On-demand Shadow request builder unit tests.
 * Fake-fetch only. No Provider / DB / env secrets / Preview.
 */
import assert from "node:assert/strict";
import {
  ACTION_SEMANTIC_CONTRACT,
  KEY_ON_DEMAND_DECIDE_OR_ANSWER_PROMPT,
  assertNoRawCustomerTelemetry,
  buildClaudeFirstOnDemandShadowBodies,
  buildOnDemandAuthorityManifest,
  buildOnDemandResourceManifest,
  buildProviderFetchObservation,
  compareLiveAndShadowBodies,
  measureAnthropicRequestMetrics,
  stableBodyHash,
} from "../server/keyCore/keyClaudeFirstOnDemandShadow.js";

const TINY_JPEG_B64 = Buffer.from(
  "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc00011080001000103011100021100031101ffc40014000100000000000000000000000000000000ffda00080001000100003f00bf00ffd9",
  "hex",
).toString("base64");

const BIG_CHART = {
  schema: "verified_customer_chart_v1",
  verified_document_coverages: Array.from({ length: 40 }, (_, i) => ({
    coverage_name: `synthetic_coverage_${i}`,
    coverage_amount: 1000 * (i + 1),
  })),
  review_candidates: [{ id: "rc1", note: "synthetic_review" }],
  key_confirmed_source_facts: [{ fact: "synthetic_fact" }],
};

const BIG_LEDGER = {
  verified_policy_ledger: true,
  confirmed_contracts: Array.from({ length: 12 }, (_, i) => ({
    contract_id: `synth_contract_${i}`,
    status: "active",
  })),
  active_distinct_count: 12,
};

function liveHeavyBody({ images = 0 } = {}) {
  const content = [
    {
      type: "text",
      text: JSON.stringify({
        available_verified_evidence: {
          personal_chart: BIG_CHART,
          VERIFIED_POLICY_LEDGER: BIG_LEDGER,
          prior_consultation: {
            related_turns: Array.from({ length: 20 }, (_, i) => ({
              role: i % 2 ? "assistant" : "user",
              text: `synthetic_turn_${i}`,
            })),
          },
          retained_past_originals: [{ document_id: "past_1", source_scope: "vault_document" }],
        },
        current_question: "synthetic_question",
      }),
    },
  ];
  for (let i = 0; i < images; i += 1) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: TINY_JPEG_B64 + "A".repeat(2000 + i * 100),
      },
    });
  }
  return {
    system: [
      {
        type: "text",
        text: "LIVE_SYSTEM_PLACEHOLDER ".repeat(200),
      },
    ],
    messages: [{ role: "user", content }],
    tools: [{ type: "web_search_20250305", name: "web_search" }],
  };
}

function assertShadowClean(shadow) {
  for (const key of ["content_first", "manifest_first"]) {
    const body = shadow[key];
    assert.equal(body.inventory.full_chart_present, false, `${key} chart`);
    assert.equal(body.inventory.full_ledger_present, false, `${key} ledger`);
    assert.equal(body.inventory.prior_original_present, false, `${key} prior_original`);
    assert.equal(body.inventory.prior_consultation_present, false, `${key} prior`);
    assert.ok(body.inventory.resource_manifest.length > 0, `${key} manifest`);
    const sys = body.system.map((b) => b.text).join("\n");
    assert.ok(sys.includes("[KEY_ON_DEMAND_DECIDE_OR_ANSWER]"));
    assert.ok(sys.includes("content_provided=true인 경우에만"));
    assert.ok(!sys.includes("첨부 원본·차트·대화·기억·계산·공공 근거는 충분히 제공된다"));
    const packed = JSON.stringify(body.messages);
    assert.ok(!packed.includes("verified_document_coverages"));
    assert.ok(!packed.includes("confirmed_contracts"));
    assert.ok(!/"coverage_amount"\s*:\s*1000/.test(packed));
    assertNoRawCustomerTelemetry(body.metrics);
    assertNoRawCustomerTelemetry(body.inventory);
  }
}

function testT1GeneralDialogue() {
  const shadow = buildClaudeFirstOnDemandShadowBodies({
    question: "오늘 날씨 어때?",
    chart: BIG_CHART,
    policyTruthContext: BIG_LEDGER,
    priorConsultation: { related_turns: [{ role: "user", text: "안녕" }] },
    liveTools: [{ type: "web_search_20250305", name: "web_search" }],
  });
  assertShadowClean(shadow);
  const live = liveHeavyBody({ images: 0 });
  const cmp = compareLiveAndShadowBodies({
    liveBody: live,
    liveUserPayload: {
      available_verified_evidence: { personal_chart: BIG_CHART },
      VERIFIED_POLICY_LEDGER: BIG_LEDGER,
    },
    liveTools: live.tools,
    shadow,
  });
  assert.equal(cmp.LIVE_CURRENT.full_chart_present, true);
  assert.equal(cmp.SHADOW_CONTENT_FIRST.full_chart_present, false);
  assert.equal(cmp.SHADOW_MANIFEST_FIRST.full_ledger_present, false);
  assert.ok(cmp.shadow_manifest_first_reduction_ratio > 0.3);
  assert.ok(cmp.shadow_content_first_byte_reduction > 0);
  assert.equal(shadow.meta.CURRENT_ATTACHMENT_POLICY_SELECTED, false);
  assert.equal(ACTION_SEMANTIC_CONTRACT.REQUEST_TRANSPORT_SELECTED, false);
}

function testT2ContractCount() {
  const shadow = buildClaudeFirstOnDemandShadowBodies({
    question: "나 보험 몇 개야?",
    chart: BIG_CHART,
    policyTruthContext: BIG_LEDGER,
  });
  assertShadowClean(shadow);
  const auth = shadow.content_first.inventory.authority_manifest;
  assert.equal(auth.confirmed_contract_count.resource_available, true);
  assert.equal(auth.confirmed_contract_count.content_provided, false);
  assert.equal(auth.confirmed_contract_list.content_provided, false);
  const text = JSON.stringify(shadow.content_first.messages);
  assert.ok(!/"active_distinct_count"\s*:\s*12/.test(text));
  assert.ok(!text.includes("12건"));
  assert.ok(
    shadow.content_first.system
      .map((b) => b.text)
      .join("\n")
      .includes("목록에 자료가 있다는 이유로"),
  );
}

function testT3OneImage() {
  const attaches = [
    { document_id: "doc_synth_1", mediaType: "image/jpeg", base64: TINY_JPEG_B64 },
  ];
  const shadow = buildClaudeFirstOnDemandShadowBodies({
    question: "이 서류 보험료만",
    chart: BIG_CHART,
    policyTruthContext: BIG_LEDGER,
    currentAttachments: attaches,
  });
  assert.equal(shadow.content_first.metrics.image_count, 1);
  assert.equal(shadow.manifest_first.metrics.image_count, 0);
  assert.equal(shadow.content_first.inventory.current_attachment_content_present, true);
  assert.equal(shadow.manifest_first.inventory.current_attachment_content_present, false);
  const aItem = shadow.content_first.inventory.resource_manifest.find(
    (r) => r.current_turn_attachment,
  );
  const bItem = shadow.manifest_first.inventory.resource_manifest.find(
    (r) => r.current_turn_attachment,
  );
  assert.equal(aItem.content_provided, true);
  assert.equal(bItem.content_provided, false);
  assert.equal(shadow.meta.CURRENT_ATTACHMENT_POLICY_SELECTED, false);
}

function testT4FiveImages() {
  const attaches = Array.from({ length: 5 }, (_, i) => ({
    document_id: `doc_synth_${i + 1}`,
    mediaType: "image/jpeg",
    base64: TINY_JPEG_B64 + "B".repeat(500 * (i + 1)),
  }));
  const shadow = buildClaudeFirstOnDemandShadowBodies({
    question: "다섯 장 합계",
    currentAttachments: attaches,
    chart: BIG_CHART,
  });
  assert.equal(shadow.content_first.metrics.image_count, 5);
  assert.equal(shadow.manifest_first.metrics.image_count, 0);
  assert.ok(
    shadow.content_first.metrics.image_total_bytes >
      shadow.manifest_first.metrics.image_total_bytes,
  );
  assert.ok(
    shadow.content_first.metrics.total_bytes > shadow.manifest_first.metrics.total_bytes,
  );
  assertNoRawCustomerTelemetry(shadow.content_first.metrics);
  assert.ok(!JSON.stringify(shadow.content_first.metrics).includes(TINY_JPEG_B64.slice(0, 40)));
}

function testT5AllHeavyIndexesOnly() {
  const shadow = buildClaudeFirstOnDemandShadowBodies({
    question: "전체 정리해줘",
    chart: BIG_CHART,
    policyTruthContext: BIG_LEDGER,
    readyCardMeta: { status: "ready", materials_connected: true },
    priorConsultation: { related_turns: [{ role: "user", text: "이전" }], open_goals: ["g"] },
    keyRelevantMemoryPacket: { use_focused_delivery: true, packet: { confirmed_facts: [] } },
    activeClaimCases: [{ id: "c1", status: "preparing" }],
    insuranceClockBrief: { items: [{ id: "clk1" }] },
    lifeLedgerBrief: { goals: ["x"] },
    paymentTruthBrief: { links: [] },
    signupOnboardingBrief: { source: "signup_onboarding" },
    priorOriginalsAvailable: true,
  });
  assertShadowClean(shadow);
  assert.ok(shadow.content_first.inventory.resource_manifest_count >= 8 ||
    shadow.content_first.inventory.resource_manifest.length >= 8);
  const packed = JSON.stringify(shadow.content_first.messages);
  assert.ok(!packed.includes("synthetic_coverage_"));
  assert.ok(!packed.includes("synth_contract_"));
  // no duplicate full fact bodies
  assert.equal((packed.match(/verified_document_coverages/g) || []).length, 0);
}

function testT6ProviderFetchCounter() {
  let fetchCount = 0;
  const hashes = [];
  const bodies = [
    liveHeavyBody({ images: 1 }),
    liveHeavyBody({ images: 1 }),
  ];
  // Simulate S1 counter semantics without invoking live Claude path / secrets.
  const observations = [];
  for (const body of bodies) {
    fetchCount += 1;
    const obs = buildProviderFetchObservation({
      providerFetchIndex: fetchCount,
      body,
      priorHeavyContextReplayed: fetchCount > 1,
    });
    observations.push(obs);
    hashes.push(obs.body_hash);
  }
  assert.equal(fetchCount, 2);
  assert.equal(observations[0].provider_fetch_index, 1);
  assert.equal(observations[1].provider_fetch_index, 2);
  assert.equal(observations[1].prior_heavy_context_replayed, true);
  assert.equal(hashes[0], hashes[1]);
  assert.notEqual(String(fetchCount), "provider_calls_hardcode");
  // Hardcode 1 must not be SSOT
  const PROVIDER_CALLS_HARDCODE = 1;
  assert.notEqual(fetchCount, PROVIDER_CALLS_HARDCODE);
  assertNoRawCustomerTelemetry(observations);
}

function testT7NoPiiInTelemetry() {
  const shadow = buildClaudeFirstOnDemandShadowBodies({
    question: "계약번호 ABC-SECRET-9999 확인해줘 010-1234-5678",
    chart: BIG_CHART,
    currentAttachments: [
      {
        document_id: "customer-uuid-should-hash",
        mediaType: "image/jpeg",
        base64: TINY_JPEG_B64,
      },
    ],
  });
  const cmp = compareLiveAndShadowBodies({
    liveBody: liveHeavyBody({ images: 1 }),
    liveUserPayload: { current_question: "x" },
    shadow,
  });
  // Telemetry surfaces only — not provider-shaped message bodies.
  assertNoRawCustomerTelemetry(cmp);
  assertNoRawCustomerTelemetry(shadow.content_first.metrics);
  assertNoRawCustomerTelemetry(shadow.manifest_first.metrics);
  assertNoRawCustomerTelemetry(shadow.content_first.inventory);
  assertNoRawCustomerTelemetry(shadow.manifest_first.inventory);
  for (const row of shadow.content_first.inventory.resource_manifest) {
    assert.ok(String(row.resource_id).startsWith("rh_"));
    assert.ok(!String(row.resource_id).includes("customer-uuid"));
  }
  assert.ok(!JSON.stringify(shadow.content_first.metrics).includes(TINY_JPEG_B64.slice(0, 24)));
  assert.ok(!KEY_ON_DEMAND_DECIDE_OR_ANSWER_PROMPT.includes("충분히 제공된다"));
}

function testLiveBodyIndependence() {
  const attaches = [
    { document_id: "d1", mediaType: "image/jpeg", base64: TINY_JPEG_B64 },
  ];
  const shadow = buildClaudeFirstOnDemandShadowBodies({
    question: "q",
    currentAttachments: attaches,
    chart: BIG_CHART,
  });
  shadow.content_first.messages[0].content[0].text = "MUTATED";
  attaches[0].base64 = "MUTATED_B64";
  const again = buildClaudeFirstOnDemandShadowBodies({
    question: "q",
    currentAttachments: [
      { document_id: "d1", mediaType: "image/jpeg", base64: TINY_JPEG_B64 },
    ],
    chart: BIG_CHART,
  });
  assert.notEqual(
    again.content_first.messages[0].content[0].text,
    "MUTATED",
  );
  assert.ok(
    JSON.stringify(again.content_first.messages).includes(TINY_JPEG_B64.slice(0, 20)),
  );
}

function testAuthorityManifestShape() {
  const auth = buildOnDemandAuthorityManifest({
    ledgerAvailable: true,
    chartAvailable: true,
    currentAttachments: [{ document_id: "a" }],
    contentProvideCurrentAttachments: false,
  });
  assert.equal(auth.confirmed_contract_count.content_provided, false);
  assert.equal(auth.current_originals.resource_available_count, 1);
  assert.equal(auth.current_originals.content_provided_count, 0);
  const res = buildOnDemandResourceManifest({
    ledgerAvailable: true,
    chartAvailable: true,
  });
  assert.ok(res.every((r) => r.content_provided === false));
}

function testHashStable() {
  const a = stableBodyHash({ system: [{ type: "text", text: "x" }], messages: [] });
  const b = stableBodyHash({ system: [{ type: "text", text: "x" }], messages: [] });
  assert.equal(a, b);
  const m = measureAnthropicRequestMetrics({
    system: [{ type: "text", text: "hello" }],
    messages: [{ role: "user", content: [{ type: "text", text: "q" }] }],
    tools: [],
  });
  assert.ok(m.total_bytes > 0);
}

const tests = [
  testT1GeneralDialogue,
  testT2ContractCount,
  testT3OneImage,
  testT4FiveImages,
  testT5AllHeavyIndexesOnly,
  testT6ProviderFetchCounter,
  testT7NoPiiInTelemetry,
  testLiveBodyIndependence,
  testAuthorityManifestShape,
  testHashStable,
];

for (const t of tests) t();
console.log(`TOKEN_BOMB_S1_SHADOW: ${tests.length} tests passed`);
