/**
 * KEY v2 phase 3 — analysis status compose (Order 0.5 Scene I).
 */
import assert from "node:assert/strict";

import {
  buildBasisTaggedFacts,
  buildHumanUnderstandingFrame,
  finalizeHumanSalesDirectorResponse,
  generateHumanSalesDirectorResponse,
  isKeyAnalysisStatusQuestion,
  buildKeyAnalysisStatusResponse,
} from "../server/humanUnderstandingLoop.js";
import { resolveSalesDirectorJudgmentIntent } from "../server/salesDirectorFormatter.js";
import { ONE_BRAIN_SURFACES } from "../server/oneBrainResponseLayer.js";

const GENERIC_KEY_LIMIT_RE = /확인된 범위 안에서만 조심스럽게/;

function buildKeyBundle(question, overrides = {}) {
  return {
    question,
    key_orchestrator: true,
    policy_count: 2,
    policies: [{ product_name: "실손", policy_type: "health" }],
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
  await runCase("V2-A1 isKeyAnalysisStatusQuestion — status yes, request no", async () => {
    assert.equal(isKeyAnalysisStatusQuestion("분석 끝났어?"), true);
    assert.equal(isKeyAnalysisStatusQuestion("분석 중이야?"), true);
    assert.equal(isKeyAnalysisStatusQuestion("내 보험 분석해줘"), false);
    assert.equal(isKeyAnalysisStatusQuestion("암보장 있어?"), false);
  }),
);

await record(
  await runCase("V2-A2 buildKeyAnalysisStatusResponse — stored analysis complete", async () => {
    const question = "분석 끝났어?";
    const bundle = buildKeyBundle(question, {
      has_stored_coverage_analysis: true,
      coverage_gap_used: true,
    });
    const text = buildKeyAnalysisStatusResponse(bundle, question);
    assert.match(text, /분석.*확인|저장/);
    assert.doesNotMatch(text, GENERIC_KEY_LIMIT_RE);
  }),
);

await record(
  await runCase("V2-A3 buildKeyAnalysisStatusResponse — policies only, defer", async () => {
    const question = "분석 끝났어?";
    const bundle = buildKeyBundle(question, {
      has_stored_coverage_analysis: false,
      coverage_gap_used: false,
    });
    const text = buildKeyAnalysisStatusResponse(bundle, question);
    assert.match(text, /가입 보험은 보이|같이 볼 단계/);
    assert.match(text, /확인해 보고 다시 말씀드리겠습니다/);
  }),
);

await record(
  await runCase("V2-A4 buildKeyAnalysisStatusResponse — empty factory defer", async () => {
    const question = "분석 다 됐어?";
    const bundle = buildKeyBundle(question, {
      policy_count: 0,
      policies: [],
      has_stored_coverage_analysis: false,
    });
    const text = buildKeyAnalysisStatusResponse(bundle, question);
    assert.match(text, /등록된 가입 보험이 없/);
    assert.match(text, /확인해 보고 다시 말씀드리겠습니다/);
  }),
);

await record(
  await runCase("V2-A5 generateHuman — key_analysis_status compose_mode", async () => {
    const question = "분석 끝났어?";
    const bundle = buildKeyBundle(question, {
      has_stored_coverage_analysis: true,
      coverage_gap_used: true,
    });
    const classificationIntent = "general_consultation";
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

    const generated = generateHumanSalesDirectorResponse({
      humanFrame,
      basisTaggedFacts,
      guardrails: { generation_mode: "key_orchestrator" },
      question,
      intent: resolvedIntent,
      factBundle: bundle,
      classificationIntent,
    });

    assert.equal(generated.key_compose_trace?.compose_mode, "key_analysis_status");
    assert.doesNotMatch(generated.text, GENERIC_KEY_LIMIT_RE);
  }),
);

await record(
  await runCase("V2-A6 finalizeHuman full path — analysis status", async () => {
    const question = "분석 끝났어?";
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "general_consultation",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildKeyBundle(question, {
        has_stored_coverage_analysis: true,
        coverage_gap_used: true,
      }),
      customerState: { question, keyOrchestrator: true },
      homeRoute: "insurance",
    });

    assert.equal(finalized.key_compose_trace?.compose_mode, "key_analysis_status");
    assert.match(finalized.text, /분석.*확인|저장/);
  }),
);

await record(
  await runCase("V2-A7 fatigue still key_relational — no regression", async () => {
    const question = "요즘 너무 피곤해요";
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "casual_chat",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildKeyBundle(question),
      customerState: { question, keyOrchestrator: true },
      homeRoute: "casual_chat",
    });
    assert.equal(finalized.key_compose_trace?.compose_mode, "key_relational");
  }),
);

console.log(
  `\nKEY v2 phase 3 analysis status: ${failed > 0 ? "FAILED" : "ALL PASSED"} (${passed}/${passed + failed})`,
);
process.exit(failed > 0 ? 1 : 0);
