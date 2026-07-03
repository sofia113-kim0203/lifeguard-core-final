/**
 * Phase B Slice 2 — "보험료 부담돼." customer-experience unit test.
 * Tom: Premium Intent value judgment — Direction · Reason · First Action (not calculation opener).
 */
import assert from "node:assert/strict";

import {
  PREMIUM_BURDEN_COMPANION_CLUSTER_ID,
  classifyConsultationIntent,
} from "../server/intentGateLayer.js";
import { finalizeHumanSalesDirectorResponse } from "../server/humanUnderstandingLoop.js";
import { buildPhaseBSlice2PremiumBurdenJudgment } from "../server/keyBrain/phaseBSlice2PremiumBurdenJudgment.js";
import { ONE_BRAIN_SURFACES } from "../server/oneBrainResponseLayer.js";

const SLICE2_Q = "보험료 부담돼.";

const DEFLECT_RE = /제일\s*불편|뭐가\s*불편|오늘은\s*확인이\s*목적/;
const EMPATHY_OPENER_RE = /느껴지시는|느껴지|마음은\s*이해|걱정되시는/;
const PREMIUM_CALC_OPENER_RE = /^현재\s*확인\s*가능한\s*월\s*보험료|^\d|원입니다/;
const DIRECTION_RE = /^지금|^현재/;

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
  await runCase("compose module returns Direction Reason First Action", () => {
    const out = buildPhaseBSlice2PremiumBurdenJudgment({
      factBundle: premiumFactBundle(),
      question: SLICE2_Q,
    });
    assert.ok(out);
    assert.doesNotMatch(out.judgment, EMPATHY_OPENER_RE, "direction not empathy");
    assert.match(out.judgment, DIRECTION_RE, "direction first");
    assert.match(out.evidence || out.limitation, /등록|보장|납입|가치|자료/);
    assert.match(out.nextAction, /이번에는|같이/);
  }),
);

results.push(
  await runCase("Slice 2 primary — direction first, value judgment not calculation", () => {
    const text = respond();
    assert.ok(text.length > 40, "answer too short");
    assert.doesNotMatch(text, DEFLECT_RE, "companion deflection");
    assert.doesNotMatch(text, EMPATHY_OPENER_RE, "empathy opener");
    assert.match(text, DIRECTION_RE, "direction first");
    assert.doesNotMatch(text.split(/[.!?]/)[0], PREMIUM_CALC_OPENER_RE, "no calc opener");
    assert.match(text, /유지|구조|부담|줄이|우선|맞아\s*보입니다/, "value direction");
    assert.match(text, /보장|가치|납입|자료|등록/, "customer reason");
    assert.match(text, /단정하지\s*않|어렵/, "clear limit");
    assert.match(text, /이번에는.*같이/, "companion pledge");
  }),
);

results.push(
  await runCase("P0 hold — no policies", () => {
    const text = respond({
      policy_count: 0,
      policies: [],
      premium_stats: { premiumKnownCount: 0, premiumTotal: 0, premiumUnknownCount: 0, totalCount: 0 },
      premium_used: false,
    });
    assert.match(text, /등록|가입|확인/);
    assert.match(text, /같이\s*확인|같이\s*맞춰|저장/);
    assert.doesNotMatch(text, EMPATHY_OPENER_RE);
  }),
);

results.push(
  await runCase("reduction signal — heavy contract priority direction", () => {
    const text = respond({
      question: "보험을 줄이고 싶어.",
      companion_cluster_signals: ["reduction"],
    });
    assert.match(text, /부담이\s*큰\s*계약|줄이는\s*것보다/);
    assert.match(text, /이번에는.*같이/);
    assert.doesNotMatch(text, EMPATHY_OPENER_RE);
  }),
);

results.push(
  await runCase("jc-premium-burden negative control preserved", () => {
    const classification = classifyConsultationIntent("월 보험료 얼마야?");
    assert.notEqual(classification.companion_cluster, PREMIUM_BURDEN_COMPANION_CLUSTER_ID);
    assert.equal(classification.lookup_sub_intent, "premium_lookup");
  }),
);

results.push(
  await runCase("cluster trace shape preserved", () => {
    const classification = classifyConsultationIntent(SLICE2_Q);
    assert.equal(classification.companion_cluster, PREMIUM_BURDEN_COMPANION_CLUSTER_ID);
    assert.ok(classification.companion_cluster_signals?.includes("burden"));
  }),
);

const passed = results.filter(Boolean).length;
const total = results.length;
console.log(`\nphase-b-slice-2-premium-burden: ${passed}/${total}`);
if (passed !== total) process.exit(1);
