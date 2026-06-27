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
import { classifyConsultationIntent } from "../server/intentGateLayer.js";
import { ONE_BRAIN_SURFACES } from "../server/oneBrainResponseLayer.js";

const KEY_RELATIONAL_INSURANCE_PUSH_RE =
  /보험(?:을|이)?\s*(?:가입|들|추천|설계|정리|볼)|보장(?:을|이)?\s*(?:추천|설계)|가입(?:을|하)/;

const RELATIONAL_EMPATHY_RE = /피곤하시겠어요|지치신 것 같아요|가족 걱정이 크시겠어요|상황부터 천천히|이야기부터 같이/;

/** Tom PR #151 — life + insurance mixed turns must stay on key_structured. */
const TOM_RELATIONAL_BLOCK_CASES = [
  {
    id: "V2-R8",
    question: "요즘 너무 피곤한데 보험금 받을 수 있어?",
    insuranceSignal: /보험금|사고|치료|범위|받/,
  },
  {
    id: "V2-R9",
    question: "아버지가 아픈데 암보험 부족해?",
    insuranceSignal: /암|충분|부족|단정|어렵/,
  },
  {
    id: "V2-R10",
    question: "가족력이 걱정돼서 암보험 있어?",
    insuranceSignal: /가입|확인|있/,
  },
  {
    id: "V2-R11",
    question: "병원비가 부담되는데 내 보험 괜찮아?",
    insuranceSignal: /괜찮|걱정|축|범위/,
  },
  {
    id: "V2-R12",
    question: "요즘 몸이 안 좋아서 실손 청구 가능해?",
    insuranceSignal: /실손|청구|사고|치료|받|범위/,
  },
];

function buildTomMixedBundle(question) {
  return buildKeyBundle(question, {
    policies: [
      { product_name: "실손의료비", policy_type: "health" },
      { product_name: "암진단", policy_type: "cancer" },
    ],
    coverage_gap_signals: ["암:미확인", "실손:유지"],
    coverage_gap_top_concerns: ["암"],
    coverage_gap_maintained: ["실손"],
    coverage_gap_used: true,
    has_stored_coverage_analysis: true,
  });
}

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

for (const tomCase of TOM_RELATIONAL_BLOCK_CASES) {
  await record(
    await runCase(`${tomCase.id} Tom block — mixed turn stays key_structured`, async () => {
      const { question, insuranceSignal } = tomCase;
      const bundle = buildTomMixedBundle(question);
      const classification = classifyConsultationIntent(question);
      const classificationIntent = classification.intent;
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

      assert.equal(
        shouldUseKeyRelationalCompose({
          question,
          classificationIntent,
          factBundle: bundle,
          humanFrame,
        }),
        false,
      );

      const generated = generateHumanSalesDirectorResponse({
        humanFrame,
        basisTaggedFacts,
        guardrails: { generation_mode: "key_orchestrator" },
        question,
        intent: resolvedIntent,
        factBundle: bundle,
        classificationIntent,
      });

      assert.notEqual(generated.key_compose_trace?.compose_mode, "key_relational");
      assert.equal(generated.key_compose_trace?.compose_mode, "key_structured");
      assert.doesNotMatch(generated.text, RELATIONAL_EMPATHY_RE);
      assert.match(generated.text, insuranceSignal);
    }),
  );
}

console.log(
  `\nKEY v2 phase 2 relational: ${failed > 0 ? "FAILED" : "ALL PASSED"} (${passed}/${passed + failed})`,
);
process.exit(failed > 0 ? 1 : 0);
