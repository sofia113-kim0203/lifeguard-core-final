/**
 * Life Ledger Slice 1 + Continuity Slice — unit tests (no network).
 */
import assert from "node:assert/strict";
import {
  buildLifeLedgerUpdatesFromUtterance,
  filterLifeLedgerByScope,
  looksLikeInferenceNotCustomerStatement,
  mergeLifeLedgerItems,
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
    preferences: [],
    decisions: [],
    open_questions: [],
    life_threads: [],
    outcomes: [],
    item_count: 1,
  });
  assert.ok(soft.life_ledger);
  assert.match(soft.life_ledger.note, /not_answer_template/);
  assert.ok(Array.isArray(soft.life_ledger.preferences));
  assert.ok(Array.isArray(soft.life_ledger.life_threads));
}

// --- Continuity Slice ---
{
  // A: preference vs goal separation
  const pref = buildLifeLedgerUpdatesFromUtterance({
    question: "나는 전화가 편한 쪽을 선호해.",
    customerId: CUSTOMER,
    messageId: "msg-pref",
    now: NOW,
  });
  assert.equal(pref.ok, true);
  assert.equal(pref.updates[0].type, "preference");
  assert.ok(pref.updates.every((u) => u.type !== "goal"));

  const goalOnly = buildLifeLedgerUpdatesFromUtterance({
    question: "나는 보험료를 줄이는 것보다 필요한 보장은 유지하고 싶어.",
    customerId: CUSTOMER,
    messageId: "msg-goal2",
    now: NOW,
  });
  assert.equal(goalOnly.updates[0].type, "goal");
  assert.ok(goalOnly.updates.every((u) => u.type !== "preference"));
}

{
  // B: life_thread + inference block
  const thread = buildLifeLedgerUpdatesFromUtterance({
    question: "나는 요즘 부모님 간병 때문에 생활이 바빠.",
    customerId: CUSTOMER,
    messageId: "msg-thread",
    now: NOW,
  });
  assert.equal(thread.ok, true);
  assert.equal(thread.updates[0].type, "life_thread");
  assert.equal(thread.updates[0].metadata_json.not_inferred, true);

  const inferredThread = buildLifeLedgerUpdatesFromUtterance({
    question: "고객은 요즘 가족 때문에 바쁜 것 같다.",
    customerId: CUSTOMER,
    messageId: "msg-thread-inf",
    now: NOW,
  });
  assert.equal(inferredThread.ok, false);
  assert.equal(inferredThread.reason, "inference_blocked");
}

