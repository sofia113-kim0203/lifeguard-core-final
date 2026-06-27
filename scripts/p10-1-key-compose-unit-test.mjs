/**
 * P10-1 phase 2 — KEY compose unit tests.
 */
import assert from "node:assert/strict";

import {
  buildKeyStructuredResponse,
  buildBasisTaggedFacts,
  buildHumanUnderstandingFrame,
  enforceKeyDeclarativeEnding,
  finalizeHumanSalesDirectorResponse,
  generateHumanSalesDirectorResponse,
  KEY_QUESTION_ENDING_RE,
} from "../server/humanUnderstandingLoop.js";
import {
  SALES_DIRECTOR_JUDGMENT_INTENTS,
  resolveSalesDirectorJudgmentIntent,
} from "../server/salesDirectorFormatter.js";
import {
  auditAnswerExpressions,
  buildSalesDirectorJudgmentAudit,
} from "../server/salesDirectorJudgmentAudit.js";
import { ONE_BRAIN_SURFACES } from "../server/oneBrainResponseLayer.js";

function buildFixtureBundle(question, overrides = {}) {
  return {
    question,
    policy_count: 2,
    policies: [
      { product_name: "실손의료비", policy_type: "health" },
      { product_name: "암진단", policy_type: "cancer" },
    ],
    coverage_gap_signals: ["암:미확인", "실손:유지"],
    coverage_gap_top_concerns: ["암", "뇌혈관"],
    coverage_gap_maintained: ["실손"],
    coverage_gap_used: true,
    has_stored_coverage_analysis: true,
    premium_stats: {
      totalCount: 2,
      premiumKnownCount: 0,
      premiumUnknownCount: 2,
      premiumTotal: 0,
    },
    ...overrides,
  };
}

