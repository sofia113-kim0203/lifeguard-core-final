/**
 * KEY v2 phase 10 — premium lookup judgment (Tom #159 conditional 3-case).
 */
import assert from "node:assert/strict";

import {
  finalizeHumanSalesDirectorResponse,
  resolveKeyJudgmentRule,
} from "../server/humanUnderstandingLoop.js";
import { ONE_BRAIN_SURFACES } from "../server/oneBrainResponseLayer.js";

const GENERIC_FILLER_RE = /확인된 범위 안에서만 조심스럽게/;
const FABRICATED_AMOUNT_RE = /\d{1,3}(?:,\d{3})+\s*원/;

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

/** Tom #159-1 — premium data present → amount leads */
await record(
  await runCase("V2-P1 Tom — 보험료 얼마야 + premium data → amount first", async () => {
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
          premiumTotal: 125000,
        },
      }),
      customerState: { question, keyOrchestrator: true },
    });
    assert.equal(resolveKeyJudgmentRule({ question, resolvedIntent: null })?.id, "premium_lookup_judgment");
    assert.match(finalized.text, /^현재 확인 가능한 월 보험료는 125,000원입니다/);
    assert.doesNotMatch(finalized.text, GENERIC_FILLER_RE);
  }),
);

/** Tom #159-2 — no premium data → no fabrication, defer */
await record(
  await runCase("V2-P2 Tom — 보험료 얼마야 + no premium → defer, no invented amount", async () => {
    const question = "보험료 얼마야?";
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "factual_lookup",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildKeyBundle(question, {
        policies: [{ product_name: "실손" }, { product_name: "암" }],
        premium_stats: {
          totalCount: 2,
          premiumKnownCount: 0,
          premiumUnknownCount: 2,
          premiumTotal: 0,
        },
      }),
      customerState: { question, keyOrchestrator: true },
    });
    assert.match(finalized.text, /확인되지 않/);
    assert.match(finalized.text, /확인해 보고 다시 말씀드리겠습니다/);
    assert.doesNotMatch(finalized.text, FABRICATED_AMOUNT_RE);
    assert.doesNotMatch(finalized.text, GENERIC_FILLER_RE);
  }),
);

/** Tom #159-3 — burden path unchanged */
await record(
  await runCase("V2-P3 Tom — 보험료 부담돼 → premium burden judgment", async () => {
    const question = "보험료 부담돼";
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "factual_lookup",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildKeyBundle(question, {
        premium_stats: {
          totalCount: 2,
          premiumKnownCount: 1,
          premiumUnknownCount: 1,
          premiumTotal: 45000,
        },
      }),
      customerState: { question, keyOrchestrator: true },
    });
    assert.match(finalized.text, /보험료 부담이 실제로 큰지는/);
    assert.doesNotMatch(finalized.text, /계약마다 달라서/);
    assert.doesNotMatch(finalized.text, /모두 확인되지 않/);
  }),
);

await record(
  await runCase("V2-P4 closing situational regression", async () => {
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
  await runCase("V2-P5 mixed premium regression", async () => {
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
