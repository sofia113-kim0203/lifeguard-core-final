/**
 * KEY-RECOVERY-03 Slice A A2 — active selective preload + F8 legacy backfill (no network).
 */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { classifyConsultationIntent } from "../server/intentGateLayer.js";
import { planKeyTools } from "../server/salesDirectorKeyToolRegistry.js";
import {
  attachF8LegacyBackfillToTrace,
  backfillMissingLegacyFactoryPreloads,
  buildKeyChatPreloadActiveFallbackTrace,
  buildKeyChatPreloadActiveTrace,
  buildKeyPreloadPlanBundle,
  deriveFactoryPreloadKeysFromPlan,
  executeSelectiveFactoryPreloads,
  getKeyChatPreloadControlMode,
  getMissingFactoryPreloadKeys,
  isKeyChatPreloadActiveEnabled,
  KEY_CHAT_PRELOAD_CONTROL_MODES,
  LEGACY_CHAT_FULL_FACTORY_PRELOAD,
  shouldExecuteSelectivePreload,
} from "../server/keyBrain/chatPreloadControl.js";

const LOADED_CONTEXT = {
  policies: "present",
  memory: "present",
  documents: "empty",
  has_policies: true,
  has_memory: true,
};

const TOM_THREE_QUESTIONS = [
  { id: "Q1", question: "추천해줘", expectedPreloads: ["recommendation"] },
  { id: "Q2", question: "내 보험 괜찮아", expectedPreloads: ["coverage_gap"] },
  { id: "Q3", question: "나를 기억해?", expectedPreloads: [] },
];

function mockLoader(loads = {}) {
  const calls = [];
  const loadFactoryPreload = async (factoryKey) => {
    calls.push(factoryKey);
    return loads[factoryKey] ?? { factory: factoryKey, loaded: true };
  };
  return { loadFactoryPreload, calls };
}

function testActiveFlag() {
  assert.equal(
    getKeyChatPreloadControlMode({ KEY_CHAT_PRELOAD_CONTROL: "active" }),
    KEY_CHAT_PRELOAD_CONTROL_MODES.ACTIVE,
  );
  assert.equal(isKeyChatPreloadActiveEnabled({ KEY_CHAT_PRELOAD_CONTROL: "active" }), true);
  assert.equal(
    shouldExecuteSelectivePreload({
      preloadControlMode: KEY_CHAT_PRELOAD_CONTROL_MODES.ACTIVE,
      keyOrchestratorEligible: true,
    }),
    true,
  );
  assert.equal(
    shouldExecuteSelectivePreload({
      preloadControlMode: KEY_CHAT_PRELOAD_CONTROL_MODES.ACTIVE,
      keyOrchestratorEligible: false,
    }),
    false,
  );
}

async function testTomThreeQuestionsActiveExecute() {
  for (const { id, question, expectedPreloads } of TOM_THREE_QUESTIONS) {
    const planBundle = buildKeyPreloadPlanBundle({
      question,
      loadedContext: LOADED_CONTEXT,
    });
    const { loadFactoryPreload, calls } = mockLoader();
    const selectiveResult = await executeSelectiveFactoryPreloads({
      factoryKeys: planBundle.keyPlannedFactoryPreloads,
      loadFactoryPreload,
    });
    const trace = buildKeyChatPreloadActiveTrace({ planBundle, selectiveResult });

    assert.equal(trace.mode, "active", `${id} mode`);
    assert.equal(trace.executed_selective_preload, true, `${id} executed_selective_preload`);
    assert.equal(trace.legacy_preload_executed, false, `${id} legacy_preload_executed`);
    assert.deepEqual(trace.preloads_executed, expectedPreloads, `${id} preloads_executed`);
    assert.deepEqual(calls, expectedPreloads, `${id} loader calls`);
    assert.deepEqual(
      trace.preloads_skipped,
      LEGACY_CHAT_FULL_FACTORY_PRELOAD.filter((key) => !expectedPreloads.includes(key)),
      `${id} preloads_skipped`,
    );
    assert.deepEqual(
      deriveFactoryPreloadKeysFromPlan(planKeyTools(classifyConsultationIntent(question), LOADED_CONTEXT, question)),
      expectedPreloads,
      `${id} plan parity`,
    );
  }
}

function testActiveIneligibleFallbackTrace() {
  const trace = buildKeyChatPreloadActiveFallbackTrace({
    planBundle: buildKeyPreloadPlanBundle({ question: "추천해줘", loadedContext: LOADED_CONTEXT }),
    fallbackReason: "orchestrator_ineligible",
  });
  assert.equal(trace.mode, "active");
  assert.equal(trace.executed_selective_preload, false);
  assert.equal(trace.legacy_preload_executed, true);
  assert.equal(trace.fallback_reason, "orchestrator_ineligible");
}

