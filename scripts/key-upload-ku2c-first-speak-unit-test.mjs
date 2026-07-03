/**
 * KU-2c — KEY first speak unit tests (Tom EXEC gate).
 */
import assert from "node:assert/strict";
import { buildKeyFirstJudgment } from "../server/keyBrain/documentFirstJudgment.js";
import {
  appendKeyFirstSpeakTrace,
  buildCustomerFirstSentence,
  validateKu2cSpeakOrder,
} from "../server/keyBrain/documentFirstSpeak.js";
import { validateKu2bJudgmentBeforeLegacy } from "../server/keyBrain/documentFirstJudgment.js";
import {
  appendLegacyPipelineContinuedTrace,
  buildKeyDocumentIntakeShadowTrace,
} from "../server/keyBrain/documentIntakeShadow.js";

const SAMPLE_DOC = {
  id: "doc-ku2c-1",
  original_filename: "가입증권.pdf",
  ingest_status: "uploaded",
  customer_hint_type: "insurance_policy",
};

function testCustomerFirstSentenceFromJudgment() {
  const judgment = buildKeyFirstJudgment({
    document: SAMPLE_DOC,
    keyInterprets: {
      document_kind_guess: "insurance_policy",
      hold: { needed: false },
    },
  });
  const sentence = buildCustomerFirstSentence(judgment, { document: SAMPLE_DOC });
  assert.ok(sentence);
  assert.match(sentence, /KEY/);
  assert.doesNotMatch(sentence, /Gap|담보|추천/i);
}

function testConsentHoldSentence() {
  const judgment = buildKeyFirstJudgment({
    document: SAMPLE_DOC,
    keyInterprets: {
      document_kind_guess: "unknown",
      hold: { needed: true },
    },
  });
  const sentence = buildCustomerFirstSentence(judgment, { document: SAMPLE_DOC });
  assert.match(sentence, /동의/);
}

function testSpeakTraceOrder() {
  const base = buildKeyDocumentIntakeShadowTrace({
    document: SAMPLE_DOC,
    hasAnalysisConsent: true,
    includeFirstJudgment: true,
  });
  const judgment = base.key_first_judgment;
  const sentence = buildCustomerFirstSentence(judgment, { document: SAMPLE_DOC });
  const withSpeak = appendKeyFirstSpeakTrace(base, sentence);
  const withWorkOrder = {
    ...withSpeak,
    trace_steps: [
      ...withSpeak.trace_steps,
      { step: "work_order_issued", actor: "KEY", work_order_id: "kwo_test" },
    ],
  };
  const full = appendLegacyPipelineContinuedTrace(withWorkOrder, { ingestStarted: true });

  const ku2c = validateKu2cSpeakOrder(full.trace_steps);
  assert.equal(ku2c.ok, true);

  const ku2b = validateKu2bJudgmentBeforeLegacy(full.trace_steps);
  assert.equal(ku2b.ok, true);

  assert.equal(withSpeak.customer_speak_changed, true);
  assert.equal(withSpeak.customer_first_sentence, sentence);
}

function testSpeakAbsentWhenNoJudgment() {
  const trace = buildKeyDocumentIntakeShadowTrace({
    document: SAMPLE_DOC,
    hasAnalysisConsent: true,
    includeFirstJudgment: false,
  });
  const updated = appendKeyFirstSpeakTrace(trace, null);
  assert.equal(updated.customer_first_sentence, undefined);
  assert.equal(updated.customer_speak_changed, false);
}

const tests = [
  testCustomerFirstSentenceFromJudgment,
  testConsentHoldSentence,
  testSpeakTraceOrder,
  testSpeakAbsentWhenNoJudgment,
];
for (const test of tests) test();
console.log(`KU-2c KEY first speak: ${tests.length} tests passed`);
