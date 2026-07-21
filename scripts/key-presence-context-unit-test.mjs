/**
 * T6 — Presence materials / gates (no Claude / network).
 */
import assert from "node:assert/strict";
import {
  buildPresenceContext,
  selectPresenceLifeThreadCandidates,
  shouldInvokePresenceClaude,
  resolvePresenceSurfaceFromAnswer,
  isPresenceSilenceAnswer,
  KEY_PRESENCE_SILENCE_TOKEN,
  markLifeThreadSurfaced,
} from "../server/keyCore/keyPresenceContext.js";
import {
  buildDoNotSurfaceLifeThreadOverlays,
  selectActiveLifeThreads,
  mergeLifeThreadHistory,
} from "../server/keyCore/keyLifeThread.js";
import { buildHomeBrainFactRequestBody } from "../src/lib/homeBrainFactRequestBody.js";

const NOW = new Date("2026-07-21T03:00:00.000Z");

const examThread = {
  schema: "key_life_thread_v1",
  thread_id: "lt-exam-a",
  customer_id: "cust-a",
  subject_person: "딸",
  event_kind: "family_exam_period",
  event_summary: "딸 시험 기간",
  status: "open",
  do_not_surface: false,
  surface_count: 0,
  last_surfaced_at: null,
  customer_stated_facts: [
    { text: "딸이 이번 주 중간고사 기간이에요.", evidence: { kind: "customer_utterance" } },
  ],
  customer_expressed_emotion: null,
  expected_date_or_window: { label: "이번 주" },
};

const resolvedEnlist = {
  ...examThread,
  thread_id: "lt-enlist-a",
  event_kind: "family_enlistment_planned",
  event_summary: "아들 입대",
  status: "resolved",
  customer_stated_facts: [{ text: "아들이 입대했어요." }],
};

{
  const cands = selectPresenceLifeThreadCandidates([examThread, resolvedEnlist], {
    customerId: "cust-a",
    now: NOW,
  });
  assert.equal(cands.length, 1);
  assert.equal(cands[0].thread_id, "lt-exam-a");
}

{
  const ctx = buildPresenceContext({
    now: NOW,
    visitKind: "revisit",
    lifeThreads: [examThread, resolvedEnlist],
    customerId: "cust-a",
  });
  assert.equal(ctx.move, "listen_focus");
  assert.equal(ctx.active_life_thread_candidates.length, 1);
  assert.equal(ctx.max_life_threads_to_surface, 1);
  const gate = shouldInvokePresenceClaude({ presenceContext: ctx });
  assert.equal(gate.ok, true);
}

{
  const gate = shouldInvokePresenceClaude({
    presenceContext: buildPresenceContext({
      now: NOW,
      lifeThreads: [resolvedEnlist],
      customerId: "cust-a",
    }),
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, "no_eligible_life_thread");
}

{
  assert.equal(isPresenceSilenceAnswer(KEY_PRESENCE_SILENCE_TOKEN), true);
  const surface = resolvePresenceSurfaceFromAnswer(
    "딸분 시험기간이라고 하셨는데, 이제 좀 끝났나요?",
    buildPresenceContext({
      now: NOW,
      lifeThreads: [examThread],
      customerId: "cust-a",
    }).active_life_thread_candidates,
  );
  assert.equal(surface.surfaced, true);
  assert.equal(surface.source_type, "life_thread");
  assert.equal(surface.life_thread_id, "lt-exam-a");
}

{
  const marked = markLifeThreadSurfaced(examThread, { at: NOW });
  assert.equal(marked.surface_count, 1);
  assert.ok(marked.last_surfaced_at);
  const cooled = selectPresenceLifeThreadCandidates([marked], {
    customerId: "cust-a",
    now: NOW,
  });
  assert.equal(cooled.length, 0, "cooldown suppresses repeat surface");
}

{
  const overlays = buildDoNotSurfaceLifeThreadOverlays("그 이야기는 묻지 말아주세요.", {
    customerId: "cust-a",
    candidateThreadIds: ["lt-exam-a"],
    now: NOW,
  });
  assert.equal(overlays.length, 1);
  assert.equal(overlays[0].do_not_surface, true);
  const merged = mergeLifeThreadHistory([examThread, ...overlays]);
  assert.equal(merged.find((t) => t.thread_id === "lt-exam-a")?.do_not_surface, true);
  assert.equal(selectActiveLifeThreads(merged, { customerId: "cust-a" }).length, 0);
}

{
  const body = buildHomeBrainFactRequestBody("ignored", [{ role: "user", content: "x" }], {
    presence: true,
    sessionId: "sess-1",
    readyCardHandoffToken: "tok",
  });
  assert.equal(body.presence, true);
  assert.equal(body.question, "");
  assert.deepEqual(body.history, []);
  assert.equal(body.session_id, "sess-1");
  assert.equal(body.ready_card_handoff_token, "tok");
}

console.log("key-presence-context-unit-test: PASS");
