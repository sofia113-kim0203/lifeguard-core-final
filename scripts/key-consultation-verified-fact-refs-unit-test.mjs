/**
 * verified_fact_refs attribution — consultation record only.
 * No network / DB / Claude.
 */
import assert from "node:assert/strict";
import {
  buildKeyConsultationRecord,
  buildVerifiedFactRefsForConsultationRecord,
} from "../server/keyCore/keyClaudeFirstDirect.js";
import {
  buildKeyRelevantEvidenceForOnePath,
  buildKeyRelevantMemoryPacket,
} from "../server/keyCore/keyRelevantMemoryPacket.js";

const DOC_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DOC_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const DOC_PENDING = "cccccccc-cccc-cccc-cccc-cccccccccccc";

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

function makeMemoryRow({
  primaryDoc = DOC_A,
  includePendingFact = false,
} = {}) {
  const contracts = [
    {
      insurer_name: "한화손해보험",
      product_name: "간편건강보험",
      policy_number: "LA20249638413000",
      source_document_id: primaryDoc,
      fact_refs: [
        {
          fact_type: "insurer",
          literal: "한화손해보험",
          source_document_id: primaryDoc,
          verification_status: "key_confirmed_from_original",
        },
      ],
    },
  ];
  if (includePendingFact) {
    contracts[0].fact_refs.push({
      fact_type: "pending_note",
      literal: "ocr candidate",
      source_document_id: DOC_PENDING,
      verification_status: "pending_unverified",
    });
  }
  return {
    id: "mem-1",
    memory_version: 3,
    commit_status: "committed",
    read_status: "confirmed_facts",
    rejected_fact_count: 0,
    primary_document_id: primaryDoc,
    document_ids: [primaryDoc],
    confirmation_source: "key_claude_original_document",
    contracts,
  };
}

function evidenceFromMemory(row) {
  const packet = buildKeyRelevantMemoryPacket({
    question:
      "현재 판매 중인 보험상품 중에서 나에게 필요한 보장을 채울 수 있는 상품을 추천해줘",
    history: [],
    memoryRow: row,
    memoryLoadAttempted: true,
    memoryQueryFailed: false,
    originalAttachmentCount: 0,
  });
  return buildKeyRelevantEvidenceForOnePath(packet);
}

test("1_no_attach_followup_with_verified_prior_doc_ref", () => {
  const evidence = evidenceFromMemory(makeMemoryRow());
  assert.ok(evidence);
  const refs = buildVerifiedFactRefsForConsultationRecord({
    documentId: null,
    keyRelevantEvidence: evidence,
  });
  assert.equal(refs.length >= 1, true);
  assert.ok(refs.some((r) => r.kind === "document" && r.id === DOC_A));
  const record = buildKeyConsultationRecord({
    question: "추천해줘",
    claudeAnswer: "확인된 계약을 기준으로 안내합니다.",
    documentId: null,
    keyRelevantEvidence: evidence,
  });
  assert.ok(
    record.verified_fact_refs.some((r) => r.kind === "document" && r.id === DOC_A),
  );
  // untouched fields
  assert.equal(record.claude_judgment.recommendation_basis_count, 0);
  assert.equal(record.claude_judgment.not_verified_customer_fact, true);
});

test("2_current_turn_document_id_kept", () => {
  const refs = buildVerifiedFactRefsForConsultationRecord({
    documentId: DOC_B,
    keyRelevantEvidence: null,
  });
  assert.deepEqual(refs, [{ kind: "document", id: DOC_B }]);
});

test("3_dedupe_same_document_from_both_sources", () => {
  const evidence = evidenceFromMemory(makeMemoryRow({ primaryDoc: DOC_A }));
  const refs = buildVerifiedFactRefsForConsultationRecord({
    documentId: DOC_A,
    keyRelevantEvidence: evidence,
  });
  const hits = refs.filter((r) => r.id === DOC_A);
  assert.equal(hits.length, 1);
  assert.equal(refs.length, 1);
});

test("4_pending_unverified_only_not_promoted", () => {
  const evidence = {
    schema_version: "key_relevant_evidence_v1",
    confirmed_facts: [
      {
        fact_type: "note",
        source_document_id: DOC_PENDING,
        verification_status: "pending_unverified",
      },
    ],
    customer_confirmed_facts: [
      {
        fact_type: "ocr",
        source_document_id: DOC_PENDING,
        verification_status: "ocr_candidate",
      },
    ],
    focused_contracts: [],
    verified_chart_slice: null,
    official_document_memory: null,
  };
  const refs = buildVerifiedFactRefsForConsultationRecord({
    documentId: null,
    keyRelevantEvidence: evidence,
  });
  assert.deepEqual(refs, []);
});

test("5_no_evidence_empty_refs", () => {
  assert.deepEqual(
    buildVerifiedFactRefsForConsultationRecord({
      documentId: null,
      keyRelevantEvidence: null,
    }),
    [],
  );
  assert.deepEqual(
    buildKeyConsultationRecord({
      question: "안녕",
      claudeAnswer: "안녕하세요.",
      documentId: null,
      keyRelevantEvidence: null,
    }).verified_fact_refs,
    [],
  );
});

if (!process.exitCode) {
  console.log("ALL_PASS key-consultation-verified-fact-refs-unit-test");
}
