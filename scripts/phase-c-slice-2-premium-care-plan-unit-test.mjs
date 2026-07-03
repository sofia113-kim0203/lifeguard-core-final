/**
 * Phase C Slice 2 — "보험료 부담돼." Premium Care Plan unit test.
 * Tom v1.1: plan not conclusion · customer Why · Companion voice · no First Action overlap.
 */
import assert from "node:assert/strict";

import {
  PREMIUM_BURDEN_COMPANION_CLUSTER_ID,
  classifyConsultationIntent,
} from "../server/intentGateLayer.js";
import { finalizeHumanSalesDirectorResponse } from "../server/humanUnderstandingLoop.js";
import { CARE_PLAN_TRANSITION } from "../server/keyBrain/phaseCSlice1CoverageCarePlan.js";
import {
  buildPhaseCSlice2PremiumCarePlan,
  buildPhaseCSlice2PremiumCarePlanText,
  formatPremiumCarePlanSteps,
  INTERNAL_WHY_RE,
  PREMIUM_CARE_PLAN_FORBIDDEN_RE,
} from "../server/keyBrain/phaseCSlice2PremiumCarePlan.js";
import { ONE_BRAIN_SURFACES } from "../server/oneBrainResponseLayer.js";

const SLICE2_Q = "보험료 부담돼.";
const FIRST_ACTION_RE = /이번에는.*같이\s*확인/;
const COMPANION_RE = /함께|같이/;

function premiumFactBundle(overrides = {}) {
  return {
    question: SLICE2_Q,
    key_orchestrator: true,
    classification_intent: "general_consultation",
    companion_cluster: PREMIUM_BURDEN_COMPANION_CLUSTER_ID,
    companion_cluster_signals: ["burden"],
    policy_count: 2,
    policies: [
      {
        product_name: "QA실손A",
        monthly_premium: 85000,
        coverage_summary: {
          riders: [{ rider_name: "실손의료비", normalized_name: "실손의료비" }],
        },
      },
      {
        product_name: "QA암B",
        monthly_premium: 120000,
        coverage_summary: {
          riders: [{ rider_name: "암진단", normalized_name: "암" }],
        },
      },
    ],
    premium_stats: {
      premiumKnownCount: 2,
      premiumTotal: 205000,
      premiumUnknownCount: 0,
      totalCount: 2,
    },
    premium_used: true,
    coverage_gap_maintained: ["실손"],
    coverage_gap_used: true,
    has_stored_coverage_analysis: true,
    ...overrides,
  };
}

function respond(overrides = {}) {
  const factBundle = premiumFactBundle(overrides);
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
  await runCase("compose module — transition + when + what + why + companion", () => {
    const plan = buildPhaseCSlice2PremiumCarePlan({
      factBundle: premiumFactBundle(),
      question: SLICE2_Q,
    });
    assert.equal(plan.transition, CARE_PLAN_TRANSITION);
    assert.ok(plan.steps.length >= 2);
    for (const step of plan.steps) {
      assert.match(step.what, COMPANION_RE, "companion voice on every step");
      assert.ok(step.why, "why required slice 2");
      assert.doesNotMatch(step.why, INTERNAL_WHY_RE, "customer-language why");
    }
    const formatted = formatPremiumCarePlanSteps(plan.steps);
    assert.match(formatted, /①\s*이번 달/);
    assert.match(formatted, /때문입니다|위해서입니다/);
  }),
);

results.push(
  await runCase("primary — judgment then plan, no conclusion, no First Action overlap", () => {
    const text = respond();
    assert.match(text, /^지금|^현재/, "Phase B judgment first");
    assert.match(text, /구조|유지|부담|맞아\s*보입니다/, "plan not conclusion");
    assert.match(text, new RegExp(CARE_PLAN_TRANSITION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(text, /①\s*이번 달.*함께\s*확인/);
    assert.match(text, /\(.*때문입니다|\).*위해서입니다\)/, "why in customer language");
    assert.doesNotMatch(text, FIRST_ACTION_RE, "no Phase B First Action when Care Plan present");
    const carePlanPart = text.slice(text.indexOf(CARE_PLAN_TRANSITION));
    assert.doesNotMatch(carePlanPart, PREMIUM_CARE_PLAN_FORBIDDEN_RE, "Tom forbidden pitch/conclusion in plan");
  }),
);

results.push(
  await runCase("P0 hold — companion plan within hold scope", () => {
    const text = respond({
      policy_count: 0,
      policies: [],
      premium_stats: { premiumKnownCount: 0, premiumTotal: 0, premiumUnknownCount: 0, totalCount: 0 },
      premium_used: false,
    });
    assert.match(text, new RegExp(CARE_PLAN_TRANSITION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(text, /①\s*이번 달.*함께\s*저장/);
    assert.match(text, COMPANION_RE);
    assert.doesNotMatch(text, PREMIUM_CARE_PLAN_FORBIDDEN_RE);
  }),
);

results.push(
  await runCase("reduction signal — heaviest branch with companion + why", () => {
    const text = respond({
      question: "보험을 줄이고 싶어.",
      companion_cluster_signals: ["reduction"],
    });
    assert.match(text, /부담이\s*큰\s*계약.*함께\s*확인/);
    assert.match(text, /\(.*때문입니다|\).*위해서입니다\)/);
    const carePlanPart = text.slice(text.indexOf(CARE_PLAN_TRANSITION));
    assert.doesNotMatch(carePlanPart, PREMIUM_CARE_PLAN_FORBIDDEN_RE);
  }),
);

results.push(
  await runCase("gap duplicates — structure before reduction", () => {
    const plan = buildPhaseCSlice2PremiumCarePlan({
      factBundle: premiumFactBundle({
        coverage_gap_signals: ["실손:중복"],
        coverage_gap_duplicates: ["실손"],
      }),
      question: SLICE2_Q,
    });
    assert.match(plan.steps[0].what, /겹치는\s*보장.*함께/);
    assert.match(plan.steps[0].why, /중복/);
  }),
);

results.push(
  await runCase("premium lookup negative control preserved", () => {
    const classification = classifyConsultationIntent("월 보험료 얼마야?");
    assert.notEqual(classification.companion_cluster, PREMIUM_BURDEN_COMPANION_CLUSTER_ID);
    assert.equal(classification.lookup_sub_intent, "premium_lookup");
  }),
);

results.push(
  await runCase("cluster trace + care plan text shape", () => {
    const classification = classifyConsultationIntent(SLICE2_Q);
    assert.equal(classification.companion_cluster, PREMIUM_BURDEN_COMPANION_CLUSTER_ID);
    const text = buildPhaseCSlice2PremiumCarePlanText({
      factBundle: premiumFactBundle(),
      question: SLICE2_Q,
    });
    assert.ok(text?.startsWith(CARE_PLAN_TRANSITION));
    assert.match(text, COMPANION_RE);
  }),
);

const passed = results.filter(Boolean).length;
const total = results.length;
console.log(`\nphase-c-slice-2-premium-care-plan: ${passed}/${total}`);
if (passed !== total) process.exit(1);
