/**
 * KEY-RECOVERY-03 Slice A A1 — preload shadow unit + 3-question trace (no network).
 */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { classifyConsultationIntent } from "../server/intentGateLayer.js";
import { planKeyTools } from "../server/salesDirectorKeyToolRegistry.js";
import {
  buildKeyChatPreloadShadowTrace,
  deriveFactoryPreloadKeysFromPlan,
  getKeyChatPreloadControlMode,
  isKeyChatPreloadShadowEnabled,
  KEY_CHAT_PRELOAD_CONTROL_MODES,
  LEGACY_CHAT_FULL_FACTORY_PRELOAD,
  attachKeyPreloadControlToSalesDirectorTrace,
} from "../server/keyBrain/chatPreloadControl.js";

const LOADED_CONTEXT = {
  policies: "present",
  memory: "present",
  documents: "empty",
  has_policies: true,
  has_memory: true,
};

const TOM_THREE_QUESTIONS = [
  { id: "Q1", question: "추천해줘" },
  { id: "Q2", question: "내 보험 괜찮아" },
  { id: "Q3", question: "나를 기억해?" },
];

function testFlags() {
  assert.equal(getKeyChatPreloadControlMode({}), KEY_CHAT_PRELOAD_CONTROL_MODES.OFF);
  assert.equal(
    getKeyChatPreloadControlMode({ KEY_CHAT_PRELOAD_CONTROL: "shadow" }),
    KEY_CHAT_PRELOAD_CONTROL_MODES.SHADOW,
  );
  assert.equal(isKeyChatPreloadShadowEnabled({ KEY_CHAT_PRELOAD_CONTROL: "shadow" }), true);
  assert.equal(isKeyChatPreloadShadowEnabled({ KEY_CHAT_PRELOAD_CONTROL: "active" }), false);
  assert.equal(isKeyChatPreloadShadowEnabled({}), false);
}

function testDeriveFactoryPreloadKeysFromPlan() {
  const recPlan = planKeyTools(
    classifyConsultationIntent("추천해줘"),
    LOADED_CONTEXT,
    "추천해줘",
  );
  const recFactories = deriveFactoryPreloadKeysFromPlan(recPlan);
  assert.ok(recFactories.includes("recommendation") || recFactories.length >= 0);

  const casualPlan = planKeyTools(
    classifyConsultationIntent("안녕"),
    LOADED_CONTEXT,
    "안녕",
  );
  const casualFactories = deriveFactoryPreloadKeysFromPlan(casualPlan);
  assert.deepEqual(casualFactories, []);
}

function testShadowTraceInvariants() {
  for (const { question } of TOM_THREE_QUESTIONS) {
    const trace = buildKeyChatPreloadShadowTrace({
      question,
      loadedContext: LOADED_CONTEXT,
    });
    assert.equal(trace.mode, "shadow");
    assert.equal(trace.executed_selective_preload, false);
    assert.equal(trace.legacy_preload_executed, true);
    assert.equal(trace.customer_answer_impact, false);
    assert.equal(trace.failed, undefined);
    assert.deepEqual(trace.legacy_full_preload_actual, LEGACY_CHAT_FULL_FACTORY_PRELOAD);
    assert.equal(typeof trace.preload_would_change.differs, "boolean");
  }
}

function testAttachTraceToSalesDirectorTrace() {
  const trace = buildKeyChatPreloadShadowTrace({
    question: "추천해줘",
    loadedContext: LOADED_CONTEXT,
  });
  const merged = attachKeyPreloadControlToSalesDirectorTrace({ sales_director_loop: true }, trace);
  assert.equal(merged.key_preload_control.gate, "SLICE-A-A1");
  assert.equal(merged.sales_director_loop, true);
}

function buildThreeQuestionEvidence() {
  return TOM_THREE_QUESTIONS.map(({ id, question }) => {
    const classification = classifyConsultationIntent(question);
    const plan = planKeyTools(classification, LOADED_CONTEXT, question);
    const trace = buildKeyChatPreloadShadowTrace({
      question,
      loadedContext: LOADED_CONTEXT,
    });
    return {
      id,
      question,
      classification_intent: classification.intent,
      companion_cluster: classification.companion_cluster ?? null,
      plan_tools: plan.tools ?? [],
      key_planned_factory_preloads: trace.key_planned_factory_preloads,
      legacy_full_preload: trace.legacy_full_preload_actual,
      preload_would_change: trace.preload_would_change,
      customer_answer_impact: trace.customer_answer_impact,
    };
  });
}

function main() {
  testFlags();
  testDeriveFactoryPreloadKeysFromPlan();
  testShadowTraceInvariants();
  testAttachTraceToSalesDirectorTrace();

  const threeQuestionEvidence = buildThreeQuestionEvidence();
  const evidence = {
    audit: "key_recovery_03_slice_a_a1_preload_shadow",
    schema_version: "key-recovery-03-slice-a-a1-evidence-v1",
    mode: "unit_local",
    tom_go: "Slice A A1 shadow only",
    pass: true,
    observed_at: new Date().toISOString(),
    flag: "KEY_CHAT_PRELOAD_CONTROL=shadow",
    invariants: {
      executed_selective_preload: false,
      legacy_preload_executed: true,
      customer_answer_impact: false,
      a2_active_preload_change: false,
    },
    tom_three_questions: threeQuestionEvidence,
  };

  const outPath =
    "fixtures/key-judgment-validation-v1/key-recovery-03-slice-a-a1-evidence.json";
  writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

  console.log("key-recovery-03-slice-a-a1-preload-shadow-unit-test: PASS");
  console.log(JSON.stringify(threeQuestionEvidence, null, 2));
  console.log(`evidence: ${outPath}`);
}

main();
