/**
 * STAGE 5A — KEY relevant memory packet (provider-free).
 */
import assert from "node:assert/strict";
import {
  loadActiveKeyDocumentMemoryCommit,
  resolveOfficialDocumentMemoryForTurn,
} from "../server/keyCore/keyDocumentMemoryCommit.js";
import {
  buildKeyRelevantMemoryPacket,
  estimateCharsAndTokens,
  resolveFocusedContracts,
  shouldHardStopOnMemoryQueryFailed,
} from "../server/keyCore/keyRelevantMemoryPacket.js";
import { buildUserPayload, LIFEGUARD_KEY_SYSTEM_PROMPT } from "../server/keyCore/keyClaudeFirstDirect.js";
import { evaluateReadyCardHandoffMemoryGate } from "../server/keyCore/keyReadyCardBuild.js";

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

function createMemoryCommitStore(initialRows = []) {
  let nextId = 1;
  const rows = initialRows.map((row) => ({
    id: row.id ?? `mock-id-${nextId++}`,
    ...row,
  }));

  function matchRow(row, filters) {
    for (const f of filters) {
      if (String(row[f.col] ?? "") !== String(f.val ?? "")) return false;
    }
    return true;
  }

  function queryRows(table, filters, orderCol, orderAsc, limitN) {
    if (table !== "key_document_memory_commits") return [];
    let matched = rows.filter((row) => matchRow(row, filters));
    if (orderCol) {
      matched = [...matched].sort((a, b) => {
        const av = a[orderCol];
        const bv = b[orderCol];
        return orderAsc ? Number(av) - Number(bv) : Number(bv) - Number(av);
      });
    }
    if (limitN != null) matched = matched.slice(0, limitN);
    return matched;
  }

  function makeChain() {
    const state = {
      table: null,
      filters: [],
      orderCol: null,
      orderAsc: true,
      limitN: null,
    };
    const chain = {
      from(table) {
        state.table = table;
        return chain;
      },
      select() {
        return chain;
      },
      eq(col, val) {
        state.filters.push({ col, val });
        return chain;
      },
      order(col, { ascending = true } = {}) {
        state.orderCol = col;
        state.orderAsc = ascending;
        return chain;
      },
      limit(n) {
        state.limitN = n;
        return chain;
      },
      async maybeSingle() {
        const matched = queryRows(
          state.table,
          state.filters,
          state.orderCol,
          state.orderAsc,
          state.limitN,
        );
        return { data: matched[0] ? { ...matched[0] } : null, error: null };
      },
      then(resolve, reject) {
        const matched = queryRows(
          state.table,
          state.filters,
          state.orderCol,
          state.orderAsc,
          state.limitN,
        );
        return Promise.resolve({
          data: matched.map((r) => ({ ...r })),
          error: null,
        }).then(resolve, reject);
      },
    };
    return chain;
  }

  return {
    from(table) {
      return makeChain().from(table);
    },
    _rows: rows,
  };
}

const cid = "11111111-1111-1111-1111-111111111111";
const sidA = "sess-a";
const sidB = "sess-b";
const docA = "33333333-3333-3333-3333-333333333333";
const docB = "44444444-4444-4444-4444-444444444444";

function sampleMemoryRow({
  sessionId = sidA,
  version = 1,
  focus = "active",
  status = "committed",
  customer = cid,
  contracts = null,
} = {}) {
  return {
    id: `row-${sessionId}-${version}`,
    customer_id: customer,
    session_id: sessionId,
    source_turn_id: "t1",
    memory_commit_id: `22222222-2222-2222-2222-22222222222${version}`,
    idempotency_key: `idem-${sessionId}-${version}`,
    commit_status: status,
    memory_version: version,
    document_ids: [docA],
    primary_document_id: docA,
    read_status: "confirmed_facts",
    focus_status: focus,
    contracts:
      contracts ||
      [
        {
          insurer_name: "삼성화재",
          normalized_insurer_name: "삼성화재",
          product_name: "어린이보험",
          policy_number: "123456789012",
          policy_number_quality: "exact_unmasked",
          monthly_premium: 32000,
          source_document_id: docA,
          fact_refs: [
            {
              fact_type: "monthly_premium",
              literal: "32000",
              source_document_id: docA,
              verification_status: "key_confirmed_from_original",
            },
          ],
        },
      ],
    rejected_fact_count: 0,
    recorded_at: new Date().toISOString(),
    committed_at: new Date().toISOString(),
  };
}

