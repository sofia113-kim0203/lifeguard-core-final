/**
 * KEY v2 phase 12 — Policy Family: insurer factual lookup (fact-first).
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
    policies: [
      { product_name: "실손", insurer_name: "삼성생명" },
      { product_name: "암", insurer_name: "현대해상" },
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
  await runCase("V2-I1 가입 보험사 + insurers → names fact first", async () => {
    const question = "가입 보험사 뭐야?";
    assert.equal(
      resolveKeyJudgmentRule({ question, resolvedIntent: null })?.id,
      "insurer_lookup_judgment",
    );
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "general_consultation",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildKeyBundle(question),
      customerState: { question, keyOrchestrator: true },
    });
    assert.match(finalized.text, /^가입하신 보험사는 삼성생명과 현대해상이에요/);
    assert.doesNotMatch(finalized.text, GENERIC_FILLER_RE);
  }),
);

await record(
  await runCase("V2-I2 no insurer names → defer, no invented company", async () => {
    const question = "가입 보험사 뭐야?";
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "general_consultation",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildKeyBundle(question, {
        policies: [{ product_name: "실손" }, { product_name: "암" }],
      }),
      customerState: { question, keyOrchestrator: true },
    });
    assert.match(finalized.text, /확인하지 못했/);
    assert.match(finalized.text, /확인해 보고 다시 말씀드리겠습니다/);
    assert.doesNotMatch(finalized.text, /삼성|현대|생명|해상/);
  }),
);

await record(
  await runCase("V2-I3 policy count regression", async () => {
    const question = "보험 몇 개야?";
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "general_consultation",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildKeyBundle(question),
      customerState: { question, keyOrchestrator: true },
    });
    assert.match(finalized.text, /2개예요/);
  }),
);

await record(
  await runCase("V2-I4 premium lookup regression", async () => {
    const question = "보험료 얼마야?";
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "factual_lookup",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildKeyBundle(question, {
        premium_stats: {
          totalCount: 2,
          premiumKnownCount: 2,
          premiumUnknownCount: 0,
          premiumTotal: 90000,
        },
      }),
      customerState: { question, keyOrchestrator: true },
    });
    assert.match(finalized.text, /90,000원/);
  }),
);

console.log(
  `\nKEY v2 phase 12 insurer lookup: ${failed > 0 ? "FAILED" : "ALL PASSED"} (${passed}/${passed + failed})`,
);
process.exit(failed > 0 ? 1 : 0);
