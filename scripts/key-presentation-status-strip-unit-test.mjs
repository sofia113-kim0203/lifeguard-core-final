/**
 * TEMP — presentation status strip unit checks (not a commit target).
 */
import assert from "node:assert/strict";
import {
  buildHandSnapshotFromDetailsJson,
  buildKeyPresentationStatusStrip,
  extractKeyStatusFromDonePayload,
  formatCustomerDocumentFactoryStatus,
  formatCustomerDocumentStorageStatus,
  resolvePdfWaitStatusText,
} from "../src/lib/keyPresentationStatusStrip.js";

// Empty → no chips
{
  const r = buildKeyPresentationStatusStrip({});
  assert.equal(r.chips.length, 0);
  assert.equal(r.claimProgress, null);
}

// Personal isolation — corporate claim hidden
{
  const snap = {
    claims: [
      { claim_case_key: "p1", status: "paid", entity_id: null },
      { claim_case_key: "c1", status: "denied", entity_id: "ent-a" },
    ],
    clocks: [
      { clock_type: "premium_due", due_at: "2026-11-20", status: "active", entity_id: null },
      { clock_type: "premium_due", due_at: "2026-10-10", status: "active", entity_id: "ent-a" },
    ],
    evidence: [{ id: "e1", entity_id: null }],
    ledger: [{ type: "goal", content: "보장은 유지", status: "active", entity_id: null }],
    paymentTruth: [
      {
        outcome: "denied",
        entity_id: null,
        reason_customer_stated: "고객 진술 사유",
        reason_verbatim: "약관 면책",
        verification_status: "insurer_verified",
      },
    ],
  };
  const personal = buildKeyPresentationStatusStrip({
    handSnapshot: snap,
    viewMode: "personal",
  });
  assert.ok(personal.chips.some((c) => c.id === "claim"));
  assert.ok(personal.chips.some((c) => c.id === "clock" && c.label.includes("2026-11-20")));
  assert.ok(personal.chips.some((c) => c.id === "evidence"));
  assert.ok(personal.chips.some((c) => c.id === "goal"));
  assert.ok(personal.chips.some((c) => c.id === "payment" && c.label.includes("부지급")));
  assert.equal(personal.claimProgress?.reason_source_label, "보험사 확인");
  assert.ok(!personal.chips.some((c) => c.label.includes("2026-10-10")));

  const corp = buildKeyPresentationStatusStrip({
    handSnapshot: snap,
    viewMode: "corporate",
    entityId: "ent-a",
  });
  assert.ok(corp.chips.some((c) => c.id === "claim" && c.label.includes("부지급")));
  assert.ok(corp.chips.some((c) => c.id === "clock" && c.label.includes("2026-10-10")));
  assert.ok(!corp.chips.some((c) => c.label.includes("보장은 유지")));
}

// Document status honesty
{
  assert.equal(
    formatCustomerDocumentStorageStatus({ storage_path: "a/b/c.pdf", ingest_status: "uploaded" }),
    "원본 보관 완료",
  );
  assert.equal(
    formatCustomerDocumentFactoryStatus({
      ingest_status: "ready",
      metadata_json: { policy_extraction_status: "extraction_failed" },
    }),
    "자동 정리 보류",
  );
  assert.equal(
    formatCustomerDocumentStorageStatus({ storage_path: "", ingest_status: "failed" }),
    "업로드 실패",
  );
}

// PDF wait copy
{
  const withDoc = resolvePdfWaitStatusText({ hasDocumentAttach: true });
  assert.equal(withDoc.primary, "원본 문서를 읽고 있어요.");
  assert.ok(withDoc.secondary.includes("조금 더"));
  const plain = resolvePdfWaitStatusText({ hasDocumentAttach: false });
  assert.equal(plain.primary, "KEY가 확인하고 있어요.");
}

// Done extract + details_json
{
  const details = buildHandSnapshotFromDetailsJson({
    key_active_claim_cases: [{ status: "under_review", entity_id: null }],
  });
  assert.equal(details.claims[0].status, "under_review");
  const fromDone = extractKeyStatusFromDonePayload({
    session_goal: { goal: "암 보장 유지", status: "active" },
    sales_director_trace: {
      key_compose_trace: {
        key_voice_trace: { corporate_claim_hand: { status: "paid" } },
      },
    },
  });
  assert.equal(fromDone.sessionGoalText, "암 보장 유지");
  assert.equal(fromDone.corporateClaimStatus, "paid");
}

console.log("key-presentation-status-strip-unit-test: PASS");
