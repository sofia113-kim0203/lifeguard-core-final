/**
 * KEY v2 phase 2 — relational compose for life/emotion turns (Scene B/C).
 */
import assert from "node:assert/strict";

import {
  buildHumanUnderstandingFrame,
  buildBasisTaggedFacts,
  finalizeHumanSalesDirectorResponse,
  generateHumanSalesDirectorResponse,
  shouldUseKeyRelationalCompose,
  buildKeyRelationalResponse,
} from "../server/humanUnderstandingLoop.js";
import { resolveSalesDirectorJudgmentIntent } from "../server/salesDirectorFormatter.js";
import { ONE_BRAIN_SURFACES } from "../server/oneBrainResponseLayer.js";

const KEY_RELATIONAL_INSURANCE_PUSH_RE =
  /보험(?:을|이)?\s*(?:가입|들|추천|설계|정리|볼)|보장(?:을|이)?\s*(?:추천|설계)|가입(?:을|하)/;

const GENERIC_KEY_LIMIT_RE = /확인된 범위 안에서만|판단보다 이야기/;

function buildKeyBundle(question, overrides = {}) {
  return {
    question,
    key_orchestrator: true,
    policy_count: 2,
    policies: [{ product_name: "실손", policy_type: "health" }],
    ...overrides,
  };
}

function buildKeyFrame(question, bundle) {
  const classificationIntent = "casual_chat";
  const resolvedIntent = resolveSalesDirectorJudgmentIntent(classificationIntent, question);
  const basisTaggedFacts = buildBasisTaggedFacts(bundle, resolvedIntent);
  const humanFrame = buildHumanUnderstandingFrame({
    question,
    intent: resolvedIntent,
    surface: ONE_BRAIN_SURFACES.HOME,
    conversationContext: { classificationIntent, history: [] },
    factBundle: bundle,
    basisTaggedFacts,
  });
  return { humanFrame, basisTaggedFacts, resolvedIntent, classificationIntent };
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
  await runCase("V2-R1 shouldUseKeyRelationalCompose — fatigue casual_chat", async () => {
    const question = "요즘 너무 피곤해요";
    const bundle = buildKeyBundle(question);
    const { humanFrame } = buildKeyFrame(question, bundle);
    assert.equal(
      shouldUseKeyRelationalCompose({
        question,
        classificationIntent: "casual_chat",
        factBundle: bundle,
        humanFrame,
      }),
      true,
    );
  }),
);

await record(
  await runCase("V2-R2 shouldUseKeyRelationalCompose — insurance question off", async () => {
    const question = "암보장 있어?";
    const bundle = buildKeyBundle(question);
    const { humanFrame } = buildKeyFrame(question, bundle);
    assert.equal(
      shouldUseKeyRelationalCompose({
        question,
        classificationIntent: "factual_lookup",
        factBundle: bundle,
        humanFrame,
      }),
      false,
    );
  }),
);

await record(
  await runCase("V2-R3 buildKeyRelationalResponse — fatigue empathy, no insurance push", async () => {
    const question = "요즘 너무 피곤해요";
    const bundle = buildKeyBundle(question);
    const { humanFrame } = buildKeyFrame(question, bundle);
    const text = buildKeyRelationalResponse(humanFrame, question);
    assert.match(text, /피곤|지치/);
    assert.doesNotMatch(text, KEY_RELATIONAL_INSURANCE_PUSH_RE);
    assert.doesNotMatch(text, GENERIC_KEY_LIMIT_RE);
  }),
);

await record(
  await runCase("V2-R4 buildKeyRelationalResponse — family worry, no insurance push", async () => {
    const question = "아버지가 많이 편찮으세요";
    const bundle = buildKeyBundle(question);
    const { humanFrame } = buildKeyFrame(question, bundle);
    const text = buildKeyRelationalResponse(humanFrame, question);
    assert.match(text, /가족|힘드|상황/);
    assert.doesNotMatch(text, KEY_RELATIONAL_INSURANCE_PUSH_RE);
  }),
);

await record(
  await runCase("V2-R5 generateHumanSalesDirectorResponse — key_relational compose_mode", async () => {
    const question = "요즘 너무 피곤해요";
    const bundle = buildKeyBundle(question);
    const { humanFrame, basisTaggedFacts, resolvedIntent, classificationIntent } =
      buildKeyFrame(question, bundle);

    const generated = generateHumanSalesDirectorResponse({
      humanFrame,
      basisTaggedFacts,
      guardrails: { generation_mode: "key_orchestrator" },
      question,
      intent: resolvedIntent,
      factBundle: bundle,
      classificationIntent,
    });

    assert.equal(generated.generation_mode, "key_orchestrator");
    assert.equal(generated.key_compose_trace?.compose_mode, "key_relational");
    assert.match(generated.text, /피곤|지치/);
    assert.doesNotMatch(generated.text, GENERIC_KEY_LIMIT_RE);
  }),
);

await record(
  await runCase("V2-R6 insurance question still key_structured", async () => {
    const question = "암보장 있어?";
    const bundle = buildKeyBundle(question);
    const classificationIntent = "factual_lookup";
    const resolvedIntent =
      resolveSalesDirectorJudgmentIntent(classificationIntent, question) ?? "coverage_judgment";
    const basisTaggedFacts = buildBasisTaggedFacts(bundle, resolvedIntent);
    const humanFrame = buildHumanUnderstandingFrame({
      question,
      intent: resolvedIntent,
      surface: ONE_BRAIN_SURFACES.HOME,
      conversationContext: { classificationIntent, history: [] },
      factBundle: bundle,
      basisTaggedFacts,
    });

    const generated = generateHumanSalesDirectorResponse({
      humanFrame,
      basisTaggedFacts,
      guardrails: { generation_mode: "key_orchestrator" },
      question,
      intent: resolvedIntent,
      factBundle: bundle,
      classificationIntent,
    });

    assert.equal(generated.key_compose_trace?.compose_mode, "key_structured");
    assert.match(generated.text, /가입된 보험이 있는 것은 확인돼요/);
  }),
);

await record(
  await runCase("V2-R7 finalizeHuman KEY path — fatigue full path", async () => {
    const question = "요즘 너무 피곤해요";
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "casual_chat",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildKeyBundle(question),
      customerState: { question, keyOrchestrator: true },
      homeRoute: "casual_chat",
    });

    assert.equal(finalized.generation_mode, "key_orchestrator");
    assert.equal(finalized.key_compose_trace?.compose_mode, "key_relational");
    assert.match(finalized.text, /피곤|지치/);
    assert.doesNotMatch(finalized.text, KEY_RELATIONAL_INSURANCE_PUSH_RE);
  }),
);

console.log(
  `\nKEY v2 phase 2 relational: ${failed > 0 ? "FAILED" : "ALL PASSED"} (${passed}/${passed + failed})`,
);
process.exit(failed > 0 ? 1 : 0);
