/**
 * DU-1 Slice 2 — 4-input isolation merge gate (Tom EXEC).
 * Each input OFF must produce different output vs its ON baseline.
 */
import assert from "node:assert/strict";
import {
  buildDu1InputBundle,
  composeDu1WithEpistemicTrace,
  validateDu1CustomerSpeech,
  validateDu1EpistemicSegments,
} from "../server/keyBrain/du1DocumentUploadFirstSpeak.js";

const DRIVER_DOC = {
  id: "iso-doc",
  original_filename: "운전자보험증권.pdf",
  customer_hint_type: "insurance_policy",
  metadata_json: { category_key: "insurance_policy" },
};

const GENERIC_DOC = {
  id: "iso-doc-generic",
  original_filename: "scan001.pdf",
  customer_hint_type: "insurance_policy",
};

const POLICIES = [
  { product_name: "실손의료비보험", policy_type: "medical_expense" },
  { product_name: "건강종합보험", policy_type: "health" },
];

const MEMORY = [{ fact_value: "실손 쪽을 먼저 챙기는 편" }];

const CONVERSATION = {
  hasHistory: true,
  latestUserMessages: ["운전자보험도 필요한지 궁금해요"],
  latestUserMessageExcerpt: "운전자보험도 필요한지 궁금해요",
};

function buildLoadedContext({ policies = false, memory = false, conversation = false } = {}) {
  return {
    profile: "present",
    policies: policies ? "present" : "empty",
    documents: "present",
    memory: memory ? "present" : "empty",
    conversations: {
      status: conversation ? "present" : "empty",
      source: conversation ? ["request_history"] : [],
    },
  };
}

function buildSnapshot({ policies = [], memoryFacts = [], conversation = { hasHistory: false } } = {}) {
  return {
    bundle: { policies, memoryFacts, recentConversation: conversation },
    flags: {
      has_policies: policies.length > 0,
      has_memory: memoryFacts.length > 0,
      has_recent_conversation: conversation.hasHistory === true,
    },
  };
}

function composeCase({
  document = DRIVER_DOC,
  policies = [],
  memoryFacts = [],
  conversation = { hasHistory: false, latestUserMessages: [] },
  loadedContext = buildLoadedContext(),
} = {}) {
  const bundle = buildDu1InputBundle({
    document,
    contextSnapshot: buildSnapshot({ policies, memoryFacts, conversation }),
    loadedContext,
    keyFirstJudgment: { hold: { needed: false } },
  });
  const result = composeDu1WithEpistemicTrace(bundle);
  assert.equal(validateDu1CustomerSpeech(result.text).ok, true, result.text);
  assert.equal(validateDu1EpistemicSegments(result.segments).ok, true);
  return result;
}

const documentOn = composeCase({
  document: DRIVER_DOC,
  policies: [],
  memoryFacts: [],
  conversation: { hasHistory: false, latestUserMessages: [] },
  loadedContext: buildLoadedContext(),
});
const documentOff = composeCase({
  document: GENERIC_DOC,
  policies: [],
  memoryFacts: [],
  conversation: { hasHistory: false, latestUserMessages: [] },
  loadedContext: buildLoadedContext(),
});

const policiesOn = composeCase({
  document: DRIVER_DOC,
  policies: POLICIES,
  memoryFacts: [],
  conversation: { hasHistory: false, latestUserMessages: [] },
  loadedContext: buildLoadedContext({ policies: true }),
});
const policiesOff = composeCase({
  document: DRIVER_DOC,
  policies: [],
  memoryFacts: [],
  conversation: { hasHistory: false, latestUserMessages: [] },
  loadedContext: buildLoadedContext({ policies: false }),
});

const memoryOn = composeCase({
  document: DRIVER_DOC,
  policies: [],
  memoryFacts: MEMORY,
  conversation: { hasHistory: false, latestUserMessages: [] },
  loadedContext: buildLoadedContext({ memory: true }),
});
const memoryOff = composeCase({
  document: DRIVER_DOC,
  policies: [],
  memoryFacts: [],
  conversation: { hasHistory: false, latestUserMessages: [] },
  loadedContext: buildLoadedContext({ memory: false }),
});

const conversationOn = composeCase({
  document: DRIVER_DOC,
  policies: [],
  memoryFacts: [],
  conversation: CONVERSATION,
  loadedContext: buildLoadedContext({ conversation: true }),
});
const conversationOff = composeCase({
  document: DRIVER_DOC,
  policies: [],
  memoryFacts: [],
  conversation: { hasHistory: false, latestUserMessages: [] },
  loadedContext: buildLoadedContext({ conversation: false }),
});

const full = composeCase({
  document: DRIVER_DOC,
  policies: POLICIES,
  memoryFacts: MEMORY,
  conversation: CONVERSATION,
  loadedContext: buildLoadedContext({ policies: true, memory: true, conversation: true }),
});

assert.notEqual(documentOn.text, documentOff.text, "document ON/OFF must differ");
assert.notEqual(policiesOn.text, policiesOff.text, "policies ON/OFF must differ");
assert.notEqual(memoryOn.text, memoryOff.text, "memory ON/OFF must differ");
assert.notEqual(conversationOn.text, conversationOff.text, "conversation ON/OFF must differ");

assert.doesNotMatch(full.text, /것\s*같습니다|흐름과\s*맞춰\s*보면|평소[^\n]{0,20}챙기/);
assert.doesNotMatch(memoryOn.text, /등록된\s*보험|프로필에\s*등록/, "memory-only must not use registered-policy wording");

const memoryOnlyPolicySegments = memoryOn.segments.filter((s) => s.source === "policies");
assert.equal(memoryOnlyPolicySegments.length, 0, "memory-only must not emit policy segments");

console.log(
  JSON.stringify(
    {
      gate: "du-1-four-input-isolation-merge-gate",
      schema: "du-1-document-upload-first-speak-v2",
      isolation: {
        document: documentOn.text !== documentOff.text,
        policies: policiesOn.text !== policiesOff.text,
        memory: memoryOn.text !== memoryOff.text,
        conversation: conversationOn.text !== conversationOff.text,
      },
      samples: {
        full,
        policies_on: policiesOn.text,
        policies_off: policiesOff.text,
        memory_on: memoryOn.text,
        conversation_on: conversationOn.text,
      },
    },
    null,
    2,
  ),
);

console.log("DU-1 four-input isolation merge gate: PASS");
