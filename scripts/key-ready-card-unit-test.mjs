/**
 * Triangle v2.2 T2 — READY CARD unit tests (no Claude, no network).
 */
import assert from "node:assert/strict";
import {
  clearReadyCardCache,
  readReadyCardCache,
  writeReadyCardCache,
  readyCardCacheSizeForTests,
  READY_CARD_CACHE_TTL_MS,
} from "../server/keyCore/keyReadyCardCache.js";
import {
  READY_CARD_VERSION,
  buildKeyReadyCard,
  warmAndStoreKeyReadyCard,
  resolveReadyCardForQuestionTurn,
  materialsFromReadyCard,
  buildReadyCardClaudeMeta,
  briefDocumentStatusForClaudeMeta,
} from "../server/keyCore/keyReadyCardBuild.js";
import { buildUserPayload } from "../server/keyCore/keyClaudeFirstDirect.js";

clearReadyCardCache();

// --- cache customer scope ---
{
  writeReadyCardCache("cust-a", "sess-1", {
    customer_id: "cust-a",
    session_id: "sess-1",
    prepared_at: new Date().toISOString(),
    status: "normal",
    materials_connected: true,
  });
  const hit = readReadyCardCache("cust-a", "sess-1");
  assert.equal(hit.status, "normal");
  assert.equal(hit.card.customer_id, "cust-a");

  const cross = readReadyCardCache("cust-b", "sess-1");
  assert.equal(cross.status, "miss");
  assert.equal(cross.card, null);

  // Wrong customer_id on write rejected
  const rejected = writeReadyCardCache("cust-a", "sess-2", {
    customer_id: "cust-b",
    prepared_at: new Date().toISOString(),
  });
  assert.equal(rejected, false);
}

clearReadyCardCache();

// --- parallel build + warm ---
{
  let goalCalls = 0;
  let priorCalls = 0;
  let claimsCalls = 0;
  let docsCalls = 0;
  let corporateCalls = 0;

  const fakeSupabase = { from() { return this; } };
  const card = await buildKeyReadyCard({
    userSupabase: fakeSupabase,
    customerId: "cust-build",
    sessionId: "sess-build",
    unifiedState: {
      memory_version: 3,
      profile: { display_name: "테스트", memory_version: 3 },
      policies: [
        {
          id: "pol-1",
          insurer_name: "테스트생명",
          product_name: "암보험",
          policy_type: "cancer",
          is_active: true,
        },
      ],
      policy_count: 1,
    },
    extractPoliciesFromContext: ({ unifiedState }) => ({
      policies: unifiedState.policies,
      policy_count: 1,
    }),
    loadLatestSessionGoalFromConversations: async () => {
      goalCalls += 1;
      return { goal: { goal: "암보장 점검", status: "active" }, reason: "active" };
    },
    loadLatestActiveCustomerGoalFromConversations: async () => ({
      goal: null,
      reason: "none",
    }),
    loadCustomerPriorConsultationForClaude: async () => {
      priorCalls += 1;
      return {
        prior: {
          related_turns: [{ role: "user", content: "암보험 괜찮아?" }],
          open_goals: [],
          open_tasks: [],
          note: "prior_consultation_reference_only_not_verified_fact",
        },
        reason: "ok",
      };
    },
    loadAllowedCorporateContextsForClaude: async () => {
      corporateCalls += 1;
      return {
        corporate_contexts: [],
        corporate_gap_evidence: [],
        corporate_recommendation_candidates: [],
        corporate_unknowns: [],
      };
    },
    loadKeyActiveClaimCases: async () => {
      claimsCalls += 1;
      return [];
    },
    loadActiveCustomerDocuments: async () => {
      docsCalls += 1;
      return [{ id: "doc-1", original_filename: "cancer.pdf" }];
    },
  });

  assert.equal(card.card_version, READY_CARD_VERSION);
  assert.equal(card.status, "normal");
  assert.equal(card.materials_connected, true);
  assert.equal(card.customer_id, "cust-build");
  assert.equal(card.insurance_card.policy_count, 1);
  assert.equal(card.insurance_card.policies[0].product_name, "암보험");
  assert.equal(card.active_goal.goal, "암보장 점검");
  assert.equal(card.document_status.active_count, 1);
  assert.equal(goalCalls, 1);
  assert.equal(priorCalls, 1);
  assert.equal(claimsCalls, 1);
  assert.equal(docsCalls, 1);
  assert.equal(corporateCalls, 1);
  assert.ok(typeof card.build_ms === "number");

  const warm = await warmAndStoreKeyReadyCard({
    userSupabase: fakeSupabase,
    customerId: "cust-build",
    sessionId: "sess-build",
    unifiedState: {
      memory_version: 3,
      profile: { display_name: "테스트" },
      policies: [
        { id: "pol-1", insurer_name: "테스트생명", product_name: "암보험", is_active: true },
      ],
      policy_count: 1,
    },
    extractPoliciesFromContext: ({ unifiedState }) => ({
      policies: unifiedState.policies,
      policy_count: 1,
    }),
    loadLatestSessionGoalFromConversations: async () => ({
      goal: { goal: "암보장 점검", status: "active" },
      reason: "active",
    }),
    loadLatestActiveCustomerGoalFromConversations: async () => ({ goal: null, reason: "none" }),
    loadCustomerPriorConsultationForClaude: async () => ({ prior: null, reason: "none" }),
    loadAllowedCorporateContextsForClaude: async () => ({
      corporate_contexts: [],
      corporate_gap_evidence: [],
      corporate_recommendation_candidates: [],
      corporate_unknowns: [],
    }),
    loadKeyActiveClaimCases: async () => [],
    loadActiveCustomerDocuments: async () => [{ id: "doc-1", original_filename: "cancer.pdf" }],
  });
  assert.equal(warm.ok, true);
  assert.equal(warm.status, "normal");

  const resolved = await resolveReadyCardForQuestionTurn({
    userSupabase: fakeSupabase,
    customerId: "cust-build",
    sessionId: "sess-build",
    buildDeps: {
      extractPoliciesFromContext: () => ({ policies: [], policy_count: 0 }),
      loadLatestSessionGoalFromConversations: async () => {
        throw new Error("should_not_rebuild_on_hit");
      },
    },
  });
  assert.equal(resolved.ready_card_status, "hit");
  assert.equal(resolved.reused, true);
  assert.ok(resolved.ready_card_ms != null);

  const mats = materialsFromReadyCard(resolved.card);
  assert.equal(mats.ssotGoal?.goal, "암보장 점검");
  assert.equal(mats.policies[0]?.product_name, "암보험");
}

