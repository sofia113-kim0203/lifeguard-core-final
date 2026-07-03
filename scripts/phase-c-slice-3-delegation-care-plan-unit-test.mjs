/**
 * Phase C Slice 3 — "알아서 봐줘." Delegation Care Plan unit test.
 * Tom v1.2: Care Leadership · lead not decide-for · no "다 맡겨 주세요".
 */
import assert from "node:assert/strict";

import { classifyConsultationIntent } from "../server/intentGateLayer.js";
import { finalizeHumanSalesDirectorResponse } from "../server/humanUnderstandingLoop.js";
import {
  DELEGATION_FORBIDDEN_RE,
  DELEGATION_OPENER,
} from "../server/keyBrain/phaseBSlice3DelegationJudgment.js";
import {
  buildPhaseCSlice3DelegationCarePlan,
  buildPhaseCSlice3DelegationCarePlanText,
  buildPhaseCSlice3DelegationResponseWithCarePlan,
  DELEGATION_CARE_PLAN_FORBIDDEN_RE,
  DELEGATION_CARE_PLAN_TRANSITION,
  formatDelegationCarePlanSteps,
  INTERNAL_WHY_RE,
} from "../server/keyBrain/phaseCSlice3DelegationCarePlan.js";
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
  await runCase("compose module — transition + leadership steps + why", () => {
    const plan = buildPhaseCSlice3DelegationCarePlan({
      factBundle: delegationFactBundle(),
      question: SLICE3_Q,
    });
    assert.equal(plan.transition, DELEGATION_CARE_PLAN_TRANSITION);
    assert.ok(plan.steps.length >= 2);
    for (const [index, step] of plan.steps.entries()) {
      if (index === plan.steps.length - 1) {
        assert.match(step.what, /함께\s*결정|같이/, "shared decision on final step");
      } else {
        assert.match(step.what, LEADERSHIP_RE, "Care Leadership on lead steps");
      }
      assert.ok(step.why, "why required");
      assert.doesNotMatch(step.why, INTERNAL_WHY_RE);
    }
    const formatted = formatDelegationCarePlanSteps(plan.steps);
    assert.match(formatted, /①\s*이번\s*달/);
    assert.match(formatted, /제가\s*먼저/);
  }),
);

results.push(
  await runCase("primary — judgment then care plan, no First Action overlap", () => {
    const { text, composeMode } = respond(SLICE3_Q);
    assert.equal(composeMode, "phase_b_slice3_delegation");
    assert.match(text, new RegExp(`^${DELEGATION_OPENER}`));
    assert.match(text, new RegExp(DELEGATION_CARE_PLAN_TRANSITION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(text, /제가\s*먼저.*같이/);
    assert.match(text, /\(.*때문입니다|\).*하려는\s*것입니다\)/);
    assert.doesNotMatch(text, DELEGATION_FORBIDDEN_RE);
    assert.doesNotMatch(text, FIRST_ACTION_RE, "no Phase B First Action when Care Plan present");
    const carePlanPart = text.slice(text.indexOf(DELEGATION_CARE_PLAN_TRANSITION));
    assert.doesNotMatch(carePlanPart, DELEGATION_CARE_PLAN_FORBIDDEN_RE);
    assert.doesNotMatch(carePlanPart, /다\s*맡겨|맡겨\s*주/);
  }),
);

results.push(
  await runCase("Q27 paraphrase — care plan with leadership", () => {
    const { text, composeMode } = respond(SLICE3_PARAPHRASE, { question: SLICE3_PARAPHRASE });
    assert.equal(composeMode, "phase_b_slice3_delegation");
    assert.match(text, new RegExp(DELEGATION_CARE_PLAN_TRANSITION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(text, /제가\s*먼저/);
    assert.doesNotMatch(text, /여쭤볼|확인이\s*목적|결정이\s*목적/);
  }),
);

results.push(
  await runCase("P0 hold — leadership plan within hold scope", () => {
    const { text } = respond(SLICE3_Q, {
      policy_count: 0,
      policies: [],
      coverage_gap_used: false,
      has_stored_coverage_analysis: false,
      coverage_gap_maintained: [],
    });
    assert.match(text, new RegExp(DELEGATION_CARE_PLAN_TRANSITION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(text, /제가\s*먼저.*가입\s*정보/);
    assert.doesNotMatch(text, DELEGATION_CARE_PLAN_FORBIDDEN_RE);
  }),
);

results.push(
  await runCase("gap shortage — priority axis leadership, not enrollment push", () => {
    const { text } = respond(SLICE3_Q, {
      coverage_gap_maintained: [],
      coverage_gap_signals: ["암:부족"],
    });
    assert.match(text, /제가\s*먼저\s*암/);
    assert.doesNotMatch(text, /암(?:보험)?\s*(?:추가|가입)/);
    assert.match(text, /함께\s*결정/);
  }),
);

results.push(
  await runCase("negative controls preserved", () => {
    const premium = classifyConsultationIntent("월 보험료 얼마야?");
    assert.equal(premium.lookup_sub_intent, "premium_lookup");
    const coverage = classifyConsultationIntent("내 보험 괜찮아?");
    assert.equal(coverage.companion_cluster, "JC-COVERAGE-ANXIETY-v1");
  }),
);

results.push(
  await runCase("full compose helper shape", () => {
    const text = buildPhaseCSlice3DelegationResponseWithCarePlan({
      factBundle: delegationFactBundle(),
      question: SLICE3_Q,
    });
    assert.ok(text?.includes(DELEGATION_OPENER));
    assert.ok(text?.includes(DELEGATION_CARE_PLAN_TRANSITION));
    const planText = buildPhaseCSlice3DelegationCarePlanText({
      factBundle: delegationFactBundle(),
      question: SLICE3_Q,
    });
    assert.ok(planText?.startsWith(DELEGATION_CARE_PLAN_TRANSITION));
  }),
);

const passed = results.filter(Boolean).length;
const total = results.length;
console.log(`\nphase-c-slice-3-delegation-care-plan: ${passed}/${total}`);
if (passed !== total) process.exit(1);