async function testF8LegacyFallbackBackfill() {
  const partialContexts = {
    coverageGapContext: null,
    underwritingRiskContext: null,
    recommendationContext: { factory: "recommendation", loaded: true },
    designContext: null,
  };

  assert.deepEqual(getMissingFactoryPreloadKeys(partialContexts), [
    "coverage_gap",
    "underwriting",
    "design",
  ]);

  const { loadFactoryPreload, calls } = mockLoader();
  const backfill = await backfillMissingLegacyFactoryPreloads({
    contexts: partialContexts,
    loadFactoryPreload,
  });

  assert.equal(backfill.f8_backfill_executed, true);
  assert.equal(backfill.f8_backfill_full, false);
  assert.deepEqual(backfill.backfilled, ["coverage_gap", "underwriting", "design"]);
  assert.deepEqual(calls, ["coverage_gap", "underwriting", "design"]);
  assert.ok(backfill.contexts.recommendationContext);
  assert.ok(backfill.contexts.coverageGapContext);
  assert.ok(backfill.contexts.underwritingRiskContext);
  assert.ok(backfill.contexts.designContext);

  const activeTrace = buildKeyChatPreloadActiveTrace({
    planBundle: buildKeyPreloadPlanBundle({ question: "추천해줘", loadedContext: LOADED_CONTEXT }),
    selectiveResult: {
      preloads_executed: ["recommendation"],
      preloads_skipped: ["coverage_gap", "underwriting", "design"],
      contexts: partialContexts,
    },
  });
  const mergedTrace = attachF8LegacyBackfillToTrace(activeTrace, backfill);
  assert.equal(mergedTrace.f8_legacy_fallback_backfill.executed, true);
  assert.equal(mergedTrace.legacy_preload_executed, true);
  assert.deepEqual(mergedTrace.f8_legacy_fallback_backfill.backfilled, [
    "coverage_gap",
    "underwriting",
    "design",
  ]);
}

async function testF8FullBackfillFromEmptySelective() {
  const { loadFactoryPreload, calls } = mockLoader();
  const backfill = await backfillMissingLegacyFactoryPreloads({
    contexts: {
      coverageGapContext: null,
      underwritingRiskContext: null,
      recommendationContext: null,
      designContext: null,
    },
    loadFactoryPreload,
  });

  assert.equal(backfill.f8_backfill_executed, true);
  assert.equal(backfill.f8_backfill_full, true);
  assert.deepEqual(backfill.backfilled, LEGACY_CHAT_FULL_FACTORY_PRELOAD);
  assert.deepEqual(calls, LEGACY_CHAT_FULL_FACTORY_PRELOAD);
}

function buildThreeQuestionActiveEvidence() {
  return TOM_THREE_QUESTIONS.map(({ id, question, expectedPreloads }) => {
    const planBundle = buildKeyPreloadPlanBundle({ question, loadedContext: LOADED_CONTEXT });
    return {
      id,
      question,
      classification_intent: planBundle.classification.intent,
      companion_cluster: planBundle.classification.companion_cluster ?? null,
      plan_tools: planBundle.plan.tools ?? [],
      key_planned_factory_preloads: planBundle.keyPlannedFactoryPreloads,
      active_preloads_executed: expectedPreloads,
      active_preloads_skipped: LEGACY_CHAT_FULL_FACTORY_PRELOAD.filter(
        (key) => !expectedPreloads.includes(key),
      ),
    };
  });
}

async function main() {
  testActiveFlag();
  await testTomThreeQuestionsActiveExecute();
  testActiveIneligibleFallbackTrace();
  await testF8LegacyFallbackBackfill();
  await testF8FullBackfillFromEmptySelective();

  const evidence = {
    audit: "key_recovery_03_slice_a_a2_preload_active",
    schema_version: "key-recovery-03-slice-a-a2-evidence-v1",
    mode: "unit_local",
    tom_go: "Slice A A2 active selective preload + F8 legacy backfill",
    pass: true,
    observed_at: new Date().toISOString(),
    flag: "KEY_CHAT_PRELOAD_CONTROL=active",
    invariants: {
      executed_selective_preload_when_eligible: true,
      legacy_preload_when_ineligible: true,
      f8_backfill_on_legacy_fallback: true,
      compose_changed: false,
      work_order_changed: false,
    },
    tom_three_questions: buildThreeQuestionActiveEvidence(),
    f8_test: {
      scenario: "active selective recommendation only → KEY fail → legacy fallback → backfill gap/uw/design",
      backfill_executed: true,
    },
  };

  const outPath =
    "fixtures/key-judgment-validation-v1/key-recovery-03-slice-a-a2-evidence.json";
  writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

  console.log("key-recovery-03-slice-a-a2-preload-active-unit-test: PASS");
  console.log(JSON.stringify(evidence.tom_three_questions, null, 2));
  console.log(`evidence: ${outPath}`);
}

await main();
