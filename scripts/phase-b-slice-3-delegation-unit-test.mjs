/**
 * Phase B Slice 3 — "알아서 봐줘." delegation customer-experience unit test.
 * Tom: decision takeover — opener · reason · limit · first action · no deflection.
 */
import assert from "node:assert/strict";

import { classifyConsultationIntent } from "../server/intentGateLayer.js";
import { finalizeHumanSalesDirectorResponse } from "../server/humanUnderstandingLoop.js";
import {
  buildPhaseBSlice3DelegationJudgment,
  DELEGATION_FORBIDDEN_RE,
  DELEGATION_OPENER,
  isDelegationIntentQuestion,
} from "../server/keyBrain/phaseBSlice3DelegationJudgment.js";
import { DELEGATION_CARE_PLAN_TRANSITION } from "../server/keyBrain/phaseCSlice3DelegationCarePlan.js";
import { ONE_BRAIN_SURFACES } from "../server/oneBrainResponseLayer.js";

const SLICE3_Q = "알아서 봐줘.";
const SLICE3_PARAPHRASE = "나도 잘 모르겠는데 그냥 알아서 봐줘.";
const FIRST_ACTION_RE = /이번에는.*같이/;
const LEADERSHIP_RE = /제가\s*먼저/;

function delegationFactBundle(overrides = {}) {
  return {
    question: SLICE3_Q,
    key_orchestrator: true,
    classification_intent: "general_consultation",
    policy_count: 2,
    policies: [
      {
        product_name: "QA실손A",
        coverage_summary: {
          riders: [{ rider_name: "실손의료비", normalized_name: "실손의료비" }],
        },
      },
      {
        product_name: "QA암B",
        coverage_summary: {
          riders: [{ rider_name: "암진단", normalized_name: "암" }],
        },
      },
    ],
    coverage_gap_used: true,
    has_stored_coverage_analysis: true,
    coverage_gap_maintained: ["실손"],
    memory_facts: [{ theme: "보험료 부담", confidence: "theme_only" }],
    ...overrides,
  };
}

function respond(question, overrides = {}) {
  const factBundle = delegationFactBundle({ question, ...overrides });
  const result = finalizeHumanSalesDirectorResponse({
    question,
    classificationIntent: "general_consultation",
    surface: ONE_BRAIN_SURFACES.HOME,
    factBundle,
    customerState: { question, keyOrchestrator: true },
  });
  return {
    text: typeof result === "string" ? result : result.text,
    composeMode: result.key_compose_trace?.compose_mode ?? null,
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

const results = [];

results.push(
  await runCase("compose module — opener Direction Reason Limit First Action", () => {
    const out = buildPhaseBSlice3DelegationJudgment({
      factBundle: delegationFactBundle(),
      question: SLICE3_Q,
    });
    assert.ok(out);
    assert.match(out.judgment, new RegExp(`^${DELEGATION_OPENER}`));
    assert.match(out.evidence, /등록|보장|분석|이전/);
    assert.match(out.limitation, /단정|어렵/);
    assert.match(out.nextAction, /이번에는.*같이/);
  }),
);

results.push(
  await runCase("primary — delegation compose, no deflection", () => {
    const { text, composeMode } = respond(SLICE3_Q);
    assert.equal(composeMode, "phase_b_slice3_delegation");
    assert.match(text, new RegExp(`^${DELEGATION_OPENER}`));
    assert.doesNotMatch(text, DELEGATION_FORBIDDEN_RE, "Tom forbidden deflection");
    assert.match(text, /등록|보장|분석|유지|구조/);
    assert.match(text, new RegExp(DELEGATION_CARE_PLAN_TRANSITION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "Phase C transition");
    assert.match(text, LEADERSHIP_RE, "Care Leadership in plan");
    assert.doesNotMatch(text, FIRST_ACTION_RE, "no First Action overlap");
  }),
);

results.push(
  await runCase("Q27 paraphrase — beats trust/relational path", () => {
    const { text, composeMode } = respond(SLICE3_PARAPHRASE, { question: SLICE3_PARAPHRASE });
    assert.equal(composeMode, "phase_b_slice3_delegation");
    assert.match(text, new RegExp(`^${DELEGATION_OPENER}`));
    assert.doesNotMatch(text, /여쭤볼|확인이\s*목적|결정이\s*목적/);
    assert.doesNotMatch(text, DELEGATION_FORBIDDEN_RE);
  }),
);

results.push(
  await runCase("P0 hold — no policies, still leads with opener", () => {
    const { text } = respond(SLICE3_Q, {
      policy_count: 0,
      policies: [],
      coverage_gap_used: false,
      has_stored_coverage_analysis: false,
      coverage_gap_maintained: [],
    });
    assert.match(text, new RegExp(`^${DELEGATION_OPENER}`));
    assert.match(text, /가입\s*정보|정리|같이/);
    assert.doesNotMatch(text, DELEGATION_FORBIDDEN_RE);
  }),
);

results.push(
  await runCase("gap shortage — priority axis direction", () => {
    const { text } = respond(SLICE3_Q, {
      coverage_gap_maintained: [],
      coverage_gap_signals: ["암:부족"],
    });
    assert.match(text, /암/);
    assert.match(text, /암/);
    assert.match(text, LEADERSHIP_RE);
    assert.doesNotMatch(text, FIRST_ACTION_RE);
  }),
);

results.push(
  await runCase("negative controls preserved", () => {
    assert.ok(!isDelegationIntentQuestion("안녕하세요."));
    assert.ok(!isDelegationIntentQuestion("월 보험료 얼마야?"));
    const premium = classifyConsultationIntent("월 보험료 얼마야?");
    assert.equal(premium.lookup_sub_intent, "premium_lookup");
  }),
);

const passed = results.filter(Boolean).length;
const total = results.length;
console.log(`\nphase-b-slice-3-delegation: ${passed}/${total}`);
if (passed !== total) process.exit(1);
