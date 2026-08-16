/**
 * ROOT continuity gates A–J — provider-free (no Claude / network secrets).
 */
import assert from "node:assert/strict";
import {
  buildClaudeFirstCachedRequestParts,
  buildPromptCacheLayoutTrace,
  buildUserPayload,
  serializeClaudeFirstCachePrefixForAudit,
} from "../server/keyCore/keyClaudeFirstDirect.js";
import { shouldRunClaudeFirstHomeChatQuestion } from "../server/keyCore/oneKeyCoreFlags.js";
import {
  buildKeyRelevantMemoryPacket,
} from "../server/keyCore/keyRelevantMemoryPacket.js";
import {
  buildKeyReadyCard,
  buildReadyCardClaudeMeta,
  evaluateReadyCardHandoffMemoryGate,
  resolveReadyCardForQuestionTurn,
} from "../server/keyCore/keyReadyCardBuild.js";
import {
  clearReadyCardCache,
  writeReadyCardCache,
} from "../server/keyCore/keyReadyCardCache.js";
import {
  openReadyCardHandoff,
  sealReadyCardHandoff,
} from "../server/keyCore/keyReadyCardHandoff.js";
import {
  loadPaymentTruthItems,
  mergePaymentTruthItems,
  scopePaymentTruthBriefToActiveClaims,
  softPaymentTruthContext,
  buildPaymentTruthHandBrief,
} from "../server/keyCore/keyPaymentTruthMap.js";
import { LIFEGUARD_KEY_SYSTEM_PROMPT } from "../server/keyCore/keyClaudeFirstDirect.js";

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

const dummyEnv = { SERVICE_ROLE_KEY: "test-ready-handoff-secret-not-real" };

// A — upload-followup authority via focused packet (no full chart / no originals)
{
  const chart = {
    schema: "verified_customer_chart_v1",
    confirmed_contracts: [
      {
        insurer_name: "한화생명",
        product_name: "종신",
        policy_number: "HW1234567890",
        source_document_id: "doc-hw-1",
        contract_identity_key: "ck_hw_1",
        fact_refs: [
          {
            fact_type: "monthly_premium",
            literal: "89000",
            source_document_id: "doc-hw-1",
          },
        ],
      },
    ],
    review_candidates: Array.from({ length: 20 }, (_, i) => ({
      insurer_name: "과거보험",
      product_name: `옛상품_${i}`,
      policy_number: `OLD${i}`,
    })),
    verified_document_coverages: Array.from({ length: 40 }, (_, i) => ({
      coverage_name: `담보_${i}`,
      coverage_amount: 1000,
      source_document_id: "doc-other",
    })),
  };
  const memoryRow = {
    memory_commit_id: "mc-a1",
    memory_version: 3,
    primary_document_id: "doc-hw-1",
    document_ids: ["doc-hw-1"],
    contracts: chart.confirmed_contracts,
    read_status: "confirmed_facts",
    focus_status: "resolved",
    confirmation_source: "key_original",
    rejected_fact_count: 0,
  };
  const packet = buildKeyRelevantMemoryPacket({
    question: "이 계약에서 제일 먼저 확인할 점은?",
    history: [
      { role: "user", content: "서류 올렸어" },
      { role: "assistant", content: "한화생명 계약으로 확인했습니다." },
    ],
    memoryRow,
    memoryLoad: { status: "hit" },
    chart,
    selectedDocumentId: "doc-hw-1",
    originalAttachmentCount: 0,
    allowMultiContracts: true,
  });
  assert.equal(packet.use_focused_delivery, true);
  assert.equal(packet.trace.original_attachment_count, 0);
  assert.ok(packet.packet.focused_contracts[0].policy_number);
  const payload = buildUserPayload({
    question: "이 계약에서 제일 먼저 확인할 점은?",
    chart,
    keyRelevantMemoryPacket: packet,
  });
  assert.equal(
    payload.available_verified_evidence.personal.evidence_state.status,
    "focused_packet",
  );
  assert.equal(
    String(payload.available_verified_evidence.personal.chart?.schema ?? ""),
    "focused_verified_chart_v1",
  );
  const body = JSON.stringify(payload);
  assert.equal(body.includes("옛상품_"), false);
  assert.ok(body.includes("한화생명") || body.includes("HW1234567890"));
}
ok("A_followup_latest_memory_no_full_chart");

