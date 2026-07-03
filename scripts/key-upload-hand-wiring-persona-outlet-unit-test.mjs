/**
 * Hand Wiring Phase 3 — Upload first sentence Persona outlet unit tests (Tom EXEC gate).
 */
import assert from "node:assert/strict";
import { buildKeyFirstJudgment } from "../server/keyBrain/documentFirstJudgment.js";
import {
  appendKeyFirstSpeakTrace,
  buildCustomerFirstSentence,
  DOCUMENT_INTAKE_PERSONA_OUTLET,
  finalizeDocumentIntakeFirstSentence,
} from "../server/keyBrain/documentFirstSpeak.js";

const SAMPLE_DOC = {
  id: "doc-persona-p3-1",
  original_filename: "가입증권.pdf",
  ingest_status: "uploaded",
  customer_hint_type: "insurance_policy",
};

function testFinalizeUsesPersonaOutlet() {
  const judgment = buildKeyFirstJudgment({
    document: SAMPLE_DOC,
    keyInterprets: {
      document_kind_guess: "insurance_policy",
      hold: { needed: false },
    },
  });
  const draft = buildCustomerFirstSentence(judgment, { document: SAMPLE_DOC });
  const finalized = finalizeDocumentIntakeFirstSentence(draft, {
    keyTurnResult: { agentTurn: { factBundle: { document_id: SAMPLE_DOC.id } } },
    document: SAMPLE_DOC,
  });

  assert.ok(finalized?.text);
  assert.equal(finalized.persona_outlet, DOCUMENT_INTAKE_PERSONA_OUTLET);
  assert.equal(finalized.generation_mode, "document_intake_persona_outlet");
  assert.equal(finalized.static_draft, draft);
  assert.match(finalized.text, /KEY/);
  assert.doesNotMatch(finalized.text, /Gap|담보|추천/i);
}

function testSpeakTraceCarriesPersonaMeta() {
  const judgment = buildKeyFirstJudgment({
    document: SAMPLE_DOC,
    keyInterprets: {
      document_kind_guess: "insurance_policy",
      hold: { needed: false },
    },
  });
  const draft = buildCustomerFirstSentence(judgment, { document: SAMPLE_DOC });
  const finalized = finalizeDocumentIntakeFirstSentence(draft, { document: SAMPLE_DOC });
  const trace = appendKeyFirstSpeakTrace({ trace_steps: [] }, finalized.text, finalized);
  const speakStep = trace.trace_steps.find((row) => row.step === "key_first_speak");

  assert.equal(speakStep?.payload?.persona_outlet, DOCUMENT_INTAKE_PERSONA_OUTLET);
  assert.equal(speakStep?.payload?.generation_mode, "document_intake_persona_outlet");
  assert.equal(speakStep?.payload?.static_draft, draft);
  assert.equal(trace.persona_outlet, DOCUMENT_INTAKE_PERSONA_OUTLET);
}

function testFinalTextNotBareStaticBypass() {
  const judgment = buildKeyFirstJudgment({
    document: SAMPLE_DOC,
    keyInterprets: {
      document_kind_guess: "insurance_policy",
      hold: { needed: false },
    },
  });
  const draft = buildCustomerFirstSentence(judgment, { document: SAMPLE_DOC });
  const finalized = finalizeDocumentIntakeFirstSentence(draft, { document: SAMPLE_DOC });

  assert.notEqual(finalized, null);
  assert.ok(finalized.key_compose_trace?.called === true);
  assert.equal(finalized.key_compose_trace?.compose_mode, "document_intake_persona_outlet");
}

const tests = [
  testFinalizeUsesPersonaOutlet,
  testSpeakTraceCarriesPersonaMeta,
  testFinalTextNotBareStaticBypass,
];
for (const test of tests) test();
console.log(`Hand Wiring Phase 3 Persona outlet: ${tests.length} tests passed`);
