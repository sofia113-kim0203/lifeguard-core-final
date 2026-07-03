/**
 * DU-1 Slice 2 — unit + isolation merge gate.
 */
import assert from "node:assert/strict";
import { buildKeyFirstJudgment } from "../server/keyBrain/documentFirstJudgment.js";
import {
  buildCustomerFirstSentence,
  DU1_SCHEMA_VERSION,
} from "../server/keyBrain/documentFirstSpeak.js";
import {
  assertDu1FourInputsPresent,
  buildDu1InputBundle,
  composeDu1WithEpistemicTrace,
  DU1_EPISTEMIC_TIER,
  DU1_INPUT_SOURCE,
  validateDu1CustomerSpeech,
} from "../server/keyBrain/du1DocumentUploadFirstSpeak.js";

function buildLoadedContext({ policies = false, memory = false, conversation = false } = {}) {
  return {
    profile: "present",
    policies: policies ? "present" : "empty",
    documents: "present",
    memory: memory ? "present" : "empty",
    conversations: { status: conversation ? "present" : "empty" },
  };
}

function buildSnapshot({ policies = [], memoryFacts = [], conversation = { hasHistory: false } } = {}) {
  return {
    context_snapshot_id: "snap-du1-test",
    flags: {
      has_policies: policies.length > 0,
      has_memory: memoryFacts.length > 0,
      has_recent_conversation: conversation.hasHistory === true,
    },
    bundle: { policies, memoryFacts, recentConversation: conversation },
  };
}

function buildJudgment(document, holdNeeded = false) {
  return buildKeyFirstJudgment({
    document,
    keyInterprets: {
      document_kind_guess: document.customer_hint_type ?? "insurance_policy",
      hold: { needed: holdNeeded },
    },
  });
}

function testFourInputsRequireLoadedContext() {
  const withoutLoaded = buildDu1InputBundle({
    document: { id: "d1" },
    contextSnapshot: buildSnapshot(),
  });
  assert.equal(assertDu1FourInputsPresent(withoutLoaded), false);

  const withLoaded = buildDu1InputBundle({
    document: { id: "d1" },
    contextSnapshot: buildSnapshot(),
    loadedContext: buildLoadedContext(),
  });
  assert.equal(assertDu1FourInputsPresent(withLoaded), true);
}

function testEpistemicSegmentsPerSource() {
  const document = {
    id: "doc-du1-s1",
    original_filename: "운전자보험증권.pdf",
    customer_hint_type: "insurance_policy",
  };
  const bundle = buildDu1InputBundle({
    document,
    contextSnapshot: buildSnapshot({
      policies: [{ product_name: "실손의료비보험" }],
      memoryFacts: [{ fact_value: "실손 쪽을 먼저 챙기는 편" }],
      conversation: {
        hasHistory: true,
        latestUserMessages: ["운전자보험도 필요한지 궁금해요"],
      },
    }),
    loadedContext: buildLoadedContext({ policies: true, memory: true, conversation: true }),
    keyFirstJudgment: buildJudgment(document),
  });
  const { segments, text } = composeDu1WithEpistemicTrace(bundle);

  assert.ok(segments.some((s) => s.source === DU1_INPUT_SOURCE.DOCUMENT));
  assert.ok(segments.some((s) => s.source === DU1_INPUT_SOURCE.POLICIES));
  assert.ok(segments.some((s) => s.source === DU1_INPUT_SOURCE.MEMORY));
  assert.ok(segments.some((s) => s.source === DU1_INPUT_SOURCE.CONVERSATION));
  assert.ok(segments.every((s) => Object.values(DU1_EPISTEMIC_TIER).includes(s.tier)));
  assert.equal(validateDu1CustomerSpeech(text).ok, true);
  assert.doesNotMatch(text, /것\s*같습니다/);
}

