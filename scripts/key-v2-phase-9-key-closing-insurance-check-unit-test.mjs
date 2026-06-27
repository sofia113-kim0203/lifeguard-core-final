/**
 * KEY v2 phase 9 — closing + insurance check mixed turn (Scene J).
 */
import assert from "node:assert/strict";

import {
  finalizeHumanSalesDirectorResponse,
  isKeyClosingTurn,
  matchKeyConversationPattern,
} from "../server/humanUnderstandingLoop.js";
import { ONE_BRAIN_SURFACES } from "../server/oneBrainResponseLayer.js";

const GENERIC_FILLER_RE = /확인된 범위 안에서만 조심스럽게/;

function buildKeyBundle(question, overrides = {}) {
  return {
    question,
    key_orchestrator: true,
    policy_count: 2,
    policies: [{ product_name: "실손", policy_type: "health" }],
    ...overrides,
  };
}

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

await record(
  await runCase("V2-K1 pattern match — insurance check + goodnight", async () => {
    const question = "보험 확인하고 잘 자요";
    const pattern = matchKeyConversationPattern(question);
    assert.equal(pattern?.id, "closing_insurance_check_goodnight");
    assert.equal(isKeyClosingTurn(question), true);
  }),
);

await record(
  await runCase("V2-K2 compose — warm close, not generic filler", async () => {
    const question = "보험 확인하고 잘 자요";
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "general_consultation",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildKeyBundle(question),
      customerState: { question, keyOrchestrator: true },
    });
    assert.equal(finalized.key_compose_trace?.compose_mode, "key_closing");
    assert.equal(
      finalized.key_compose_trace?.conversation_pattern_id,
      "closing_insurance_check_goodnight",
    );
    assert.match(finalized.text, /편히 쉬|편안한 밤|내일 이어/);
    assert.doesNotMatch(finalized.text, GENERIC_FILLER_RE);
  }),
);

await record(
  await runCase("V2-K3 defer closing regression — still defer pattern", async () => {
    const question = "보험은 내일 이야기하고 잘게요";
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "general_consultation",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildKeyBundle(question),
      customerState: { question, keyOrchestrator: true },
    });
    assert.equal(
      finalized.key_compose_trace?.conversation_pattern_id,
      "closing_defer_insurance_to_later",
    );
  }),
);

await record(
  await runCase("V2-K4 pure goodnight regression", async () => {
    const question = "잘 자요";
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "casual_chat",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildKeyBundle(question),
      customerState: { question, keyOrchestrator: true },
      homeRoute: "casual_chat",
    });
    assert.equal(finalized.key_compose_trace?.conversation_pattern_id, "closing_goodnight");
  }),
);

await record(
  await runCase("V2-K5 insurance question regression — not closing", async () => {
    const question = "암보장 있어?";
    assert.equal(isKeyClosingTurn(question), false);
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "factual_lookup",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildKeyBundle(question),
      customerState: { question, keyOrchestrator: true },
    });
    assert.equal(finalized.key_compose_trace?.compose_mode, "key_structured");
  }),
);

await record(
  await runCase("V2-K6 mixed turn premium regression", async () => {
    const question = "고마워요. 보험료가 부담돼요.";
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "factual_lookup",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildKeyBundle(question),
      customerState: { question, keyOrchestrator: true },
    });
    assert.match(finalized.text, /보험료 부담/);
    assert.equal(finalized.key_compose_trace?.compose_mode, "key_structured");
  }),
);

console.log(
  `\nKEY v2 phase 9 closing insurance check: ${failed > 0 ? "FAILED" : "ALL PASSED"} (${passed}/${passed + failed})`,
);
process.exit(failed > 0 ? 1 : 0);