const bulkyChart = {
  schema: "verified_customer_chart_v1",
  confirmed_contracts: [
    {
      insurer_name: "삼성화재",
      product_name: "어린이보험",
      policy_number: "123456789012",
      source_document_id: docA,
      monthly_premium: 32000,
    },
    {
      insurer_name: "한화생명",
      product_name: "단체보험",
      policy_number: "999999999999",
      source_document_id: docB,
      monthly_premium: 10000,
    },
  ],
  review_candidates: Array.from({ length: 40 }, (_, i) => ({
    insurer_name: `후보보험${i}`,
    product_name: `상품${i}`,
    note: "x".repeat(200),
  })),
  verified_document_coverages: Array.from({ length: 60 }, (_, i) => ({
    coverage_name: `담보${i}`,
    amount: 1000000 + i,
    source_document_id: i % 2 === 0 ? docA : docB,
    insurer_name: i % 2 === 0 ? "삼성화재" : "한화생명",
    policy_number: i % 2 === 0 ? "123456789012" : "999999999999",
    filler: "y".repeat(120),
  })),
  key_confirmed_source_facts: [
    {
      fact_type: "monthly_premium",
      literal: "32000",
      source_document_id: docA,
    },
    {
      fact_type: "monthly_premium",
      literal: "32000",
      source_document_id: docA,
    },
  ],
};

// A — recall
{
  const sb = createMemoryCommitStore([
    sampleMemoryRow({ sessionId: sidA, version: 1, focus: "active" }),
    sampleMemoryRow({
      sessionId: sidA,
      version: 2,
      focus: "superseded",
      status: "committed",
    }),
    sampleMemoryRow({ sessionId: sidB, version: 3, focus: "closed" }),
    sampleMemoryRow({
      sessionId: "other",
      version: 4,
      focus: "failed",
      status: "failed",
    }),
  ]);
  // fix: failed status row shouldn't be active; add a cross-session active
  sb._rows.push(
    sampleMemoryRow({ sessionId: sidB, version: 5, focus: "active" }),
  );

  const same = await loadActiveKeyDocumentMemoryCommit({
    supabase: sb,
    customerId: cid,
    sessionId: sidA,
  });
  assert.equal(same.ok, true);
  assert.equal(same.reason, "hit");
  assert.equal(same.row.session_id, sidA);
  assert.equal(same.row.focus_status, "active");

  const cross = await resolveOfficialDocumentMemoryForTurn({
    supabase: sb,
    customerId: cid,
    sessionId: "brand-new-session",
  });
  assert.equal(cross.ok, true);
  assert.equal(cross.reason, "hit");
  assert.equal(cross.cross_session_recall, true);
  assert.ok(["sess-a", "sess-b"].includes(cross.row.session_id));
  assert.equal(cross.row.focus_status, "active");
  assert.notEqual(cross.row.focus_status, "superseded");
  assert.notEqual(cross.row.commit_status, "failed");

  const owned = await resolveOfficialDocumentMemoryForTurn({
    supabase: sb,
    customerId: "99999999-9999-9999-9999-999999999999",
    sessionId: sidA,
  });
  assert.equal(owned.ok, true);
  assert.equal(owned.row, null);

  const miss = await resolveOfficialDocumentMemoryForTurn({
    supabase: createMemoryCommitStore([]),
    customerId: cid,
    sessionId: sidA,
  });
  assert.equal(miss.ok, true);
  assert.equal(miss.reason, "miss");

  const failingSb = {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return this;
        },
        maybeSingle: async () => ({
          data: null,
          error: { message: "boom" },
        }),
        then(resolve, reject) {
          return Promise.resolve({
            data: null,
            error: { message: "boom" },
          }).then(resolve, reject);
        },
      };
    },
  };
  const failed = await resolveOfficialDocumentMemoryForTurn({
    supabase: failingSb,
    customerId: cid,
    sessionId: sidA,
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, "query_failed");

  assert.equal(
    shouldHardStopOnMemoryQueryFailed({
      originalAttachmentCount: 0,
      memoryLoad: { status: "query_failed" },
      readyCardMeta: { document_status: { active_count: 1 } },
      chart: bulkyChart,
    }),
    true,
  );
  assert.equal(
    shouldHardStopOnMemoryQueryFailed({
      originalAttachmentCount: 1,
      memoryLoad: { status: "query_failed" },
      readyCardMeta: { document_status: { active_count: 1 } },
      chart: bulkyChart,
    }),
    false,
  );
  assert.equal(
    shouldHardStopOnMemoryQueryFailed({
      originalAttachmentCount: 0,
      memoryLoad: { status: "miss" },
      readyCardMeta: { document_status: { active_count: 1 } },
      chart: bulkyChart,
    }),
    false,
  );
  assert.equal(
    shouldHardStopOnMemoryQueryFailed({
      originalAttachmentCount: 0,
      memoryLoad: { status: "query_failed" },
      readyCardMeta: { document_status: { active_count: 0 } },
      chart: { confirmed_contracts: [] },
    }),
    false,
  );
}
ok("A_memory_recall_hit_miss_query_failed");

