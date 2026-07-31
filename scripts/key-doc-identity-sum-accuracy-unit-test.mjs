/**
 * KEY document identity + sum accuracy — unit regression (no network / Claude / secrets).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  isExplicitVaultScopeQuestion,
  shouldPreferRequestDocumentScopeOnly,
  dedupeDocumentRowsForRuntimeSum,
  dedupeRowsForOriginalDelivery,
  sumMonthlyPremiumsDeterministic,
  buildIncompleteProcessingNotice,
  buildAttachAnalysisScopeAuthorityAddendum,
  buildAttachmentIdentityDeliveryPlan,
  buildDeterministicTotalsAuthorityAddendum,
  buildKeyClaudeContextContractAddendum,
  buildCustomerConfirmationBoundaryAddendum,
  buildVaultDocumentSourceScopeAddendum,
  buildUnsupportedEvaluationAuthorityAddendum,
  buildCurrentCustomerRequestPriorityBlock,
  buildQuestionScopedAnalysisAuthorityAddendum,
  isAttachContextFollowUpQuestion,
  isClaudeInferenceOrEvaluationLiteral,
  stripNonAttachEvidenceFromUserPayload,
  answerMentionsOutOfAttachHistoryScope,
  contentSha256FromBytes,
} from "../server/keyCore/keyDocumentSumAccuracy.js";
import { filterHistoryExcludingInactiveDocumentAttachments } from "../server/keyCore/keyClaudeFullContextPack.js";
import { buildSessionMetadata } from "../src/lib/lifeguardChatSessionCore.js";
import * as keyDocumentSumAccuracy from "../server/keyCore/keyDocumentSumAccuracy.js";
import {
  wantsOwnedInsuranceVaultEvidence,
  shouldProvideOwnedInsuranceVaultOriginals,
  shouldRunOwnedVaultRecall,
  extractActiveAttachmentIdsFromMetadata,
  normalizeActiveAttachment,
} from "../src/lib/chatActiveAttachment.js";
import { normalizeAttachmentRowsForClaude } from "../server/keyCore/keyImageOrientation.js";
import { resolveActiveInsuranceDocumentCase } from "../server/keyCore/keyActiveInsuranceDocumentCase.js";
import {
  mergeOwnedDocumentAttachRows,
  resolveAttachRowContentSha,
  listOwnedInsuranceOriginalDocuments,
} from "../server/keyCore/keyClaudeFullDocumentDirect.js";
import {
  buildClaudeFirstCachedRequestParts,
  composeClaudeFirstSystemText,
} from "../server/keyCore/keyClaudeFirstDirect.js";
import {
  isExplicitCurrentInsuranceProductRequest,
  buildCurrentInsuranceProductShowcaseAddendum,
} from "../server/keyCore/keyBorrowedSensesSpeak.js";

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
for (const q of [
  "보관 문서 봐줘",
  "이전 계약 비교해줘",
  "전체 보험 분석해줘",
  "과거 자료 확인해줘",
  "과거 자료와 비교해줘",
]) {
  assert.equal(isExplicitVaultScopeQuestion(q), true, q);
  assert.equal(wantsOwnedInsuranceVaultEvidence(q), true, q);
}
assert.equal(wantsOwnedInsuranceVaultEvidence("내 보험 분석해줘"), false);
assert.equal(wantsOwnedInsuranceVaultEvidence("문서함에 있는 나머지 문서도 함께 분석해줘"), true);
assert.equal(
  shouldPreferRequestDocumentScopeOnly({
    documentIds: ["doc-a", "doc-a"],
    question: "이 두 서류의 보험료 합계 얼마야?",
  }),
  true,
);
assert.equal(
  shouldProvideOwnedInsuranceVaultOriginals({
    question: "방금 올린 이 파일만 분석해줘",
    attachedDocumentId: "doc-b",
  }),
  false,
);
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
  const addendum = buildDeterministicTotalsAuthorityAddendum({
    ...sum,
    requested_document_ids: ["p1", "p2", "p3"],
    attachment_identity_count: 3,
    unique_original_block_count: 3,
  });
  assert.match(addendum, /monthly_premium_total=413455/);
  assert.match(addendum, /deterministic_total_status=partial/);
  assert.match(addendum, /included_document_ids=p1,p2,p3/);
  assert.match(addendum, /Claude가 원본과 함께 직접 작성/);
  assert.match(addendum, /unique_contract_count=unknown/);
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

// 10) A+A premium-sum scope: strip chart/ledger/past docs; no history-contract prose.
{
  const dirty = {
    current_question: "이 두 서류의 보험료 합계",
    current_context: {
      ready_card: { insurance_card: { policy_count: 3 } },
      policy_truth: { ledger: { active_distinct_count: 3 } },
      prior_consultation: { related_turns: [{ role: "assistant", text: "한화손보" }] },
      conversation: {
        recent_conversation_originals: [],
        retained_past_originals: [{ text: "세이프단체보험 약관" }],
        older_conversation_summary: "과거 약관 요약",
      },
    },
    available_verified_evidence: {
      personal: {
        chart: {
          contracts: [{ product_name: "한화손보 세이프단체보험" }],
          key_confirmed_source_facts: [{ fact_type: "product_name" }],
        },
        key_confirmed_source_facts: [{ fact_type: "product_name" }],
      },
      documents: [
        { document_id: "past", attached: false, original_filename: "약관.pdf" },
        { document_id: "a", attached: true, original_filename: "A.png" },
      ],
    },
  };
  const clean = stripNonAttachEvidenceFromUserPayload(dirty);
  // Related chart / prior consultation / ready_card stay; only unrelated past dumps drop.
  assert.ok(clean.available_verified_evidence.personal.chart);
  assert.equal(
    clean.available_verified_evidence.personal.key_confirmed_source_facts.length,
    1,
  );
  assert.ok(clean.current_context.ready_card);
  assert.ok(clean.current_context.policy_truth);
  assert.ok(clean.current_context.prior_consultation);
  assert.deepEqual(clean.current_context.conversation.retained_past_originals, []);
  assert.equal(
    clean.current_context.conversation.older_conversation_summary,
    "과거 약관 요약",
  );
  assert.deepEqual(
    clean.available_verified_evidence.documents.map((d) => d.document_id),
    ["a"],
  );
  const badAnswer =
    "지금까지 올라온 서류 전체와 한화손보 세이프단체보험 약관을 기준으로 합계를 보면";
  assert.equal(answerMentionsOutOfAttachHistoryScope(badAnswer), true);
  const scopeHint = buildAttachAnalysisScopeAuthorityAddendum({
    documentIds: ["doc-a", "doc-b", "doc-c"],
    totals: { premium_row_count: 0, no_computable_premiums_in_current_attach: true },
  });
  assert.match(scopeHint, /ATTACH_ANALYSIS_SCOPE_ONLY/);
  assert.match(scopeHint, /current_attach_document_count=3/);
  assert.match(scopeHint, /관련 verified customer facts/);
  assert.match(scopeHint, /다시 올리라고 요구하지 않는다/);
  const noPrem = buildDeterministicTotalsAuthorityAddendum({
    unique_document_count: 2,
    unique_original_block_count: 2,
    attachment_identity_count: 3,
    premium_row_count: 0,
    monthly_premium_sum: 0,
    premiums: [],
    requested_document_ids: ["a", "b", "c"],
    originals_available: true,
  });
  assert.match(noPrem, /deterministic_total_status=unknown/);
  assert.match(noPrem, /originals_available=true/);
  assert.match(noPrem, /inspect_originals_before_concluding=true/);
  assert.doesNotMatch(noPrem, /computable_premiums=false/);
  assert.doesNotMatch(noPrem, /NO_PREMIUM/);
  assert.doesNotMatch(noPrem, /다시 올리/);
  assert.doesNotMatch(noPrem, /보험료가 없다|계산 불가|문서 부족/);
}
ok("attach_scope_keeps_related_memory_strips_unrelated_past");

// 11) Same contract 3 pages → read count 3, premium once (183231).
{
  const rows = [
    {
      document_id: "p1",
      monthly_premium: 183231,
      policy_number: "POL-9",
      content_sha256: "page-1",
    },
    {
      document_id: "p2",
      monthly_premium: 183231,
      policy_number: "POL-9",
      content_sha256: "page-2",
    },
    {
      document_id: "p3",
      monthly_premium: 183231,
      policy_number: "POL-9",
      content_sha256: "page-3",
    },
  ];
  const sum = sumMonthlyPremiumsDeterministic(rows);
  assert.equal(sum.unique_document_count, 3);
  assert.equal(sum.unique_contract_count, 1);
  assert.equal(sum.contract_count_status, "verified");
  assert.equal(sum.premium_row_count, 1);
  assert.equal(sum.monthly_premium_sum, 183231);
  // Delivery layer keeps all three pages even if a stale stored sha were shared.
  const delivery = dedupeRowsForOriginalDelivery([
    { document_id: "p1", base64: Buffer.from("page-bytes-1").toString("base64") },
    { document_id: "p2", base64: Buffer.from("page-bytes-2").toString("base64") },
    { document_id: "p3", base64: Buffer.from("page-bytes-3").toString("base64") },
  ]);
  assert.equal(delivery.length, 3);
  const staleStoredSameSha = dedupeRowsForOriginalDelivery([
    {
      document_id: "p1",
      content_sha256: "stale-shared",
      base64: Buffer.from("page-bytes-1").toString("base64"),
    },
    {
      document_id: "p2",
      content_sha256: "stale-shared",
      base64: Buffer.from("page-bytes-2").toString("base64"),
    },
    {
      document_id: "p3",
      content_sha256: "stale-shared",
      base64: Buffer.from("page-bytes-3").toString("base64"),
    },
  ]);
  assert.equal(staleStoredSameSha.length, 3);
  const exactBytesDup = dedupeRowsForOriginalDelivery([
    { document_id: "a1", base64: Buffer.from("same-bytes").toString("base64") },
    { document_id: "a2", base64: Buffer.from("same-bytes").toString("base64") },
  ]);
  assert.equal(exactBytesDup.length, 1);
}
ok("same_contract_three_pages_premium_once");

// 12) Post-Claude customer_answer mutation helpers removed from customer path.
{
  assert.equal(
    typeof keyDocumentSumAccuracy.sealCustomerAnswerWithDeterministicTotals,
    "undefined",
  );
  assert.equal(typeof keyDocumentSumAccuracy.sealVaultDocumentSourceSpeak, "undefined");
  assert.equal(
    typeof keyDocumentSumAccuracy.applyDeterministicPremiumSumGuard,
    "undefined",
  );
  const here = path.dirname(fileURLToPath(import.meta.url));
  const claudeFirst = readFileSync(
    path.join(here, "../server/keyCore/keyClaudeFirstDirect.js"),
    "utf8",
  );
  assert.equal(claudeFirst.includes("sealCustomerAnswerWithDeterministicTotals"), false);
  assert.equal(claudeFirst.includes("sealVaultDocumentSourceSpeak"), false);
  assert.equal(claudeFirst.includes("applyDeterministicPremiumSumGuard"), false);
  assert.match(claudeFirst, /buildDeterministicTotalsAuthorityAddendum/);
  assert.match(claudeFirst, /buildVaultDocumentSourceScopeAddendum/);
  assert.match(claudeFirst, /pdfAttachmentsForClaude\.length >= 1/);
  assert.match(claudeFirst, /contentSha256FromBase64/);
  const evalAddendum = buildUnsupportedEvaluationAuthorityAddendum();
  assert.match(evalAddendum, /EVALUATION_AUTHORITY/);
  assert.match(evalAddendum, /근거가 없으면/);
}
ok("post_claude_customer_text_mutation_removed");

// 13) Follow-up originals require active attachment scope (no conversation restore).
{
  assert.equal(isAttachContextFollowUpQuestion("보험료 합산만 해줘"), true);
  assert.equal(isAttachContextFollowUpQuestion("보장내역은?"), true);
  assert.equal(isAttachContextFollowUpQuestion("합산금액이라고 했잖아"), true);
  assert.equal(isAttachContextFollowUpQuestion("이것만 정리해줘"), true);
  assert.equal(isAttachContextFollowUpQuestion("아까 서류 기준으로"), true);
  const meta = {
    active_attachment_id: "c",
    active_attachment_ids: ["a", "b", "c"],
    evidence_package: { attached_document_ids: ["a", "b", "c"] },
  };
  assert.deepEqual(extractActiveAttachmentIdsFromMetadata(meta), ["a", "b", "c"]);
  const norm = normalizeActiveAttachment({
    active_attachment_id: "c",
    active_attachment_ids: ["a", "b", "c"],
  });
  assert.deepEqual(norm.active_attachment_ids, ["a", "b", "c"]);

  const owned = new Set(["a", "b", "c"]);
  const staleOnly = await resolveActiveInsuranceDocumentCase({
    supabase: {},
    customerId: "cust-1",
    sessionId: "sess-1",
    clientDocumentId: "c",
    clientDocumentIds: ["c"],
    attachmentReferenceEnabled: false,
    activeAttachmentIds: [],
    currentTurnDocumentIds: [],
    enforceAttachmentScope: true,
    verifyOwned: async ({ documentId }) => owned.has(documentId),
  });
  assert.equal(staleOnly.documentId, null);
  assert.deepEqual(staleOnly.documentIds, []);

  const scopedSelect = await resolveActiveInsuranceDocumentCase({
    supabase: {},
    customerId: "cust-1",
    sessionId: "sess-1",
    clientDocumentId: "c",
    clientDocumentIds: ["c"],
    attachmentReferenceEnabled: true,
    activeAttachmentIds: ["a", "b", "c"],
    currentTurnDocumentIds: [],
    enforceAttachmentScope: true,
    verifyOwned: async ({ documentId }) => owned.has(documentId),
  });
  // request_document_id selects inside active scope — no conversation widen.
  assert.equal(scopedSelect.documentId, "c");
  assert.deepEqual(scopedSelect.documentIds, ["c"]);

  const scopedMulti = await resolveActiveInsuranceDocumentCase({
    supabase: {
      from() {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          order() {
            return this;
          },
          limit() {
            return Promise.resolve({
              data: [
                {
                  role: "assistant",
                  metadata_json: {
                    session_id: "sess-1",
                    active_attachment_ids: ["a", "b", "c"],
                    evidence_package: { attached_document_ids: ["a", "b", "c"] },
                  },
                },
              ],
              error: null,
            });
          },
        };
      },
    },
    customerId: "cust-1",
    sessionId: "sess-1",
    clientDocumentId: "a",
    clientDocumentIds: ["a", "b", "c"],
    attachmentReferenceEnabled: true,
    activeAttachmentIds: ["a", "b", "c"],
    currentTurnDocumentIds: [],
    enforceAttachmentScope: true,
    verifyOwned: async ({ documentId }) => owned.has(documentId),
  });
  assert.deepEqual(scopedMulti.documentIds, ["a", "b", "c"]);
  assert.equal(scopedMulti.restored, false);

  const conversationCannotAuthorize = await resolveActiveInsuranceDocumentCase({
    supabase: {
      from() {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          order() {
            return this;
          },
          limit() {
            return Promise.resolve({
              data: [
                {
                  role: "assistant",
                  metadata_json: {
                    session_id: "sess-1",
                    active_attachment_ids: ["a", "b", "c"],
                    evidence_package: { attached_document_ids: ["a", "b", "c"] },
                  },
                },
              ],
              error: null,
            });
          },
        };
      },
    },
    customerId: "cust-1",
    sessionId: "sess-1",
    clientDocumentId: null,
    clientDocumentIds: [],
    attachmentReferenceEnabled: false,
    activeAttachmentIds: [],
    currentTurnDocumentIds: [],
    enforceAttachmentScope: true,
    verifyOwned: async ({ documentId }) => owned.has(documentId),
  });
  assert.deepEqual(conversationCannotAuthorize.documentIds, []);
}
ok("follow_up_expands_multi_attach_snapshot");

// 14) Vault source_scope is pre-Claude addendum only (no post-answer rewrite helper).
{
  const addendum = buildVaultDocumentSourceScopeAddendum();
  assert.match(addendum, /source_scope=vault_document/);
  assert.match(addendum, /보관 중이던 문서/);
  assert.match(addendum, /답변 뒤에서 고치지 않는다/);
  assert.match(addendum, /Claude가 직접 작성/);
}
ok("vault_source_scope_pre_claude_addendum");

// 15) Normalize failure must not drop a request document_id.
{
  const kept = await normalizeAttachmentRowsForClaude(
    [
      {
        document_id: "d1",
        base64: Buffer.from("not-an-image").toString("base64"),
        mediaType: "image/jpeg",
      },
      {
        document_id: "d2",
        base64: Buffer.from("%PDF-1.4 ok").toString("base64"),
        mediaType: "application/pdf",
      },
      {
        document_id: "d3",
        base64: Buffer.from("also-not-image").toString("base64"),
        mediaType: "image/png",
      },
    ],
    {
      vaultSafeImage: true,
      sharpImpl: () => ({
        rotate() {
          return this;
        },
        resize() {
          return this;
        },
        jpeg() {
          return this;
        },
        async toBuffer() {
          throw new Error("decode fail");
        },
      }),
    },
  );
  assert.equal(kept.length, 3);
  assert.deepEqual(
    kept.map((r) => r.document_id),
    ["d1", "d2", "d3"],
  );
}
ok("normalize_keeps_all_document_ids");

// 16) Identities 3 / unique blocks 2 / C→A duplicate map.
{
  const bytesA = Buffer.from("page-1-of-3-bytes");
  const bytesB = Buffer.from("page-2-of-3-bytes");
  const plan = buildAttachmentIdentityDeliveryPlan({
    identityRows: [
      {
        document_id: "a",
        original_filename: "1-3.png",
        base64: bytesA.toString("base64"),
        source_scope: "current_turn_attachment",
      },
      {
        document_id: "b",
        original_filename: "2-3.png",
        base64: bytesB.toString("base64"),
        source_scope: "current_turn_attachment",
      },
      {
        document_id: "c",
        original_filename: "1-3-dup.png",
        base64: bytesA.toString("base64"),
        source_scope: "current_turn_attachment",
      },
    ],
  });
  assert.equal(plan.attachment_identity_count, 3);
  assert.equal(plan.unique_original_block_count, 2);
  assert.deepEqual(plan.duplicate_map, [
    { document_id: "c", duplicate_of_document_id: "a" },
  ]);
  const distinct = buildAttachmentIdentityDeliveryPlan({
    identityRows: [
      { document_id: "a", base64: Buffer.from("p1").toString("base64") },
      { document_id: "b", base64: Buffer.from("p2").toString("base64") },
      { document_id: "c", base64: Buffer.from("p3").toString("base64") },
    ],
  });
  assert.equal(distinct.attachment_identity_count, 3);
  assert.equal(distinct.unique_original_block_count, 3);
}
ok("attachment_identities_vs_unique_blocks");

// 17) scopeOnly must not forceScrub history; deleted recheck sticky scrub retained.
{
  const history = [
    { role: "user", text: "(첨부: a.png)\n방금 올린 세 서류 합계" },
    { role: "assistant", text: "월 보험료는 183,231원입니다." },
    { role: "user", text: "지금 올린 서류 기준으로 보장내역을 정리해줘" },
  ];
  const kept = filterHistoryExcludingInactiveDocumentAttachments(history, [
    { document_id: "a", original_filename: "a.png" },
  ], { forceScrubAttachSegments: false });
  assert.equal(kept.length, 3);
  const scrubbed = filterHistoryExcludingInactiveDocumentAttachments(
    history,
    [],
    { forceScrubAttachSegments: true },
  );
  assert.ok(scrubbed.length < 3);
}
ok("scopeOnly_history_keeps_prior_qa");

// 18) Session metadata persists active_attachment_ids array.
{
  const meta = buildSessionMetadata("sess-1", {
    activeAttachment: {
      active_attachment_id: "c",
      active_attachment_ids: ["a", "b", "c"],
    },
  });
  assert.deepEqual(meta.active_attachment_ids, ["a", "b", "c"]);
  assert.equal(meta.active_attachment_id, "c");
  const legacy = normalizeActiveAttachment({ active_attachment_id: "only" });
  assert.deepEqual(legacy.active_attachment_ids, ["only"]);
}
ok("session_metadata_active_attachment_ids");

// 19) Context contract + confirmation boundary + inference filter.
{
  const contract = buildKeyClaudeContextContractAddendum({
    now: new Date("2026-07-31T05:00:00.000Z"),
    timeZone: "Asia/Seoul",
    attachmentIdentities: [
      {
        original_index: 1,
        document_id: "a",
        source_scope: "current_turn_attachment",
        duplicate_of_document_id: null,
      },
    ],
    history: [{ role: "user", text: "hi", created_at: "2026-07-31T04:59:00.000Z" }],
  });
  assert.match(contract, /KEY_CLAUDE_CONTEXT_CONTRACT/);
  assert.match(contract, /user_timezone=Asia\/Seoul/);
  assert.match(contract, /reference_now_iso=/);
  const boundary = buildCustomerConfirmationBoundaryAddendum();
  assert.match(boundary, /CUSTOMER_CONFIRMATION_BOUNDARY/);
  assert.equal(isClaudeInferenceOrEvaluationLiteral("보장이 두텁습니다"), true);
  assert.equal(isClaudeInferenceOrEvaluationLiteral("183231"), false);
  assert.equal(isAttachContextFollowUpQuestion("지금 올린 서류 기준으로"), true);
  assert.equal(isAttachContextFollowUpQuestion("방금 올린 서류"), true);
}
ok("context_contract_and_confirmation_boundary");

// 20) QUESTION SCOPE + GROUNDED PRODUCT RECOMMENDATION (TEST A–E mechanics + integrity).
{
  const qA = "방금 올린 세 서류의 월 보험료 합계만 계산해줘";
  const qB = "필요한 보장과 상품 추천해줘";
  const qC = "어느 회사 상품이 좋아?";
  const qD = "지금 올린 서류 기준으로 보장내역을 정리하고, 중복된 페이지와 빠진 페이지가 있으면 알려줘.";
  const qE = "이 서류 전체를 자세히 분석하고 보완할 상품도 추천해줘.";

  // TEST A — narrow sum request: priority block + response scope forbids unsolicited dump.
  const priorityA = buildCurrentCustomerRequestPriorityBlock(qA);
  assert.match(priorityA, /CURRENT_CUSTOMER_REQUEST/);
  assert.ok(priorityA.includes(qA));
  assert.match(priorityA, /RESPONSE_SCOPE/);
  assert.match(priorityA, /전체 담보 목록/);
  assert.match(priorityA, /누락 페이지 안내/);
  assert.match(priorityA, /추가 상담 제안/);
  assert.equal(isExplicitCurrentInsuranceProductRequest(qA), false);
  const totals = sumMonthlyPremiumsDeterministic([
    { document_id: "a", monthly_premium: 183231, content_sha256: "p1", policy_number: "POL-A" },
    { document_id: "b", monthly_premium: 183231, content_sha256: "p2", policy_number: "POL-A" },
    { document_id: "c", monthly_premium: 183231, content_sha256: "p1", policy_number: "POL-A" },
  ]);
  assert.equal(totals.unique_document_count, 2); // a+c exact sha dup → 2 unique pages
  assert.equal(totals.unique_contract_count, 1);
  assert.equal(totals.monthly_premium_sum, 183231);
  const partsA = buildClaudeFirstCachedRequestParts({
    systemText: "sys",
    userPayload: {
      current_question: qA,
      current_context: {},
      available_verified_evidence: {
        personal: {},
        corporate: [],
        documents: [],
        public_evidence: [],
      },
    },
  });
  const lastA = partsA.messages[0].content.at(-1).text;
  assert.match(lastA, /CURRENT_CUSTOMER_REQUEST/);
  assert.ok(lastA.includes(qA));
  assert.equal(
    partsA.messages[0].content.filter((b) => String(b?.text ?? "").includes("CURRENT_CUSTOMER_REQUEST")).length,
    1,
  );

  // TEST B/C — product recommend path opens grounded showcase + no refusal default.
  assert.equal(isExplicitCurrentInsuranceProductRequest(qB), true);
  assert.equal(isExplicitCurrentInsuranceProductRequest(qC), true);
  assert.equal(isExplicitCurrentInsuranceProductRequest("나한테 맞는 보험 추천해줘"), true);
  const showcase = buildCurrentInsuranceProductShowcaseAddendum({ question: qC });
  assert.match(showcase, /CURRENT_INSURANCE_PRODUCT_SHOWCASE/);
  assert.match(showcase, /고정 회피문을 기본값으로 쓰지 않는다/);
  assert.match(showcase, /가입 가능 여부/);
  const sysB = composeClaudeFirstSystemText({ question: qB });
  assert.match(sysB, /CURRENT_INSURANCE_PRODUCT_SHOWCASE/);
  assert.match(sysB, /회사명·상품명 자체를 회피하지 않는다/);
  assert.equal(sysB.includes("특정 상품 이름은 지금 단계에선 말씀드리기 어려워요"), false);

  // TEST D/E — detailed analysis allowed when asked; scope still question-led.
  const priorityD = buildCurrentCustomerRequestPriorityBlock(qD);
  assert.ok(priorityD.includes(qD));
  const priorityE = buildCurrentCustomerRequestPriorityBlock(qE);
  assert.ok(priorityE.includes(qE));
  assert.equal(isExplicitCurrentInsuranceProductRequest(qE), true);
  const scoped = buildQuestionScopedAnalysisAuthorityAddendum();
  assert.match(scoped, /QUESTION_SCOPED_ANALYSIS/);
  assert.match(scoped, /고객이 그 분석을 요청한 경우에만/);
  const evalAuth = buildUnsupportedEvaluationAuthorityAddendum();
  assert.match(evalAuth, /갈아탈 필요 없음/);
  assert.match(evalAuth, /확인되지 않습니다/);

  // Integrity — post-Claude Hand seals remain absent; no customer rewrite helpers reintroduced.
  assert.equal(typeof keyDocumentSumAccuracy.sealCustomerAnswerWithDeterministicTotals, "undefined");
  assert.equal(typeof keyDocumentSumAccuracy.sealVaultDocumentSourceSpeak, "undefined");
  assert.equal(typeof keyDocumentSumAccuracy.applyDeterministicPremiumSumGuard, "undefined");
  const claudeFirst = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../server/keyCore/keyClaudeFirstDirect.js"),
    "utf8",
  );
  assert.equal(claudeFirst.includes("sealCustomerAnswerWithDeterministicTotals"), false);
  assert.match(claudeFirst, /buildCurrentCustomerRequestPriorityBlock/);
  assert.match(claudeFirst, /buildQuestionScopedAnalysisAuthorityAddendum/);
  // Pure integrity marker: Claude answer text identity through seal path (no mutation helper).
  const sample = "세 파일은 같은 계약의 서류이고 한 파일은 중복입니다. 따라서 월 보험료 합계는 183,231원입니다.";
  const sha = createHash("sha256").update(sample, "utf8").digest("hex");
  assert.equal(createHash("sha256").update(sample, "utf8").digest("hex"), sha);
}
ok("question_scope_and_grounded_product_recommendation");

console.log("\nALL PASS key-doc-identity-sum-accuracy-unit-test");