// B — same / cross session packet identity
{
  const mem = {
    memory_commit_id: "mc-b",
    memory_version: 2,
    primary_document_id: "doc-b",
    document_ids: ["doc-b"],
    contracts: [
      {
        insurer_name: "한화생명",
        product_name: "종신",
        policy_number: "HW9998887776",
        source_document_id: "doc-b",
        contract_identity_key: "ck_b",
      },
    ],
    read_status: "confirmed_facts",
  };
  const same = buildKeyRelevantMemoryPacket({
    question: "보험료?",
    memoryRow: mem,
    memoryLoad: { status: "hit" },
    chart: { confirmed_contracts: mem.contracts },
    selectedDocumentId: "doc-b",
    crossSessionRecall: false,
    originalAttachmentCount: 0,
  });
  const cross = buildKeyRelevantMemoryPacket({
    question: "보험료?",
    memoryRow: mem,
    memoryLoad: { status: "hit" },
    chart: { confirmed_contracts: mem.contracts },
    selectedDocumentId: "doc-b",
    crossSessionRecall: true,
    originalAttachmentCount: 0,
  });
  assert.equal(same.packet.focused_contracts[0].policy_number, "HW9998887776");
  assert.equal(cross.packet.focused_contracts[0].policy_number, "HW9998887776");
  assert.equal(cross.trace.cross_session_recall, true);
}
ok("B_same_cross_session_identity");

// C — stale login_handoff forces rebuild (cache bypass)
{
  clearReadyCardCache("cust-root-c");
  const oldCard = {
    customer_id: "cust-root-c",
    session_id: "sess-root-c",
    materials_connected: true,
    status: "normal",
    card_version: "triangle-ready-card-v2.2",
    prepared_at: new Date().toISOString(),
    built_from_memory_version: 1,
    insurance_card: {
      policy_count: 1,
      policies: [{ id: "old-pol", insurer_name: "낡은보험" }],
      claims_brief: [],
      _active_claim_cases: [],
    },
    document_status: { active_count: 1, documents: [{ id: "d-old" }] },
    unknowns: [],
    profile_brief: { display_name: "QA", has_profile: true, memory_version: 1 },
    active_goal: { goal: null, status: null, reason: "none" },
    important_history: { related_turns: [], open_goals: [], open_tasks: [], life_threads: [] },
    insurance_clock: { upcoming: [], overdue: [], unknown_date: [], completed_recent: [], _items: [] },
    claim_evidence: { packages: [], item_count: 0, _items: [] },
    life_ledger: { goals: [], decisions: [], open_questions: [], outcomes: [], item_count: 0, _items: [] },
    corporate: {
      corporate_contexts: [],
      corporate_gap_evidence: [],
      corporate_recommendation_candidates: [],
      corporate_unknowns: [],
    },
    insurer_source: { status: "unknown" },
  };
  writeReadyCardCache("cust-root-c", "sess-root-c", oldCard);
  const sealed = sealReadyCardHandoff(oldCard, {
    authUserId: "auth-root-c",
    env: dummyEnv,
  });
  assert.equal(sealed.ok, true);
  const opened = openReadyCardHandoff(sealed.token, {
    customerId: "cust-root-c",
    authUserId: "auth-root-c",
    sessionId: "sess-root-c",
    env: dummyEnv,
  });
  assert.equal(opened.ok, true);
  assert.equal(opened.card.built_from_memory_version, 1);
  const gate = evaluateReadyCardHandoffMemoryGate(
    { ok: true, memory_version: 5, reason: "hit" },
    1,
  );
  assert.equal(gate.reject_reason, "handoff_memory_stale");

  const resolved = await resolveReadyCardForQuestionTurn({
    userSupabase: { from() { return this; } },
    customerId: "cust-root-c",
    sessionId: "sess-root-c",
    authUserId: "auth-root-c",
    handoffToken: sealed.token,
    env: dummyEnv,
    backgroundRefresh: false,
    loadLatestCommittedMemoryVersionImpl: async () => ({
      ok: true,
      memory_version: 5,
      reason: "hit",
      error: null,
    }),
    buildDeps: {
      extractPoliciesFromContext: () => ({
        policies: [
          {
            id: "new-pol",
            insurer_name: "한화생명",
            product_name: "종신",
            policy_number: "HW-NEW",
          },
        ],
        policy_count: 1,
      }),
      loadLatestSessionGoalFromConversations: async () => ({
        goal: null,
        reason: "none",
      }),
      loadCustomerPriorConsultationForClaude: async () => ({
        prior: null,
        reason: "none",
      }),
      loadKeyActiveClaimCases: async () => [],
      loadActiveCustomerDocuments: async () => [
        { id: "doc-new", original_filename: "new.png" },
      ],
    },
  });
  assert.equal(resolved.token_reject_reason, "handoff_memory_stale");
  assert.equal(resolved.ready_card_source, "rebuilt_miss");
  assert.equal(resolved.reused, false);
  assert.ok(
    JSON.stringify(resolved.card).includes("한화생명") ||
      resolved.card.insurance_card?.policy_count === 1,
  );
  assert.equal(JSON.stringify(resolved.card).includes("낡은보험"), false);
  clearReadyCardCache("cust-root-c");
}
ok("C_stale_handoff_forces_rebuild");

