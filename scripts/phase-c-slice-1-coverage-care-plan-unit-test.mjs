/**

 * Phase C Slice 1 — "내 보험 괜찮아?" Care Plan Next Step unit test.

 * Tom: transition + numbered timeline — no First Action overlap.

 */

import assert from "node:assert/strict";



import { COVERAGE_ANXIETY_COMPANION_CLUSTER_ID, classifyConsultationIntent } from "../server/intentGateLayer.js";

import { finalizeHumanSalesDirectorResponse } from "../server/humanUnderstandingLoop.js";

import { buildPhaseBSlice1CoverageJudgment } from "../server/keyBrain/phaseBSlice1CoverageJudgment.js";

import {

  buildPhaseCSlice1CoverageCarePlan,

  buildPhaseCSlice1CoverageCarePlanText,

  CARE_PLAN_FORBIDDEN_RE,

  CARE_PLAN_TRANSITION,

  formatCarePlanSteps,

} from "../server/keyBrain/phaseCSlice1CoverageCarePlan.js";

import { ONE_BRAIN_SURFACES } from "../server/oneBrainResponseLayer.js";



const SLICE1_Q = "내 보험 괜찮아?";

const FIRST_ACTION_RE = /이번에는.*같이\s*확인/;



function coverageFactBundle(overrides = {}) {

  return {

    question: SLICE1_Q,

    key_orchestrator: true,

    classification_intent: "general_consultation",

    companion_cluster: COVERAGE_ANXIETY_COMPANION_CLUSTER_ID,

    companion_cluster_signals: ["adequacy_ok"],

    policy_count: 1,

    policies: [

      {

        product_name: "QA종합보장A",

        coverage_summary: {

          riders: [{ rider_name: "실손의료비", normalized_name: "실손의료비" }],

        },

      },

    ],

    coverage_gap_used: true,

    has_stored_coverage_analysis: true,

    coverage_gap_maintained: ["실손"],

    ...overrides,

  };

}



function respond(overrides = {}) {

  const factBundle = coverageFactBundle(overrides);

  const result = finalizeHumanSalesDirectorResponse({

    question: factBundle.question,

    classificationIntent: factBundle.classification_intent,

    surface: ONE_BRAIN_SURFACES.HOME,

    factBundle,

    customerState: { question: factBundle.question, keyOrchestrator: true },

  });

  return typeof result === "string" ? result : result.text;

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

  await runCase("compose module — transition + numbered timeline steps", () => {

    const plan = buildPhaseCSlice1CoverageCarePlan({

      factBundle: coverageFactBundle(),

      question: SLICE1_Q,

    });

    assert.equal(plan.transition, CARE_PLAN_TRANSITION);

    assert.ok(plan.steps.length >= 2);

    assert.equal(plan.steps[0].timeframe, "이번 달");

    assert.match(plan.steps[0].action, /실손/);

    assert.equal(plan.steps[1].timeframe, "올해 안");

    assert.match(plan.steps[1].action, /암/);

    const formatted = formatCarePlanSteps(plan.steps);

    assert.match(formatted, /①\s*이번 달/);

    assert.match(formatted, /②\s*올해 안/);

  }),

);



results.push(

  await runCase("primary — Judge ends, transition, timeline plan", () => {

    const text = respond();

    assert.match(text, /^지금 확인/, "Phase B judgment first");

    assert.match(text, /유지하는\s*쪽이\s*맞아\s*보입니다/, "Phase B direction");

    assert.match(text, new RegExp(CARE_PLAN_TRANSITION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "transition");

    assert.match(text, /①\s*이번 달\s*실손\s*구조\s*확인/);

    assert.match(text, /②\s*올해 안\s*암\s*보장\s*점검/);

    assert.doesNotMatch(text, FIRST_ACTION_RE, "no First Action overlap with Care Plan");

    assert.doesNotMatch(text, CARE_PLAN_FORBIDDEN_RE, "Tom forbidden product push");

    const transitionIdx = text.indexOf(CARE_PLAN_TRANSITION);

    const judgmentEnd = text.indexOf("단정하지 않겠습니다");

    assert.ok(judgmentEnd > 0 && transitionIdx > judgmentEnd, "transition after judgment");

  }),

);



results.push(

  await runCase("auto policy — step ③ at renewal", () => {

    const text = respond({

      policies: [

        {

          product_name: "QA자동차특약",

          coverage_summary: { riders: [{ rider_name: "운전자", normalized_name: "운전자" }] },

        },

        {

          product_name: "QA실손A",

          coverage_summary: { riders: [{ rider_name: "실손", normalized_name: "실손" }] },

        },

      ],

      policy_count: 2,

      coverage_gap_maintained: ["실손"],

    });

    assert.match(text, /③\s*갱신\s*시기\s*자동차\s*보험\s*확인/);

  }),

);



results.push(

  await runCase("P0 hold — timeline without enrollment push", () => {

    const text = respond({

      policy_count: 0,

      policies: [],

      coverage_gap_used: false,

      has_stored_coverage_analysis: false,

      coverage_gap_maintained: [],

    });

    assert.ok(text.includes(CARE_PLAN_TRANSITION));

    assert.match(text, /①\s*이번 달\s*가입\s*정보\s*저장/);

    assert.doesNotMatch(text, CARE_PLAN_FORBIDDEN_RE);

  }),

);



results.push(

  await runCase("gap shortage — priority axis as step ①", () => {

    const plan = buildPhaseCSlice1CoverageCarePlan({

      factBundle: coverageFactBundle({

        coverage_gap_maintained: [],

        coverage_gap_signals: ["암:부족"],

      }),

      question: SLICE1_Q,

    });

    assert.match(plan.steps[0].action, /암/);

    assert.equal(plan.steps[0].timeframe, "이번 달");

  }),

);



results.push(

  await runCase("cluster trace preserved", () => {

    const classification = classifyConsultationIntent(SLICE1_Q);

    assert.equal(classification.companion_cluster, COVERAGE_ANXIETY_COMPANION_CLUSTER_ID);

    const text = buildPhaseCSlice1CoverageCarePlanText({

      factBundle: coverageFactBundle(),

      question: SLICE1_Q,

    });

    assert.ok(text?.startsWith(CARE_PLAN_TRANSITION));

  }),

);



const passed = results.filter(Boolean).length;

const total = results.length;

console.log(`\nphase-c-slice-1-coverage-care-plan: ${passed}/${total}`);

if (passed !== total) process.exit(1);

