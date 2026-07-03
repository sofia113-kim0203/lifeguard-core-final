/**
 * Phase B Slice 1 — "내 보험 괜찮아?" customer-experience unit test.
 * Tom completion: expert consultation feel — Direction · Reason · First Action.
 */
import assert from "node:assert/strict";

import { COVERAGE_ANXIETY_COMPANION_CLUSTER_ID, classifyConsultationIntent } from "../server/intentGateLayer.js";
import { finalizeHumanSalesDirectorResponse } from "../server/humanUnderstandingLoop.js";
import { buildPhaseBSlice1CoverageJudgment } from "../server/keyBrain/phaseBSlice1CoverageJudgment.js";
import { CARE_PLAN_TRANSITION } from "../server/keyBrain/phaseCSlice1CoverageCarePlan.js";
import { ONE_BRAIN_SURFACES } from "../server/oneBrainResponseLayer.js";

const SLICE1_Q = "내 보험 괜찮아?";

const DEFLECT_RE = /제일\s*불편|뭐가\s*불편|오늘은\s*확인이\s*목적/;
const INVENTORY_DUMP_RE = /확인\s*가능한\s*내용|field_count|OCR/i;
const EMPATHY_OPENER_RE = /걱정되시는|마음은\s*이해|뭔가\s*빠진\s*것\s*같/;
const INTERNAL_REASON_RE = /저장된\s*분석\s*기준|가입\s*\d+\s*건과\s*저장/;

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
  await runCase("compose module returns Direction Reason First Action", () => {
    const out = buildPhaseBSlice1CoverageJudgment({
      factBundle: coverageFactBundle(),
      question: SLICE1_Q,
    });
    assert.ok(out);
    assert.doesNotMatch(out.judgment, EMPATHY_OPENER_RE, "judgment first not empathy");
    assert.match(out.judgment, /지금 확인|등록된|괜찮|단정|범위/);
    assert.match(out.evidence || out.limitation, /등록|확인|자료|보장/);
    assert.match(out.nextAction, /이번에는|같이/);
  }),
);

results.push(
  await runCase("Slice 1 primary question — judgment first, expert reason", () => {
    const text = respond();
    assert.ok(text.length > 40, "answer too short");
    assert.doesNotMatch(text, DEFLECT_RE, "companion deflection");
    assert.doesNotMatch(text, INVENTORY_DUMP_RE, "inventory dump");
    assert.doesNotMatch(text, EMPATHY_OPENER_RE, "empathy opener");
    assert.doesNotMatch(text, INTERNAL_REASON_RE, "internal reason phrasing");
    assert.match(text, /^지금 확인/, "judgment first");
    assert.match(text, /유지하는\s*쪽이\s*맞아\s*보입니다|공백\s*신호/, "direction");
    assert.match(text, /현재\s*자료|등록된\s*보험|확인되는\s*범위/, "customer reason");
    assert.match(text, /단정하지\s*않|확인되지\s*않/, "clear limit");
    assert.match(text, /그럼\s*앞으로는\s*이렇게\s*진행하면\s*됩니다/, "Phase C transition");
    assert.match(text, /①\s*이번 달\s*실손\s*구조\s*확인/, "Phase C timeline step 1");
    assert.match(text, /②\s*올해 안\s*암\s*보장\s*점검/, "Phase C timeline step 2");
    assert.doesNotMatch(text, /이번에는.*같이\s*확인/, "First Action omitted when Care Plan present");
  }),
);

results.push(
  await runCase("P0 hold — no policies", () => {
    const text = respond({
      policy_count: 0,
      policies: [],
      coverage_gap_used: false,
      has_stored_coverage_analysis: false,
      coverage_gap_maintained: [],
    });
    assert.match(text, /등록|가입\s*정보|확인/);
    assert.ok(text.includes(CARE_PLAN_TRANSITION) || /같이\s*확인|같이\s*보/.test(text));
    assert.doesNotMatch(text, EMPATHY_OPENER_RE);
  }),
);

results.push(
  await runCase("P1 gap shortage — direction on axis", () => {
    const text = respond({
      coverage_gap_maintained: [],
      coverage_gap_signals: ["암:부족"],
    });
    assert.match(text, /암/);
    assert.match(text, /①\s*이번 달\s*암\s*보장\s*확인/);
    assert.doesNotMatch(text, EMPATHY_OPENER_RE);
  }),
);

results.push(
  await runCase("jc-coverage-anxiety local trace shape preserved", () => {
    const classification = classifyConsultationIntent(SLICE1_Q);
    assert.equal(classification.companion_cluster, COVERAGE_ANXIETY_COMPANION_CLUSTER_ID);
    assert.deepEqual(classification.companion_cluster_signals, ["adequacy_ok"]);
  }),
);

const passed = results.filter(Boolean).length;
const total = results.length;
console.log(`\nphase-b-slice-1-coverage-adequacy: ${passed}/${total}`);
if (passed !== total) process.exit(1);