clearReadyCardCache();

// --- miss meta for Claude ---
{
  const missMeta = buildReadyCardClaudeMeta(
    {
      status: "miss",
      materials_connected: false,
      prepared_at: "2026-07-21T00:00:00.000Z",
      card_version: READY_CARD_VERSION,
      unknowns: ["materials_unconnected"],
    },
    "miss",
  );
  assert.equal(missMeta.status, "miss");
  assert.match(missMeta.note, /not connected|미연결|Do not invent/i);

  const staleMeta = buildReadyCardClaudeMeta(
    {
      status: "normal",
      materials_connected: true,
      prepared_at: "2026-07-21T00:00:00.000Z",
      card_version: READY_CARD_VERSION,
    },
    "stale",
  );
  assert.equal(staleMeta.status, "stale");
  assert.equal(staleMeta.as_of, "2026-07-21T00:00:00.000Z");

  const payload = buildUserPayload({
    question: "내 암보험 괜찮아?",
    chart: { policy_count: { status: "verified", value: 1 }, contracts: [] },
    contextPack: { recent_conversation_originals: [], older_conversation_summary: null },
    readyCardMeta: missMeta,
  });
  assert.equal(payload.current_question, "내 암보험 괜찮아?");
  assert.equal(payload.current_context.ready_card.status, "miss");
}

