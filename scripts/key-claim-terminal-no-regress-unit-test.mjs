/**
 * Personal V1 — terminal claim must not regress on unclear follow-ups.
 * Minimal unit lock for paid/denied honesty (no network).
 */
import assert from "node:assert/strict";
import {
  mergeKeyActiveClaimCases,
  normalizeKeyClaimCaseUpdates,
} from "../server/documentPolicyUploadPersist.js";
import {
  buildKeyClaimIntakeUpdate,
  detectClaimOutcomeSignal,
} from "../server/keyCore/keyClaimIntakeSidecar.js";

const paidSurgery = {
  claim_case_key: "customer_statement:kind:surgery",
  claim_scope: "personal",
  entity_id: null,
  status: "paid",
  source: "customer_statement",
  insurer_verified: false,
  medical_event: { event_kind: "surgery" },
  available_documents: ["진단서", "입퇴원확인서"],
  required_documents: ["진단서", "입퇴원확인서", "진료비세부내역서"],
  missing_documents: ["진료비세부내역서"],
  evidence: ["source:customer_statement", "outcome_status:paid"],
  next_action: "결과 기록 유지",
};

// Merge must not rewind paid → identified.
{
  const merged = mergeKeyActiveClaimCases(
    [paidSurgery],
    [
      {
        claim_case_key: "customer_statement:kind:surgery",
        claim_scope: "personal",
        status: "identified",
        source: "customer_statement",
        evidence: ["source:customer_statement", "message_id:m1"],
      },
    ],
  );
  const row = merged.find((c) => c.claim_case_key === paidSurgery.claim_case_key);
  assert.equal(row?.status, "paid");
}

assert.equal(
  detectClaimOutcomeSignal("아직 연락이 없는데 안 된 것 같아.")?.kind,
  "unclear_wait",
);

// Unclear wait keeps terminal paid (no reopen / no identified).
{
  const built = buildKeyClaimIntakeUpdate({
    question: "아직 연락이 없는데 안 된 것 같아.",
    existingCases: [paidSurgery],
    attachedDocumentId: null,
    messageId: "msg-unclear-1",
    sessionId: "sess-terminal-1",
  });
  assert.equal(built.ok, true);
  assert.equal(built.reason, "outcome_unclear_keep_status");
  assert.equal(built.updates?.[0]?.status, "paid");
  assert.equal(built.updates?.[0]?.insurer_verified, false);
}

// Denied also stays terminal on unclear wait.
{
  const denied = {
    ...paidSurgery,
    claim_case_key: "customer_statement:kind:cancer",
    status: "denied",
    medical_event: { event_kind: "cancer" },
  };
  const built = buildKeyClaimIntakeUpdate({
    question: "아직 연락이 없는데 안 된 것 같아.",
    existingCases: [denied],
    messageId: "msg-unclear-2",
    sessionId: "sess-terminal-2",
  });
  assert.equal(built.ok, true);
  assert.equal(built.updates?.[0]?.status, "denied");
}

// Clear new accident kind can still create a separate open claim beside terminal paid.
{
  const built = buildKeyClaimIntakeUpdate({
    question: "지난주에 교통사고 나서 입원했는데 보험금 청구할 수 있을까?",
    existingCases: [paidSurgery],
    messageId: "msg-new-accident",
    sessionId: "sess-terminal-3",
  });
  // If classifier treats as intake, new/open case must not overwrite paid surgery.
  if (built.ok === true && Array.isArray(built.updates) && built.updates.length) {
    const surgery = built.updates.find(
      (u) => u.claim_case_key === "customer_statement:kind:surgery",
    );
    assert.equal(surgery == null || surgery.status === "paid", true);
    const nonSurgery = built.updates.filter(
      (u) => u.claim_case_key !== "customer_statement:kind:surgery",
    );
    assert.equal(
      nonSurgery.every((u) => u.status !== "paid" || u.claim_case_key !== paidSurgery.claim_case_key),
      true,
    );
  }
}

