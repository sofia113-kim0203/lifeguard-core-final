/**
 * Triangle T3 — raw question direct (newline preserve + single current_question).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { normalizeHomeBrainQuestion } from "../server/homeBrainFactCore.js";
import {
  buildUserPayload,
  fingerprintRawQuestion,
  countCurrentQuestionOccurrences,
} from "../server/keyCore/keyClaudeFirstDirect.js";

const QA1 = "내 암보험 괜찮아? 이유까지 솔직하게 말해줘.";
const QA2 = "점심을 아직 못 먹었어요.\n오늘은 보험 말고 그냥 이야기하고 싶어요.";
const QA3 = "내가 가입한 보험이 뭐야?";

function sha(s) {
  return createHash("sha256").update(String(s), "utf8").digest("hex");
}

// Mutation was: collapse whitespace. Must preserve newlines.
{
  const n1 = normalizeHomeBrainQuestion(QA1);
  const n2 = normalizeHomeBrainQuestion(QA2);
  assert.equal(n1, QA1);
  assert.equal(n2, QA2);
  assert.equal((n2.match(/\n/g) || []).length, 1);
  assert.equal(sha(n2), sha(QA2));
  // Leading/trailing trim only
  assert.equal(normalizeHomeBrainQuestion(`  ${QA1}  `), QA1);
  assert.notEqual(
    String(QA2).replace(/\s+/g, " ").trim(),
    normalizeHomeBrainQuestion(QA2),
  );
}

// Payload: current_question once; ready_card separate
{
  const payload = buildUserPayload({
    question: QA2,
    chart: { policy_count: { status: "verified", value: 1 }, contracts: [] },
    contextPack: {
      recent_conversation_originals: [{ role: "user", text: "이전 말" }],
      older_conversation_summary: null,
    },
    readyCardMeta: {
      status: "normal",
      prepared_at: "2026-07-21T00:00:00.000Z",
      materials_connected: true,
      note: "READY CARD",
    },
  });
  assert.equal(payload.current_question, QA2);
  assert.equal(payload.current_context.ready_card.status, "normal");
  assert.notEqual(payload.current_question, payload.current_context.ready_card);
  const text = JSON.stringify(payload);
  assert.equal(countCurrentQuestionOccurrences(text, QA2), 1);
  const fp = fingerprintRawQuestion(payload.current_question);
  assert.equal(fp.question_sha256, sha(QA2));
  assert.equal(fp.question_newline_count, 1);
}

for (const q of [QA1, QA3]) {
  const payload = buildUserPayload({
    question: normalizeHomeBrainQuestion(q),
    chart: null,
    contextPack: { recent_conversation_originals: [], older_conversation_summary: null },
  });
  assert.equal(payload.current_question, q);
  assert.equal(countCurrentQuestionOccurrences(JSON.stringify(payload), q), 1);
}

console.log("key-raw-question-direct-unit-test: PASS");
