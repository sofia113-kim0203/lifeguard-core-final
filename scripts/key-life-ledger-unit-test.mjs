/**
 * Life Ledger Slice 1 — unit tests (no network).
 */
import assert from "node:assert/strict";
import {
  buildLifeLedgerUpdatesFromUtterance,
  filterLifeLedgerByScope,
  looksLikeInferenceNotCustomerStatement,
  softLifeLedgerContext,
  syncLifeLedgerOutcomesFromClaims,
} from "../server/keyCore/keyLifeLedger.js";

const CUSTOMER = "cust-ll-1";
const ENTITY_A = "ent-a";
const NOW = new Date("2026-07-22T04:00:00+09:00");

{
  assert.equal(
    looksLikeInferenceNotCustomerStatement(
      "고객은 가족 보호를 가장 중요하게 생각하는 것 같다.",
    ),
    true,
  );
  assert.equal(
    looksLikeInferenceNotCustomerStatement(
      "나는 보험료를 줄이는 것보다 필요한 보장은 유지하고 싶어.",
    ),
    false,
  );
}

{
  const blocked = buildLifeLedgerUpdatesFromUtterance({
    question: "고객은 가족 보호를 가장 중요하게 생각하는 것 같다.",
    customerId: CUSTOMER,
    messageId: "msg-inf",
    now: NOW,
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "inference_blocked");
}

{
  const goal = buildLifeLedgerUpdatesFromUtterance({
    question: "나는 보험료를 줄이는 것보다 필요한 보장은 유지하고 싶어.",
    customerId: CUSTOMER,
    messageId: "msg-goal",
    now: NOW,
  });
  assert.equal(goal.ok, true);
  assert.equal(goal.updates[0].type, "goal");
  assert.equal(goal.updates[0].source, "customer_statement");
  assert.match(goal.updates[0].content, /필요한 보장은 유지/);
}

{
  const dec = buildLifeLedgerUpdatesFromUtterance({
    question: "암보험은 유지하기로 했어.",
    customerId: CUSTOMER,
    messageId: "msg-dec",
    now: NOW,
  });
  assert.equal(dec.ok, true);
  assert.equal(dec.updates[0].type, "decision");
  assert.equal(dec.updates[0].metadata_json.not_key_recommendation, true);
}

{
  const oq = buildLifeLedgerUpdatesFromUtterance({
    question: "뇌혈관 보장이 충분한지 모르겠어.",
    customerId: CUSTOMER,
    messageId: "msg-oq",
    now: NOW,
  });
  assert.equal(oq.ok, true);
  assert.equal(oq.updates[0].type, "open_question");
  assert.equal(oq.updates[0].status, "active");
  assert.equal(oq.updates[0].resolved_at, null);
}

{
  const outcomes = syncLifeLedgerOutcomesFromClaims({
    cases: [
      {
        claim_case_key: "customer_statement:kind:surgery",
        claim_scope: "personal",
        entity_id: null,
        status: "paid",
        insurer_verified: false,
      },
    ],
    existingLedger: [],
    customerId: CUSTOMER,
    now: NOW,
  });
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].type, "outcome");
  assert.equal(outcomes[0].outcome_type, "claim_paid");
  assert.equal(outcomes[0].source, "claim_guardian");
  assert.equal(outcomes[0].related_claim_id, "customer_statement:kind:surgery");
}

{
  const items = [
    {
      id: "g1",
      type: "goal",
      content: "개인 목표",
      entity_id: null,
      source: "customer_statement",
      status: "active",
    },
    {
      id: "g2",
      type: "goal",
      content: "법인 목표",
      entity_id: ENTITY_A,
      source: "customer_statement",
      status: "active",
    },
  ];
  const personal = filterLifeLedgerByScope(items, { mode: "personal" });
  assert.equal(personal.length, 1);
  assert.equal(personal[0].id, "g1");
  const corp = filterLifeLedgerByScope(items, { mode: "corporate", entityId: ENTITY_A });
  assert.equal(corp.length, 1);
  assert.equal(corp[0].entity_id, ENTITY_A);
}

{
  const soft = softLifeLedgerContext({
    goals: [{ id: "g1", content: "x", entity_id: null }],
    decisions: [],
    open_questions: [],
    outcomes: [],
    item_count: 1,
  });
  assert.ok(soft.life_ledger);
  assert.match(soft.life_ledger.note, /not_answer_template/);
}

console.log("key-life-ledger-unit-test: PASS");
