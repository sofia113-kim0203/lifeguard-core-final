/**
 * KEY v2 phase 6 — claim judgment rule (Judgment Rule Library #1).
 */
import assert from "node:assert/strict";

import {
  buildBasisTaggedFacts,
  buildHumanUnderstandingFrame,
  finalizeHumanSalesDirectorResponse,
  resolveKeyJudgmentRule,
} from "../server/humanUnderstandingLoop.js";
import { resolveSalesDirectorJudgmentIntent } from "../server/salesDirectorFormatter.js";
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
  await runCase("V2-J1 resolveKeyJudgmentRule — claim questions match", async () => {
    assert.equal(
      resolveKeyJudgmentRule({
        question: "사고났는데 받을 거 있어?",
        resolvedIntent: "accident_claim",
      })?.id,
      "claim_eligibility_judgment",
    );
    assert.equal(
      resolveKeyJudgmentRule({
        question: "요즘 너무 피곤한데 보험금 받을 수 있어?",
        classificationIntent: "claim_eligibility_check",
        resolvedIntent: "claim_opportunity",
      })?.id,
      "claim_eligibility_judgment",
    );
    assert.equal(
      resolveKeyJudgmentRule({ question: "암보장 있어?", resolvedIntent: "coverage_judgment" }),
      null,
    );
  }),
);

await record(
  await runCase("V2-J2 mixed fatigue + claim — claim judgment not generic filler", async () => {
    const question = "요즘 너무 피곤한데 보험금 받을 수 있어?";
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "claim_eligibility_check",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildKeyBundle(question),
      customerState: { question, keyOrchestrator: true },
    });
    assert.equal(finalized.key_compose_trace?.compose_mode, "key_structured");
    assert.match(finalized.text, /사고·치료|열리는 축/);
    assert.doesNotMatch(finalized.text, GENERIC_FILLER_RE);
  }),
);

await record(
  await runCase("V2-J3 accident claim — judgment first", async () => {
    const question = "사고났는데 받을 거 있어?";
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "general_consultation",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildKeyBundle(question),
      customerState: { question, keyOrchestrator: true },
    });
    assert.doesNotMatch(finalized.text, GENERIC_FILLER_RE);
    assert.match(finalized.text, /사고·치료|열리는 축/);
  }),
);

await record(
  await runCase("V2-J4 presence regression — still presence judgment", async () => {
    const question = "암보장 있어?";
    const classificationIntent = "factual_lookup";
    const resolvedIntent = resolveSalesDirectorJudgmentIntent(classificationIntent, question);
    const bundle = buildKeyBundle(question);
    const basisTaggedFacts = buildBasisTaggedFacts(bundle, resolvedIntent);
    const humanFrame = buildHumanUnderstandingFrame({
      question,
      intent: resolvedIntent,
      surface: ONE_BRAIN_SURFACES.HOME,
      conversationContext: { classificationIntent, history: [] },
      factBundle: bundle,
      basisTaggedFacts,
    });
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent,
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: bundle,
      customerState: { question, keyOrchestrator: true },
    });
    assert.match(finalized.text, /가입된 보험이 있는 것은 확인돼요/);
    assert.doesNotMatch(finalized.text, /열리는 축이 달라/);
  }),
);

await record(
  await runCase("V2-J5 premium regression", async () => {
    const question = "보험료 너무 부담돼";
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

await record(
  await runCase("V2-J6 greeting social regression", async () => {
    const question = "안녕하세요";
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "casual_chat",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildKeyBundle(question),
      customerState: { question, keyOrchestrator: true },
      homeRoute: "casual_chat",
    });
    assert.equal(finalized.key_compose_trace?.compose_mode, "key_social");
  }),
);

console.log(
  `\nKEY v2 phase 6 claim judgment: ${failed > 0 ? "FAILED" : "ALL PASSED"} (${passed}/${passed + failed})`,
);
process.exit(failed > 0 ? 1 : 0);