function composeKey(question, bundleOverrides = {}) {
  const bundle = buildFixtureBundle(question, bundleOverrides);
  const classificationIntent = "factual_lookup";
  const resolvedIntent =
    resolveSalesDirectorJudgmentIntent(classificationIntent, question) ??
    SALES_DIRECTOR_JUDGMENT_INTENTS.COVERAGE_JUDGMENT;
  const basisTaggedFacts = buildBasisTaggedFacts(bundle, resolvedIntent);
  const humanFrame = buildHumanUnderstandingFrame({
    question,
    intent: resolvedIntent,
    surface: ONE_BRAIN_SURFACES.HOME,
    conversationContext: { classificationIntent, history: [] },
    factBundle: bundle,
    basisTaggedFacts,
  });

  return {
    text: buildKeyStructuredResponse(humanFrame, basisTaggedFacts, bundle, {
      resolvedIntent,
    }),
    humanFrame,
    basisTaggedFacts,
    bundle,
    resolvedIntent,
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
  await runCase("K1 KEY compose order — presence question not adequacy", async () => {
    const { text } = composeKey("암보장 있어?");
    assert.match(text, /가입된 보험이 있는 것은 확인돼요/);
    assert.doesNotMatch(text, /충분 여부|부족/);
    assert.doesNotMatch(text, /^월 납입|^상품명·가입/);
    assert.doesNotMatch(text, KEY_QUESTION_ENDING_RE);
  }),
);

await record(
  await runCase("K2 three sample questions — question_count 0", async () => {
    for (const question of ["암보장 있어?", "보험료 부담돼", "내 보험 괜찮아?"]) {
      const overrides =
        question.includes("보험료")
          ? {
              key_orchestrator: true,
              premium_stats: {
                totalCount: 2,
                premiumKnownCount: 0,
                premiumUnknownCount: 2,
                premiumTotal: 0,
              },
            }
          : { key_orchestrator: true };
      const { text, bundle } = composeKey(question, overrides);
      const audit = auditAnswerExpressions(text);
      assert.equal(audit.question_count, 0, `${question} question_count`);
      assert.doesNotMatch(text, KEY_QUESTION_ENDING_RE, `${question} ending`);
      assert.ok(text.length > 40, `${question} non-empty`);
      assert.ok(bundle.has_stored_coverage_analysis || question.includes("보험료"));
    }
  }),
);

await record(
  await runCase("K3 generation_mode key_orchestrator when flagged", async () => {
    const bundle = buildFixtureBundle("암보장 있어?", { key_orchestrator: true });
    const resolvedIntent = SALES_DIRECTOR_JUDGMENT_INTENTS.COVERAGE_JUDGMENT;
    const basisTaggedFacts = buildBasisTaggedFacts(bundle, resolvedIntent);
    const humanFrame = buildHumanUnderstandingFrame({
      question: "암보장 있어?",
      intent: resolvedIntent,
      conversationContext: { classificationIntent: "factual_lookup", history: [] },
      factBundle: bundle,
      basisTaggedFacts,
    });

    const generated = generateHumanSalesDirectorResponse({
      humanFrame,
      basisTaggedFacts,
      guardrails: { generation_mode: "key_orchestrator" },
      factBundle: bundle,
      intent: resolvedIntent,
    });

    assert.equal(generated.generation_mode, "key_orchestrator");
  }),
);

await record(
  await runCase("K4 legacy compose unchanged when key flag absent", async () => {
    const bundle = buildFixtureBundle("암보장 있어?", { key_orchestrator: false });
    const resolvedIntent = SALES_DIRECTOR_JUDGMENT_INTENTS.COVERAGE_JUDGMENT;
    const basisTaggedFacts = buildBasisTaggedFacts(bundle, resolvedIntent);
    const humanFrame = buildHumanUnderstandingFrame({
      question: "암보장 있어?",
      intent: resolvedIntent,
      conversationContext: { classificationIntent: "factual_lookup", history: [] },
      factBundle: bundle,
      basisTaggedFacts,
    });

    const generated = generateHumanSalesDirectorResponse({
      humanFrame,
      basisTaggedFacts,
      guardrails: {},
      factBundle: bundle,
      intent: resolvedIntent,
    });

    assert.equal(generated.generation_mode, "insurance_human");
    assert.match(generated.text, /걱정되는 축|먼저 보입니다|지금/);
  }),
);

await record(
  await runCase("K5 finalizeHuman KEY path — gap fact count >= 1", async () => {
    const finalized = finalizeHumanSalesDirectorResponse({
      question: "암보장 있어?",
      classificationIntent: "factual_lookup",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildFixtureBundle("암보장 있어?", { key_orchestrator: true }),
      customerState: {
        question: "암보장 있어?",
        keyOrchestrator: true,
        coverageGapContext: {
          loaded: true,
          signals: ["암:미확인", "실손:유지"],
          top_concerns: ["암"],
          maintained: ["실손"],
        },
      },
      homeRoute: "casual_chat",
    });

    assert.equal(finalized.generation_mode, "key_orchestrator");
    const audit = buildSalesDirectorJudgmentAudit({
      answerText: finalized.text,
      customerContextBundle: {
        coverageGapContext: {
          signals: ["암:미확인", "실손:유지"],
        },
      },
    });
    assert.ok(audit.fact_count.coverage_gap_fact_count >= 1);
    assert.equal(audit.question_count, 0);
  }),
);

await record(
  await runCase("K6 enforceKeyDeclarativeEnding replaces question ending", async () => {
    const cleaned = enforceKeyDeclarativeEnding("테스트입니다. 말씀해 주실까요?", "information_gap");
    assert.doesNotMatch(cleaned, KEY_QUESTION_ENDING_RE);
    assert.match(cleaned, /확인해 보고 다시 말씀드리겠습니다/);
  }),
);

console.log(`\nP10-1 KEY compose: ${failed > 0 ? "FAILED" : "ALL PASSED"} (${passed}/${passed + failed})`);
process.exit(failed > 0 ? 1 : 0);
