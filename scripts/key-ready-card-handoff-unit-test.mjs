/**
 * Triangle T2.1 — READY CARD handoff seal/open unit tests (no network).
 */
import assert from "node:assert/strict";
import {
  resolveReadyCardHandoffSecret,
  sealReadyCardHandoff,
  openReadyCardHandoff,
  READY_CARD_HANDOFF_CARD_VERSION,
} from "../server/keyCore/keyReadyCardHandoff.js";
import { resolveReadyCardForQuestionTurn } from "../server/keyCore/keyReadyCardBuild.js";
import { clearReadyCardCache } from "../server/keyCore/keyReadyCardCache.js";

const ENV = {
  SERVICE_ROLE_KEY: "unit-test-service-role-key-32chars-min!!",
};

{
  const missing = resolveReadyCardHandoffSecret({});
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "READY_CARD_HANDOFF_SECRET_REQUIRED");
  const ok = resolveReadyCardHandoffSecret(ENV);
  assert.equal(ok.ok, true);
  assert.equal(ok.source, "SERVICE_ROLE_KEY");
}

const sampleCard = {
  card_version: READY_CARD_HANDOFF_CARD_VERSION,
  prepared_at: new Date().toISOString(),
  status: "normal",
  materials_connected: true,
  customer_id: "cust-a",
  session_id: "sess-a",
  build_ms: 900,
  profile_brief: { display_name: "A", has_profile: true, memory_version: 1 },
  insurance_card: {
    policy_count: 1,
    policies: [{ id: "p1", product_name: "암보험", insurer_name: "테스트" }],
    claims_brief: [],
    _active_claim_cases: [],
  },
  active_goal: {
    goal: "암보장 점검",
    status: "active",
    reason: "active",
    _goal_object: { goal: "암보장 점검", status: "active" },
  },
  important_history: {
    related_turns: [],
    open_goals: [],
    open_tasks: [],
    note: "prior_consultation_reference_only_not_verified_fact",
    _prior_object: null,
  },
  document_status: { active_count: 0, documents: [], _active_documents: [] },
  insurer_source: {
    status: "unconnected",
    as_of: null,
    note: "원수사 공식 데이터가 연결되지 않았습니다.",
  },
  corporate: {
    corporate_contexts: [],
    corporate_gap_evidence: [],
    corporate_recommendation_candidates: [],
    corporate_unknowns: [],
  },
  unknowns: [],
};

// A — seal/open hit
{
  const sealed = sealReadyCardHandoff(sampleCard, {
    authUserId: "user-a",
    env: ENV,
  });
  assert.equal(sealed.ok, true);
  assert.ok(sealed.token.startsWith("rch1."));
  assert.ok(sealed.token_bytes > 32);
  assert.equal(sealed.token.includes("암보험"), false, "plaintext product must not appear");

  const opened = openReadyCardHandoff(sealed.token, {
    customerId: "cust-a",
    authUserId: "user-a",
    sessionId: "sess-a",
    env: ENV,
  });
  assert.equal(opened.ok, true);
  assert.equal(opened.card.materials_connected, true);
  assert.equal(opened.card.insurance_card.policies[0].product_name, "암보험");
  assert.equal(opened.card.insurer_source.status, "unconnected");
  assert.equal(opened.card.insurer_source.as_of, null);
  assert.equal(opened.meta.source, "login_handoff");
}

// B — cross customer reject
{
  const sealed = sealReadyCardHandoff(sampleCard, {
    authUserId: "user-a",
    env: ENV,
  });
  const opened = openReadyCardHandoff(sealed.token, {
    customerId: "cust-b",
    authUserId: "user-b",
    env: ENV,
  });
  assert.equal(opened.ok, false);
  assert.equal(opened.reason, "handoff_customer_mismatch");
}

// C — tamper reject
{
  const sealed = sealReadyCardHandoff(sampleCard, {
    authUserId: "user-a",
    env: ENV,
  });
  const chars = sealed.token.split("");
  chars[chars.length - 5] = chars[chars.length - 5] === "A" ? "B" : "A";
  const tampered = chars.join("");
  const opened = openReadyCardHandoff(tampered, {
    customerId: "cust-a",
    authUserId: "user-a",
    env: ENV,
  });
  assert.equal(opened.ok, false);
  assert.equal(opened.reason, "handoff_tampered");
}

// D — expired reject
{
  const sealed = sealReadyCardHandoff(sampleCard, {
    authUserId: "user-a",
    env: ENV,
  });
  const opened = openReadyCardHandoff(sealed.token, {
    customerId: "cust-a",
    authUserId: "user-a",
    env: ENV,
    now: Date.now() + 10 * 60_000,
  });
  assert.equal(opened.ok, false);
  assert.equal(opened.reason, "handoff_expired");
}

// E — empty / unconnected cannot seal
{
  const empty = sealReadyCardHandoff(
    { ...sampleCard, materials_connected: false, status: "miss" },
    { authUserId: "user-a", env: ENV },
  );
  assert.equal(empty.ok, false);
  assert.equal(empty.reason, "handoff_empty_or_unconnected");
}

// Resolve path: handoff hit skips rebuild
clearReadyCardCache();
{
  const sealed = sealReadyCardHandoff(sampleCard, {
    authUserId: "user-a",
    env: ENV,
  });
  let rebuilt = 0;
  const resolved = await resolveReadyCardForQuestionTurn({
    customerId: "cust-a",
    sessionId: "sess-a",
    authUserId: "user-a",
    handoffToken: sealed.token,
    env: ENV,
    buildDeps: {
      extractPoliciesFromContext: () => {
        rebuilt += 1;
        return { policies: [], policy_count: 0 };
      },
      loadLatestSessionGoalFromConversations: async () => {
        rebuilt += 1;
        return { goal: null, reason: "none" };
      },
    },
  });
  assert.equal(resolved.ready_card_hit, true);
  assert.equal(resolved.ready_card_source, "login_handoff");
  assert.equal(resolved.ready_card_build_ms, 0);
  assert.equal(resolved.card.insurance_card.policies[0].product_name, "암보험");
  assert.equal(rebuilt, 0);
}

// Cross-customer token on resolve → rebuild miss, no A materials trust
clearReadyCardCache();
{
  const sealed = sealReadyCardHandoff(sampleCard, {
    authUserId: "user-a",
    env: ENV,
  });
  const resolved = await resolveReadyCardForQuestionTurn({
    userSupabase: { from() { return this; } },
    customerId: "cust-b",
    sessionId: "sess-b",
    authUserId: "user-b",
    handoffToken: sealed.token,
    env: ENV,
    unifiedState: {
      profile: { display_name: "B" },
      policies: [{ id: "b1", product_name: "B보험", is_active: true }],
      policy_count: 1,
    },
    buildDeps: {
      extractPoliciesFromContext: ({ unifiedState }) => ({
        policies: unifiedState.policies,
        policy_count: 1,
      }),
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
  assert.equal(resolved.ready_card_hit, false);
  assert.equal(resolved.token_reject_reason, "handoff_customer_mismatch");
  assert.equal(resolved.ready_card_source, "rebuilt_miss");
  assert.notEqual(
    resolved.card?.insurance_card?.policies?.[0]?.product_name,
    "암보험",
  );
}

console.log("key-ready-card-handoff-unit-test: PASS");
