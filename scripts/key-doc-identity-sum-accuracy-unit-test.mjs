/**
 * KEY document identity + sum accuracy — unit regression (no network / Claude / secrets).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  isExplicitVaultScopeQuestion,
  shouldPreferRequestDocumentScopeOnly,
  dedupeDocumentRowsForRuntimeSum,
  sumMonthlyPremiumsDeterministic,
  applyDeterministicPremiumSumGuard,
  buildIncompleteProcessingNotice,
  contentSha256FromBytes,
} from "../server/keyCore/keyDocumentSumAccuracy.js";
import {
  wantsOwnedInsuranceVaultEvidence,
  shouldProvideOwnedInsuranceVaultOriginals,
  shouldRunOwnedVaultRecall,
} from "../src/lib/chatActiveAttachment.js";
import {
  mergeOwnedDocumentAttachRows,
  resolveAttachRowContentSha,
  listOwnedInsuranceOriginalDocuments,
} from "../server/keyCore/keyClaudeFullDocumentDirect.js";

function ok(name) {
  console.log(`PASS ${name}`);
}

// 1) Request document_ids → no vault mix-in unless explicit vault/history scope.
assert.equal(
  shouldPreferRequestDocumentScopeOnly({
    documentIds: ["doc-a", "doc-b"],
    question: "이 두 장 보험료 합계 얼마야?",
    wantsVaultEvidence: false,
  }),
  true,
);
assert.equal(
  shouldProvideOwnedInsuranceVaultOriginals({
    question: "이 두 장 보험료 합계 얼마야?",
    attachedDocumentId: "doc-a",
  }),
  false,
);
assert.equal(
  shouldRunOwnedVaultRecall({
    wantsVaultEvidence: shouldProvideOwnedInsuranceVaultOriginals({
      question: "이 두 장 보험료 합계 얼마야?",
      attachedDocumentId: "doc-a",
    }),
    isPresenceTurn: false,
  }),
  false,
);
ok("attach_scope_no_vault_mixin");

// 2) Vault only on locked phrases / explicit box multi.
for (const q of ["보관 문서 봐줘", "이전 계약도 확인해줘", "전체 보험 분석해줘", "과거 자료와 비교해줘"]) {
  assert.equal(isExplicitVaultScopeQuestion(q), true, q);
  assert.equal(wantsOwnedInsuranceVaultEvidence(q), true, q);
}
assert.equal(wantsOwnedInsuranceVaultEvidence("내 보험 분석해줘"), false);
assert.equal(wantsOwnedInsuranceVaultEvidence("문서함에 있는 나머지 문서도 함께 분석해줘"), true);
ok("vault_gate_locked_phrases");

// 3) Same document_id once.
{
  const rows = [
    { document_id: "d1", monthly_premium: 123450, content_sha256: "aaa" },
    { document_id: "d1", monthly_premium: 123450, content_sha256: "aaa" },
    { document_id: "d2", monthly_premium: 166555, content_sha256: "bbb" },
  ];
  const deduped = dedupeDocumentRowsForRuntimeSum(rows);
  assert.equal(deduped.length, 2);
  const sum = sumMonthlyPremiumsDeterministic(rows);
  assert.equal(sum.monthly_premium_sum, 123450 + 166555);
}
ok("same_document_id_once");

// 4) Same bytes / different document_id → once.
{
  const bytes = Buffer.from("%PDF-1.4 same-bytes-fixture");
  const sha = contentSha256FromBytes(bytes);
  const rows = [
    { document_id: "doc-x", monthly_premium: 123450, content_sha256: sha },
    { document_id: "doc-y", monthly_premium: 123450, content_sha256: sha },
    { document_id: "doc-z", monthly_premium: 166555, content_sha256: "other" },
  ];
  const sum = sumMonthlyPremiumsDeterministic(rows);
  assert.equal(sum.unique_document_count, 2);
  assert.equal(sum.monthly_premium_sum, 123450 + 166555);
  // Also from base64 when stored sha missing.
  const b64 = bytes.toString("base64");
  const fromBytes = sumMonthlyPremiumsDeterministic([
    { document_id: "doc-x", monthly_premium: 100, base64: b64 },
    { document_id: "doc-y", monthly_premium: 100, base64: b64 },
    { document_id: "doc-z", monthly_premium: 50, content_sha256: "zz" },
  ]);
  assert.equal(fromBytes.monthly_premium_sum, 150);
}
ok("same_bytes_different_id_once");

// 5) Filename+size alone must NOT collapse distinct originals.
{
  const rows = [
    {
      document_id: "a",
      monthly_premium: 100,
      original_filename: "same.jpg",
      fileSizeBytes: 999,
      content_sha256: "sha-1",
    },
    {
      document_id: "b",
      monthly_premium: 200,
      original_filename: "same.jpg",
      fileSizeBytes: 999,
      content_sha256: "sha-2",
    },
  ];
  const sum = sumMonthlyPremiumsDeterministic(rows);
  assert.equal(sum.unique_document_count, 2);
  assert.equal(sum.monthly_premium_sum, 300);
}
ok("filename_size_not_dedupe");

// 6) Classic arithmetic — 123450 + 123450 + 166555 = 413455 (not 413555).
{
  const rows = [
    { document_id: "p1", monthly_premium: 123450, content_sha256: "s1" },
    { document_id: "p2", monthly_premium: 123450, content_sha256: "s2" },
    { document_id: "p3", monthly_premium: 166555, content_sha256: "s3" },
  ];
  const sum = sumMonthlyPremiumsDeterministic(rows);
  assert.equal(sum.monthly_premium_sum, 413455);
  assert.notEqual(sum.monthly_premium_sum, 413555);
  const guarded = applyDeterministicPremiumSumGuard({
    customerAnswer: "세 계약 월 납입 합계는 413,555원입니다.",
    totals: sum,
  });
  assert.equal(guarded.changed, true);
  assert.match(guarded.answer, /413,455원/);
  assert.doesNotMatch(guarded.answer, /413,555원/);
}
ok("deterministic_sum_413455");

// 7) Merge helper: sha from bytes when stored hash absent.
{
  const bytes = Buffer.from("%PDF-1.4 merge-sha");
  const b64 = bytes.toString("base64");
  const sha = createHash("sha256").update(bytes).digest("hex");
  assert.equal(resolveAttachRowContentSha({ base64: b64 }), sha);
  const merged = mergeOwnedDocumentAttachRows({
    vaultAttachments: [
      { document_id: "d1", pdfBase64: b64, mediaType: "application/pdf" },
      { document_id: "d2", pdfBase64: b64, mediaType: "application/pdf" },
      {
        document_id: "d3",
        pdfBase64: Buffer.from("%PDF-1.4 other").toString("base64"),
        mediaType: "application/pdf",
      },
    ],
    maxUnique: 6,
  });
  assert.equal(merged.length, 2);
}
ok("merge_sha_from_bytes");

// 8) Incomplete processing notice — never claim complete.
{
  const notice = buildIncompleteProcessingNotice({
    total_count: 12,
    processed_count: 5,
    remaining_count: 7,
    stop_reason: "unique_attach_cap_partial",
  });
  assert.equal(notice.complete, false);
  assert.equal(notice.total_count, 12);
  assert.equal(notice.processed_count, 5);
  assert.equal(notice.remaining_count, 7);
  assert.match(notice.customer_speak_hint, /완료라고 말하지 않는다/);
}
ok("incomplete_processing_notice");

// 9) Pagination: list walks pages past 40 (mock supabase range).
{
  const all = Array.from({ length: 85 }, (_, i) => ({
    id: `doc-${i}`,
    customer_id: "c1",
    original_filename: `f${i}.pdf`,
    created_at: new Date(Date.now() - i * 1000).toISOString(),
    deleted_at: null,
    mime_type: "application/pdf",
    storage_path: `c1/f${i}.pdf`,
    doc_class: "policy_certificate",
    customer_hint_type: "insurance_policy",
    metadata_json: { category_key: "insurance_policy" },
  }));
  const supabase = {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        is() {
          return this;
        },
        order() {
          return this;
        },
        async range(from, to) {
          return { data: all.slice(from, to + 1), error: null };
        },
      };
    },
  };
  const listed = await listOwnedInsuranceOriginalDocuments({
    supabase,
    customerId: "c1",
    pageSize: 40,
  });
  assert.equal(listed.ok, true);
  assert.equal(listed.list_complete, true);
  assert.equal(listed.documents.length, 85);
  assert.ok(listed.pages_fetched >= 3);
}
ok("list_pagination_past_40");

console.log("\nALL PASS key-doc-identity-sum-accuracy-unit-test");
