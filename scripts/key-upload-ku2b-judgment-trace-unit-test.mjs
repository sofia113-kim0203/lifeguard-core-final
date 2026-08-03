/**
 * KU-2b — KEY first judgment trace unit tests (Tom merge gate).
 * Tom A — judgment enabled via KEY_UPLOAD_ENTRY=active only (no separate env).
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
  getKeyUploadEntryMode,
  isKeyUploadActiveAuthorityEnabled,
  isKeyUploadEntryActiveEnabled,
  KEY_UPLOAD_ACTIVE_GATE,
  KEY_UPLOAD_ENTRY_MODES,
} from "../server/keyBrain/uploadEntryFlags.js";

const SAMPLE_DOC = {
  id: "doc-ku2b-1",
  original_filename: "가입증권.pdf",
  ingest_status: "uploaded",
  doc_class: "policy_certificate",
  customer_hint_type: "insurance_policy",
};

function testUnifiedActiveAuthorityFlag() {
  assert.equal(getKeyUploadEntryMode({}), KEY_UPLOAD_ENTRY_MODES.ACTIVE);
  assert.equal(isKeyUploadEntryActiveEnabled({ KEY_UPLOAD_ENTRY: "active" }), true);
  assert.equal(isKeyUploadActiveAuthorityEnabled({ KEY_UPLOAD_ENTRY: "active" }), true);
  assert.equal(isKeyUploadActiveAuthorityEnabled({ KEY_UPLOAD_ENTRY: "shadow" }), false);
  assert.equal(isKeyUploadActiveAuthorityEnabled({ KEY_UPLOAD_ENTRY: "off" }), false);
}

function testActiveAuthorityTraceStep() {
  const active = isKeyUploadEntryActiveEnabled({ KEY_UPLOAD_ENTRY: "active" });
  const trace = buildKeyDocumentIntakeShadowTrace({
    document: SAMPLE_DOC,
    hasAnalysisConsent: true,
    includeFirstJudgment: active,
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
  assert.equal(trace.gate, KEY_UPLOAD_ACTIVE_GATE);
  assert.equal(trace.key_first_judgment?.actor, "KEY");
  assert.equal(trace.customer_speak_changed, false);
}

function testShadowWithoutJudgmentUnchanged() {
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
  base.gate = KEY_UPLOAD_ACTIVE_GATE;
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
  const workOrderIdx = steps.indexOf("work_order_issued");
  const legacyIdx = steps.indexOf("legacy_pipeline_continued");
  assert.ok(judgmentIdx >= 0);
  assert.ok(workOrderIdx > judgmentIdx);
  assert.ok(legacyIdx > workOrderIdx);
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
  testUnifiedActiveAuthorityFlag,
  testActiveAuthorityTraceStep,
  testShadowWithoutJudgmentUnchanged,
  testTomMergeGateJudgmentBeforeLegacy,
  testJudgmentRecordShape,
];
for (const test of tests) test();
console.log(`KU-2b KEY first judgment trace: ${tests.length} tests passed`);
