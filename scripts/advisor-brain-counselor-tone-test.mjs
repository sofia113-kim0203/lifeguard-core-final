/**
 * Advisor Brain — counselor tone prompt rules (no live DB / no live Claude).
 */
import assert from "node:assert/strict";
import { classifyConsultationIntent, detectCasualChatIntent } from "../server/intentGateLayer.js";
import {
  ADVISOR_BRAIN_CONVERSATION_MAX_TOKENS,
  ADVISOR_CONVERSATION_FOLLOW_UP_EXAMPLES,
  ADVISOR_CONVERSATION_STYLE_EXAMPLES,
  buildAdvisorConversationSystemPrompt,
  buildAdvisorConversationUserPrompt,
  buildStoredConversationEvidence,
} from "../server/advisorBrain/advisorConversationResponder.js";

const mockEvidence = buildStoredConversationEvidence({
  coverage_gap: { items: [{ coverage_label: "뇌혈관", gap_level: "critical" }], top_gaps: [] },
  underwriting_risk: { items: [] },
  recommendation: { customer_visible_top2: [] },
});

// K — system prompt counselor rules
{
  const system = buildAdvisorConversationSystemPrompt();
  assert.match(system, /one-sentence-only/i);
  assert.match(system, /follow-up question/i);
  assert.match(system, /report\/document tone/i);
  assert.match(system, /Minimize bullet lists/i);
  assert.match(system, /ongoing consultation/i);
  console.log("K PASS");
}

// L — user prompt style examples + follow-up guidance
{
  const prompt = buildAdvisorConversationUserPrompt({
    question: "보험 더 들어야 해?",
    evidence: mockEvidence,
  });
  assert.match(prompt, /BAD.*뇌혈관 보장이 부족합니다/);
  assert.match(prompt, /GOOD.*뇌혈관 쪽이 조금 아쉬워/);
  for (const example of ADVISOR_CONVERSATION_FOLLOW_UP_EXAMPLES) {
    assert.ok(prompt.includes(example), `missing follow-up example: ${example}`);
  }
  assert.equal(ADVISOR_CONVERSATION_STYLE_EXAMPLES.bad, "뇌혈관 보장이 부족합니다.");
  assert.match(ADVISOR_CONVERSATION_STYLE_EXAMPLES.good, /혈압약/);
  console.log("L PASS");
}

// M — max tokens bumped for multi-paragraph counsel
{
  assert.equal(ADVISOR_BRAIN_CONVERSATION_MAX_TOKENS, 900);
  console.log("M PASS");
}

// N — everyday emotion routes to casual_chat (no immediate insurance path)
{
  for (const question of ["오늘 피곤하다", "요즘 힘들다", "잠이 안 온다"]) {
    const casual = detectCasualChatIntent(question);
    assert.equal(casual?.matched_rule, "casual_emotion_check", question);
    const classification = classifyConsultationIntent(question);
    assert.equal(classification.intent, "casual_chat", question);
    assert.equal(classification.matched_rule, "casual_emotion_check", question);
  }
  console.log("N PASS");
}

console.log("advisor-brain-counselor-tone-test: PASS");