// B — focus selection
{
  const mem = sampleMemoryRow({
    contracts: [
      {
        insurer_name: "삼성화재",
        product_name: "어린이보험",
        policy_number: "123456789012",
        source_document_id: docA,
      },
      {
        insurer_name: "한화생명",
        product_name: "단체보험",
        policy_number: "999999999999",
        source_document_id: docB,
      },
    ],
  });
  const bySelect = resolveFocusedContracts({
    question: "보험료 얼마야?",
    memoryRow: mem,
    chart: bulkyChart,
    selectedDocumentId: docA,
  });
  assert.equal(bySelect.status, "resolved");
  assert.equal(bySelect.focused[0].insurer_name, "삼성화재");

  const byPn = resolveFocusedContracts({
    question: "증권 123456789012 보장 알려줘",
    memoryRow: mem,
    chart: bulkyChart,
  });
  assert.equal(byPn.status, "resolved");
  assert.equal(byPn.source, "strong_contract_identity");

  const byHistory = resolveFocusedContracts({
    question: "그거 보험료 다시",
    history: [
      { role: "user", content: "삼성화재 어린이보험 알려줘" },
      { role: "assistant", content: "삼성화재 어린이보험 기준으로 설명드릴게요." },
    ],
    memoryRow: mem,
    chart: bulkyChart,
  });
  assert.equal(byHistory.status, "resolved");
  assert.equal(byHistory.focused[0].insurer_name, "삼성화재");

  // Multiple actives with evidence still resolve — not blocked merely for multi-active.
  const multiActiveOk = resolveFocusedContracts({
    question: "증권 123456789012",
    memoryRow: mem,
    chart: bulkyChart,
  });
  assert.equal(multiActiveOk.status, "resolved");

  // Must not pick unrelated contract solely by newer version elsewhere.
  const versionTrap = resolveFocusedContracts({
    question: "어린이보험 보험료",
    history: [
      { role: "user", content: "삼성화재 어린이보험" },
      { role: "assistant", content: "삼성화재 기준으로 볼게요." },
    ],
    memoryRow: sampleMemoryRow({
      version: 1,
      contracts: [
        {
          insurer_name: "삼성화재",
          product_name: "어린이보험",
          policy_number: "123456789012",
          source_document_id: docA,
        },
      ],
    }),
    chart: {
      confirmed_contracts: [
        {
          insurer_name: "한화생명",
          product_name: "단체보험",
          policy_number: "999999999999",
          memory_version: 99,
          source_document_id: docB,
        },
        {
          insurer_name: "삼성화재",
          product_name: "어린이보험",
          policy_number: "123456789012",
          memory_version: 1,
          source_document_id: docA,
        },
      ],
    },
  });
  assert.equal(versionTrap.focused[0].insurer_name, "삼성화재");

  const ambMem = sampleMemoryRow({
    contracts: [
      {
        insurer_name: "삼성화재",
        product_name: "어린이보험",
        policy_number: "123456789012",
        source_document_id: docA,
      },
      {
        insurer_name: "한화생명",
        product_name: "단체보험",
        policy_number: "999999999999",
        source_document_id: docB,
      },
    ],
  });
  ambMem.primary_document_id = "";
  const amb = resolveFocusedContracts({
    question: "내 보험 알려줘",
    memoryRow: ambMem,
    chart: bulkyChart,
  });
  // two contracts, no focus evidence, no primary lineage → ambiguous shortlist
  assert.equal(amb.status, "ambiguous");
  assert.ok(amb.candidates.length >= 2);
}
ok("B_focus_selection");