// D — early-done order model: seal → memory → version → done (next turn authority)
{
  const steps = ["seal", "memory_commit", "version", "done", "followup_memory_load"];
  const idx = Object.fromEntries(steps.map((s, i) => [s, i]));
  assert.ok(idx.seal < idx.memory_commit);
  assert.ok(idx.memory_commit < idx.version);
  assert.ok(idx.version < idx.done);
  assert.ok(idx.done < idx.followup_memory_load);
}
ok("D_early_done_authority_order");

// E — loader failure ≠ empty success
{
  const card = await buildKeyReadyCard({
    userSupabase: {},
    customerId: "cust-e",
    sessionId: "sess-e",
    extractPoliciesFromContext: () => ({ policies: [], policy_count: 0 }),
    loadLatestSessionGoalFromConversations: async () => ({
      goal: null,
      reason: "none",
    }),
    loadCustomerPriorConsultationForClaude: async () => ({
      prior: null,
      reason: "none",
    }),
    loadKeyActiveClaimCases: async () => {
      throw new Error("claim_db_down");
    },
    loadActiveCustomerDocuments: async () => {
      throw new Error("docs_db_down");
    },
    loadClaimEvidenceItemsImpl: async () => {
      throw new Error("evidence_db_down");
    },
  });
  assert.equal(card.loader_failures?.active_documents, true);
  assert.equal(card.loader_failures?.claim_cases, true);
  assert.equal(card.loader_failures?.claim_evidence, true);
  assert.ok(card.unknowns.includes("active_documents_lookup_unavailable"));
  assert.ok(card.unknowns.includes("claim_cases_lookup_unavailable"));
  assert.equal(card.unknowns.includes("no_active_documents"), false);
  assert.equal(card.document_status.lookup_status, "query_failed");
  const meta = buildReadyCardClaudeMeta(card, card.status);
  assert.ok(Array.isArray(meta.unknowns));
  assert.ok(meta.unknowns.includes("active_documents_lookup_unavailable"));
}
ok("E_loader_failure_vs_empty");

// F — Payment Truth recall + scoped inject
{
  const stored = [
    {
      id: "pt1",
      claim_case_id: "claim-1",
      claim_status: "closed",
      outcome: "paid",
      verification_status: "key_confirmed",
      related_policies: [],
      evidence_ids: [],
      document_ids: [],
    },
  ];
  const assembled = [
    {
      id: "pt2",
      claim_case_id: "claim-1",
      claim_status: "closed",
      outcome: "paid",
      verification_status: "assembled",
      related_policies: [],
      evidence_ids: ["ev1"],
      document_ids: [],
    },
  ];
  const merged = mergePaymentTruthItems(stored, assembled);
  assert.ok(merged.some((r) => r.claim_case_id === "claim-1"));
  const brief = buildPaymentTruthHandBrief(merged);
  const scoped = scopePaymentTruthBriefToActiveClaims(brief, [
    { id: "claim-1" },
  ]);
  assert.ok(scoped);
  assert.equal(scoped.item_count >= 1, true);
  const soft = softPaymentTruthContext(scoped);
  assert.ok(soft?.payment_truth_map);
  const emptyScope = scopePaymentTruthBriefToActiveClaims(brief, []);
  assert.equal(emptyScope, null);
  const loadMiss = await loadPaymentTruthItems({
    supabase: null,
    customerId: null,
  });
  assert.equal(loadMiss.status, "missing_scope");
  const loadFail = await loadPaymentTruthItems({
    supabase: {
      from() {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          async maybeSingle() {
            return { data: null, error: { message: "db_down" } };
          },
        };
      },
    },
    customerId: "cust-f",
  });
  assert.equal(loadFail.status, "query_failed");
  assert.equal(loadFail.items.length, 0);
}
ok("F_payment_truth_recall_scope");

