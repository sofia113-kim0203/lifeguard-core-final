/**
 * Hand Wiring Phase 1 — snapshot wiring unit tests (Tom EXEC GO).
 */
import assert from "node:assert/strict";
import { buildLoadedContextFromSnapshot } from "../server/customerContextSnapshot.js";
import {
  buildKeyDocumentIntakeShadowTrace,
  buildKeyContextLoadedStep,
} from "../server/keyBrain/documentIntakeShadow.js";
import { validateKu2bJudgmentBeforeLegacy } from "../server/keyBrain/documentFirstJudgment.js";
import { KEY_UPLOAD_ACTIVE_GATE } from "../server/keyBrain/uploadEntryFlags.js";

const SAMPLE_DOC = {
  id: "doc-hand-p1-1",
  original_filename: "가입증권.pdf",
  ingest_status: "uploaded",
  customer_hint_type: "insurance_policy",
};

const MOCK_SNAPSHOT = {
  context_snapshot_id: "snap-hand-p1-test",
  memory: { status: "present" },
  policies: { status: "present" },
  documents: { status: "present" },
  flags: {
    has_policies: true,
    has_memory: true,
    has_recent_conversation: true,
    has_documents: true,
  },
};

function testContextLoadedStepShape() {
  const loadedContext = buildLoadedContextFromSnapshot(MOCK_SNAPSHOT);
  const step = buildKeyContextLoadedStep({
    contextSnapshot: MOCK_SNAPSHOT,
    loadedContext,
    fromCache: false,
  });
  assert.equal(step.step, "key_context_loaded");
  assert.equal(step.payload.context_snapshot_id, "snap-hand-p1-test");
  assert.equal(step.payload.loader, "loadSalesDirectorTurnContext");
  assert.equal(step.payload.has_memory, true);
  assert.equal(step.payload.has_policies, true);
  assert.equal(step.payload.memory_status, "present");
}

function testTraceInsertsContextAfterReads() {
  const loadedContext = buildLoadedContextFromSnapshot(MOCK_SNAPSHOT);
  const trace = buildKeyDocumentIntakeShadowTrace({
    document: SAMPLE_DOC,
    hasAnalysisConsent: true,
    includeFirstJudgment: true,
    loadedContext,
    contextSnapshot: MOCK_SNAPSHOT,
  });
  const steps = trace.trace_steps.map((row) => row.step);
  assert.deepEqual(steps, [
    "document_uploaded",
    "key_intake_called",
    "key_reads",
    "key_context_loaded",
    "key_interprets",
    "key_first_judgment",
    "dispatch_plan_created",
  ]);
  assert.equal(trace.context_snapshot_id, "snap-hand-p1-test");
  assert.equal(trace.key_context_loaded?.has_memory, true);
}

function testInterpretKnowableIncludesSnapshotFlags() {
  const loadedContext = buildLoadedContextFromSnapshot(MOCK_SNAPSHOT);
  const trace = buildKeyDocumentIntakeShadowTrace({
    document: SAMPLE_DOC,
    hasAnalysisConsent: true,
    loadedContext,
    contextSnapshot: MOCK_SNAPSHOT,
  });
  const knowable = trace.key_interprets.judgment_scope.knowable;
  assert.ok(knowable.includes("has_policies"));
  assert.ok(knowable.includes("has_memory"));
  assert.ok(knowable.includes("has_recent_conversation"));
  assert.ok(knowable.includes("registered_document_inventory"));
}

function testJudgmentCarriesContextStatus() {
  const loadedContext = buildLoadedContextFromSnapshot(MOCK_SNAPSHOT);
  const trace = buildKeyDocumentIntakeShadowTrace({
    document: SAMPLE_DOC,
    hasAnalysisConsent: true,
    includeFirstJudgment: true,
    loadedContext,
    contextSnapshot: MOCK_SNAPSHOT,
  });
  assert.equal(trace.key_first_judgment.context_snapshot_id, "snap-hand-p1-test");
  assert.equal(trace.key_first_judgment.customer_context_status.memory, "present");
  assert.equal(trace.key_first_judgment.customer_context_status.policies, "present");
}

function testKu2bOrderPreservedWithContextStep() {
  const loadedContext = buildLoadedContextFromSnapshot(MOCK_SNAPSHOT);
  const trace = buildKeyDocumentIntakeShadowTrace({
    document: SAMPLE_DOC,
    hasAnalysisConsent: true,
    includeFirstJudgment: true,
    loadedContext,
    contextSnapshot: MOCK_SNAPSHOT,
  });
  trace.gate = KEY_UPLOAD_ACTIVE_GATE;
  const withLegacy = {
    ...trace,
    trace_steps: [
      ...trace.trace_steps,
      { step: "work_order_issued", actor: "KEY", work_order_id: "kwo_hand_p1" },
      { step: "legacy_pipeline_continued", at: "test" },
    ],
  };
  const gate = validateKu2bJudgmentBeforeLegacy(withLegacy.trace_steps);
  assert.equal(gate.ok, true);
}

function testWithoutSnapshotOmitsContextStep() {
  const trace = buildKeyDocumentIntakeShadowTrace({
    document: SAMPLE_DOC,
    hasAnalysisConsent: true,
    includeFirstJudgment: false,
  });
  const steps = trace.trace_steps.map((row) => row.step);
  assert.equal(steps.includes("key_context_loaded"), false);
  assert.equal(trace.context_snapshot_id, null);
}

const tests = [
  testContextLoadedStepShape,
  testTraceInsertsContextAfterReads,
  testInterpretKnowableIncludesSnapshotFlags,
  testJudgmentCarriesContextStatus,
  testKu2bOrderPreservedWithContextStep,
  testWithoutSnapshotOmitsContextStep,
];
for (const test of tests) test();
console.log(`Hand Wiring Phase 1 snapshot: ${tests.length} tests passed`);
