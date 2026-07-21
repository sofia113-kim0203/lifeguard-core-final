/**
 * Payment Truth Map Slice 1 — unit tests (no network).
 */
import assert from "node:assert/strict";
import {
  assemblePaymentTruthMap,
  derivePaymentTruthVerification,
  extractReasonVerbatimFromEvidence,
  filterPaymentTruthByScope,
  mergePaymentTruthItems,
  normalizePaymentTruthItems,
  softPaymentTruthContext,
} from "../server/keyCore/keyPaymentTruthMap.js";

const CUSTOMER = "cust-ptm-1";
const ENTITY_A = "ent-a";
const NOW = new Date("2026-07-22T06:00:00+09:00");

const paidCase = {
  claim_case_key: "customer_statement:kind:surgery",
  claim_scope: "personal",
  entity_id: null,
  status: "paid",
  related_policies: ["pol-cancer-1"],
  related_coverages: ["암진단"],
  submission_number: "SUB-1",
  submission_date_text: "2026-07-01",
  source_document_ids: ["doc-diag-1"],
  insurer_verified: false,
  payout_amount_text: "120만원",
  denial_reason: null,
};

const deniedCase = {
  claim_case_key: "customer_statement:kind:hospital",
  claim_scope: "personal",
  entity_id: null,
  status: "denied",
  related_policies: ["pol-health-1"],
  related_coverages: [],
  submission_number: "SUB-2",
  source_document_ids: ["doc-receipt-1"],
  insurer_verified: false,
  denial_reason: "고객이 말한 특약 미해당",
};

const corpCase = {
  claim_case_key: "corporate:ent-a:fire",
  claim_scope: "corporate",
  entity_id: ENTITY_A,
  status: "preparing",
  related_policies: ["pol-corp-fire"],
  insurer_verified: false,
};

{
  // A/B/C — policy ↔ claim ↔ submission ↔ paid outcome
  const evidence = [
    {
      id: "ev-sub-1",
      claim_case_id: paidCase.claim_case_key,
      evidence_type: "claim_submission",
      source: "customer_statement",
      verification_status: "customer_reported",
      source_message_id: "msg-sub",
    },
    {
      id: "ev-out-paid",
      claim_case_id: paidCase.claim_case_key,
      evidence_type: "payment_or_denial_outcome",
      source: "customer_statement",
      verification_status: "customer_reported",
      metadata_json: { outcome: "paid", utterance: "보험금 지급됐어" },
    },
  ];
  const rows = assemblePaymentTruthMap({
    cases: [paidCase],
    evidenceItems: evidence,
    customerId: CUSTOMER,
    now: NOW,
  });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].related_policies, ["pol-cancer-1"]);
  assert.equal(rows[0].claim_case_id, paidCase.claim_case_key);
  assert.equal(rows[0].submission.present, true);
  assert.equal(rows[0].submission.submission_number, "SUB-1");
  assert.equal(rows[0].outcome, "paid");
  assert.ok(rows[0].evidence_ids.includes("ev-sub-1"));
  assert.equal(rows[0].verification_status, "customer_reported");
  assert.equal(rows[0].reason_verbatim, null);
}

{
  // D — denied + customer reason separated from verbatim
  const rows = assemblePaymentTruthMap({
    cases: [deniedCase],
    evidenceItems: [
      {
        id: "ev-out-den",
        claim_case_id: deniedCase.claim_case_key,
        evidence_type: "payment_or_denial_outcome",
        source: "customer_statement",
        verification_status: "customer_reported",
        metadata_json: { outcome: "denied", utterance: "거절됐어" },
      },
    ],
    customerId: CUSTOMER,
    now: NOW,
  });
  assert.equal(rows[0].outcome, "denied");
  assert.equal(rows[0].reason_customer_stated, "고객이 말한 특약 미해당");
  assert.equal(rows[0].reason_verbatim, null);
  assert.equal(rows[0].verification_status, "customer_reported");
}

{
  // E — insurer response verbatim + evidence (only with document + metadata)
  const insurerEv = {
    id: "ev-ins-1",
    claim_case_id: deniedCase.claim_case_key,
    evidence_type: "insurer_response",
    document_id: "doc-ins-deny-1",
    source: "uploaded_document",
    verification_status: "insurer_verified",
    metadata_json: {
      reason_verbatim: "약관 제3조 면책 사유에 해당합니다.",
      original_filename: "거절안내.pdf",
    },
  };
  assert.equal(
    extractReasonVerbatimFromEvidence(insurerEv),
    "약관 제3조 면책 사유에 해당합니다.",
  );
  assert.equal(
    extractReasonVerbatimFromEvidence({
      ...insurerEv,
      document_id: null,
      metadata_json: { reason_verbatim: "있으면 안 됨" },
    }),
    null,
  );

  const rows = assemblePaymentTruthMap({
    cases: [{ ...deniedCase, insurer_verified: true }],
    evidenceItems: [insurerEv],
    customerId: CUSTOMER,
    now: NOW,
  });
  assert.equal(rows[0].insurer_response.present, true);
  assert.ok(rows[0].insurer_response.evidence_ids.includes("ev-ins-1"));
  assert.equal(rows[0].reason_verbatim, "약관 제3조 면책 사유에 해당합니다.");
  assert.equal(rows[0].reason_customer_stated, "고객이 말한 특약 미해당");
  assert.equal(rows[0].verification_status, "insurer_verified");
}

{
  // F — row verification honesty; no silent promote
  assert.equal(
    derivePaymentTruthVerification({
      caseRow: { status: "denied", insurer_verified: false },
      outcomeEvidence: [
        {
          evidence_type: "payment_or_denial_outcome",
          source: "customer_statement",
          verification_status: "customer_reported",
        },
      ],
      insurerEvidence: [],
    }),
    "customer_reported",
  );
  const forced = normalizePaymentTruthItems([
    {
      claim_case_id: "x",
      verification_status: "insurer_verified",
      insurer_verified_flag: false,
      reason_customer_stated: "고객 말",
      insurer_response: { present: false, evidence_ids: [], document_ids: [] },
    },
  ]);
  assert.equal(forced[0].verification_status, "customer_reported");
}

{
  // G — isolation
  const rows = assemblePaymentTruthMap({
    cases: [paidCase, corpCase],
    evidenceItems: [],
    customerId: CUSTOMER,
    now: NOW,
  });
  assert.equal(filterPaymentTruthByScope(rows, { mode: "personal" }).length, 1);
  assert.equal(
    filterPaymentTruthByScope(rows, { mode: "corporate", entityId: ENTITY_A }).length,
    1,
  );
  assert.ok(
    !filterPaymentTruthByScope(rows, { mode: "personal" }).some((r) => r.entity_id),
  );
}

{
  // Merge preserves both rows; soft context note
  const a = assemblePaymentTruthMap({
    cases: [paidCase],
    evidenceItems: [],
    customerId: CUSTOMER,
    now: NOW,
  });
  const b = assemblePaymentTruthMap({
    cases: [deniedCase],
    evidenceItems: [],
    customerId: CUSTOMER,
    now: NOW,
  });
  const merged = mergePaymentTruthItems(a, b, { now: NOW });
  assert.equal(merged.length, 2);
  const soft = softPaymentTruthContext({
    rows: merged.map((r) => ({ id: r.id, claim_case_id: r.claim_case_id })),
    item_count: 2,
  });
  assert.ok(soft.payment_truth_map);
  assert.match(soft.payment_truth_map.note, /verification_status/);
  assert.match(soft.payment_truth_map.note, /probability/i);
}

console.log("key-payment-truth-map-unit-test: PASS");