// Structured payment-truth / outcome evidence must not demote paid|denied → preparing.
{
  const rows = normalizeKeyClaimCaseUpdates(
    [
      {
        claim_case_key: "v1f:paid:fixture",
        claim_scope: "personal",
        status: "paid",
        source: "customer_statement",
        evidence: [],
      },
      {
        claim_case_key: "v1f:denied:fixture",
        claim_scope: "personal",
        status: "denied",
        source: "customer_statement",
        denial_reason: "고객이 말한 특약 미해당",
        evidence: [],
      },
    ],
    {
      evidenceItems: [
        {
          id: "ev-paid",
          claim_case_id: "v1f:paid:fixture",
          evidence_type: "payment_or_denial_outcome",
          source: "customer_statement",
          verification_status: "customer_reported",
          metadata_json: { outcome: "paid" },
        },
        {
          id: "ev-den",
          claim_case_id: "v1f:denied:fixture",
          evidence_type: "payment_or_denial_outcome",
          source: "customer_statement",
          verification_status: "customer_reported",
          metadata_json: { outcome: "denied" },
        },
      ],
      paymentTruthItems: [
        {
          claim_case_id: "v1f:paid:fixture",
          claim_status: "paid",
          outcome: "paid",
          verification_status: "customer_reported",
        },
        {
          claim_case_id: "v1f:denied:fixture",
          claim_status: "denied",
          outcome: "denied",
          verification_status: "insurer_verified",
          reason_verbatim: "약관 면책 사유에 해당합니다.",
          reason_customer_stated: "고객이 말한 특약 미해당",
        },
      ],
    },
  );
  assert.equal(rows.find((r) => r.claim_case_key === "v1f:paid:fixture")?.status, "paid");
  assert.equal(rows.find((r) => r.claim_case_key === "v1f:denied:fixture")?.status, "denied");

  const restored = normalizeKeyClaimCaseUpdates(
    [
      {
        claim_case_key: "v1f:paid:fixture",
        claim_scope: "personal",
        status: "preparing",
        source: "customer_statement",
        evidence: [],
      },
    ],
    {
      paymentTruthItems: [
        {
          claim_case_id: "v1f:paid:fixture",
          outcome: "paid",
          verification_status: "customer_reported",
        },
      ],
    },
  );
  assert.equal(restored[0]?.status, "paid");
}

// Persisted terminal + empty inline evidence[] (no PT) must not rewind to preparing.
// Human Gate: Hand/Ready Card re-normalize must keep canonical paid|denied.
{
  const bare = normalizeKeyClaimCaseUpdates([
    {
      claim_case_key: "customer_statement:kind:surgery",
      claim_scope: "personal",
      status: "paid",
      source: "customer_statement",
      evidence: [],
    },
    {
      claim_case_key: "customer_statement:kind:cancer",
      claim_scope: "personal",
      status: "denied",
      source: "customer_statement",
      evidence: [],
    },
    {
      claim_case_key: "open:preparing:fixture",
      claim_scope: "personal",
      status: "preparing",
      source: "customer_statement",
      evidence: [],
    },
  ]);
  assert.equal(
    bare.find((r) => r.claim_case_key === "customer_statement:kind:surgery")?.status,
    "paid",
  );
  assert.equal(
    bare.find((r) => r.claim_case_key === "customer_statement:kind:cancer")?.status,
    "denied",
  );
  assert.equal(
    bare.find((r) => r.claim_case_key === "open:preparing:fixture")?.status,
    "preparing",
  );

  // Unverified new terminal promotion from open prior still refused.
  const blocked = mergeKeyActiveClaimCases(
    [
      {
        claim_case_key: "open:prep:promote",
        claim_scope: "personal",
        status: "preparing",
        source: "customer_statement",
        evidence: [],
      },
    ],
    [
      {
        claim_case_key: "open:prep:promote",
        claim_scope: "personal",
        status: "paid",
        source: "customer_statement",
        evidence: [],
      },
    ],
  );
  assert.equal(
    blocked.find((r) => r.claim_case_key === "open:prep:promote")?.status,
    "preparing",
  );

  // Corporate scope unchanged through bare terminal normalize.
  const corp = normalizeKeyClaimCaseUpdates([
    {
      claim_case_key: "corp:fixture",
      claim_scope: "corporate",
      entity_id: "ent-1",
      status: "denied",
      source: "customer_statement",
      evidence: [],
    },
  ]);
  assert.equal(corp[0]?.claim_scope, "corporate");
  assert.equal(corp[0]?.entity_id, "ent-1");
  assert.equal(corp[0]?.status, "denied");
}

console.log("key-claim-terminal-no-regress-unit-test: PASS");