function testMemoryNeverRegisteredPolicyWording() {
  const document = {
    id: "doc-mem",
    original_filename: "운전자보험.pdf",
    customer_hint_type: "insurance_policy",
  };
  const bundle = buildDu1InputBundle({
    document,
    contextSnapshot: buildSnapshot({
      policies: [],
      memoryFacts: [{ fact_value: "실손 쪽을 먼저 챙기는 편" }],
    }),
    loadedContext: buildLoadedContext({ memory: true }),
    keyFirstJudgment: buildJudgment(document),
  });
  const { text, segments } = composeDu1WithEpistemicTrace(bundle);
  assert.doesNotMatch(text, /프로필에\s*등록|등록된\s*실손/);
  assert.ok(segments.some((s) => s.source === DU1_INPUT_SOURCE.MEMORY));
  assert.equal(segments.some((s) => s.source === DU1_INPUT_SOURCE.POLICIES), false);
}

function testConversationAbsentWhenEmpty() {
  const document = {
    id: "doc-conv",
    original_filename: "운전자보험.pdf",
    customer_hint_type: "insurance_policy",
  };
  const bundle = buildDu1InputBundle({
    document,
    contextSnapshot: buildSnapshot({ conversation: { hasHistory: false, latestUserMessages: [] } }),
    loadedContext: buildLoadedContext(),
    keyFirstJudgment: buildJudgment(document),
  });
  const { segments } = composeDu1WithEpistemicTrace(bundle);
  assert.equal(segments.some((s) => s.source === DU1_INPUT_SOURCE.CONVERSATION), false);
}

function testCustomerFirstSentenceRequiresLoadedContext() {
  const document = {
    id: "doc-intake",
    original_filename: "운전자보험.pdf",
    customer_hint_type: "insurance_policy",
  };
  const judgment = buildJudgment(document);
  const withoutLoaded = buildCustomerFirstSentence(judgment, {
    document,
    contextSnapshot: buildSnapshot(),
  });
  assert.match(withoutLoaded, /KEY/);

  const withLoaded = buildCustomerFirstSentence(judgment, {
    document,
    contextSnapshot: buildSnapshot({
      policies: [{ product_name: "실손의료비" }],
    }),
    loadedContext: buildLoadedContext({ policies: true }),
  });
  assert.match(withLoaded, /프로필에.*축 보험이 등록/);
  assert.doesNotMatch(withLoaded, /것\s*같습니다/);
}

function testSchemaVersion() {
  assert.equal(DU1_SCHEMA_VERSION, "du-1-document-upload-first-speak-v2");
}

function testConsentHoldOnlyWhenAnalysisConsentMissing() {
  const document = {
    id: "doc-consent-gate",
    original_filename: "운전자보험.pdf",
    customer_hint_type: "insurance_policy",
  };
  const snapshot = buildSnapshot({ policies: [{ product_name: "실손의료비" }] });
  const loadedContext = buildLoadedContext({ policies: true });

  const withConsent = buildDu1InputBundle({
    document,
    contextSnapshot: snapshot,
    loadedContext,
    keyFirstJudgment: {
      hold: { needed: true },
      orient_speech_planned: { posture: "provisional_metadata" },
      judgment_scope: { unknowable: ["document_body_before_key_read"] },
    },
  });
  const fused = composeDu1WithEpistemicTrace(withConsent);
  assert.match(fused.text, /프로필에.*축 보험이 등록/);
  assert.doesNotMatch(fused.text, /동의 후 KEY가 진행/);

  const withoutConsent = buildDu1InputBundle({
    document,
    contextSnapshot: snapshot,
    loadedContext,
    keyFirstJudgment: {
      hold: { needed: true },
      orient_speech_planned: { posture: "hold_consent" },
      judgment_scope: { unknowable: ["document_body"] },
    },
  });
  const held = composeDu1WithEpistemicTrace(withoutConsent);
  assert.match(held.text, /동의 후 KEY가 진행/);
}

const tests = [
  testFourInputsRequireLoadedContext,
  testEpistemicSegmentsPerSource,
  testMemoryNeverRegisteredPolicyWording,
  testConversationAbsentWhenEmpty,
  testCustomerFirstSentenceRequiresLoadedContext,
  testConsentHoldOnlyWhenAnalysisConsentMissing,
  testSchemaVersion,
];

for (const test of tests) test();
console.log(`DU-1 Slice 2 unit: ${tests.length} tests passed`);
