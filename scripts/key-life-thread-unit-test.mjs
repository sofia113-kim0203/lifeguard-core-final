/**
 * T5 — LIFE THREAD extract / merge / trivial skip (no Claude call).
 */
import assert from "node:assert/strict";
import {
  extractLifeThreadsFromCustomerUtterance,
  mergeLifeThreadHistory,
  isTrivialChatNotLifeThread,
  formatLifeThreadsForReadyCard,
  selectActiveLifeThreads,
} from "../server/keyCore/keyLifeThread.js";
import { buildKeyConsultationRecord } from "../server/keyCore/keyClaudeFirstDirect.js";
import { attachActiveLifeThreadsToReadyCard } from "../server/keyCore/keyReadyCardBuild.js";

const NOW = new Date("2026-07-21T00:00:00.000Z");
const SOURCE = {
  method: "session_turn_ord",
  session_id: "sess-a",
  turn_ord: 1,
};

// QA1 — planned enlistment, no invented emotion
{
  const rows = extractLifeThreadsFromCustomerUtterance("아들이 다음 달 군대에 가요.", {
    customerId: "cust-a",
    sourceLink: SOURCE,
    now: NOW,
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].event_kind, "family_enlistment_planned");
  assert.equal(rows[0].status, "open");
  assert.equal(rows[0].customer_expressed_emotion, null);
  assert.ok(rows[0].expected_date_or_window?.label === "다음 달");
  assert.ok(rows[0].source_link?.session_id === "sess-a");
  assert.ok(!/슬프|불안/.test(JSON.stringify(rows[0])));
}

// QA2 — customer-stated worry only
{
  const rows = extractLifeThreadsFromCustomerUtterance("아들이 군대에 간다니 걱정돼요.", {
    customerId: "cust-a",
    sourceLink: { ...SOURCE, turn_ord: 2 },
    now: NOW,
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].customer_expressed_emotion?.text, "걱정");
  assert.ok(!/슬프|불안/.test(JSON.stringify(rows[0])));
}

// QA3 — outcome links without deleting prior plan
{
  const planned = extractLifeThreadsFromCustomerUtterance("아들이 다음 달 군대에 가요.", {
    customerId: "cust-a",
    sourceLink: SOURCE,
    now: NOW,
  });
  const resolved = extractLifeThreadsFromCustomerUtterance(
    "아들은 잘 입대했고 첫 전화도 왔어요.",
    {
      customerId: "cust-a",
      sourceLink: { ...SOURCE, turn_ord: 3 },
      now: new Date("2026-08-15T00:00:00.000Z"),
    },
  );
  assert.equal(resolved[0].status, "resolved");
  assert.ok(resolved[0].resolved_outcome?.detail);
  const merged = mergeLifeThreadHistory([...planned, ...resolved]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, "resolved");
  assert.ok(merged[0].customer_stated_facts.length >= 1);
  assert.ok(merged[0].resolved_outcome);
  assert.equal(planned[0].thread_id, resolved[0].thread_id);
}

// QA4 — exam window, no score/emotion invent
{
  const rows = extractLifeThreadsFromCustomerUtterance("딸이 이번 주 중간고사 기간이에요.", {
    customerId: "cust-a",
    sourceLink: SOURCE,
    now: NOW,
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].event_kind, "family_exam_period");
  assert.ok(!/성적|점수|슬프|불안/.test(JSON.stringify(rows[0])));
}

// QA5 — trivial lunch not persisted
{
  assert.equal(isTrivialChatNotLifeThread("오늘 점심은 김밥 먹었어요."), true);
  const rows = extractLifeThreadsFromCustomerUtterance("오늘 점심은 김밥 먹었어요.", {
    customerId: "cust-a",
    sourceLink: SOURCE,
    now: NOW,
  });
  assert.equal(rows.length, 0);
}

// Consultation record carries life_threads; Claude answer never mined
{
  const rec = buildKeyConsultationRecord({
    question: "아들이 다음 달 군대에 가요.",
    claudeAnswer: "많이 슬프시겠어요. 아들이 이미 입대하셨군요.",
    customerId: "cust-a",
    sourceLink: SOURCE,
    now: NOW,
  });
  assert.equal(rec.schema, "key_consultation_record_v1");
  assert.equal(rec.life_threads.length, 1);
  assert.equal(rec.life_threads[0].customer_expressed_emotion, null);
  assert.equal(rec.life_threads[0].status, "open");
  assert.ok(!/슬프|이미 입대/.test(JSON.stringify(rec.life_threads)));
}

// READY CARD brief — no Presence ask flag
{
  const brief = formatLifeThreadsForReadyCard(
    extractLifeThreadsFromCustomerUtterance("아들이 다음 달 군대에 가요.", {
      customerId: "cust-a",
      now: NOW,
    }),
  );
  assert.equal(brief[0].surfaced_to_customer, false);
  assert.match(brief[0].note, /do_not_ask_first/);
}

// Isolation: different customer_id → different thread_id
{
  const a = extractLifeThreadsFromCustomerUtterance("아들이 다음 달 군대에 가요.", {
    customerId: "cust-a",
    now: NOW,
  });
  const b = extractLifeThreadsFromCustomerUtterance("아들이 다음 달 군대에 가요.", {
    customerId: "cust-b",
    now: NOW,
  });
  assert.notEqual(a[0].thread_id, b[0].thread_id);
  assert.equal(a[0].customer_id, "cust-a");
  assert.equal(b[0].customer_id, "cust-b");
}

// T5.1 — active filter drops resolved; attach overlays DB active onto stale handoff card
await (async () => {
  const planned = extractLifeThreadsFromCustomerUtterance("아들이 다음 달 군대에 가요.", {
    customerId: "cust-a",
    now: NOW,
  });
  const resolved = extractLifeThreadsFromCustomerUtterance(
    "아들은 잘 입대했고 첫 전화도 왔어요.",
    { customerId: "cust-a", now: new Date("2026-08-15T00:00:00.000Z") },
  );
  const exam = extractLifeThreadsFromCustomerUtterance("딸이 이번 주 중간고사 기간이에요.", {
    customerId: "cust-a",
    now: NOW,
  });
  const merged = mergeLifeThreadHistory([...planned, ...resolved, ...exam]);
  const active = selectActiveLifeThreads(merged, { customerId: "cust-a" });
  assert.equal(active.length, 1);
  assert.equal(active[0].event_kind, "family_exam_period");
  assert.ok(merged.some((t) => t.status === "resolved"));

  const staleCard = {
    customer_id: "cust-a",
    important_history: {
      related_turns: [],
      open_goals: [],
      open_tasks: [],
      life_threads: [],
      _prior_object: { life_threads: [] },
    },
  };
  const attached = await attachActiveLifeThreadsToReadyCard({
    card: staleCard,
    userSupabase: {},
    customerId: "cust-a",
    loadLifeThreads: async () => ({
      threads: merged,
      active,
      reason: "ok",
    }),
  });
  assert.equal(attached.active_count, 1);
  assert.equal(attached.card.important_history.life_threads.length, 1);
  assert.equal(attached.card.important_history._prior_object.life_threads.length, 1);
  assert.equal(
    attached.card.important_history._prior_object.life_threads[0].event_kind,
    "family_exam_period",
  );
})();

console.log("key-life-thread-unit-test: PASS");
