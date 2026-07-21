/**
 * Evidence Vault Slice 1 — unit tests (no network).
 */
import assert from "node:assert/strict";
import {
  buildClaimEvidenceUpdatesFromUtterance,
  buildOriginalDocumentEvidenceFromDocs,
  buildClaimEvidenceHandBrief,
  deriveContentHashHint,
  filterClaimEvidenceByScope,
  mergeClaimEvidenceItems,
  normalizeClaimEvidenceItems,
  parseStatedSubmissionTime,
} from "../server/keyCore/keyClaimEvidenceVault.js";

const CUSTOMER = "cust-ev-1";
const ENTITY_A = "ent-a";
const ENTITY_B = "ent-b";
const NOW = new Date("2026-07-22T03:00:00+09:00");
const surgery = {
  claim_case_key: "customer_statement:kind:surgery",
  claim_scope: "personal",
  entity_id: null,
  status: "preparing",
  available_documents: ["진단서"],
  missing_documents: ["입퇴원확인서"],
  source_document_ids: [],
  next_action: "서류 준비",
};

{
  const hint = deriveContentHashHint({
    documentId: "doc-1",
    byteSize: 1200,
    storagePath: `${CUSTOMER}/doc-1/a.pdf`,
  });
  assert.match(hint, /^doc:doc-1:/);
}

{
  const when = parseStatedSubmissionTime("오늘 보험사에 진단서를 제출했어.", { now: NOW });
  assert.equal(when.reason, "today_stated");
  assert.match(when.submitted_at, /^2026-07-22/);
  const none = parseStatedSubmissionTime("서류를 제출했어.", { now: NOW });
  assert.equal(none.submitted_at, null);
}

{
  const docs = [
    {
      id: "doc-diag-1",
      storage_path: `${CUSTOMER}/doc-diag-1/진단서.pdf`,
      original_filename: "진단서.pdf",
      customer_hint_type: "진단서",
      metadata_json: { byte_size: 4096 },
      created_at: "2026-07-20T01:00:00.000Z",
    },
  ];
  const created = buildOriginalDocumentEvidenceFromDocs({
    claimCase: surgery,
    documents: docs,
    existingEvidence: [],
    customerId: CUSTOMER,
    now: NOW,
  });
  assert.equal(created.length, 1);
  assert.equal(created[0].evidence_type, "original_document");
  assert.equal(created[0].entity_id, null);
  assert.equal(created[0].document_id, "doc-diag-1");
  assert.equal(created[0].verification_status, "original");
  assert.equal(created[0].metadata_json.extract_separated, true);

  // Second upload same label → new evidence + supersedes
  const docs2 = [
    {
      id: "doc-diag-2",
      storage_path: `${CUSTOMER}/doc-diag-2/진단서2.pdf`,
      original_filename: "진단서2.pdf",
      customer_hint_type: "진단서",
      metadata_json: { byte_size: 5000 },
      created_at: "2026-07-21T01:00:00.000Z",
    },
  ];
  const v2 = buildOriginalDocumentEvidenceFromDocs({
    claimCase: surgery,
    documents: docs2,
    existingEvidence: created,
    customerId: CUSTOMER,
    now: NOW,
  });
  assert.equal(v2.length, 1);
  assert.equal(v2[0].document_id, "doc-diag-2");
  assert.equal(v2[0].supersedes_id, created[0].id);
  const merged = mergeClaimEvidenceItems(created, v2, { now: NOW });
  assert.equal(merged.length, 2);
  assert.ok(merged.some((e) => e.document_id === "doc-diag-1"));
  assert.ok(merged.some((e) => e.document_id === "doc-diag-2"));
}

{
  const sub = buildClaimEvidenceUpdatesFromUtterance({
    question: "오늘 보험사에 진단서를 제출했어.",
    existingCases: [surgery],
    existingEvidence: [],
    customerId: CUSTOMER,
    messageId: "msg-sub-1",
    now: NOW,
  });
  assert.equal(sub.ok, true);
  assert.equal(sub.updates[0].evidence_type, "claim_submission");
  assert.equal(sub.updates[0].source, "customer_statement");
  assert.equal(sub.updates[0].verification_status, "customer_reported");
  assert.ok(sub.updates[0].submitted_at);
  assert.equal(sub.updates[0].received_at, null);
  assert.equal(sub.updates[0].metadata_json.not_insurer_receipt, true);
}

