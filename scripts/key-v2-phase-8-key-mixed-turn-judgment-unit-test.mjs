/**
 * KEY v2 phase 8 — mixed turn judgment (Priority 2).
 */
import assert from "node:assert/strict";

import {
  finalizeHumanSalesDirectorResponse,
  resolveKeyJudgmentRule,
} from "../server/humanUnderstandingLoop.js";
import { matchKeyConversationPattern } from "../server/keyConversationPatterns.js";
import { buildKeyWaitAck } from "../server/keyWaitAck.js";
import { ONE_BRAIN_SURFACES } from "../server/oneBrainResponseLayer.js";

const GENERIC_FILLER_RE = /확인된 범위 안에서만 조심스럽게/;

function buildKeyBundle(question, overrides = {}) {
  return {
    question,
    key_orchestrator: true,
    policy_count: 2,
    policies: [{ product_name: "실손", policy_type: "health" }],
    coverage_gap_maintained: ["실손"],
    coverage_gap_used: true,
    has_stored_coverage_analysis: true,
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
  await runCase("V2-M1 thanks + premium — premium judgment, not social", async () => {
    const question = "고마워요. 그런데 보험료가 부담돼요.";
    assert.equal(matchKeyConversationPattern(question), null);
    assert.equal(
      resolveKeyJudgmentRule({ question, resolvedIntent: null })?.id,
      "mixed_turn_premium_judgment",
    );
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "factual_lookup",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildKeyBundle(question),
      customerState: { question, keyOrchestrator: true },
    });
    assert.equal(finalized.key_compose_trace?.compose_mode, "key_structured");
    assert.match(finalized.text, /보험료 부담/);
    assert.doesNotMatch(finalized.text, GENERIC_FILLER_RE);
  }),
);

await record(
  await runCase("V2-M2 greeting + insurance invite — open judgment, not filler", async () => {
    const question = "안녕하세요. 보험 하나만 물어볼게요.";
    assert.equal(matchKeyConversationPattern(question), null);
    assert.equal(
      resolveKeyJudgmentRule({ question, resolvedIntent: null })?.id,
      "mixed_turn_greeting_insurance_open",
    );
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "general_consultation",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildKeyBundle(question),
      customerState: { question, keyOrchestrator: true },
    });
    assert.match(finalized.text, /보험 이야기|같이 확인/);
    assert.doesNotMatch(finalized.text, GENERIC_FILLER_RE);
  }),
);

await record(
  await runCase("V2-M3 pure thanks — still social pattern", async () => {
    const question = "고마워요";
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "casual_chat",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildKeyBundle(question),
      customerState: { question, keyOrchestrator: true },
    });
    assert.equal(finalized.key_compose_trace?.compose_mode, "key_social");
  }),
);

await record(
  await runCase("V2-M4 greeting + presence — presence judgment regression", async () => {
    const question = "안녕하세요. 암보장 있어?";
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "factual_lookup",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildKeyBundle(question),
      customerState: { question, keyOrchestrator: true },
    });
    assert.match(finalized.text, /가입된 보험이 있는 것은 확인돼요/);
    assert.doesNotMatch(finalized.text, GENERIC_FILLER_RE);
  }),
);

await record(
  await runCase("V2-M5 thanks + claim — claim judgment regression", async () => {
    const question = "고마워요. 사고났는데 받을 거 있어?";
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "general_consultation",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildKeyBundle(question),
      customerState: { question, keyOrchestrator: true },
    });
    assert.match(finalized.text, /사고·치료|열리는 축/);
    assert.doesNotMatch(finalized.text, GENERIC_FILLER_RE);
  }),
);

await record(
  await runCase("V2-M6 wait ack — no judgment in ACK text", async () => {
    const ack = buildKeyWaitAck("암보장 있어?");
    assert.match(ack, /들었|받았|함께 확인/);
    assert.doesNotMatch(ack, /보험료|암|실손|부족|괜찮|판단|단정/i);
  }),
);

console.log(
  `\nKEY v2 phase 8 mixed turn: ${failed > 0 ? "FAILED" : "ALL PASSED"} (${passed}/${passed + failed})`,
);
process.exit(failed > 0 ? 1 : 0);
