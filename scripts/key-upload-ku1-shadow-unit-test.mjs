/**
 * KU-1 — KEY document intake shadow unit tests (no network).
 */
import assert from "node:assert/strict";
import {
  appendLegacyPipelineContinuedTrace,
  buildKeyDocumentIntakeShadowTrace,
} from "../server/keyBrain/documentIntakeShadow.js";
import {
  getKeyUploadEntryMode,
  isKeyUploadEntryShadowEnabled,
  KEY_UPLOAD_ENTRY_MODES,
} from "../server/keyBrain/uploadEntryFlags.js";

const SAMPLE_DOC = {
  id: "doc-ku1-1",
  original_filename: "가입증권.pdf",
  ingest_status: "uploaded",
  doc_class: "policy_certificate",
  customer_hint_type: "insurance_policy",
};

function testShadowFlag() {
  assert.equal(getKeyUploadEntryMode({}), KEY_UPLOAD_ENTRY_MODES.OFF);
  assert.equal(isKeyUploadEntryShadowEnabled({ KEY_UPLOAD_ENTRY: "shadow" }), true);
}

function testTraceChain() {
  const trace = buildKeyDocumentIntakeShadowTrace({
    document: SAMPLE_DOC,
    hasAnalysisConsent: true,
    uploadSource: "web",
    categoryKey: "insurance_policy",
  });
  const steps = trace.trace_steps.map((row) => row.step);
  assert.deepEqual(steps, [
    "document_uploaded",
    "key_intake_called",
    "key_reads",
    "key_interprets",
    "dispatch_plan_created",
  ]);
  assert.equal(trace.subject, "KEY");
  assert.equal(trace.key_reads.actor, "KEY");
  assert.equal(trace.factory_executed, false);
  assert.equal(trace.customer_speak_changed, false);
}

function testLegacyAppended() {
  const base = buildKeyDocumentIntakeShadowTrace({ document: SAMPLE_DOC, hasAnalysisConsent: false });
  const full = appendLegacyPipelineContinuedTrace(base, { ingestStarted: true });
  assert.equal(full.trace_steps.at(-1)?.step, "legacy_pipeline_continued");
  assert.equal(full.legacy_pipeline_continued?.ingest_enqueue_started, true);
}

function testConsentHoldDispatch() {
  const trace = buildKeyDocumentIntakeShadowTrace({
    document: SAMPLE_DOC,
    hasAnalysisConsent: false,
  });
  assert.equal(trace.dispatch_plan.factory_work_orders.length, 0);
  assert.equal(trace.dispatch_plan.hold_reason, "analysis_consent_missing");
}

const tests = [testShadowFlag, testTraceChain, testLegacyAppended, testConsentHoldDispatch];
for (const test of tests) test();
console.log(`KU-1 KEY upload intake shadow: ${tests.length} tests passed`);