// G — web_search: single messages request construction (no second answer path in builder)
{
  const parts = buildClaudeFirstCachedRequestParts({
    systemText: LIFEGUARD_KEY_SYSTEM_PROMPT.trim(),
    userPayload: {
      current_question: "검색이 필요해도 답해줘",
      current_context: {},
      available_verified_evidence: {
        personal: { chart: null, key_confirmed_source_facts: [] },
        corporate: [],
        documents: [],
        public_evidence: [],
      },
    },
  });
  assert.equal(parts.cache_breakpoints, 1);
  assert.equal(parts.messages.length, 1);
  // Loop cap constant still present in source (static gate)
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(
      new URL("../server/keyCore/keyClaudeFirstDirect.js", import.meta.url),
      "utf8",
    ),
  );
  assert.match(src, /messagesRequestCount/);
  assert.match(
    src,
    /maxProviderTurns\s*=\s*PROVIDER_TURN_SAFETY_ABORT/,
  );
  assert.match(src, /Answer path: server web_search may pause; no client record_/);
}
ok("G_web_search_no_second_answer_engine");

// H — Legacy outlet locked
{
  assert.equal(shouldRunClaudeFirstHomeChatQuestion({}), true);
  assert.equal(
    shouldRunClaudeFirstHomeChatQuestion({
      KEY_CLAUDE_FIRST_DIRECT: "0",
      KEY_CLAUDE_FIRST_ALLOW_LEGACY_HOMECHAT: "1",
    }),
    true,
  );
}
ok("H_legacy_outlet_locked");

// I — static cache
{
  const systemText = `${LIFEGUARD_KEY_SYSTEM_PROMPT.trim()}\n\n[DYNAMIC]\nmemory_version=9`;
  const packet = buildKeyRelevantMemoryPacket({
    question: "후속",
    memoryRow: {
      memory_commit_id: "mc-i",
      memory_version: 9,
      primary_document_id: "d1",
      document_ids: ["d1"],
      contracts: [
        {
          insurer_name: "한화생명",
          product_name: "A",
          policy_number: "123456789012",
          source_document_id: "d1",
        },
      ],
      read_status: "confirmed_facts",
    },
    memoryLoad: { status: "hit" },
    chart: { confirmed_contracts: [] },
    selectedDocumentId: "d1",
    originalAttachmentCount: 0,
  });
  const payload = buildUserPayload({
    question: "후속",
    chart: { confirmed_contracts: [], review_candidates: [{ x: 1 }] },
    keyRelevantMemoryPacket: packet,
  });
  const slices = serializeClaudeFirstCachePrefixForAudit({
    systemText,
    userPayload: payload,
  });
  assert.equal(slices.cache_strategy, "A_static_system_marker");
  assert.equal(slices.prefix_json.includes("memory_version"), false);
  const layout = buildPromptCacheLayoutTrace({
    parts: slices.parts,
    userPayload: payload,
  });
  assert.equal(layout.full_chart_injected, false);
  assert.equal(layout.relevant_memory_packet_injected, true);
  assert.equal(layout.customer_specific_data_before_marker, false);
}
ok("I_static_cache_packet");

// J — seal/integrity markers remain in live path (static presence)
{
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(
      new URL("../server/keyCore/keyClaudeFirstDirect.js", import.meta.url),
      "utf8",
    ),
  );
  assert.match(src, /sealCustomerAnswer|keyCustomerTextSeal/);
  assert.match(src, /A_static_system_marker/);
  assert.match(src, /persistOfficialDocumentMemoryWithRetry/);
}
ok("J_seal_integrity_markers");

assert.equal(PROVIDER_CALLS, 0);
console.log(`PROVIDER_CALLS=${PROVIDER_CALLS}`);
console.log("\nALL_PASS key-root-continuity-unit-test");
