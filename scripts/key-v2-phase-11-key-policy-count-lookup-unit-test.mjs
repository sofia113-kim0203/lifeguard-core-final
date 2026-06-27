/**
 * KEY v2 phase 11 — policy count factual lookup (fact → judgment → action).
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
      { product_name: "실손", policy_type: "health" },
      { product_name: "암", policy_type: "cancer" },
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
  await runCase("V2-N1 보험 몇 개야 + policies → count fact first", async () => {
    const question = "보험 몇 개야?";
    assert.equal(
      resolveKeyJudgmentRule({ question, resolvedIntent: null })?.id,
      "policy_count_lookup_judgment",
    );
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "general_consultation",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildKeyBundle(question),
      customerState: { question, keyOrchestrator: true },
    });
    assert.match(finalized.text, /^지금 확인된 가입 보험은 2개예요/);
    assert.doesNotMatch(finalized.text, GENERIC_FILLER_RE);
  }),
);

await record(
  await runCase("V2-N2 no policies → defer, no invented count", async () => {
    const question = "보험 몇 개야?";
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "general_consultation",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildKeyBundle(question, { policy_count: 0, policies: [] }),
      customerState: { question, keyOrchestrator: true },
    });
    assert.match(finalized.text, /등록된 가입 보험이 아직 없습니다|찾지 못했/);
    assert.match(finalized.text, /확인해 보고 다시 말씀드리겠습니다/);
    assert.doesNotMatch(finalized.text, /\d+\s*개예요/);
  }),
);

await record(
  await runCase("V2-N3 premium lookup regression", async () => {
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

await record(
  await runCase("V2-N4 premium burden regression", async () => {
    const question = "보험료 부담돼";
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
  `\nKEY v2 phase 11 policy count lookup: ${failed > 0 ? "FAILED" : "ALL PASSED"} (${passed}/${passed + failed})`,
);
process.exit(failed > 0 ? 1 : 0);
