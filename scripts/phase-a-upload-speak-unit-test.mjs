/**
 * Phase A — DU-1 v2 + EA-1 customer-safe follow-up speak.
 */
import assert from "node:assert/strict";
import {
  buildDu1InputBundle,
  buildEa1CustomerSummaryFromMultiExtraction,
  buildPhaseAFollowUpCustomerSpeak,
  composeDu1WithEpistemicTrace,
  composePhaseAFollowUpWithEpistemicTrace,
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
    context_snapshot_id: "snap-phase-a",
    flags: {
      has_policies: policies.length > 0,
      has_memory: memoryFacts.length > 0,
      has_recent_conversation: conversation.hasHistory === true,
    },
    bundle: { policies, memoryFacts, recentConversation: conversation },
  };
}

function testEa1CustomerSummaryUsesLifeAxesNotOcrEcho() {
  const summary = buildEa1CustomerSummaryFromMultiExtraction({
    policies: [
      {
        field_count: 3,
        fields: {
          insurer_name: "삼성화재",
          product_name: "운전자보험 플러스",
        },
      },
    ],
  });

  assert.ok(summary.life_axes.includes("운전자"));
  assert.equal(summary.identifiable, true);
  assert.equal(/삼성|보험사|field_count|신뢰도/.test(JSON.stringify(summary)), false);
}

function testFollowUpSpeakConnectsEvidencePoliciesMemory() {
  const document = {
    id: "doc-phase-a-1",
    original_filename: "운전자보험증권.pdf",
    customer_hint_type: "insurance_policy",
  };
  const snapshot = buildSnapshot({
    policies: [
      { id: "p-existing", product_name: "실손의료비보험" },
      { id: "p-new", product_name: "운전자보험 플러스" },
    ],
    memoryFacts: [{ fact_value: "운전자 쪽을 먼저 챙기는 편" }],
    conversation: {
      hasHistory: true,
      latestUserMessages: ["운전자보험도 필요한지 궁금해요"],
    },
  });
  const loadedContext = buildLoadedContext({ policies: true, memory: true, conversation: true });

  const speak = buildPhaseAFollowUpCustomerSpeak({
    document,
    contextSnapshot: snapshot,
    loadedContext,
    multiExtraction: {
      policies: [
        {
          field_count: 2,
          fields: { product_name: "운전자보험 플러스", insurer_name: "현대해상" },
        },
      ],
    },
    linkedPolicyIds: ["p-new"],
  });

  assert.ok(speak?.text);
  assert.match(speak.text, /방금 올려 주신 자료 확인을 마쳤습니다/);
  assert.match(speak.text, /운전자/);
  assert.match(speak.text, /프로필과 연결/);
  assert.match(speak.text, /기억해 둔 내용/);
  assert.match(speak.text, /직전에/);
  assert.equal(validateDu1CustomerSpeech(speak.text).ok, true);
  assert.equal(
    speak.segments.some((row) => row.source === DU1_INPUT_SOURCE.EVIDENCE),
    true,
  );
}

function testFollowUpUnknownWhenEvidenceThin() {
  const document = { id: "doc-thin", original_filename: "scan.pdf", customer_hint_type: "other" };
  const snapshot = buildSnapshot();
  const loadedContext = buildLoadedContext();

  const { text, segments } = composePhaseAFollowUpWithEpistemicTrace({
    document,
    contextSnapshot: snapshot,
    loadedContext,
    multiExtraction: { policies: [{ field_count: 0, fields: {} }] },
    linkedPolicyIds: [],
    ea1CustomerSummary: { life_axes: [], identifiable: false, field_populated: false },
  });

  assert.match(text, /단정하지 않겠습니다/);
  assert.ok(segments.some((row) => row.tier === DU1_EPISTEMIC_TIER.UNKNOWN));
  assert.equal(validateDu1CustomerSpeech(text).ok, true);
}

function testIntakeIncludesEvidenceWhenExtractAlreadyComplete() {
  const document = {
    id: "doc-requeue",
    original_filename: "운전자보험증권.pdf",
    customer_hint_type: "insurance_policy",
    metadata_json: {
      policy_extraction_status: "completed",
      profile_policy_ids: ["p-linked"],
      key_ea1_customer_summary: {
        life_axes: ["운전자"],
        identifiable: true,
        field_populated: true,
      },
    },
  };
  const snapshot = buildSnapshot({ policies: [{ id: "p-linked", product_name: "운전자보험" }] });
  const loadedContext = buildLoadedContext({ policies: true });
  const bundle = buildDu1InputBundle({ document, contextSnapshot: snapshot, loadedContext });
  const { text, segments } = composeDu1WithEpistemicTrace(bundle);

  assert.match(text, /확인해 둔 내용 기준으로 운전자/);
  assert.match(text, /프로필과 연결/);
  assert.ok(segments.some((row) => row.source === DU1_INPUT_SOURCE.EVIDENCE));
  assert.equal(validateDu1CustomerSpeech(text).ok, true);
}

function testNoGapOrRecommendationPush() {
  const document = { id: "doc-no-gap", original_filename: "실손증권.pdf", customer_hint_type: "insurance_policy" };
  const snapshot = buildSnapshot({ policies: [{ product_name: "실손" }] });
  const loadedContext = buildLoadedContext({ policies: true });
  const speak = buildPhaseAFollowUpCustomerSpeak({
    document,
    contextSnapshot: snapshot,
    loadedContext,
    multiExtraction: { policies: [{ fields: { product_name: "실손의료비" }, field_count: 1 }] },
    linkedPolicyIds: ["p1"],
  });

  assert.equal(/Gap|추천|담보\s*부족/.test(speak.text), false);
}

function testFollowUpWhenExtractionFailedProvisional() {
  const document = {
    id: "doc-failed",
    original_filename: "scan.pdf",
    customer_hint_type: "other",
    metadata_json: { policy_extraction_status: "failed" },
  };
  const snapshot = buildSnapshot({
    policies: [{ id: "p-existing", product_name: "QA종합보장A" }],
    memoryFacts: [],
    conversation: { hasHistory: false },
  });
  const loadedContext = buildLoadedContext({ policies: true });

  const speak = buildPhaseAFollowUpCustomerSpeak({
    document,
    contextSnapshot: snapshot,
    loadedContext,
    multiExtraction: null,
    linkedPolicyIds: [],
    ea1CustomerSummary: null,
  });

  assert.ok(speak?.text);
  assert.match(speak.text, /내용 확인을 마쳤습니다/);
  assert.match(speak.text, /등록되어 있는 보험/);
  assert.doesNotMatch(speak.text, /QA/i);
  assert.doesNotMatch(speak.text, /이어서 더 확인/);
  assert.doesNotMatch(speak.text, /특약·보장 범위까지는 아직 말씀드리기 어렵습니다/);
  assert.equal(validateDu1CustomerSpeech(speak.text).ok, true);
}

function main() {
  testEa1CustomerSummaryUsesLifeAxesNotOcrEcho();
  testFollowUpSpeakConnectsEvidencePoliciesMemory();
  testFollowUpUnknownWhenEvidenceThin();
  testIntakeIncludesEvidenceWhenExtractAlreadyComplete();
  testNoGapOrRecommendationPush();
  testFollowUpWhenExtractionFailedProvisional();
  console.log("phase-a-upload-speak-unit-test: PASS (6/6)");
}

main();