{
  const pay = buildClaimEvidenceUpdatesFromUtterance({
    question: "보험금이 지급됐어. 120만원 받았어.",
    existingCases: [{ ...surgery, status: "under_review" }],
    existingEvidence: [],
    customerId: CUSTOMER,
    messageId: "msg-pay-1",
    now: NOW,
  });
  assert.equal(pay.ok, true);
  assert.equal(pay.updates[0].evidence_type, "payment_or_denial_outcome");
  assert.equal(pay.updates[0].verification_status, "customer_reported");
  assert.equal(pay.updates[0].metadata_json.insurer_verified, false);
  assert.ok(pay.updates[0].metadata_json.payout_amount_text);

  // Normalize must not promote customer payment to insurer_verified
  const forced = normalizeClaimEvidenceItems([
    {
      ...pay.updates[0],
      verification_status: "insurer_verified",
    },
  ]);
  assert.equal(forced[0].verification_status, "customer_reported");
}

{
  const insurerDoc = {
    id: "doc-ins-1",
    storage_path: `${CUSTOMER}/doc-ins-1/거절안내.pdf`,
    original_filename: "보험사_거절안내.pdf",
    customer_hint_type: "보험사답변",
    metadata_json: { byte_size: 800 },
    created_at: "2026-07-21T02:00:00.000Z",
  };
  const resp = buildOriginalDocumentEvidenceFromDocs({
    claimCase: surgery,
    documents: [insurerDoc],
    existingEvidence: [],
    customerId: CUSTOMER,
    now: NOW,
  });
  assert.equal(resp[0].evidence_type, "insurer_response");
  assert.equal(resp[0].verification_status, "insurer_verified");

  const noDoc = normalizeClaimEvidenceItems([
    {
      id: "ev-bad",
      claim_case_id: surgery.claim_case_key,
      evidence_type: "insurer_response",
      document_id: null,
      source: "customer_statement",
      verification_status: "insurer_verified",
    },
  ]);
  assert.equal(noDoc[0].verification_status, "customer_reported");
}

{
  const items = [
    {
      id: "p1",
      claim_case_id: surgery.claim_case_key,
      evidence_type: "original_document",
      entity_id: null,
      document_id: "d1",
      verification_status: "original",
      source: "uploaded_document",
      label: "진단서",
    },
    {
      id: "c1",
      claim_case_id: "corporate:ent-a:fire",
      evidence_type: "original_document",
      entity_id: ENTITY_A,
      document_id: "d2",
      verification_status: "original",
      source: "uploaded_document",
      label: "화재확인서",
    },
    {
      id: "c2",
      claim_case_id: "corporate:ent-b:fire",
      evidence_type: "original_document",
      entity_id: ENTITY_B,
      document_id: "d3",
      verification_status: "original",
      source: "uploaded_document",
      label: "B서류",
    },
  ];
  const personal = filterClaimEvidenceByScope(items, { mode: "personal" });
  assert.equal(personal.length, 1);
  assert.equal(personal[0].id, "p1");
  const corpA = filterClaimEvidenceByScope(items, { mode: "corporate", entityId: ENTITY_A });
  assert.equal(corpA.length, 1);
  assert.equal(corpA[0].entity_id, ENTITY_A);
  assert.ok(!corpA.some((e) => e.entity_id === ENTITY_B));
}

{
  const brief = buildClaimEvidenceHandBrief({
    cases: [surgery],
    evidenceItems: [
      {
        id: "h1",
        claim_case_id: surgery.claim_case_key,
        evidence_type: "original_document",
        label: "진단서",
        verification_status: "original",
        source: "uploaded_document",
        document_id: "d1",
      },
      {
        id: "s1",
        claim_case_id: surgery.claim_case_key,
        evidence_type: "claim_submission",
        label: "고객 제출 진술",
        verification_status: "customer_reported",
        source: "customer_statement",
      },
    ],
    now: NOW,
  });
  assert.equal(brief.packages.length, 1);
  assert.equal(brief.packages[0].held_evidence.length, 1);
  assert.equal(brief.packages[0].submitted_evidence.length, 1);
  assert.deepEqual(brief.packages[0].missing_evidence_labels, ["입퇴원확인서"]);
}

console.log("key-claim-evidence-vault-unit-test: PASS");