// --- T7.2 document existence brief in Claude meta (not body / not evidence) ---
{
  const card = {
    status: "normal",
    materials_connected: true,
    prepared_at: "2026-07-21T00:00:00.000Z",
    card_version: READY_CARD_VERSION,
    customer_id: "cust-a",
    document_status: {
      active_count: 3,
      documents: [
        { id: "doc-a1", original_filename: "seat-policy.pdf" },
        { id: "doc-a1", original_filename: "seat-policy.pdf" },
        {
          id: "doc-b-leak",
          original_filename: "other.pdf",
          customer_id: "cust-b",
        },
        { id: "doc-a2", filename: "claim-form.pdf" },
      ],
    },
  };
  const brief = briefDocumentStatusForClaudeMeta(card);
  assert.equal(brief.active_count, 2);
  assert.deepEqual(
    brief.documents.map((d) => d.id),
    ["doc-a1", "doc-a2"],
  );
  assert.equal(brief.documents[0].original_filename, "seat-policy.pdf");
  assert.equal(brief.documents[1].original_filename, "claim-form.pdf");
  assert.match(brief.note, /DOCUMENT_EVIDENCE|existence|do not claim you read/i);

  const meta = buildReadyCardClaudeMeta(card, "hit");
  assert.equal(meta.status, "normal");
  assert.equal(meta.document_status.active_count, 2);
  assert.equal(meta.document_status.documents.length, 2);

  const payload = buildUserPayload({
    question: "내가 올린 서류가 있어?",
    chart: { policy_count: { status: "verified", value: 0 }, contracts: [] },
    contextPack: { recent_conversation_originals: [], older_conversation_summary: null },
    readyCardMeta: meta,
  });
  assert.equal(payload.current_question, "내가 올린 서류가 있어?");
  const rc = payload.current_context.ready_card;
  assert.ok(rc.document_status);
  assert.equal(rc.document_status.documents[0].id, "doc-a1");
  assert.ok(!JSON.stringify(rc).includes("storage_path"));
  assert.ok(!JSON.stringify(rc).includes("base64"));
  // Question stays separate from ready_card document brief.
  assert.notEqual(payload.current_question, rc.document_status);
}

// --- A/B isolation in cache ---
clearReadyCardCache();
{
  writeReadyCardCache("cust-a", "s1", {
    customer_id: "cust-a",
    prepared_at: new Date().toISOString(),
    materials_connected: true,
    insurance_card: { policy_count: 1, policies: [{ id: "a1", product_name: "A암" }] },
  });
  writeReadyCardCache("cust-b", "s1", {
    customer_id: "cust-b",
    prepared_at: new Date().toISOString(),
    materials_connected: true,
    insurance_card: { policy_count: 1, policies: [{ id: "b1", product_name: "B암" }] },
  });
  const a = readReadyCardCache("cust-a", "s1");
  const b = readReadyCardCache("cust-b", "s1");
  assert.equal(a.card.insurance_card.policies[0].product_name, "A암");
  assert.equal(b.card.insurance_card.policies[0].product_name, "B암");
  assert.notEqual(a.card.customer_id, b.card.customer_id);
}

// --- unconnected cached card must not count as hit ---
clearReadyCardCache();
{
  writeReadyCardCache("cust-empty", "s1", {
    customer_id: "cust-empty",
    prepared_at: new Date().toISOString(),
    status: "miss",
    materials_connected: false,
    insurance_card: { policy_count: 0, policies: [] },
  });
  let rebuilt = 0;
  const resolved = await resolveReadyCardForQuestionTurn({
    userSupabase: { from() { return this; } },
    customerId: "cust-empty",
    sessionId: "s1",
    buildDeps: {
      extractPoliciesFromContext: () => {
        rebuilt += 1;
        return {
          policies: [
            { id: "p1", product_name: "암보험", insurer_name: "테스트", is_active: true },
          ],
          policy_count: 1,
        };
      },
      loadLatestSessionGoalFromConversations: async () => ({ goal: null, reason: "none" }),
      loadLatestActiveCustomerGoalFromConversations: async () => ({ goal: null, reason: "none" }),
      loadCustomerPriorConsultationForClaude: async () => ({ prior: null, reason: "none" }),
      loadAllowedCorporateContextsForClaude: async () => ({
        corporate_contexts: [],
        corporate_gap_evidence: [],
        corporate_recommendation_candidates: [],
        corporate_unknowns: [],
      }),
      loadKeyActiveClaimCases: async () => [],
      loadActiveCustomerDocuments: async () => [],
    },
  });
  assert.equal(resolved.ready_card_status, "miss");
  assert.equal(resolved.reused, false);
  assert.ok(rebuilt >= 1);
  assert.equal(resolved.card.materials_connected, true);
}

assert.ok(READY_CARD_CACHE_TTL_MS > 0);
assert.ok(readyCardCacheSizeForTests() >= 2);

console.log("key-ready-card-unit-test: PASS");
