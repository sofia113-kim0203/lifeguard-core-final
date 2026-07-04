/**
 * KEY v2 phase 22 — Memory Family: memory recall (fact-first).
 */
import assert from "node:assert/strict";

import {
  finalizeHumanSalesDirectorResponse,
  resolveKeyJudgmentRule,
} from "../server/humanUnderstandingLoop.js";
import { ONE_BRAIN_SURFACES } from "../server/oneBrainResponseLayer.js";

const GENERIC_FILLER_RE = /확인된 범위 안에서만 조심스럽게/;

const CONFIRMED_MEMORY_FACTS = [
  { fact_key: "premium_worry", fact_value: "보험료 부담이 크다" },
  { fact_key: "cancer_worry", fact_value: "암 가족력 걱정" },
];

function buildKeyBundle(question, overrides = {}) {
  return {
    question,
    key_orchestrator: true,
    policy_count: 2,
    policies: [
      { product_name: "실손", policy_type: "health", product: "실손" },
      { product_name: "암", policy_type: "cancer", product: "암" },
    ],
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
  await runCase("V2-Mr1 기억해 + confirmed memory → recall judgment first", async () => {
    const question = "기억해?";
    assert.equal(
      resolveKeyJudgmentRule({ question, resolvedIntent: null, classificationIntent: "memory_recall_lookup" })?.id,
      "memory_recall_judgment",
    );
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "memory_recall_lookup",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildKeyBundle(question, {
        memory_facts: CONFIRMED_MEMORY_FACTS,
        memory_fact_count: CONFIRMED_MEMORY_FACTS.length,
      }),
      customerState: { question, keyOrchestrator: true },
    });
    assert.match(finalized.text, /저장해 둔 상담 맥락이 확인돼요/);
    assert.match(finalized.text, /보험료 부담과 암 관련 걱정/);
    assert.doesNotMatch(finalized.text, GENERIC_FILLER_RE);
  }),
);

await record(
  await runCase('V2-Mr1b "나를 기억해?" + confirmed memory → recall judgment (Q3-S1)', async () => {
    const question = "나를 기억해?";
    assert.equal(
      resolveKeyJudgmentRule({ question, resolvedIntent: null, classificationIntent: "general_consultation" })?.id,
      "memory_recall_judgment",
    );
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "general_consultation",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildKeyBundle(question, {
        memory_facts: CONFIRMED_MEMORY_FACTS,
        memory_fact_count: CONFIRMED_MEMORY_FACTS.length,
      }),
      customerState: { question, keyOrchestrator: true },
    });
    assert.match(finalized.text, /저장해 둔 상담 맥락이 확인돼요/);
    assert.match(finalized.text, /보험료 부담과 암 관련 걱정/);
    assert.doesNotMatch(finalized.text, GENERIC_FILLER_RE);
    assert.equal(finalized.key_compose_trace?.compose_mode, "key_structured");
  }),
);

await record(
  await runCase('V2-Mr1c "나를 기억해?" no memory → honest defer (Q3-S1)', async () => {
    const question = "나를 기억해?";
    assert.equal(
      resolveKeyJudgmentRule({ question, classificationIntent: "general_consultation" })?.id,
      "memory_recall_judgment",
    );
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "general_consultation",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildKeyBundle(question, { memory_facts: [], memory_fact_count: 0 }),
      customerState: { question, keyOrchestrator: true },
    });
    assert.match(finalized.text, /확인된 기억이 없어요/);
    assert.doesNotMatch(finalized.text, GENERIC_FILLER_RE);
  }),
);

await record(
  await runCase("V2-Mr2 no memory facts → defer, no invented recall", async () => {
    const question = "기억해?";
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "memory_recall_lookup",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildKeyBundle(question, { memory_facts: [], memory_fact_count: 0 }),
      customerState: { question, keyOrchestrator: true },
    });
    assert.match(finalized.text, /확인된 기억이 없어요/);
    assert.match(finalized.text, /저장된 기억은 아직 확인되지 않았어요/);
    assert.doesNotMatch(finalized.text, /저장해 둔 상담 맥락/);
  }),
);

await record(
  await runCase("V2-Mr3 claim eligibility regression", async () => {
    const question = "사고났는데 받을 거 있어?";
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "general_consultation",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildKeyBundle(question),
      customerState: { question, keyOrchestrator: true },
    });
    assert.match(finalized.text, /열리는 축|열려 있는 축/);
  }),
);

await record(
  await runCase("V2-Mr4 product lookup regression", async () => {
    const question = "가입한 보험 뭐야?";
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "general_consultation",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildKeyBundle(question),
      customerState: { question, keyOrchestrator: true },
    });
    assert.match(finalized.text, /실손과 암/);
  }),
);

console.log(
  `\nKEY v2 phase 22 memory recall: ${failed > 0 ? "FAILED" : "ALL PASSED"} (${passed}/${passed + failed})`,
);
process.exit(failed > 0 ? 1 : 0);