{
  // C: decision reason link
  const dec = buildLifeLedgerUpdatesFromUtterance({
    question: "암보험은 유지하기로 했어.",
    customerId: CUSTOMER,
    messageId: "msg-dec-r1",
    now: NOW,
  });
  assert.equal(dec.updates[0].reason, null);
  // Older decision without reason must not steal link — latest active wins.
  const older = {
    ...dec.updates[0],
    id: "ll_decision_older",
    content: "예전에 다른 결정",
    decision: "예전에 다른 결정",
    reason: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
  const reason = buildLifeLedgerUpdatesFromUtterance({
    question: "왜냐하면 가족이 걱정되거든.",
    existingLedger: [older, ...dec.updates],
    customerId: CUSTOMER,
    messageId: "msg-dec-r2",
    now: NOW,
  });
  assert.equal(reason.ok, true);
  assert.equal(reason.updates[0].id, dec.updates[0].id);
  assert.match(reason.updates[0].reason, /가족이 걱정/);
  const merged = mergeLifeLedgerItems([older, ...dec.updates], reason.updates, { now: NOW });
  const linked = merged.find((e) => e.id === dec.updates[0].id);
  assert.match(linked.reason, /가족이 걱정/);
  assert.equal(linked.content, dec.updates[0].content);
  assert.equal(merged.find((e) => e.id === older.id).reason, null);
}

{
  // D: correction preserves prior + supersedes
  const g1 = buildLifeLedgerUpdatesFromUtterance({
    question: "나는 보험료를 줄이는 것보다 필요한 보장은 유지하고 싶어.",
    customerId: CUSTOMER,
    messageId: "msg-g-old",
    now: NOW,
  });
  const g2 = buildLifeLedgerUpdatesFromUtterance({
    question: "정정하면, 나는 보험료 부담을 더 줄이는 쪽을 원해.",
    existingLedger: g1.updates,
    customerId: CUSTOMER,
    messageId: "msg-g-new",
    now: NOW,
  });
  assert.equal(g2.ok, true);
  const corr = g2.updates.find((u) => u.supersedes_id);
  assert.ok(corr);
  assert.equal(corr.supersedes_id, g1.updates[0].id);
  const merged = mergeLifeLedgerItems(g1.updates, g2.updates, { now: NOW });
  assert.ok(merged.some((e) => e.id === g1.updates[0].id));
  assert.ok(merged.some((e) => e.supersedes_id === g1.updates[0].id));
}

{
  // E: close / resume + no silent regress
  const g1 = buildLifeLedgerUpdatesFromUtterance({
    question: "나는 보험료를 줄이는 것보다 필요한 보장은 유지하고 싶어.",
    customerId: CUSTOMER,
    messageId: "msg-close-g",
    now: NOW,
  });
  const closed = buildLifeLedgerUpdatesFromUtterance({
    question: "그 목표 종료할게.",
    existingLedger: g1.updates,
    customerId: CUSTOMER,
    messageId: "msg-close",
    now: NOW,
  });
  assert.equal(closed.updates[0].status, "resolved");
  assert.equal(closed.updates[0].id, g1.updates[0].id);
  let merged = mergeLifeLedgerItems(g1.updates, closed.updates, { now: NOW });
  assert.equal(merged[0].status, "resolved");

  // Silent active update must not regress
  const silentActive = {
    ...merged[0],
    status: "active",
    metadata_json: { ...(merged[0].metadata_json || {}), explicit_resume: false },
  };
  merged = mergeLifeLedgerItems(merged, [silentActive], { now: NOW });
  assert.equal(merged[0].status, "resolved");

  const resumed = buildLifeLedgerUpdatesFromUtterance({
    question: "그 목표 다시 진행할게.",
    existingLedger: merged,
    customerId: CUSTOMER,
    messageId: "msg-resume",
    now: NOW,
  });
  assert.equal(resumed.updates[0].status, "active");
  assert.equal(resumed.updates[0].metadata_json.explicit_resume, true);
  merged = mergeLifeLedgerItems(merged, resumed.updates, { now: NOW });
  assert.equal(merged[0].status, "active");
}

{
  // F: customer-confirmed life outcome; block advice
  const lifeOut = buildLifeLedgerUpdatesFromUtterance({
    question: "실제로 결과가 확정됐어. 생활에서 끝났어.",
    customerId: CUSTOMER,
    messageId: "msg-life-out",
    now: NOW,
  });
  assert.equal(lifeOut.ok, true);
  assert.equal(lifeOut.updates[0].type, "outcome");
  assert.equal(lifeOut.updates[0].outcome_type, "customer_confirmed_life");
  assert.equal(lifeOut.updates[0].source, "customer_statement");

  const advice = buildLifeLedgerUpdatesFromUtterance({
    question: "이렇게 하면 좋을 것 같아. 추천 결과야.",
    customerId: CUSTOMER,
    messageId: "msg-advice",
    now: NOW,
  });
  assert.ok(
    advice.ok === false ||
      !advice.updates.some((u) => u.type === "outcome"),
  );
}

{
  // H: isolation for preference / thread
  const personalPref = buildLifeLedgerUpdatesFromUtterance({
    question: "나는 전화가 편한 쪽을 선호해.",
    customerId: CUSTOMER,
    messageId: "msg-p-pref",
    now: NOW,
  });
  const corpThread = buildLifeLedgerUpdatesFromUtterance({
    question: "나는 요즘 직장 생활이 바빠.",
    customerId: CUSTOMER,
    entityId: ENTITY_A,
    messageId: "msg-c-thread",
    now: NOW,
  });
  const mixed = [...personalPref.updates, ...corpThread.updates];
  assert.equal(filterLifeLedgerByScope(mixed, { mode: "personal" }).length, 1);
  assert.equal(
    filterLifeLedgerByScope(mixed, { mode: "corporate", entityId: ENTITY_A }).length,
    1,
  );
}

console.log("key-life-ledger-unit-test: PASS");
