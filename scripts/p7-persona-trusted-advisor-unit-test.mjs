/**
 * P7-PERSONA — Trusted advisor persona tests.
 */
import assert from "node:assert/strict";

import {
  CONVERSATION_BRAIN_TOPICS,
  SALES_DIRECTOR_PERSONA_ID,
  SALES_DIRECTOR_TRUSTED_ADVISOR_PROMPT,
  abstractMemoryThemes,
  buildTrustMemoryAcknowledgment,
  composeTrustedAdvisorTurn,
  violatesMemoryValueRepetition,
} from "../server/salesDirectorPersona.js";
import {
  composeDeterministicFreeThinking,
  hasFreeThinkingQualities,
  SALES_DIRECTOR_FREE_THINKING_PROMPT,
} from "../server/salesDirectorFreeThinking.js";

async function runCase(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
    return true;
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    return false;
  }
}

let passed = 0;
let failed = 0;

async function record(ok) {
  if (ok) passed += 1;
  else failed += 1;
}

const memoryFacts = [
  { fact_key: "work.status", fact_value: "프리랜서" },
  { fact_key: "insurance.goal", fact_value: "보험료 부담" },
];

await record(
  await runCase("P1 prompt — trusted advisor, not sales expert", async () => {
    assert.match(SALES_DIRECTOR_TRUSTED_ADVISOR_PROMPT, /5천만|믿음|고문/);
    assert.doesNotMatch(SALES_DIRECTOR_TRUSTED_ADVISOR_PROMPT, /15년차\s*보험\s*영업부장/);
    assert.equal(SALES_DIRECTOR_FREE_THINKING_PROMPT, SALES_DIRECTOR_TRUSTED_ADVISOR_PROMPT);
  }),
);

await record(
  await runCase("P2 memory abstraction — themes only, no raw values", async () => {
    const themes = abstractMemoryThemes(memoryFacts, CONVERSATION_BRAIN_TOPICS.PREMIUM_BURDEN);
    assert.ok(themes.includes("보험료 부담"));
    assert.equal(themes.includes("프리랜서"), false);
  }),
);

await record(
  await runCase("P3 no verbatim memory repetition in customer text", async () => {
    const ack = buildTrustMemoryAcknowledgment(memoryFacts, CONVERSATION_BRAIN_TOPICS.PREMIUM_BURDEN);
    assert.doesNotMatch(ack, /프리랜서/);
    assert.equal(violatesMemoryValueRepetition("프리랜서 때문에 걱정이에요", memoryFacts), true);
    const result = composeDeterministicFreeThinking({
      question: "보험료 부담돼",
      topic: CONVERSATION_BRAIN_TOPICS.PREMIUM_BURDEN,
      customerContextBundle: {
        policies: [{ product_name: "실손", policy_type: "health" }],
        memoryFacts,
      },
      loadedContext: { policies: "present", memory: "present" },
      contextSnapshotId: "persona-1",
    });
    assert.doesNotMatch(result.text, /프리랜서/);
    assert.equal(result.persona, SALES_DIRECTOR_PERSONA_ID);
  }),
);

await record(
  await runCase("P4 conversation flow — intent to reassurance", async () => {
    const turn = composeTrustedAdvisorTurn({
      topic: CONVERSATION_BRAIN_TOPICS.ADEQUACY,
      memoryFacts,
      loadedContext: { policies: "present" },
      policySignalText: "실손/건강·암 관련",
    });
    assert.match(turn.text, /괜찮|확인하고\s*싶/);
    assert.match(turn.text, /가입|보이|단정/);
    assert.match(turn.text, /천천히|급하게|함께|괜찮/);
    assert.equal(hasFreeThinkingQualities(turn.text), true);
  }),
);

console.log(`\nP7-PERSONA: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
