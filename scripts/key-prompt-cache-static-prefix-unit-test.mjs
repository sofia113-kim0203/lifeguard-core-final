/**
 * STAGE 5D — static prompt-cache prefix + KEY memory packet delivery (provider-free).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  buildClaudeFirstCachedRequestParts,
  buildPromptCacheLayoutTrace,
  buildUserPayload,
  composeClaudeFirstSystemText,
  LIFEGUARD_KEY_SYSTEM_PROMPT,
  serializeClaudeFirstCachePrefixForAudit,
  splitSystemTextForPromptCache,
} from "../server/keyCore/keyClaudeFirstDirect.js";
import {
  buildKeyRelevantMemoryPacket,
  resolveFocusedContracts,
} from "../server/keyCore/keyRelevantMemoryPacket.js";

let PROVIDER_CALLS = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = (...args) => {
  PROVIDER_CALLS += 1;
  if (typeof originalFetch === "function") return originalFetch(...args);
  return Promise.reject(new Error("fetch blocked"));
};

function ok(name) {
  console.log(`PASS ${name}`);
}

function sha16(s) {
  return createHash("sha256").update(String(s ?? ""), "utf8").digest("hex").slice(0, 16);
}

function estimateTokens(chars) {
  return Math.ceil(Number(chars || 0) / 4);
}

function largeChart(contractCount = 12, coveragePer = 40) {
  const confirmed = [];
  const review = [];
  const coverages = [];
  for (let i = 0; i < contractCount; i += 1) {
    const id = `doc_lg_${i}`;
    const c = {
      insurer_name: i % 2 ? "한화생명" : "삼성화재",
      product_name: `대형상품_${i}`,
      policy_number: `PN${String(100000000000 + i)}`,
      monthly_premium: 50000 + i * 1000,
      source_document_id: id,
      contract_identity_key: `ck_${i}`,
      status: "active",
      fact_refs: [
        {
          fact_type: "monthly_premium",
          literal: String(50000 + i * 1000),
          source_document_id: id,
          verification_status: "key_confirmed_from_original",
        },
      ],
    };
    if (i < 3) confirmed.push(c);
    else review.push({ ...c, identity_strength: "weak" });
    for (let j = 0; j < coveragePer; j += 1) {
      coverages.push({
        coverage_name: `담보_${i}_${j}_${"상세설명".repeat(8)}`,
        coverage_amount: 1_000_000 + j * 10000,
        source_document_id: id,
        contract_identity_key: `ck_${i}`,
        insurer_name: c.insurer_name,
        policy_number: c.policy_number,
      });
    }
  }
  return {
    schema: "verified_customer_chart_v1",
    confirmed_contracts: confirmed,
    review_candidates: review,
    verified_document_coverages: coverages,
    key_confirmed_source_facts: confirmed.flatMap((c) => c.fact_refs || []),
  };
}

function memoryRowFromChart(chart, version = 1) {
  const contracts = (chart.confirmed_contracts || []).slice(0, 3);
  return {
    memory_commit_id: "mem_stage5d_1",
    memory_version: version,
    customer_id: "cust_stage5d_1",
    session_id: "sess_stage5d_1",
    primary_document_id: contracts[0]?.source_document_id ?? "doc_lg_0",
    document_ids: contracts.map((c) => c.source_document_id),
    contracts,
    read_status: "confirmed_facts",
    focus_status: "resolved",
    confirmation_source: "key_original",
    rejected_fact_count: 0,
  };
}

function finalBodyChars(parts) {
  return JSON.stringify({
    system: parts.system,
    messages: parts.messages,
  }).length;
}

function legacyCachedPrefixChars(systemText, userPayload) {
  // Reconstruct pre-5D layout size: system (full) + Block B with cache marker.
  const evidence =
    userPayload?.available_verified_evidence &&
    typeof userPayload.available_verified_evidence === "object"
      ? userPayload.available_verified_evidence
      : {};
  const blockB = JSON.stringify({ available_verified_evidence: evidence });
  return String(systemText ?? "").length + blockB.length;
}

const staticBase = String(LIFEGUARD_KEY_SYSTEM_PROMPT).trim();
const baseSystem = composeClaudeFirstSystemText({
  question: "기준질문",
  history: [],
});

// A — STATIC_PREFIX_HASH_STABLE
{
  const chartA = largeChart(8, 30);
  const chartB = largeChart(14, 45);
  const memV1 = memoryRowFromChart(chartA, 1);
  const memV2 = memoryRowFromChart(chartB, 2);
  const histShort = [
    { role: "user", content: "문서 올렸어" },
    { role: "assistant", content: "확인했습니다." },
  ];
  const histLong = [
    ...histShort,
    { role: "user", content: "추가질문1" },
    { role: "assistant", content: "답1" },
    { role: "user", content: "추가질문2" },
    { role: "assistant", content: "답2" },
  ];

  const scenarios = [
    {
      name: "Q_A",
      question: "이 보험 월 보험료 얼마야?",
      history: histShort,
      chart: chartA,
      mem: memV1,
    },
    {
      name: "Q_B",
      question: "암진단비 보장금액이 얼마인가요?",
      history: histShort,
      chart: chartA,
      mem: memV1,
    },
    {
      name: "HISTORY_GROW",
      question: "이 보험 월 보험료 얼마야?",
      history: histLong,
      chart: chartA,
      mem: memV1,
    },
    {
      name: "CHART_GROW",
      question: "이 보험 월 보험료 얼마야?",
      history: histShort,
      chart: chartB,
      mem: memV1,
    },
    {
      name: "MEMORY_VERSION",
      question: "이 보험 월 보험료 얼마야?",
      history: histShort,
      chart: chartA,
      mem: memV2,
    },
    {
      name: "FACT_GROW",
      question: "이 보험 월 보험료 얼마야?",
      history: histShort,
      chart: {
        ...chartA,
        key_confirmed_source_facts: [
          ...(chartA.key_confirmed_source_facts || []),
          {
            fact_type: "extra",
            literal: "추가사실",
            source_document_id: "doc_lg_0",
          },
        ],
      },
      mem: memV1,
    },
  ];

  const hashes = [];
  for (const sc of scenarios) {
    const packet = buildKeyRelevantMemoryPacket({
      question: sc.question,
      history: sc.history,
      memoryRow: sc.mem,
      memoryLoad: { status: "hit" },
      chart: sc.chart,
      keyConfirmedSourceFacts: sc.chart.key_confirmed_source_facts,
      selectedDocumentId: sc.mem.primary_document_id,
      originalAttachmentCount: 0,
      allowMultiContracts: true,
    });
    const systemText = `${baseSystem}\n\n[DOMAIN_DYNAMIC]\nchart_contracts=${
      (sc.chart.confirmed_contracts?.length || 0) +
      (sc.chart.review_candidates?.length || 0)
    }\nmemory_version=${sc.mem.memory_version}`;
    const payload = buildUserPayload({
      question: sc.question,
      chart: sc.chart,
      contextPack: {
        recent_conversation_originals: sc.history,
      },
      keyRelevantMemoryPacket: packet,
      now: new Date("2026-08-01T01:20:00.111+09:00"),
    });
    const slices = serializeClaudeFirstCachePrefixForAudit({
      systemText,
      userPayload: payload,
    });
    hashes.push(sha16(slices.prefix_json));
    assert.equal(slices.cache_strategy, "A_static_system_marker");
    assert.equal(slices.cache_marker_location, "system");
    assert.equal(slices.prefix_json.includes(sc.question), false);
    assert.equal(slices.prefix_json.includes("available_verified_evidence"), false);
  }

  // upload count 0→5 chart growth — prefix still stable
  for (let n = 0; n <= 5; n += 1) {
    const chart = largeChart(Math.max(1, n), 20);
    const mem = memoryRowFromChart(chart, 1);
    const packet = buildKeyRelevantMemoryPacket({
      question: "보험료 알려줘",
      history: histShort,
      memoryRow: mem,
      memoryLoad: { status: "hit" },
      chart,
      selectedDocumentId: mem.primary_document_id,
      originalAttachmentCount: 0,
      allowMultiContracts: true,
    });
    const payload = buildUserPayload({
      question: "보험료 알려줘",
      chart,
      keyRelevantMemoryPacket: packet,
    });
    const slices = serializeClaudeFirstCachePrefixForAudit({
      systemText: baseSystem,
      userPayload: payload,
    });
    hashes.push(sha16(slices.prefix_json));
  }

  assert.ok(hashes.length >= 2);
  assert.ok(hashes.every((h) => h === hashes[0]), `hashes=${hashes.join(",")}`);
  console.log(`STATIC_PREFIX_HASH_STABLE hash=${hashes[0]} n=${hashes.length}`);
}
ok("A_STATIC_PREFIX_HASH_STABLE");

// B — cache prefix content has no customer payload JSON
{
  const chart = largeChart(10, 25);
  const mem = memoryRowFromChart(chart, 3);
  const q = "이 보험의 주의점을 자세히 설명해줘";
  const packet = buildKeyRelevantMemoryPacket({
    question: q,
    history: [{ role: "user", content: "삼성화재 올렸어" }],
    memoryRow: mem,
    memoryLoad: { status: "hit" },
    chart,
    selectedDocumentId: mem.primary_document_id,
    originalAttachmentCount: 0,
    allowMultiContracts: true,
  });
  const payload = buildUserPayload({
    question: q,
    chart,
    keyRelevantMemoryPacket: packet,
    now: new Date("2026-08-02T10:00:00.000+09:00"),
  });
  const systemText = `${baseSystem}\n\ncustomer_id=cust_stage5d_1\nsession_id=sess_x`;
  const slices = serializeClaudeFirstCachePrefixForAudit({
    systemText,
    userPayload: payload,
  });
  const split = splitSystemTextForPromptCache(systemText);
  assert.equal(split.cached_system_text, staticBase);
  assert.ok(split.dynamic_system_text.includes("customer_id"));
  assert.equal(slices.prefix_json.includes("cust_stage5d_1"), false);
  assert.equal(slices.prefix_json.includes("sess_x"), false);
  assert.equal(slices.prefix_json.includes(q), false);
  assert.equal(slices.prefix_json.includes("available_verified_evidence"), false);
  assert.equal(slices.prefix_json.includes("PN100000000000"), false);
  assert.equal(slices.prefix_json.includes("memory_version"), false);
  assert.ok(slices.c_json.includes(q) || slices.c_json.includes("current_question"));
  const layout = buildPromptCacheLayoutTrace({
    parts: slices.parts,
    userPayload: payload,
  });
  assert.equal(layout.customer_specific_data_before_marker, false);
  assert.equal(layout.strategy, "A_static_system_marker");
}
ok("B_cache_prefix_no_customer_payload");

// C — ordinary follow-up: packet in, full chart out, originals 0
{
  const chart = largeChart(12, 35);
  const mem = memoryRowFromChart(chart, 1);
  const q = "월 보험료 얼마야?";
  const packet = buildKeyRelevantMemoryPacket({
    question: q,
    history: [
      { role: "user", content: "삼성화재 어린이보험 올렸어" },
      { role: "assistant", content: "확인했습니다." },
    ],
    memoryRow: mem,
    memoryLoad: { status: "hit" },
    chart,
    keyConfirmedSourceFacts: chart.key_confirmed_source_facts,
    selectedDocumentId: mem.primary_document_id,
    originalAttachmentCount: 0,
    allowMultiContracts: true,
  });
  assert.equal(packet.use_focused_delivery, true);
  const payload = buildUserPayload({
    question: q,
    chart,
    contextPack: {
      recent_conversation_originals: [
        { role: "user", content: "삼성화재 어린이보험 올렸어" },
        { role: "assistant", content: "확인했습니다." },
      ],
    },
    keyRelevantMemoryPacket: packet,
  });
  const parts = buildClaudeFirstCachedRequestParts({
    systemText: baseSystem,
    userPayload: payload,
    attachments: [],
  });
  const body = JSON.stringify(parts);
  assert.equal(body.includes('"type":"document"'), false);
  assert.equal(body.includes('"type":"image"'), false);
  assert.ok(body.includes("key_relevant_memory_packet"));
  assert.equal(
    payload.available_verified_evidence.personal.evidence_state.status,
    "focused_packet",
  );
  assert.equal(
    String(payload.available_verified_evidence.personal.chart?.schema ?? ""),
    "focused_verified_chart_v1",
  );
  assert.ok(
    (payload.available_verified_evidence.personal.chart?.review_candidates
      ?.length ?? 0) === 0,
  );
  assert.ok(packet.packet.confirmed_facts.length >= 1);
  assert.ok(packet.packet.unconfirmed);
  assert.ok(packet.packet.recent_dialogue.length >= 1);
  const layout = buildPromptCacheLayoutTrace({ parts, userPayload: payload });
  assert.equal(layout.full_chart_injected, false);
  assert.equal(layout.relevant_memory_packet_injected, true);
  assert.ok(layout.focused_contract_count >= 1);
  // Claude-first path remains single messages request in production wiring —
  // this assembly helper is the one provider call body builder.
  assert.equal(parts.cache_breakpoints, 1);
}
ok("C_followup_packet_no_full_chart");

// D — complex multi-contract expansion without classifier / extra Claude
{
  const chart = largeChart(6, 20);
  const mem = {
    ...memoryRowFromChart(chart, 1),
    primary_document_id: "",
    contracts: (chart.confirmed_contracts || []).slice(0, 3),
    document_ids: (chart.confirmed_contracts || []).slice(0, 3).map((c) => c.source_document_id),
  };
  const focus = resolveFocusedContracts({
    question: "내 보험들 비교해서 어디가 더 유리한지 알려줘",
    history: [],
    memoryRow: mem,
    chart,
    allowMulti: true,
  });
  assert.equal(focus.status, "resolved");
  assert.ok(focus.focused.length >= 2, `focused=${focus.focused.length}`);
  const packet = buildKeyRelevantMemoryPacket({
    question: "내 보험들 비교해서 어디가 더 유리한지 자세히 설명해줘",
    history: [],
    memoryRow: mem,
    memoryLoad: { status: "hit" },
    chart,
    originalAttachmentCount: 0,
    allowMultiContracts: true,
  });
  assert.ok(packet.packet.focused_contracts.length >= 2);
  const coverages = packet.packet.focused_chart?.verified_document_coverages || [];
  assert.ok(coverages.length >= 2);
  const payload = buildUserPayload({
    question: packet.packet.current_question,
    chart,
    keyRelevantMemoryPacket: packet,
  });
  assert.equal(
    String(payload.available_verified_evidence.personal.chart?.schema ?? ""),
    "focused_verified_chart_v1",
  );
  // Not a full chart dump
  assert.ok(
    (payload.available_verified_evidence.personal.chart?.review_candidates
      ?.length ?? 0) === 0,
  );
  assert.ok(
    JSON.stringify(payload).includes("삼성화재") ||
      JSON.stringify(payload).includes("한화생명"),
  );
}
ok("D_complex_multi_contract_expand");

// E — before/after final request body comparison on large fixture
{
  const chart = largeChart(12, 40);
  const mem = memoryRowFromChart(chart, 1);
  const q = "이 보험 담보 구조와 주의점을 자세히 설명해줘";
  const systemText = `${baseSystem}\n\n[VERIFIED_COVERAGE_AUTHORITY]\nlarge_fixture`;
  const fullPayload = buildUserPayload({
    question: q,
    chart,
    contextPack: {
      recent_conversation_originals: Array.from({ length: 8 }, (_, i) => ({
        role: i % 2 ? "assistant" : "user",
        content: `과거턴_${i}_` + "내용".repeat(20),
      })),
    },
    now: new Date("2026-08-01T01:20:00.111+09:00"),
  });
  const beforePrefix = legacyCachedPrefixChars(systemText, fullPayload);
  const beforeParts = {
    system: [{ type: "text", text: systemText }],
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: JSON.stringify({
              available_verified_evidence: fullPayload.available_verified_evidence,
            }),
            cache_control: { type: "ephemeral" },
          },
          {
            type: "text",
            text: JSON.stringify(
              {
                current_question: fullPayload.current_question,
                current_context: fullPayload.current_context,
              },
              null,
              2,
            ),
          },
        ],
      },
    ],
  };
  const beforeBody = finalBodyChars(beforeParts);

  const packet = buildKeyRelevantMemoryPacket({
    question: q,
    history: [
      { role: "user", content: "서류 올렸어" },
      { role: "assistant", content: "확인했습니다." },
    ],
    memoryRow: mem,
    memoryLoad: { status: "hit" },
    chart,
    keyConfirmedSourceFacts: chart.key_confirmed_source_facts,
    selectedDocumentId: mem.primary_document_id,
    originalAttachmentCount: 0,
    allowMultiContracts: true,
  });
  const afterPayload = buildUserPayload({
    question: q,
    chart,
    contextPack: {
      recent_conversation_originals: [
        { role: "user", content: "서류 올렸어" },
        { role: "assistant", content: "확인했습니다." },
      ],
    },
    keyRelevantMemoryPacket: packet,
    now: new Date("2026-08-01T01:20:00.111+09:00"),
  });
  const afterParts = buildClaudeFirstCachedRequestParts({
    systemText,
    userPayload: afterPayload,
  });
  const afterBody = finalBodyChars(afterParts);
  const afterLayout = buildPromptCacheLayoutTrace({
    parts: afterParts,
    userPayload: afterPayload,
  });
  const beforeCacheTokens = estimateTokens(beforePrefix);
  const afterCacheTokens = afterLayout.estimated_cached_prefix_tokens;
  const reduction =
    beforeCacheTokens > 0
      ? Number((((beforeCacheTokens - afterCacheTokens) / beforeCacheTokens) * 100).toFixed(1))
      : 0;

  assert.ok(afterLayout.cached_prefix_chars <= staticBase.length + 32);
  assert.ok(afterCacheTokens < 5000);
  assert.ok(beforeCacheTokens > 20000, `beforeCacheTokens=${beforeCacheTokens}`);
  assert.ok(afterBody < beforeBody);
  assert.equal(afterLayout.full_chart_injected, false);
  assert.equal(afterLayout.relevant_memory_packet_injected, true);
  assert.equal(afterLayout.customer_specific_data_before_marker, false);

  globalThis.__STAGE5D_SIZE = {
    before_final_body_chars: beforeBody,
    after_final_body_chars: afterBody,
    before_cached_prefix_chars: beforePrefix,
    after_cached_prefix_chars: afterLayout.cached_prefix_chars,
    before_estimated_cache_creation_tokens: beforeCacheTokens,
    after_estimated_cache_creation_tokens: afterCacheTokens,
    after_estimated_dynamic_input_tokens: Math.max(
      0,
      afterLayout.estimated_total_input_tokens - afterCacheTokens,
    ),
    cache_creation_reduction_percent: reduction,
  };
  console.log("SIZE_COMPARE", JSON.stringify(globalThis.__STAGE5D_SIZE));
}
ok("E_large_fixture_before_after");

// F — quality fixtures: required facts present for each question shape
{
  const chart = largeChart(5, 15);
  // Ensure coverages on focused contracts
  chart.confirmed_contracts = (chart.confirmed_contracts || []).slice(0, 3);
  const mem = memoryRowFromChart(chart, 1);
  const cases = [
    {
      name: "simple_confirm",
      q: "월 보험료 얼마야?",
      need: ["monthly_premium", "삼성화재"],
      multi: false,
    },
    {
      name: "caution_detail",
      q: "이 보험의 주의점을 설명해줘",
      need: ["focused_contracts", "confirmed_facts", "unconfirmed"],
      multi: false,
    },
    {
      name: "multi_coverage",
      q: "이 보험 담보들을 분석해줘",
      need: ["verified_document_coverages", "focused_chart"],
      multi: false,
    },
    {
      name: "multi_compare",
      q: "내 보험들 비교해줘",
      need: ["focused_contracts"],
      multi: true,
    },
    {
      name: "detail_request",
      q: "자세히 설명해줘. 근거와 출처도 알려줘",
      need: ["confirmed_facts", "source_document_id"],
      multi: false,
    },
  ];
  for (const c of cases) {
    const row = c.multi
      ? {
          ...mem,
          primary_document_id: "",
          contracts: chart.confirmed_contracts.slice(0, 3),
        }
      : mem;
    const packet = buildKeyRelevantMemoryPacket({
      question: c.q,
      history: [
        { role: "user", content: "서류 확인했어?" },
        { role: "assistant", content: "네, 공식 기억으로 확인했습니다." },
      ],
      memoryRow: row,
      memoryLoad: { status: "hit" },
      chart,
      keyConfirmedSourceFacts: chart.key_confirmed_source_facts,
      selectedDocumentId: c.multi ? null : mem.primary_document_id,
      originalAttachmentCount: 0,
      allowMultiContracts: true,
    });
    const payload = buildUserPayload({
      question: c.q,
      chart,
      keyRelevantMemoryPacket: packet,
    });
    const parts = buildClaudeFirstCachedRequestParts({
      systemText: baseSystem,
      userPayload: payload,
    });
    const body = JSON.stringify({
      packet: packet.packet,
      payload,
      parts_meta: {
        strategy: parts.cache_strategy,
        system_blocks: parts.system.length,
      },
    });
    for (const needle of c.need) {
      assert.ok(body.includes(needle), `${c.name} missing ${needle}`);
    }
    if (c.multi) {
      assert.ok(packet.packet.focused_contracts.length >= 2, c.name);
    } else {
      assert.ok(packet.packet.focused_contracts.length >= 1, c.name);
    }
    assert.equal(
      String(payload.available_verified_evidence.personal.chart?.schema ?? ""),
      "focused_verified_chart_v1",
    );
  }
  // Table / length principles remain in static system (not forced truncate)
  assert.match(LIFEGUARD_KEY_SYSTEM_PROMPT, /표는 실제 비교가 더 명확할 때만/);
  assert.match(LIFEGUARD_KEY_SYSTEM_PROMPT, /미완성 문장으로 끝내지 않는다/);
}
ok("F_quality_fixtures_facts_present");

assert.equal(PROVIDER_CALLS, 0);
console.log(`PROVIDER_CALLS=${PROVIDER_CALLS}`);
console.log("\nALL_PASS key-prompt-cache-static-prefix-unit-test");