// C + D + F — packet contents, factory dedupe, size
{
  const mem = sampleMemoryRow();
  const beforeFull = buildUserPayload({
    question: "이 보험 월 보험료 얼마야?",
    chart: bulkyChart,
    contextPack: {
      recent_conversation_originals: Array.from({ length: 20 }, (_, i) => ({
        role: i % 2 ? "assistant" : "user",
        content: "과거대화 ".repeat(40),
      })),
    },
    readyCardMeta: {
      status: "normal",
      document_status: { active_count: 2, documents: [{ id: docA }] },
    },
    keyLatestDocumentContext: {
      memory_commit_id: mem.memory_commit_id,
      memory_version: 1,
      contracts: mem.contracts,
      read_status: "confirmed_facts",
    },
  });
  const beforeChars = estimateCharsAndTokens(beforeFull).chars;

  const built = buildKeyRelevantMemoryPacket({
    question: "이 보험 월 보험료 얼마야?",
    history: [
      { role: "user", content: "삼성화재 어린이보험 올려뒀어" },
      { role: "assistant", content: "네, 삼성화재 어린이보험으로 확인했습니다." },
      { role: "user", content: "이 보험 월 보험료 얼마야?" },
    ],
    memoryRow: mem,
    memoryLoad: { status: "hit" },
    chart: bulkyChart,
    keyConfirmedSourceFacts: bulkyChart.key_confirmed_source_facts,
    selectedDocumentId: docA,
    originalAttachmentCount: 0,
    crossSessionRecall: false,
  });
  assert.equal(built.ok, true);
  assert.equal(built.use_focused_delivery, true);
  assert.equal(built.packet.current_question.includes("보험료"), true);
  assert.equal(built.trace.focused_contract_count, 1);
  assert.equal(built.packet.focused_contracts[0].insurer_name, "삼성화재");
  assert.ok(built.packet.official_document_memory);
  assert.ok(built.packet.confirmed_facts.length >= 1);
  assert.equal(built.trace.factory_facts_deduplicated, true);
  assert.ok(built.packet.recent_dialogue.length >= 1);
  assert.ok(built.trace.excluded_blocks.includes("full_policy_ledger"));
  assert.ok(built.trace.excluded_blocks.includes("full_customer_chart"));
  assert.equal(built.trace.original_attachment_count, 0);
  assert.ok(built.trace.block_chars.focused_contracts > 0);
  assert.ok(built.trace.total_context_chars <= 30000);
  assert.ok(built.trace.estimated_input_tokens <= 8000);

  const afterPayload = buildUserPayload({
    question: "이 보험 월 보험료 얼마야?",
    chart: bulkyChart,
    contextPack: { recent_conversation_originals: [] },
    readyCardMeta: {
      status: "normal",
      document_status: { active_count: 2, documents: [{ id: docA }] },
    },
    keyRelevantMemoryPacket: built,
  });
  const afterChars = estimateCharsAndTokens(afterPayload).chars;
  assert.ok(afterChars <= 30000, `afterChars=${afterChars}`);
  assert.ok(
    estimateCharsAndTokens(afterPayload).estimated_input_tokens <= 8000,
  );
  assert.equal(
    afterPayload.available_verified_evidence.personal.chart.review_candidates
      ?.length ?? 0,
    0,
  );
  assert.ok(
    (afterPayload.available_verified_evidence.personal.chart.confirmed_contracts
      ?.length ?? 0) <= 1,
  );
  assert.ok(afterPayload.current_context.key_relevant_memory_packet);
  assert.equal(
    afterPayload.available_verified_evidence.personal.provenance.source,
    "key_relevant_memory_packet",
  );
  // unrelated 한화 본문 미주입
  const afterJson = JSON.stringify(afterPayload);
  assert.equal(afterJson.includes("단체보험"), false);
  assert.ok(afterChars < beforeChars);
  console.log(
    `SIZE before=${beforeChars} after=${afterChars} reduction=${(
      (1 - afterChars / beforeChars) *
      100
    ).toFixed(1)}% tokens~${estimateCharsAndTokens(afterPayload).estimated_input_tokens}`,
  );
}
ok("C_D_F_packet_factory_size");

// E — answer form instructions (no forced table / no truncate classifier)
{
  assert.match(LIFEGUARD_KEY_SYSTEM_PROMPT, /표는 실제 비교가 더 명확할 때만/);
  assert.match(LIFEGUARD_KEY_SYSTEM_PROMPT, /모든 답변을 표로 만들지 말/);
  assert.match(LIFEGUARD_KEY_SYSTEM_PROMPT, /미완성 문장으로 끝내지 않는다/);
  assert.match(LIFEGUARD_KEY_SYSTEM_PROMPT, /key_relevant_memory_packet/);
  assert.doesNotMatch(LIFEGUARD_KEY_SYSTEM_PROMPT, /모든 답변.*표로 만들어/);
}
ok("E_answer_form_no_forced_table");

// G — stale handoff still rejects; packet path does not weaken gate
{
  const gate = evaluateReadyCardHandoffMemoryGate(
    { ok: true, memory_version: 2, reason: "hit" },
    0,
  );
  assert.equal(gate.reuse_handoff, false);
  assert.equal(gate.reject_reason, "handoff_memory_stale");
}
ok("G_stale_handoff_reject");

assert.equal(PROVIDER_CALLS, 0);
console.log(`PROVIDER_CALLS=${PROVIDER_CALLS}`);
console.log("\nALL_PASS key-relevant-memory-packet-unit-test");
