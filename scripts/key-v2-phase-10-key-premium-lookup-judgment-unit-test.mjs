/**
 * KEY v2 phase 10 — premium lookup judgment (factual how-much).
 */
import assert from "node:assert/strict";

import {
  finalizeHumanSalesDirectorResponse,
  resolveKeyJudgmentRule,
} from "../server/humanUnderstandingLoop.js";
import { ONE_BRAIN_SURFACES } from "../server/oneBrainResponseLayer.js";

const GENERIC_FILLER_RE = /확인된 범위 안에서만 조심스럽게/;

function buildKeyBundle(question, overrides = {}) {
  return {
    question,
    key_orchestrator: true,
    policy_count: 2,
    policies: [{ product_name: "실손", policy_type: "health", monthly_premium: 45000 }],
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
  await runCase("V2-P1 premium lookup — judgment not generic filler", async () => {
    const question = "보험료 얼마야?";
    assert.equal(resolveKeyJudgmentRule({ question, resolvedIntent: null })?.id, "premium_lookup_judgment");
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "factual_lookup",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildKeyBundle(question),
      customerState: { question, keyOrchestrator: true },
    });
    assert.equal(finalized.key_compose_trace?.compose_mode, "key_structured");
    assert.match(finalized.text, /납입액|보험료/);
    assert.doesNotMatch(finalized.text, GENERIC_FILLER_RE);
  }),
);

await record(
  await runCase("V2-P2 premium burden regression — interpretation not lookup", async () => {
    const question = "보험료 너무 부담돼";
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "factual_lookup",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildKeyBundle(question),
      customerState: { question, keyOrchestrator: true },
    });
    assert.match(finalized.text, /보험료 부담/);
    assert.doesNotMatch(finalized.text, /계약마다 달라서/);
  }),
);

await record(
  await runCase("V2-P3 closing situational regression", async () => {
    const question = "보험 확인하고 잘 자요";
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "general_consultation",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildKeyBundle(question),
      customerState: { question, keyOrchestrator: true },
    });
    assert.equal(finalized.key_compose_trace?.compose_mode, "key_closing");
  }),
);

await record(
  await runCase("V2-P4 mixed premium regression", async () => {
    const question = "고마워요. 보험료가 부담돼요.";
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "factual_lookup",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildKeyBundle(question),
      customerState: { question, keyOrchestrator: true },
    });
    assert.match(finalized.text, /보험료 부담/);
  }),
);

console.log(
  `\nKEY v2 phase 10 premium lookup: ${failed > 0 ? "FAILED" : "ALL PASSED"} (${passed}/${passed + failed})`,
);
process.exit(failed > 0 ? 1 : 0);
