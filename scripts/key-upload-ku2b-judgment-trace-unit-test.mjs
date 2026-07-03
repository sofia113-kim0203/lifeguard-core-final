/**
 * KU-2b — KEY first judgment trace unit tests (Tom merge gate).
 */
import assert from "node:assert/strict";
import {
  appendLegacyPipelineContinuedTrace,
  buildKeyDocumentIntakeShadowTrace,
} from "../server/keyBrain/documentIntakeShadow.js";
import {
  buildKeyFirstJudgment,
  validateKu2bJudgmentBeforeLegacy,
} from "../server/keyBrain/documentFirstJudgment.js";
import {
  getKeyUploadJudgmentMode,
  isKeyUploadJudgmentEnabled,
  KEY_UPLOAD_JUDGMENT_MODES,
} from "../server/keyBrain/uploadJudgmentFlags.js";

const SAMPLE_DOC = {
  id: "doc-ku2b-1",
  original_filename: "가입증권.pdf",
  ingest_status: "uploaded",
  doc_class: "policy_certificate",
  customer_hint_type: "insurance_policy",
};

function testJudgmentFlag() {
  assert.equal(getKeyUploadJudgmentMode({}), KEY_UPLOAD_JUDGMENT_MODES.OFF);
  assert.equal(isKeyUploadJudgmentEnabled({ KEY_UPLOAD_JUDGMENT: "shadow" }), true);
  assert.equal(isKeyUploadJudgmentEnabled({ KEY_UPLOAD_JUDGMENT: "active" }), true);
}

function testFirstJudgmentTraceStep() {
  const trace = buildKeyDocumentIntakeShadowTrace({
    document: SAMPLE_DOC,
    hasAnalysisConsent: true,
    includeFirstJudgment: true,
  });
  const steps = trace.trace_steps.map((row) => row.step);
  assert.deepEqual(steps, [
    "document_uploaded",
    "key_intake_called",
    "key_reads",
    "key_interprets",
    "key_first_judgment",
    "dispatch_plan_created",
  ]);
  assert.equal(trace.gate, "KU-2b");
  assert.equal(trace.key_first_judgment?.actor, "KEY");
  assert.equal(trace.customer_speak_changed, false);
}

function testWithoutJudgmentUnchanged() {
  const trace = buildKeyDocumentIntakeShadowTrace({
    document: SAMPLE_DOC,
    hasAnalysisConsent: true,
    includeFirstJudgment: false,
  });
  const steps = trace.trace_steps.map((row) => row.step);
  assert.equal(steps.includes("key_first_judgment"), false);
  assert.equal(trace.gate, "KU-1");
  assert.equal(trace.key_first_judgment, null);
}

function testTomMergeGateJudgmentBeforeLegacy() {
  const base = buildKeyDocumentIntakeShadowTrace({
    document: SAMPLE_DOC,
    hasAnalysisConsent: true,
    includeFirstJudgment: true,
  });
  const withWorkOrder = {
    ...base,
    trace_steps: [
      ...base.trace_steps,
      {
        step: "work_order_issued",
        actor: "KEY",
        work_order_id: "kwo_test",
        gate: "KU-2a",
      },
    ],
  };
  const full = appendLegacyPipelineContinuedTrace(withWorkOrder, { ingestStarted: true });
  const gate = validateKu2bJudgmentBeforeLegacy(full.trace_steps);
  assert.equal(gate.ok, true);
  assert.equal(gate.reason, "judgment_before_legacy");

  const steps = full.trace_steps.map((row) => row.step);
  const judgmentIdx = steps.indexOf("key_first_judgment");
  const legacyIdx = steps.indexOf("legacy_pipeline_continued");
  assert.ok(judgmentIdx >= 0);
  assert.ok(legacyIdx >= 0);
  assert.ok(judgmentIdx < legacyIdx);
}

function testJudgmentRecordShape() {
  const record = buildKeyFirstJudgment({
    document: SAMPLE_DOC,
    keyInterprets: {
      document_kind_guess: "insurance_policy",
      judgment_scope: { knowable: ["filename_metadata"], unknowable: ["document_body"], must_not_claim: [] },
      hold: { needed: false },
      orient_speech_planned: { posture: "provisional_metadata" },
    },
  });
  assert.equal(record.schema_version, "key-first-judgment-ku2b-v1");
  assert.equal(record.gate, "KU-2b");
  assert.equal(record.document_kind_guess, "insurance_policy");
  assert.ok(record.recorded_at);
}

const tests = [
  testJudgmentFlag,
  testFirstJudgmentTraceStep,
  testWithoutJudgmentUnchanged,
  testTomMergeGateJudgmentBeforeLegacy,
  testJudgmentRecordShape,
];
for (const test of tests) test();
console.log(`KU-2b KEY first judgment trace: ${tests.length} tests passed`);
