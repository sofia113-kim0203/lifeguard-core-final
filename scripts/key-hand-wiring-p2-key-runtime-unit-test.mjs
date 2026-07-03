/**
 * Hand Wiring Phase 2 — KEY Runtime SSOT unit tests (Tom EXEC gate).
 */
import assert from "node:assert/strict";
import { buildLoadedContextFromSnapshot } from "../server/customerContextSnapshot.js";
import {
  buildKeyDocumentIntakeShadowTrace,
  buildKeyRuntimeEnteredStep,
} from "../server/keyBrain/documentIntakeShadow.js";
import { planKeyTools } from "../server/salesDirectorKeyToolRegistry.js";
import {
  DOCUMENT_INTAKE_CONSULTATION_INTENT,
  KEY_ENTRY,
  KEY_RUNTIME_SSOT,
} from "../server/salesDirectorKeyOrchestrator.js";
import { validateKu2bJudgmentBeforeLegacy } from "../server/keyBrain/documentFirstJudgment.js";

const SAMPLE_DOC = {
  id: "doc-hand-p2-1",
  original_filename: "가입증권.pdf",
  ingest_status: "uploaded",
  customer_hint_type: "insurance_policy",
};

const MOCK_SNAPSHOT = {
  context_snapshot_id: "snap-hand-p2-test",
  memory: { status: "present" },
  policies: { status: "present" },
  flags: { has_policies: true, has_memory: true, has_recent_conversation: false },
};

function testRuntimeSsotConstant() {
  assert.equal(KEY_RUNTIME_SSOT, "runSalesDirectorKeyTurn");
  assert.equal(KEY_ENTRY.DOCUMENT_INTAKE, "document_intake");
}

function testRuntimeEnteredStep() {
  const step = buildKeyRuntimeEnteredStep({ keyEntry: KEY_ENTRY.DOCUMENT_INTAKE });
  assert.equal(step.step, "key_runtime_entered");
  assert.equal(step.payload.primitive, "runSalesDirectorKeyTurn");
  assert.equal(step.payload.key_entry, "document_intake");
  assert.equal(step.payload.runtime_ssot, true);
}

function testDocumentIntakeToolPlan() {
  const plan = planKeyTools(
    DOCUMENT_INTAKE_CONSULTATION_INTENT,
    { memory: "present", policies: "present" },
    "",
  );
  assert.equal(plan.intent, "document_intake");
  assert.equal(plan.document_intake, true);
  assert.equal(plan.coverage_gap_suppressed, true);
  assert.ok(plan.tools.includes("snapshot"));
  assert.ok(plan.tools.includes("memory"));
  assert.equal(plan.tools.includes("coverage_gap"), false);
  assert.equal(plan.tools.includes("recommendation"), false);
}

function testTraceOrderWithKeyRuntime() {
  const loadedContext = buildLoadedContextFromSnapshot(MOCK_SNAPSHOT);
  const trace = buildKeyDocumentIntakeShadowTrace({
    document: SAMPLE_DOC,
    hasAnalysisConsent: true,
    includeFirstJudgment: true,
    loadedContext,
    contextSnapshot: MOCK_SNAPSHOT,
    keyRuntimeEntered: true,
    keyEntry: KEY_ENTRY.DOCUMENT_INTAKE,
  });
  const steps = trace.trace_steps.map((row) => row.step);
  assert.deepEqual(steps, [
    "document_uploaded",
    "key_intake_called",
    "key_reads",
    "key_context_loaded",
    "key_runtime_entered",
    "key_interprets",
    "key_first_judgment",
    "dispatch_plan_created",
  ]);
  assert.equal(trace.key_runtime_entered?.primitive, "runSalesDirectorKeyTurn");
}

function testKu2bOrderWithRuntimeStep() {
  const loadedContext = buildLoadedContextFromSnapshot(MOCK_SNAPSHOT);
  const trace = buildKeyDocumentIntakeShadowTrace({
    document: SAMPLE_DOC,
    hasAnalysisConsent: true,
    includeFirstJudgment: true,
    loadedContext,
    contextSnapshot: MOCK_SNAPSHOT,
    keyRuntimeEntered: true,
    keyEntry: KEY_ENTRY.DOCUMENT_INTAKE,
  });
  const withLegacy = {
    ...trace,
    trace_steps: [
      ...trace.trace_steps,
      { step: "work_order_issued", actor: "KEY" },
      { step: "legacy_pipeline_continued", at: "test" },
    ],
  };
  const gate = validateKu2bJudgmentBeforeLegacy(withLegacy.trace_steps);
  assert.equal(gate.ok, true);
  const runtimeIdx = withLegacy.trace_steps.findIndex((row) => row.step === "key_runtime_entered");
  const judgmentIdx = withLegacy.trace_steps.findIndex((row) => row.step === "key_first_judgment");
  assert.ok(runtimeIdx >= 0);
  assert.ok(runtimeIdx < judgmentIdx);
}

const tests = [
  testRuntimeSsotConstant,
  testRuntimeEnteredStep,
  testDocumentIntakeToolPlan,
  testTraceOrderWithKeyRuntime,
  testKu2bOrderWithRuntimeStep,
];
for (const test of tests) test();
console.log(`Hand Wiring Phase 2 KEY Runtime: ${tests.length} tests passed`);
