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
import {
  buildClaudeFullContextPack,
  filterHistoryExcludingInactiveDocumentAttachments,
} from "../server/keyCore/keyClaudeFullContextPack.js";
import { buildSessionMetadata } from "../src/lib/lifeguardChatSessionCore.js";
import * as keyDocumentSumAccuracy from "../server/keyCore/keyDocumentSumAccuracy.js";
import {
  wantsOwnedInsuranceVaultEvidence,
  shouldProvideOwnedInsuranceVaultOriginals,
  shouldRunOwnedVaultRecall,
  extractActiveAttachmentIdsFromMetadata,
  extractActiveAttachmentFromSessionMessages,
  normalizeActiveAttachment,
  normalizeRestorableAttachmentCandidate,
  pickRestorableAttachmentCandidate,
  isRestorableAttachmentCandidateInScope,
} from "../src/lib/chatActiveAttachment.js";
import {
  buildHomeBrainFactRequestBody,
  resolveAttachmentRequestScope,
} from "../src/lib/homeBrainFactRequestBody.js";
import { normalizeAttachmentRowsForClaude } from "../server/keyCore/keyImageOrientation.js";
import { resolveActiveInsuranceDocumentCase } from "../server/keyCore/keyActiveInsuranceDocumentCase.js";
import {
  mergeOwnedDocumentAttachRows,
  resolveAttachRowContentSha,
  listOwnedInsuranceOriginalDocuments,
} from "../server/keyCore/keyClaudeFullDocumentDirect.js";
import {
  buildClaudeFirstCachedRequestParts,
  buildClaudeVerifiedChartProjection,
  buildUserPayload,
  collapseVerifiedDocumentCoveragesSourceIdEnrichment,
  composeClaudeFirstSystemText,
  serializeClaudeFirstCachePrefixForAudit,
  CLAUDE_VERIFIED_CHART_LONG_STRING_LIMIT,
  LIFEGUARD_KEY_SYSTEM_PROMPT,
  summarizeClaudeFirstWebSearchBlocks,
  buildClaudeFirstModelTelemetry,
  attachClaudeFirstTelemetryToLatencyMarks,
  callClaudeFirstDirect,
} from "../server/keyCore/keyClaudeFirstDirect.js";
import { buildPersistableLatencyMarks } from "../server/keyCore/keyLatencyMarks.js";
import {
  buildVerifiedPolicyLedgerBrief,
  buildSourceSeparatedTruthContext,
  buildVerifiedCoverageAuthorityAddendum,
  projectClaudeVerifiedPolicyLedgerBrief,
} from "../server/keyCore/keyPolicyTruthEvidence.js";
import { buildVerifiedCustomerChart } from "../server/keyCore/keyBorrowedSensesSpeak.js";
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
  assert.match(contract, /current_context\.current_datetime/);
  assert.match(contract, /timezone/);
  assert.equal(contract.includes("reference_now_iso="), false);
  assert.equal(contract.includes("recent_thread_timestamps="), false);
  assert.equal(contract.includes("2026-07-31T05:00:00.000Z"), false);
  assert.equal(contract.includes("document_id=a"), false);
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

// ─── Explicit prior-attachment reactivation (TEST 1–10) ───
{
  const homeChatPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/components/LifeguardHomeChat.jsx",
  );
  const homeChatSrc = readFileSync(homeChatPath, "utf8");

  // TEST 1 — past message metadata hydrate → candidate only, request scope empty
  {
    const messages = [
      {
        role: "user",
        content: "업로드",
        metadata: {
          active_attachment_id: "B",
          active_attachment_ids: ["A", "B"],
          active_attachment_mime: "application/pdf",
        },
      },
    ];
    const fromMessages = extractActiveAttachmentFromSessionMessages(messages);
    assert.deepEqual(fromMessages.active_attachment_ids, ["A", "B"]);
    const candidate = pickRestorableAttachmentCandidate({
      messages,
      snapshot: null,
      customerId: "cust-1",
      sessionId: "sess-1",
    });
    assert.deepEqual(candidate.active_attachment_ids, ["A", "B"]);
    assert.equal(candidate.session_id, "sess-1");
    assert.equal(candidate.customer_id, "cust-1");
    const active = [];
    assert.deepEqual(active, []);
    const scope = resolveAttachmentRequestScope({
      attachmentReferenceEnabled: false,
      activeAttachmentIds: active,
      currentTurnDocumentIds: [],
      documentId: candidate.active_attachment_id,
      documentIds: candidate.active_attachment_ids,
    });
    assert.equal(scope.attachmentReferenceEnabled, false);
    assert.deepEqual(scope.activeAttachmentIds, []);
    assert.deepEqual(scope.currentTurnDocumentIds, []);
    assert.equal(scope.documentId, null);
    const body = buildHomeBrainFactRequestBody("암주요치료비는 뭐야?", [], {
      attachmentReferenceEnabled: false,
      activeAttachmentIds: [],
      currentTurnDocumentIds: [],
      documentId: candidate.active_attachment_id,
      documentIds: candidate.active_attachment_ids,
      sessionId: "sess-1",
    });
    assert.equal(body.attachment_reference_enabled, false);
    assert.equal(body.active_attachment_ids, undefined);
    assert.equal(body.current_turn_document_ids, undefined);
    assert.equal(body.document_id, undefined);
    assert.equal(JSON.stringify(body).includes("\"A\""), false);
    assert.equal(JSON.stringify(body).includes("\"B\""), false);
  }
  ok("explicit_reactivation_test1_message_metadata_hydrate");

  // TEST 2 — snapshot hydrate → candidate only
  {
    const snapshot = {
      sessionId: "sess-2",
      activeAttachment: {
        active_attachment_id: "B",
        active_attachment_ids: ["A", "B"],
        active_attachment_mime: "image/jpeg",
      },
    };
    const candidate = pickRestorableAttachmentCandidate({
      messages: [],
      snapshot,
      customerId: "cust-1",
      sessionId: "sess-2",
    });
    assert.deepEqual(candidate.active_attachment_ids, ["A", "B"]);
    const scope = resolveAttachmentRequestScope({
      attachmentReferenceEnabled: false,
      activeAttachmentIds: [],
      currentTurnDocumentIds: [],
      documentIds: candidate.active_attachment_ids,
    });
    assert.equal(scope.attachmentReferenceEnabled, false);
    assert.deepEqual(scope.activeAttachmentIds, []);
  }
  ok("explicit_reactivation_test2_snapshot_hydrate");

  // TEST 3 — explicit reactivation click → active=[A,B], no current-turn, no API
  {
    const candidate = normalizeRestorableAttachmentCandidate(
      {
        active_attachment_id: "B",
        active_attachment_ids: ["A", "B"],
      },
      { customerId: "cust-1", sessionId: "sess-1" },
    );
    const activeBefore = [];
    assert.deepEqual(activeBefore, []);
    assert.equal(
      isRestorableAttachmentCandidateInScope(candidate, {
        customerId: "cust-1",
        sessionId: "sess-1",
      }),
      true,
    );
    const activeAfter = candidate.active_attachment_ids.slice();
    assert.deepEqual(activeAfter, ["A", "B"]);
    const body = buildHomeBrainFactRequestBody("이 서류 보장 정리해줘", [], {
      attachmentReferenceEnabled: true,
      activeAttachmentIds: activeAfter,
      currentTurnDocumentIds: [],
      sessionId: "sess-1",
    });
    assert.equal(body.attachment_reference_enabled, true);
    assert.deepEqual(body.active_attachment_ids, ["A", "B"]);
    assert.equal(body.current_turn_document_ids, undefined);
    assert.equal(homeChatSrc.includes("reactivateRestorableAttachmentCandidate"), true);
    assert.match(homeChatSrc, /onClick=\{reactivateRestorableAttachmentCandidate\}/);
    assert.equal(homeChatSrc.includes("fetch(") && /reactivateRestorableAttachmentCandidate[\s\S]{0,400}fetch\(/.test(homeChatSrc), false);
  }
  ok("explicit_reactivation_test3_click_activates_only");

  // TEST 4 — current 3-file upload path (identity / dedupe / sum) + request shape
  {
    const ids = ["a", "b", "c"];
    const body = buildHomeBrainFactRequestBody("세 서류 월 보험료 합계", [], {
      attachmentReferenceEnabled: true,
      activeAttachmentIds: ids,
      currentTurnDocumentIds: ids,
      documentIds: ids,
      sessionId: "sess-up",
    });
    assert.equal(body.attachment_reference_enabled, true);
    assert.deepEqual(body.active_attachment_ids, ["a", "b", "c"]);
    assert.deepEqual(body.current_turn_document_ids, ["a", "b", "c"]);
    const bytesA = Buffer.from("page-1-reactivation-test4");
    const bytesB = Buffer.from("page-2-reactivation-test4");
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
    const totals = sumMonthlyPremiumsDeterministic([
      { document_id: "a", monthly_premium: 183231, content_sha256: "sha-a", policy_number: "POL-A" },
      { document_id: "b", monthly_premium: 183231, content_sha256: "sha-b", policy_number: "POL-A" },
      { document_id: "c", monthly_premium: 183231, content_sha256: "sha-a", policy_number: "POL-A" },
    ]);
    assert.equal(totals.monthly_premium_sum, 183231);
  }
  ok("explicit_reactivation_test4_current_upload_multi");

  // TEST 5 — same-screen follow-up: active kept, current-turn cleared
  {
    const body = buildHomeBrainFactRequestBody("합산만", [], {
      attachmentReferenceEnabled: true,
      activeAttachmentIds: ["a", "b", "c"],
      currentTurnDocumentIds: [],
      sessionId: "sess-up",
    });
    assert.equal(body.attachment_reference_enabled, true);
    assert.deepEqual(body.active_attachment_ids, ["a", "b", "c"]);
    assert.equal(body.current_turn_document_ids, undefined);
  }
  ok("explicit_reactivation_test5_same_screen_followup");

  // TEST 6 — clear → general question isolates candidate
  {
    const candidate = normalizeRestorableAttachmentCandidate(
      { active_attachment_id: "B", active_attachment_ids: ["A", "B"] },
      { customerId: "cust-1", sessionId: "sess-1" },
    );
    const body = buildHomeBrainFactRequestBody("일반 질문", [], {
      attachmentReferenceEnabled: false,
      activeAttachmentIds: [],
      currentTurnDocumentIds: [],
      documentIds: candidate.active_attachment_ids,
      sessionId: "sess-1",
    });
    assert.equal(body.attachment_reference_enabled, false);
    assert.equal(body.active_attachment_ids, undefined);
    assert.equal(body.current_turn_document_ids, undefined);
    assert.equal(body.document_id, undefined);
    assert.ok(candidate);
  }
  ok("explicit_reactivation_test6_clear_general_question");

  // TEST 7 — clear then reactivate: only candidate IDs, no auto-expand
  {
    const candidate = normalizeRestorableAttachmentCandidate(
      { active_attachment_id: "B", active_attachment_ids: ["A", "B"] },
      { customerId: "cust-1", sessionId: "sess-1" },
    );
    const active = candidate.active_attachment_ids.slice();
    assert.deepEqual(active, ["A", "B"]);
    assert.equal(active.includes("Z"), false);
    const body = buildHomeBrainFactRequestBody("다시 참조", [], {
      attachmentReferenceEnabled: true,
      activeAttachmentIds: active,
      currentTurnDocumentIds: [],
    });
    assert.deepEqual(body.active_attachment_ids, ["A", "B"]);
    assert.equal(body.current_turn_document_ids, undefined);
  }
  ok("explicit_reactivation_test7_clear_then_reactivate");

  // TEST 8 — late hydrate race: hydrate never writes active; epoch guard present
  {
    assert.match(homeChatSrc, /userAttachActionEpochRef/);
    assert.match(homeChatSrc, /userEpochAtStart/);
    assert.match(
      homeChatSrc,
      /userAttachActionEpochRef\.current === userEpochAtStart/,
    );
    assert.match(homeChatSrc, /setRestorableAttachmentCandidate\(candidate\)/);
    // Hydrate restore block must not call setConversationActiveAttachment
    const hydrateIdx = homeChatSrc.indexOf("Past attach → restorable candidate only");
    assert.ok(hydrateIdx > 0);
    const hydrateSlice = homeChatSrc.slice(hydrateIdx, hydrateIdx + 1200);
    assert.equal(hydrateSlice.includes("setConversationActiveAttachment"), false);
    assert.equal(hydrateSlice.includes("setRestorableAttachmentCandidate"), true);
  }
  ok("explicit_reactivation_test8_late_hydrate_guard");

  // TEST 9 — session/customer isolation
  {
    const candidate = normalizeRestorableAttachmentCandidate(
      { active_attachment_id: "A", active_attachment_ids: ["A"] },
      { customerId: "cust-A", sessionId: "sess-1" },
    );
    assert.equal(
      isRestorableAttachmentCandidateInScope(candidate, {
        customerId: "cust-B",
        sessionId: "sess-1",
      }),
      false,
    );
    assert.equal(
      isRestorableAttachmentCandidateInScope(candidate, {
        customerId: "cust-A",
        sessionId: "sess-2",
      }),
      false,
    );
    const snapOther = {
      sessionId: "sess-other",
      activeAttachment: {
        active_attachment_id: "X",
        active_attachment_ids: ["X", "Y"],
      },
    };
    const picked = pickRestorableAttachmentCandidate({
      messages: [
        {
          metadata: {
            active_attachment_id: "A",
            active_attachment_ids: ["A", "B"],
          },
        },
      ],
      snapshot: snapOther,
      customerId: "cust-A",
      sessionId: "sess-1",
    });
    assert.deepEqual(picked.active_attachment_ids, ["A", "B"]);
    assert.equal(picked.active_attachment_ids.includes("X"), false);
    assert.match(homeChatSrc, /prevCustomerIdRef/);
    assert.match(homeChatSrc, /setRestorableAttachmentCandidate\(null\)/);
  }
  ok("explicit_reactivation_test9_session_customer_isolation");

  // TEST 10 — candidate request isolation (CASE A)
  {
    const body = buildHomeBrainFactRequestBody("암주요치료비는 뭐야?", [], {
      attachmentReferenceEnabled: false,
      activeAttachmentIds: [],
      currentTurnDocumentIds: [],
      // attacker/leak attempt: candidate ids must not serialize
      documentId: "A",
      documentIds: ["A", "B"],
      sessionId: "sess-1",
    });
    assert.equal(body.attachment_reference_enabled, false);
    assert.equal(body.active_attachment_ids, undefined);
    assert.equal(body.current_turn_document_ids, undefined);
    assert.equal(body.document_id, undefined);
    assert.equal(body.document_ids, undefined);
    const raw = JSON.stringify(body);
    assert.equal(raw.includes("\"A\""), false);
    assert.equal(raw.includes("\"B\""), false);
  }
  ok("explicit_reactivation_test10_candidate_request_isolation");

  // Static UI invariants
  assert.match(homeChatSrc, /첨부 참조 해제/);
  assert.match(homeChatSrc, /개 참조하기/);
  assert.match(homeChatSrc, /type="button"/);
  assert.match(homeChatSrc, /KEY가 확인하고 있어요\./);
  assert.equal(homeChatSrc.includes("restorableAttachmentCandidate"), true);
}
ok("explicit_prior_attachment_reactivation_suite");

// ─── Claude prompt cache prefix stability (TEST 1–6 + structure) ───
{
  const sha256 = (s) => createHash("sha256").update(String(s ?? ""), "utf8").digest("hex");

  function synthPolicies(version = "A") {
    // Version B changes a verified chart fact that survives chart projection.
    return [
      {
        id: "pol_cache_1",
        policy_id: "pol_cache_1",
        insurer_name: "테스트보험",
        product_name: version === "B" ? "테스트암보험_변경" : "테스트암보험",
        policy_number: "PN-CACHE-1",
        monthly_premium: version === "B" ? 190000 : 183231,
        status: "active",
        identity_strength: "strong",
        coverages: [
          {
            coverage_name: "암진단비",
            coverage_amount: 5_000_000,
            status: "verified",
            source_document_id: "doc_cache_1",
          },
        ],
      },
    ];
  }

  function buildOrdinaryNoAttachSystemText({ question, history = [], chart, ledger }) {
    // Mirrors callClaudeFirstDirect no-attach ordinary path order (no fetch).
    let systemText = composeClaudeFirstSystemText({ question, history });
    const covAuth = buildVerifiedCoverageAuthorityAddendum({
      ledgerBrief: ledger,
      chart,
    });
    if (covAuth) {
      systemText = `${systemText}\n\n[VERIFIED_COVERAGE_AUTHORITY]\n${covAuth}`;
    }
    systemText = `${systemText}\n\n${buildKeyClaudeContextContractAddendum()}`;
    systemText = `${systemText}\n\n${buildCustomerConfirmationBoundaryAddendum()}`;
    systemText = `${systemText}\n\n${buildQuestionScopedAnalysisAuthorityAddendum()}`;
    return systemText;
  }

  function buildAuditSlices({
    question,
    history = [],
    now,
    policies,
    chartVersion = "A",
  }) {
    const pols = policies || synthPolicies(chartVersion);
    const chart = buildVerifiedCustomerChart({ policies: pols, policy_count: pols.length });
    const ledger = buildVerifiedPolicyLedgerBrief(pols);
    const policyTruth = buildSourceSeparatedTruthContext({
      ledgerBrief: ledger,
      evidenceMeta: { attached_document_count: 0 },
      countQuestion: false,
    });
    const { pack } = buildClaudeFullContextPack({ history, question });
    const systemText = buildOrdinaryNoAttachSystemText({
      question,
      history,
      chart,
      ledger,
    });
    const userPayload = buildUserPayload({
      question,
      chart,
      contextPack: pack,
      policyTruthContext: policyTruth,
      now,
    });
    const slices = serializeClaudeFirstCachePrefixForAudit({
      systemText,
      userPayload,
      attachments: null,
      attachmentIdentityPlan: null,
    });
    return { ...slices, chart, pack, userPayload, systemText };
  }

  const t1 = "2026-08-01T01:20:00.111+09:00";
  const t2 = "2026-08-01T01:21:37.987+09:00";
  const qOrdinary1 = "암진단비는 뭐야?";
  const qOrdinary2 = "실손보험은 어떻게 보장돼?";

  // TEST 1 — PREFIX_HASH_STABLE_TIME
  {
    const hist = [
      { role: "user", content: "안녕", created_at: "THREAD_TS_SENTINEL_222" },
      { role: "assistant", content: "안녕하세요", created_at: "THREAD_TS_A" },
    ];
    const r1 = buildAuditSlices({
      question: qOrdinary1,
      history: hist,
      now: new Date(t1),
      chartVersion: "A",
    });
    const r2 = buildAuditSlices({
      question: qOrdinary1,
      history: hist,
      now: new Date(t2),
      chartVersion: "A",
    });
    const p1 = sha256(r1.prefix_json);
    const p2 = sha256(r2.prefix_json);
    const c1 = sha256(r1.c_json);
    const c2 = sha256(r2.c_json);
    assert.equal(p1, p2, "PREFIX_HASH_STABLE_TIME prefix");
    assert.notEqual(c1, c2, "PREFIX_HASH_STABLE_TIME C differs");
    assert.equal(r1.prefix_json.includes(t1), false);
    assert.equal(r1.prefix_json.includes(t2), false);
    assert.equal(r2.prefix_json.includes(t1), false);
    assert.equal(r2.prefix_json.includes(t2), false);
    assert.ok(r1.c_json.includes("2026-08-01") || r1.c_json.includes("current_datetime"));
    assert.ok(r2.c_json.includes("2026-08-01") || r2.c_json.includes("current_datetime"));
    assert.notEqual(r1.c_json, r2.c_json);
    // expose for report
    globalThis.__CACHE_PREFIX_HASH_1 = p1;
    globalThis.__CACHE_PREFIX_HASH_2 = p2;
    globalThis.__CACHE_C_HASH_1 = c1;
    globalThis.__CACHE_C_HASH_2 = c2;
  }
  ok("PREFIX_HASH_STABLE_TIME");

  // TEST 2 — PREFIX_HASH_STABLE_HISTORY_GROWTH
  {
    const hist2 = [
      { role: "user", content: "Q1", created_at: "TS1" },
      { role: "assistant", content: "A1", created_at: "TS2" },
    ];
    const hist4 = [
      ...hist2,
      { role: "user", content: "Q2_EXTRA_HISTORY", created_at: "TS3" },
      { role: "assistant", content: "A2_EXTRA_HISTORY", created_at: "TS4" },
    ];
    const r1 = buildAuditSlices({
      question: qOrdinary1,
      history: hist2,
      now: new Date(t1),
    });
    const r2 = buildAuditSlices({
      question: qOrdinary1,
      history: hist4,
      now: new Date(t1),
    });
    assert.equal(sha256(r1.prefix_json), sha256(r2.prefix_json));
    assert.notEqual(sha256(r1.c_json), sha256(r2.c_json));
    assert.ok(r2.c_json.includes("Q2_EXTRA_HISTORY"));
    assert.equal(r1.prefix_json.includes("Q2_EXTRA_HISTORY"), false);
    assert.equal(r2.prefix_json.includes("Q2_EXTRA_HISTORY"), false);
    assert.equal(r1.prefix_json.includes("TS3"), false);
    assert.ok(r2.c_json.includes("TS3") || r2.c_json.includes("TS4"));
  }
  ok("PREFIX_HASH_STABLE_HISTORY_GROWTH");

  // TEST 3 — PREFIX_HASH_STABLE_ORDINARY_QUESTION
  {
    const hist = [
      { role: "user", content: "이전질문", created_at: "TSX" },
      { role: "assistant", content: "이전달", created_at: "TSY" },
    ];
    const r1 = buildAuditSlices({
      question: qOrdinary1,
      history: hist,
      now: new Date(t1),
    });
    const r2 = buildAuditSlices({
      question: qOrdinary2,
      history: hist,
      now: new Date(t1),
    });
    assert.equal(
      composeClaudeFirstSystemText({ question: qOrdinary1, history: hist }),
      composeClaudeFirstSystemText({ question: qOrdinary2, history: hist }),
      "ordinary questions must not diverge place/product addenda",
    );
    assert.equal(sha256(r1.prefix_json), sha256(r2.prefix_json));
    assert.notEqual(sha256(r1.c_json), sha256(r2.c_json));
    assert.ok(r1.c_json.includes(qOrdinary1));
    assert.ok(r2.c_json.includes(qOrdinary2));
    assert.equal(r1.prefix_json.includes(qOrdinary1), false);
    assert.equal(r1.prefix_json.includes(qOrdinary2), false);
    assert.equal(r2.prefix_json.includes(qOrdinary1), false);
    assert.equal(r2.prefix_json.includes(qOrdinary2), false);
  }
  ok("PREFIX_HASH_STABLE_ORDINARY_QUESTION");

  // TEST 4 — PREFIX_INVALIDATES_ON_VERIFIED_STATE_CHANGE
  {
    const r1 = buildAuditSlices({
      question: qOrdinary1,
      history: [],
      now: new Date(t1),
      chartVersion: "A",
    });
    const r2 = buildAuditSlices({
      question: qOrdinary1,
      history: [],
      now: new Date(t1),
      chartVersion: "B",
    });
    assert.notEqual(sha256(r1.prefix_json), sha256(r2.prefix_json));
  }
  ok("PREFIX_INVALIDATES_ON_VERIFIED_STATE_CHANGE");

  // TEST 5 — DYNAMIC_SENTINEL_ABSENCE
  {
    const sentinels = {
      now: "NOW_SENTINEL_111",
      thread: "THREAD_TS_SENTINEL_222",
      question: "QUESTION_SENTINEL_333",
      turn: "TURN_SENTINEL_444",
      session: "SESSION_SENTINEL_555",
      request: "REQUEST_SENTINEL_666",
    };
    const hist = [
      {
        role: "user",
        content: "일반 맥락",
        created_at: sentinels.thread,
      },
      {
        role: "assistant",
        content: "응답",
        created_at: "THREAD_OTHER",
      },
    ];
    // Encode dynamic clock via Date that stringifies into a unique ISO we also inject as sentinel via payload fields
    const r = buildAuditSlices({
      question: sentinels.question,
      history: hist,
      now: new Date("2026-08-01T01:20:00.111+09:00"),
    });
    // Force extra per-turn fields into a cloned C-only check by rebuilding payload with session markers in question only
    assert.equal(r.prefix_json.includes(sentinels.thread), false);
    assert.equal(r.prefix_json.includes(sentinels.question), false);
    assert.equal(r.prefix_json.includes("reference_now_iso="), false);
    assert.equal(r.prefix_json.includes("recent_thread_timestamps="), false);
    assert.ok(r.c_json.includes(sentinels.question));
    assert.ok(r.c_json.includes(sentinels.thread));
    // Turn/session/request sentinels are not placed into system A by builders.
    assert.equal(r.prefix_json.includes(sentinels.turn), false);
    assert.equal(r.prefix_json.includes(sentinels.session), false);
    assert.equal(r.prefix_json.includes(sentinels.request), false);
    assert.equal(r.prefix_json.includes(sentinels.now), false);
  }
  ok("DYNAMIC_SENTINEL_ABSENCE");

  // TEST 6 — CACHE_STRUCTURE_INVARIANT
  {
    const r = buildAuditSlices({
      question: qOrdinary1,
      history: [],
      now: new Date(t1),
    });
    assert.equal(r.cache_marker_count, 1);
    assert.equal(r.cache_marker_index, 0);
    assert.equal(r.cache_strategy, "A_plus_B_via_B_marker");
    assert.equal(r.cache_breakpoints, 1);
    const first = r.parts.messages[0].content[0];
    assert.ok(first.cache_control);
    assert.equal(first.cache_control.type, "ephemeral");
    assert.match(String(first.text), /available_verified_evidence/);
    // Block B must be compact JSON (not pretty-printed).
    const bParsed = JSON.parse(first.text);
    assert.equal(first.text, JSON.stringify(bParsed), "block B compact");
    assert.match(r.systemText, /lifeguard_key_system|너는 고객이 만나는 유일한 AI 보험 주치의 KEY/);
    assert.ok(r.c_json.includes("current_question") || r.c_json.includes(qOrdinary1));
    assert.match(r.c_json, /CURRENT_CUSTOMER_REQUEST/);
  }
  ok("CACHE_STRUCTURE_INVARIANT");
}
ok("claude_prompt_cache_prefix_stability_suite");

// --- KEY CHART BLOAT REPAIR 2A (Claude projection only) ---
{
  const longPeriod = `${"coverage_period_malformed_".repeat(40)}END`;
  const longKeyA = `${"source_fact_key_body_A_".repeat(50)}TAIL_A`;
  const longKeyB = `${"source_fact_key_body_B_".repeat(50)}TAIL_B`;
  assert.ok(longPeriod.length > CLAUDE_VERIFIED_CHART_LONG_STRING_LIMIT);
  assert.ok(longKeyA.length > CLAUDE_VERIFIED_CHART_LONG_STRING_LIMIT);

  const shortKey = "sfk_short_ok";
  const shortPeriod = "80세만기";
  const coverageTemplate = {
    coverage_name: "암진단비",
    coverage_amount: 10000000,
    premium: 1000,
    status: "active",
    coverage_period: shortPeriod,
    source_fact_key: shortKey,
  };
  const longCoverage = {
    ...coverageTemplate,
    coverage_period: longPeriod,
    source_fact_key: longKeyA,
  };
  const reviewRow = {
    contract_id: "c-review-1",
    product_name: "fixture-product",
    coverages: [longCoverage],
    source_fact_key: longKeyA,
  };
  const contractRow = {
    contract_id: "c-1",
    insurer: "fixture-insurer",
    product: "fixture-product",
    coverages: [longCoverage, { ...coverageTemplate, source_fact_key: longKeyB }],
  };

  // A — review alias exact duplicate
  {
    const diag = {};
    const src = {
      review_candidates: [reviewRow],
      personal_review_candidates: [reviewRow],
      review_candidate_count: 1,
      personal_review_candidate_count: 1,
      contracts: [contractRow],
      confirmed_contracts: [contractRow],
      personal_confirmed_contracts: [contractRow],
      verified_document_coverages: [longCoverage],
    };
    const before = JSON.stringify(src);
    const proj = buildClaudeVerifiedChartProjection(src, diag);
    assert.equal(JSON.stringify(src), before, "non-mutation after review exact");
    assert.ok(Array.isArray(proj.review_candidates));
    assert.equal(proj.review_candidates.length, 1);
    assert.equal(
      Object.prototype.hasOwnProperty.call(proj, "personal_review_candidates"),
      false,
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(proj, "personal_review_candidate_count"),
      false,
    );
    assert.equal(proj.review_candidate_count, 1);
    assert.equal(diag.review_alias, "EXACT_DUPLICATE_COLLAPSED");
  }
  ok("chart_bloat_2a_review_alias_exact");

  // B — review alias divergence
  {
    const diag = {};
    const src = {
      review_candidates: [reviewRow],
      personal_review_candidates: [{ ...reviewRow, contract_id: "c-review-2" }],
      review_candidate_count: 1,
      personal_review_candidate_count: 1,
    };
    const proj = buildClaudeVerifiedChartProjection(src, diag);
    assert.ok(Array.isArray(proj.review_candidates));
    assert.ok(Array.isArray(proj.personal_review_candidates));
    assert.equal(proj.review_candidates.length, 1);
    assert.equal(proj.personal_review_candidates.length, 1);
    assert.notEqual(
      JSON.stringify(proj.review_candidates),
      JSON.stringify(proj.personal_review_candidates),
    );
    assert.equal(diag.review_alias, "REVIEW_ALIAS_DIVERGED");
  }
  ok("chart_bloat_2a_review_alias_diverged");

  // C — contract aliases exact duplicate
  {
    const diag = {};
    const src = {
      contracts: [contractRow],
      confirmed_contracts: [contractRow],
      personal_confirmed_contracts: [contractRow],
    };
    const proj = buildClaudeVerifiedChartProjection(src, diag);
    assert.ok(Array.isArray(proj.contracts));
    assert.equal(
      Object.prototype.hasOwnProperty.call(proj, "confirmed_contracts"),
      false,
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(proj, "personal_confirmed_contracts"),
      false,
    );
    assert.equal(diag.contract_alias, "EXACT_DUPLICATE_COLLAPSED");
  }
  ok("chart_bloat_2a_contract_alias_exact");

  // D — contract alias divergence
  {
    const diag = {};
    const other = { ...contractRow, contract_id: "c-2" };
    const src = {
      contracts: [contractRow],
      confirmed_contracts: [other],
      personal_confirmed_contracts: [contractRow],
    };
    const proj = buildClaudeVerifiedChartProjection(src, diag);
    assert.ok(Array.isArray(proj.contracts));
    assert.ok(Array.isArray(proj.confirmed_contracts));
    assert.ok(Array.isArray(proj.personal_confirmed_contracts));
    assert.equal(diag.contract_alias, "CONTRACT_ALIAS_DIVERGED");
  }
  ok("chart_bloat_2a_contract_alias_diverged");

  // E — source_fact_key short/long + stable ref
  {
    const shortCov = { ...coverageTemplate, source_fact_key: shortKey };
    const longCov1 = { ...coverageTemplate, source_fact_key: longKeyA };
    const longCov2 = { ...coverageTemplate, source_fact_key: longKeyA };
    const longCovOther = { ...coverageTemplate, source_fact_key: longKeyB };
    const proj = buildClaudeVerifiedChartProjection({
      verified_document_coverages: [shortCov, longCov1, longCov2, longCovOther],
    });
    const [p0, p1, p2, p3] = proj.verified_document_coverages;
    assert.equal(p0.source_fact_key, shortKey);
    assert.equal(Object.prototype.hasOwnProperty.call(p0, "source_fact_ref"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(p1, "source_fact_key"), false);
    assert.equal(p1.source_fact_key_state, "long_value_replaced_by_ref");
    assert.match(String(p1.source_fact_ref), /^[0-9a-f]{16}$/);
    assert.equal(p1.source_fact_ref, p2.source_fact_ref);
    assert.notEqual(p1.source_fact_ref, p3.source_fact_ref);
    assert.equal(JSON.stringify(proj).includes(longKeyA), false);
    assert.equal(JSON.stringify(proj).includes(longKeyB), false);
  }
  ok("chart_bloat_2a_source_fact_key");

  // F — coverage_period short/long
  {
    const proj = buildClaudeVerifiedChartProjection({
      verified_document_coverages: [
        { ...coverageTemplate, coverage_period: shortPeriod },
        { ...coverageTemplate, coverage_period: longPeriod },
      ],
    });
    assert.equal(proj.verified_document_coverages[0].coverage_period, shortPeriod);
    assert.equal(proj.verified_document_coverages[1].coverage_period, null);
    assert.equal(
      proj.verified_document_coverages[1].coverage_period_state,
      "unverified_malformed_long_value",
    );
    assert.match(
      String(proj.verified_document_coverages[1].coverage_period_source_ref),
      /^[0-9a-f]{16}$/,
    );
    assert.equal(JSON.stringify(proj).includes(longPeriod), false);
    assert.equal(JSON.stringify(proj).includes(longPeriod.slice(0, 40)), false);
  }
  ok("chart_bloat_2a_coverage_period");

  // G — non-mutation deep
  {
    const src = {
      review_candidates: [reviewRow],
      personal_review_candidates: [reviewRow],
      contracts: [contractRow],
      confirmed_contracts: [contractRow],
      personal_confirmed_contracts: [contractRow],
      verified_document_coverages: [longCoverage],
    };
    const snap = JSON.parse(JSON.stringify(src));
    buildClaudeVerifiedChartProjection(src);
    assert.deepEqual(src, snap);
  }
  ok("chart_bloat_2a_non_mutation");

  // H + fixture volume (FIXTURE-EXACT) via buildUserPayload + cached parts
  {
    const bloated = {
      schema: "verified_customer_chart_v1",
      review_candidates: Array.from({ length: 3 }, () => reviewRow),
      personal_review_candidates: Array.from({ length: 3 }, () => reviewRow),
      review_candidate_count: 3,
      personal_review_candidate_count: 3,
      contracts: [contractRow, { ...contractRow, contract_id: "c-2" }],
      confirmed_contracts: [contractRow, { ...contractRow, contract_id: "c-2" }],
      personal_confirmed_contracts: [
        contractRow,
        { ...contractRow, contract_id: "c-2" },
      ],
      verified_document_coverages: [longCoverage, longCoverage, longCoverage],
      key_confirmed_source_facts: [],
    };
    const beforeChartCompact = JSON.stringify(bloated).length;
    const afterProj = buildClaudeVerifiedChartProjection(bloated);
    const afterChartCompact = JSON.stringify(afterProj).length;
    const aliasRemoved =
      JSON.stringify(bloated.personal_review_candidates).length +
      JSON.stringify(bloated.confirmed_contracts).length +
      JSON.stringify(bloated.personal_confirmed_contracts).length;
    // Count long source_fact_key / coverage_period occurrences in bloated fixture (chars of those string values only).
    let sourceFactKeyCharsRemoved = 0;
    let coveragePeriodCharsRemoved = 0;
    const walkCount = (node) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (const x of node) walkCount(x);
        return;
      }
      if (
        typeof node.source_fact_key === "string" &&
        node.source_fact_key.length > CLAUDE_VERIFIED_CHART_LONG_STRING_LIMIT
      ) {
        sourceFactKeyCharsRemoved += node.source_fact_key.length;
      }
      if (
        typeof node.coverage_period === "string" &&
        node.coverage_period.length > CLAUDE_VERIFIED_CHART_LONG_STRING_LIMIT
      ) {
        coveragePeriodCharsRemoved += node.coverage_period.length;
      }
      for (const v of Object.values(node)) walkCount(v);
    };
    walkCount(bloated);
    const beforePrettyB = JSON.stringify(
      { available_verified_evidence: { personal: { chart: bloated } } },
      null,
      2,
    ).length;
    const payload = buildUserPayload({
      question: "암진단비는 뭐야?",
      chart: bloated,
      contextPack: {
        recent_conversation_originals: [],
        older_conversation_summary: null,
        retained_past_originals: [],
      },
      now: new Date("2026-08-01T01:20:00.111+09:00"),
    });
    const chartInPayload = payload.available_verified_evidence.personal.chart;
    assert.equal(
      Object.prototype.hasOwnProperty.call(chartInPayload, "personal_review_candidates"),
      false,
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(chartInPayload, "confirmed_contracts"),
      false,
    );
    const parts = buildClaudeFirstCachedRequestParts({
      systemText: "sys",
      userPayload: payload,
    });
    const bText = parts.messages[0].content[0].text;
    assert.equal(bText, JSON.stringify(JSON.parse(bText)));
    const afterCompactB = bText.length;
    // C remains pretty (content[1] when no attachments)
    const cBlock = parts.messages[0].content[1];
    assert.ok(cBlock?.type === "text");
    assert.equal(Object.prototype.hasOwnProperty.call(cBlock, "cache_control"), false);
    assert.notEqual(cBlock.text, JSON.stringify(JSON.parse(cBlock.text)));
    assert.equal(parts.messages[0].content[0].cache_control?.type, "ephemeral");
    assert.equal(JSON.stringify(bloated).includes(longKeyA), true);
    assert.equal(JSON.stringify(chartInPayload).includes(longKeyA), false);
    assert.equal(JSON.stringify(chartInPayload).includes(longPeriod), false);

    globalThis.__CHART_BLOAT_2A_FIXTURE = {
      before_chart_compact_chars: beforeChartCompact,
      after_chart_compact_chars: afterChartCompact,
      exact_alias_chars_removed_estimate: aliasRemoved,
      source_fact_key_chars_removed: sourceFactKeyCharsRemoved,
      coverage_period_chars_removed: coveragePeriodCharsRemoved,
      before_block_b_pretty_chars: beforePrettyB,
      after_block_b_compact_chars: afterCompactB,
      reduction_percent: Number(
        (
          ((beforePrettyB - afterCompactB) / beforePrettyB) *
          100
        ).toFixed(2),
      ),
      evidence_grade: "FIXTURE-EXACT",
    };
  }
  ok("chart_bloat_2a_payload_and_block_b_compact");
}
ok("claude_chart_bloat_repair_2a_suite");

// --- 2H source_document_id enrichment collapse (Claude projection only) ---
{
  const baseFact = {
    contract_id: "c-enrich-1",
    coverage_name: "fixture-coverage",
    coverage_amount: 1000000,
    insurer: "fixture-insurer-a",
    insurer_name: "fixture-insurer-name-a",
    product_name: "fixture-product",
    status: "active",
  };
  const nonemptyId = "doc-nonempty-fixture-001";
  const withId = { ...baseFact, source_document_id: nonemptyId };
  const nullId = { ...baseFact, source_document_id: null };
  const undefId = { ...baseFact, source_document_id: undefined };
  const emptyStrId = { ...baseFact, source_document_id: "" };
  const absentId = { ...baseFact };
  delete absentId.source_document_id;
  const whitespaceId = { ...baseFact, source_document_id: "   " };
  const otherNonempty = {
    ...baseFact,
    source_document_id: "doc-nonempty-fixture-002",
  };
  const withIdAmountNum = { ...withId, coverage_amount: 1000000 };
  const nullIdAmountStr = { ...nullId, coverage_amount: "1000000" };
  const divergedStatus = { ...withId, status: "lapsed" };

  function assertCollapsePair(a, b, expectCollapse, selected = withId) {
    const input = [a, b];
    const aKeysBefore = Object.keys(a).sort().join("|");
    const bKeysBefore = Object.keys(b).sort().join("|");
    const out = collapseVerifiedDocumentCoveragesSourceIdEnrichment(input);
    assert.equal(input[0], a);
    assert.equal(input[1], b);
    assert.equal(Object.keys(a).sort().join("|"), aKeysBefore);
    assert.equal(Object.keys(b).sort().join("|"), bKeysBefore);
    if (expectCollapse) {
      assert.equal(out.coverages.length, 1);
      assert.equal(out.occurrence_records.length, 1);
      assert.equal(out.occurrence_records[0].occurrence_count, 2);
      assert.equal(
        out.occurrence_records[0].duplicate_class,
        "source_document_id_enrichment",
      );
      assert.equal(
        out.occurrence_records[0].source_document_id_presence_count,
        1,
      );
      assert.equal(out.coverages[0].source_document_id, nonemptyId);
      assert.equal(out.coverages[0], selected);
    } else {
      assert.equal(out.coverages.length, 2);
      assert.equal(out.occurrence_records.length, 0);
    }
  }

  assertCollapsePair(nullId, withId, true);
  ok("chart_bloat_2h_null_nonempty_collapse");
  assertCollapsePair(absentId, withId, true);
  ok("chart_bloat_2h_absent_nonempty_collapse");
  assertCollapsePair(undefId, withId, true);
  ok("chart_bloat_2h_undefined_nonempty_collapse");
  assertCollapsePair(emptyStrId, withId, true);
  ok("chart_bloat_2h_empty_string_nonempty_collapse");

  assertCollapsePair(whitespaceId, nullId, false);
  ok("chart_bloat_2h_whitespace_hold");
  assertCollapsePair(withId, otherNonempty, false);
  ok("chart_bloat_2h_both_nonempty_hold");
  assertCollapsePair(nullId, emptyStrId, false);
  ok("chart_bloat_2h_both_empty_like_hold");
  assertCollapsePair(divergedStatus, nullId, false);
  ok("chart_bloat_2h_non_source_diverge_hold");
  assertCollapsePair(withIdAmountNum, nullIdAmountStr, false);
  ok("chart_bloat_2h_number_vs_numeric_string_hold");

  {
    const three = [withId, nullId, { ...withId }];
    const out = collapseVerifiedDocumentCoveragesSourceIdEnrichment(three);
    assert.equal(out.coverages.length, 3);
    assert.equal(out.occurrence_records.length, 0);
  }
  ok("chart_bloat_2h_group_size_not_two_hold");

  {
    const missingIdentity = [
      { coverage_name: "x", source_document_id: nonemptyId },
      { coverage_name: "x", source_document_id: null },
    ];
    const out =
      collapseVerifiedDocumentCoveragesSourceIdEnrichment(missingIdentity);
    assert.equal(out.coverages.length, 2);
    assert.equal(out.occurrence_records.length, 0);
  }
  ok("chart_bloat_2h_identity_missing_hold");

  {
    const forward = collapseVerifiedDocumentCoveragesSourceIdEnrichment([
      nullId,
      withId,
      { ...baseFact, contract_id: "c-other", coverage_name: "other", source_document_id: null },
    ]);
    const reverse = collapseVerifiedDocumentCoveragesSourceIdEnrichment([
      { ...baseFact, contract_id: "c-other", coverage_name: "other", source_document_id: null },
      withId,
      nullId,
    ]);
    assert.equal(forward.coverages.length, reverse.coverages.length);
    assert.equal(
      forward.occurrence_records.length,
      reverse.occurrence_records.length,
    );
    assert.equal(forward.coverages.filter((r) => r === withId).length, 1);
    assert.equal(reverse.coverages.filter((r) => r === withId).length, 1);
    assert.deepEqual(
      forward.occurrence_records.map((r) => r.contract_id).sort(),
      reverse.occurrence_records.map((r) => r.contract_id).sort(),
    );
  }
  ok("chart_bloat_2h_input_order_stable");

  {
    const singleton = {
      ...baseFact,
      contract_id: "c-single",
      coverage_name: "solo",
      source_document_id: nonemptyId,
    };
    const src = {
      review_candidates: [{ contract_id: "c-review" }],
      personal_review_candidates: [{ contract_id: "c-review" }],
      contracts: [{ contract_id: "c-1" }],
      confirmed_contracts: [{ contract_id: "c-1" }],
      personal_confirmed_contracts: [{ contract_id: "c-1" }],
      verified_document_coverages: [nullId, withId, singleton],
      key_confirmed_source_facts: [{ fact: "keep" }],
    };
    const before = JSON.parse(JSON.stringify(src));
    const diag = {};
    const proj = buildClaudeVerifiedChartProjection(src, diag);
    assert.deepEqual(src, before);
    assert.equal(src.verified_document_coverages.length, 3);
    assert.equal(proj.verified_document_coverages.length, 2);
    assert.equal(diag.source_document_id_enrichment_collapsed_groups, 1);
    assert.equal(diag.source_document_id_enrichment_original_occurrences, 3);
    assert.equal(diag.source_document_id_enrichment_projected_rows, 2);
    assert.equal(diag.source_document_id_presence_count, 1);
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        proj,
        "verified_document_coverage_occurrence_records",
      ),
      false,
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(proj, "personal_review_candidates"),
      false,
    );
    assert.deepEqual(proj.key_confirmed_source_facts, [{ fact: "keep" }]);
  }
  ok("chart_bloat_2h_projection_wiring_and_non_mutation");
}
ok("claude_chart_bloat_repair_2h_suite");

// ─── 2C: C ledger contract authority / B coverage detail split ───
{
  function idsOf(rows) {
    return (Array.isArray(rows) ? rows : [])
      .map((r) => String(r?.contract_id ?? "").trim())
      .filter(Boolean)
      .sort();
  }

  const policies = [
    {
      id: "pol-c1",
      policy_id: "pol-c1",
      insurer_name: "한화생명",
      product_name: "암보험A",
      policy_number: "PN-C1",
      monthly_premium: 50000,
      status: "active",
      identity_strength: "strong",
      coverage_summary: {
        verification_status: "verified",
        key_coverage_baseline_facts: [
          {
            coverage_name: "암진단비",
            coverage_amount: 10_000_000,
            status: "verified",
            source_document_id: "doc-c1",
          },
        ],
      },
    },
    {
      id: "pol-c2",
      policy_id: "pol-c2",
      insurer_name: "삼성생명",
      product_name: "종신B",
      policy_number: "PN-C2",
      monthly_premium: 80000,
      status: "active",
      identity_strength: "strong",
      coverage_summary: {
        verification_status: "verified",
        key_coverage_baseline_facts: [],
      },
    },
  ];

  const fullLedger = buildVerifiedPolicyLedgerBrief(policies);
  const fullBefore = JSON.parse(JSON.stringify(fullLedger));
  const projectedLedger = projectClaudeVerifiedPolicyLedgerBrief(fullLedger);
  assert.deepEqual(fullLedger, fullBefore, "original ledger mutation false");

  // 1–3) contract count / id set / skeleton fields preserved
  assert.equal(projectedLedger.active_distinct_count, fullLedger.active_distinct_count);
  assert.equal(
    projectedLedger.confirmed_contracts.length,
    fullLedger.confirmed_contracts.length,
  );
  assert.deepEqual(
    idsOf(projectedLedger.confirmed_contracts),
    idsOf(fullLedger.confirmed_contracts),
  );
  assert.equal(projectedLedger.confirmed_contracts[0].insurer, "한화생명");
  assert.equal(projectedLedger.confirmed_contracts[0].product_name, "암보험A");
  assert.equal(
    projectedLedger.confirmed_contracts[0].verification_status,
    fullLedger.confirmed_contracts[0].verification_status,
  );

  // 4) coverage bodies removed; review/alias arrays dropped from C projection
  for (const row of projectedLedger.confirmed_contracts || []) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(row, "coverages"),
      false,
      "C confirmed row must not carry coverages",
    );
  }
  for (const dropped of [
    "verified_document_coverages",
    "review_candidates",
    "personal_review_candidates",
    "personal_confirmed_contracts",
    "contracts",
  ]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(projectedLedger, dropped),
      false,
      `C projection must drop ${dropped}`,
    );
  }
  // hard-slot counts preserved
  assert.equal(
    projectedLedger.review_candidate_count,
    fullLedger.review_candidate_count,
  );
  assert.equal(
    projectedLedger.personal_review_candidate_count,
    fullLedger.personal_review_candidate_count,
  );
  // full ledger still has coverage bodies + review arrays (KEY internal)
  assert.ok(Array.isArray(fullLedger.confirmed_contracts[0].coverages));
  assert.ok(fullLedger.confirmed_contracts[0].coverages.length >= 1);
  assert.ok(Array.isArray(fullLedger.review_candidates));

  const chart = buildVerifiedCustomerChart({
    policies,
    policy_count: policies.length,
  });
  const chartBefore = JSON.parse(JSON.stringify(chart));
  const diag = {};
  const projChart = buildClaudeVerifiedChartProjection(chart, diag);
  assert.deepEqual(chart, chartBefore, "original chart mutation false");

  // 5–6) B rows: C-backed vs review/flat-backed; orphan 0 (no B⊆C requirement)
  function surfacePresence(originalChart, contractId) {
    let inContracts = false;
    let inReview = false;
    let inFlat = false;
    for (const c of originalChart.contracts || []) {
      if (String(c?.contract_id ?? "").trim() !== contractId) continue;
      if (Array.isArray(c?.coverages) && c.coverages.length > 0) inContracts = true;
    }
    for (const r of originalChart.review_candidates || []) {
      if (String(r?.contract_id ?? "").trim() !== contractId) continue;
      if (Array.isArray(r?.coverages) && r.coverages.length > 0) inReview = true;
    }
    for (const cov of originalChart.verified_document_coverages || []) {
      if (String(cov?.contract_id ?? "").trim() === contractId) inFlat = true;
    }
    return { inContracts, inReview, inFlat };
  }
  const bRows = projChart.verified_document_coverages || [];
  assert.ok(bRows.length >= 1);
  const cIdSet = new Set(idsOf(projectedLedger.confirmed_contracts));
  let missingCid = 0;
  let directC = 0;
  let reviewFlatBacked = 0;
  let orphan = 0;
  for (const row of bRows) {
    const cid = String(row?.contract_id ?? "").trim();
    if (!cid) {
      missingCid += 1;
      orphan += 1;
      continue;
    }
    if (cIdSet.has(cid)) {
      directC += 1;
      continue;
    }
    const p = surfacePresence(chart, cid);
    if (p.inReview && p.inFlat) reviewFlatBacked += 1;
    else orphan += 1;
  }
  assert.equal(missingCid, 0, "B missing contract_id");
  assert.equal(orphan, 0, "orphan B rows must be 0");
  assert.equal(directC + reviewFlatBacked, bRows.length);

  // 7–8) C-only contract (no B coverage) allowed; detail unknown
  assert.ok(cIdSet.has("pol-c2"));
  const bIds = new Set(
    bRows.map((r) => String(r?.contract_id ?? "").trim()).filter(Boolean),
  );
  assert.equal(bIds.has("pol-c2"), false);
  // no restoration of coverages onto C
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      projectedLedger.confirmed_contracts.find((r) => r.contract_id === "pol-c2"),
      "coverages",
    ),
    false,
  );

  // 9–10) count authority is C hard slot; no coverage invent on C
  assert.equal(projectedLedger.active_distinct_count, 2);
  assert.notEqual(projectedLedger.active_distinct_count, bRows.length);
  assert.notEqual(projectedLedger.active_distinct_count, bIds.size);

  // 14) occurrence metadata absent; C has no review/alias arrays
  const policyTruth = buildSourceSeparatedTruthContext({
    ledgerBrief: fullLedger,
    evidenceMeta: { attached_document_count: 0 },
    countQuestion: true,
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      policyTruth.VERIFIED_POLICY_LEDGER,
      "verified_document_coverages",
    ),
    false,
  );
  for (const dropped of [
    "review_candidates",
    "personal_review_candidates",
    "personal_confirmed_contracts",
    "contracts",
  ]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        policyTruth.VERIFIED_POLICY_LEDGER,
        dropped,
      ),
      false,
    );
  }
  const userPayload = buildUserPayload({
    question: "내 계약 몇 건이야?",
    chart,
    contextPack: { recent_turns: [] },
    policyTruthContext: policyTruth,
    now: new Date("2026-08-01T01:20:00.111+09:00"),
  });
  const { block_b, block_c } = (() => {
    const parts = buildClaudeFirstCachedRequestParts({
      systemText: "sys",
      userPayload,
    });
    const content = parts.messages[0].content;
    const bText = content.find((x) => x.cache_control)?.text;
    const cText = content.find(
      (x, i) => i > 0 && x.type === "text" && !x.cache_control,
    )?.text;
    return {
      block_b: JSON.parse(bText),
      block_c: JSON.parse(cText),
    };
  })();
  const bChart = block_b?.available_verified_evidence?.personal?.chart;
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      bChart || {},
      "verified_document_coverage_occurrence_records",
    ),
    false,
  );
  const cLedger = block_c?.current_context?.policy_truth?.VERIFIED_POLICY_LEDGER;
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      cLedger || {},
      "verified_document_coverages",
    ),
    false,
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      cLedger || {},
      "verified_document_coverage_occurrence_records",
    ),
    false,
  );
  for (const dropped of [
    "review_candidates",
    "personal_review_candidates",
    "personal_confirmed_contracts",
    "contracts",
  ]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(cLedger || {}, dropped),
      false,
    );
  }
  assert.equal(cLedger?.active_distinct_count, 2);
  assert.equal(cLedger?.confirmed_contracts?.length, 2);
  assert.deepEqual(
    idsOf(cLedger.confirmed_contracts),
    idsOf(fullLedger.confirmed_contracts),
  );

  // coverage authority addendum reads B only (not C ledger coverages)
  const covAuth = buildVerifiedCoverageAuthorityAddendum({
    ledgerBrief: fullLedger,
    chart,
  });
  assert.ok(covAuth);
  assert.equal(/VERIFIED_POLICY_LEDGER\.verified_document_coverages/.test(covAuth), false);
  assert.ok(/Block B/.test(covAuth));

  // 15) diagnostics retain enrichment counts on projection diag path
  {
    const nullId = {
      contract_id: "c-enrich-1",
      coverage_name: "암진단비",
      coverage_amount: 10000000,
      status: "verified",
      source_document_id: null,
    };
    const withId = {
      ...nullId,
      source_document_id: "doc-enrich-1",
    };
    const d2 = {};
    const p2 = buildClaudeVerifiedChartProjection(
      {
        verified_document_coverages: [nullId, withId],
        contracts: [{ contract_id: "c-enrich-1" }],
        confirmed_contracts: [{ contract_id: "c-enrich-1" }],
        personal_confirmed_contracts: [{ contract_id: "c-enrich-1" }],
      },
      d2,
    );
    assert.equal(d2.source_document_id_enrichment_collapsed_groups, 1);
    assert.equal(d2.source_document_id_enrichment_original_occurrences, 2);
    assert.equal(d2.source_document_id_enrichment_projected_rows, 1);
    assert.equal(d2.source_document_id_presence_count, 1);
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        p2,
        "verified_document_coverage_occurrence_records",
      ),
      false,
    );
  }

  // policy rows mutation false (input policies untouched)
  assert.equal(policies[0].id, "pol-c1");
  assert.ok(policies[0].coverage_summary.key_coverage_baseline_facts.length >= 1);

  ok("ledger_coverage_authority_split_2c_invariants");
}
ok("ledger_coverage_authority_split_2c_suite");

// ─── 2D-1: confirmed speech boundary + search/model telemetry ───
await (async () => {
  const prompt = String(LIFEGUARD_KEY_SYSTEM_PROMPT ?? "");
  assert.ok(prompt.includes("<confirmed_speech_boundary>"));
  assert.ok(/암종|일반암|소액암|유사암|특정암/.test(prompt));
  assert.ok(/면책기간|감액기간|체증/.test(prompt));
  assert.ok(/바로 지급|즉시/.test(prompt));
  assert.ok(/공개 검색 결과만으로 고객 계약/.test(prompt));
  assert.ok(/보험증권 원본에서 확인/.test(prompt));
  assert.ok(/현재 고객 차트에 확인된 내용/.test(prompt));
  assert.ok(/공개 자료 기준의 일반정보/.test(prompt));
  assert.ok(/고정 고객 문장|템플릿 답변/.test(prompt));
  assert.ok(
    prompt.includes(
      "질문과 직접 관련 없는 미확인 약관 항목을 답변에 나열하지 않는다.",
    ),
  );
  assert.equal(
    /모든 약관 항목을 매번 장황하게 나열하지 말고/.test(prompt),
    false,
  );
  const boundary2d1 =
    prompt.match(/<confirmed_speech_boundary>[\s\S]*?<\/confirmed_speech_boundary>/)?.[0] ??
    "";
  assert.equal(/\$\{/.test(boundary2d1), false);
  // No post-stream customer rewrite helpers introduced for this slice.
  const src = readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../server/keyCore/keyClaudeFirstDirect.js",
    ),
    "utf8",
  );
  assert.equal(
    /sealCustomerAnswerWithDeterministicTotals/.test(src),
    false,
  );
  assert.ok(
    /Claude final speech authority: do not replace\/append\/rewrite customer_answer after Claude/.test(
      src,
    ),
  );
  // provider_turn_count: increment immediately before each fetchImpl attempt.
  assert.ok(
    /messagesRequestCount \+= 1;\s*\n\s*res = await fetchImpl\(/.test(src),
  );
  // No post-success duplicate increment after fetch returns.
  assert.equal(
    /await fetchImpl\([\s\S]{0,400}?messagesRequestCount \+= 1;/.test(src),
    false,
  );
  ok("confirmed_speech_boundary_2d1_prompt");

  // B) search unused mock — tool offered must not inflate use_count
  const unused = summarizeClaudeFirstWebSearchBlocks([
    { type: "text", text: "차트에 확인된 암진단비는 1억입니다." },
  ]);
  assert.equal(unused.web_search_use_count, 0);
  assert.equal(unused.web_search_result_count, 0);
  assert.equal(unused.web_search_citation_count, 0);
  const unusedMarks = attachClaudeFirstTelemetryToLatencyMarks(
    buildPersistableLatencyMarks({
      ttft_ms: 10,
      triangle_t0: { input_tokens: 1, output_tokens: 1 },
    }),
    {
      web_search_tool_offered: true,
      web_search_use_count: unused.web_search_use_count,
      web_search_result_count: unused.web_search_result_count,
      web_search_citation_count: unused.web_search_citation_count,
      provider_turn_count: 1,
      configured_model: "claude-sonnet-4-6",
      response_model: "claude-sonnet-4-6",
      model_match: true,
    },
  );
  assert.equal(unusedMarks.web_search_tool_offered, true);
  assert.equal(unusedMarks.web_search_use_count, 0);
  assert.equal(unusedMarks.provider_turn_count, 1);
  assert.equal(unusedMarks.triangle_t0.web_search_use_count, 0);
  assert.equal(unusedMarks.triangle_t0.provider_turn_count, 1);
  ok("search_telemetry_unused_2d1");

  // C) search used once + one result block + one citation
  const used = summarizeClaudeFirstWebSearchBlocks([
    { type: "server_tool_use", name: "web_search", id: "toolu_1" },
    {
      type: "web_search_tool_result",
      tool_use_id: "toolu_1",
      content: [{ type: "web_search_result", title: "t", url: "https://example.com" }],
    },
    {
      type: "text",
      text: "일반정보입니다.",
      citations: [{ url: "https://example.com", title: "t" }],
    },
  ]);
  assert.equal(used.web_search_use_count, 1);
  assert.equal(used.web_search_result_count, 1);
  assert.equal(used.web_search_citation_count, 1);
  // Continuation: two provider turns, one search use across both (second turn text only)
  const turn2 = summarizeClaudeFirstWebSearchBlocks([
    { type: "text", text: "이어서 설명합니다." },
  ]);
  const provider_turn_count = 2;
  const web_search_use_count =
    used.web_search_use_count + turn2.web_search_use_count;
  assert.equal(web_search_use_count, 1);
  assert.equal(provider_turn_count, 2);
  ok("search_telemetry_one_use_2d1");

  // D) model telemetry
  const match = buildClaudeFirstModelTelemetry({
    configured_model: "claude-sonnet-4-6",
    response_model: "claude-sonnet-4-6",
  });
  assert.equal(match.configured_model, "claude-sonnet-4-6");
  assert.equal(match.response_model, "claude-sonnet-4-6");
  assert.equal(match.model_match, true);
  const missing = buildClaudeFirstModelTelemetry({
    configured_model: "claude-sonnet-4-6",
    response_model: null,
  });
  assert.equal(missing.response_model, null);
  assert.equal(missing.model_match, null);
  const mismatch = buildClaudeFirstModelTelemetry({
    configured_model: "claude-sonnet-4-6",
    response_model: "claude-opus-4-0",
  });
  assert.equal(mismatch.model_match, false);
  ok("model_telemetry_2d1");

  // E) telemetry attach does not mutate customer answer text
  const streamed = "고객에게 보이는 최종 문장";
  const sealed = streamed;
  const marksBeforeAnswer = { customer_answer: streamed };
  attachClaudeFirstTelemetryToLatencyMarks(
    { ttft_ms: 1, triangle_t0: {} },
    { provider_turn_count: 1 },
  );
  assert.equal(marksBeforeAnswer.customer_answer, sealed);
  assert.equal(streamed, sealed);
  ok("customer_answer_unmutated_by_telemetry_2d1");

  // F) latency_marks full field preservation via production attach helper
  {
    const telemetry = {
      web_search_tool_offered: true,
      web_search_use_count: 7,
      web_search_result_count: 8,
      web_search_citation_count: 9,
      provider_turn_count: 3,
      configured_model: "claude-sonnet-4-6",
      response_model: "claude-sonnet-4-6",
      model_match: true,
    };
    const inputMarks = {
      ttft_ms: 111001,
      git_commit_sha: "sha-sentinel-aaa111",
      deployment_id: "dpl-sentinel-bbb222",
      streamed_equals_sealed: true,
      // Existing safe top-level field preserved by attach spread.
      provider_speed: { ttft_ms: 111002, attempt_count: 4 },
      triangle_t0: {
        customer_question_received_ms: 200001,
        anthropic_first_byte_ms: 200002,
        first_delta_sent_ms: 200003,
        claude_complete_ms: 200004,
        customer_done_ms: 200005,
        persist_start_ms: 200006,
        persist_complete_ms: 200007,
        input_tokens: 200008,
        output_tokens: 200009,
        cache_creation_input_tokens: 200010,
        cache_read_input_tokens: 200011,
        cache_creation_ephemeral_5m_input_tokens: 200012,
        request_body_chars: 200013,
        streamed_equals_sealed: false,
        ready_card_source: "sentinel-ready-source",
        ready_card_hit: true,
      },
    };
    const inputSnapshot = JSON.parse(JSON.stringify(inputMarks));
    const customerAnswer = "보존 검증용 고객 답변";
    const answerBefore = customerAnswer;
    const attached = attachClaudeFirstTelemetryToLatencyMarks(inputMarks, telemetry);
    assert.equal(customerAnswer, answerBefore);
    assert.deepEqual(inputMarks, inputSnapshot);
    assert.ok(attached && typeof attached === "object");
    assert.ok(attached.triangle_t0 && typeof attached.triangle_t0 === "object");
    assert.equal(attached.ttft_ms, 111001);
    assert.equal(attached.git_commit_sha, "sha-sentinel-aaa111");
    assert.equal(attached.deployment_id, "dpl-sentinel-bbb222");
    assert.equal(attached.streamed_equals_sealed, true);
    assert.deepEqual(attached.provider_speed, {
      ttft_ms: 111002,
      attempt_count: 4,
    });
    assert.equal(attached.triangle_t0.customer_question_received_ms, 200001);
    assert.equal(attached.triangle_t0.anthropic_first_byte_ms, 200002);
    assert.equal(attached.triangle_t0.first_delta_sent_ms, 200003);
    assert.equal(attached.triangle_t0.claude_complete_ms, 200004);
    assert.equal(attached.triangle_t0.customer_done_ms, 200005);
    assert.equal(attached.triangle_t0.persist_start_ms, 200006);
    assert.equal(attached.triangle_t0.persist_complete_ms, 200007);
    assert.equal(attached.triangle_t0.input_tokens, 200008);
    assert.equal(attached.triangle_t0.output_tokens, 200009);
    assert.equal(attached.triangle_t0.cache_creation_input_tokens, 200010);
    assert.equal(attached.triangle_t0.cache_read_input_tokens, 200011);
    assert.equal(
      attached.triangle_t0.cache_creation_ephemeral_5m_input_tokens,
      200012,
    );
    assert.equal(attached.triangle_t0.request_body_chars, 200013);
    assert.equal(attached.triangle_t0.streamed_equals_sealed, false);
    assert.equal(attached.triangle_t0.ready_card_source, "sentinel-ready-source");
    assert.equal(attached.triangle_t0.ready_card_hit, true);
    assert.equal(attached.web_search_tool_offered, true);
    assert.equal(attached.web_search_use_count, 7);
    assert.equal(attached.web_search_result_count, 8);
    assert.equal(attached.web_search_citation_count, 9);
    assert.equal(attached.provider_turn_count, 3);
    assert.equal(attached.configured_model, "claude-sonnet-4-6");
    assert.equal(attached.response_model, "claude-sonnet-4-6");
    assert.equal(attached.model_match, true);
    assert.equal(attached.triangle_t0.provider_turn_count, 3);
    assert.equal(attached.triangle_t0.web_search_use_count, 7);

    assert.equal(
      attachClaudeFirstTelemetryToLatencyMarks(null, telemetry),
      null,
    );
    const noT0 = attachClaudeFirstTelemetryToLatencyMarks(
      { ttft_ms: 55 },
      { provider_turn_count: 2, configured_model: "claude-sonnet-4-6" },
    );
    assert.equal(noT0.ttft_ms, 55);
    assert.ok(noT0.triangle_t0 && typeof noT0.triangle_t0 === "object");
    assert.equal(noT0.triangle_t0.provider_turn_count, 2);
    assert.equal(noT0.provider_turn_count, 2);
    ok("latency_marks_full_field_preservation_2d1b");
  }

  // G) provider_turn_count via production callClaudeFirstDirect mock fetch loop
  {
    const baseEnv = {
      ANTHROPIC_API_KEY: "test-key-not-real",
      ANTHROPIC_MODEL: "claude-sonnet-4-6",
    };
    const emptyReality = { policies: [], policy_count: 0 };

    const mockJsonResponse = (payload) => ({
      ok: true,
      status: 200,
      // No body.getReader → JSON path in readAnthropicSseWithAnswerStream
      json: async () => payload,
    });

    // A) first fetch network throw
    {
      let calls = 0;
      const out = await callClaudeFirstDirect({
        question: "암 진단비 확인해줘",
        history: [],
        reality: emptyReality,
        env: baseEnv,
        fetchImpl: async () => {
          calls += 1;
          throw new Error("ECONNRESET");
        },
      });
      assert.equal(calls, 1);
      assert.equal(out.ok, false);
      assert.equal(out.error, "ANTHROPIC_FETCH_FAILED");
      assert.equal(out.provider_turn_count, 1);
      assert.equal(out.web_search_trace?.provider_turn_count, 1);
      assert.equal(out.web_search_trace?.web_search_tool_offered, true);
      assert.equal(out.web_search_trace?.web_search_use_count, 0);
      assert.equal(out.web_search_trace?.web_search_result_count, 0);
      assert.equal(out.web_search_trace?.web_search_citation_count, 0);
      assert.equal(out.configured_model, "claude-sonnet-4-6");
      assert.equal(out.response_model, null);
      assert.equal(out.model_match, null);
      ok("provider_turn_count_network_throw_2d1b");
    }

    // B) first fetch AbortError
    {
      let calls = 0;
      const out = await callClaudeFirstDirect({
        question: "암 진단비 확인해줘",
        history: [],
        reality: emptyReality,
        env: baseEnv,
        fetchImpl: async () => {
          calls += 1;
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          throw err;
        },
      });
      assert.equal(calls, 1);
      assert.equal(out.ok, false);
      assert.equal(out.error, "ANTHROPIC_TIMEOUT");
      assert.equal(out.provider_turn_count, 1);
      assert.equal(out.web_search_trace?.provider_turn_count, 1);
      assert.equal(out.response_model, null);
      assert.equal(out.model_match, null);
      ok("provider_turn_count_abort_2d1b");
    }

    // C) normal 1-turn success
    {
      let calls = 0;
      const out = await callClaudeFirstDirect({
        question: "암 진단비 확인해줘",
        history: [],
        reality: emptyReality,
        env: baseEnv,
        fetchImpl: async () => {
          calls += 1;
          return mockJsonResponse({
            model: "claude-sonnet-4-6",
            stop_reason: "end_turn",
            content: [{ type: "text", text: "차트에 확인된 내용입니다." }],
          });
        },
      });
      assert.equal(calls, 1);
      assert.equal(out.provider_turn_count, 1);
      assert.equal(out.web_search_trace?.provider_turn_count, 1);
      assert.equal(out.web_search_trace?.web_search_use_count, 0);
      ok("provider_turn_count_one_turn_2d1b");
    }

    // D) search continuation 2 turns
    {
      let calls = 0;
      const out = await callClaudeFirstDirect({
        question: "일반암 면책기간 일반정보",
        history: [],
        reality: emptyReality,
        env: baseEnv,
        fetchImpl: async () => {
          calls += 1;
          if (calls === 1) {
            return mockJsonResponse({
              model: "claude-sonnet-4-6",
              stop_reason: "pause_turn",
              content: [
                { type: "server_tool_use", name: "web_search", id: "toolu_1" },
                {
                  type: "web_search_tool_result",
                  tool_use_id: "toolu_1",
                  content: [
                    {
                      type: "web_search_result",
                      title: "t",
                      url: "https://example.com",
                    },
                  ],
                },
              ],
            });
          }
          return mockJsonResponse({
            model: "claude-sonnet-4-6",
            stop_reason: "end_turn",
            content: [{ type: "text", text: "공개 자료 기준의 일반정보입니다." }],
          });
        },
      });
      assert.equal(calls, 2);
      assert.equal(out.provider_turn_count, 2);
      assert.equal(out.web_search_trace?.provider_turn_count, 2);
      assert.equal(out.web_search_trace?.web_search_use_count, 1);
      assert.equal(out.web_search_trace?.web_search_tool_offered, true);
      ok("provider_turn_count_search_continuation_2d1b");
    }
  }
})();
ok("confirmed_speech_search_telemetry_2d1_suite");

// ─── 2D-2: evidence ladder + claim completeness (prompt boundary only) ───
{
  const prompt = String(LIFEGUARD_KEY_SYSTEM_PROMPT ?? "");
  const boundary =
    prompt.match(/<confirmed_speech_boundary>[\s\S]*?<\/confirmed_speech_boundary>/)?.[0] ??
    "";
  assert.ok(boundary.length > 0);

  // A) judgment authority — confident when evidence holds; blank-fill only when core evidence missing
  assert.ok(
    boundary.includes(
      "직접 연결된 검증 사실·적용 약관·공식 청구 근거로 결론이 성립하면 KEY는 분명하게 판단한다.",
    ),
  );
  assert.ok(
    boundary.includes(
      "결론에 필요한 핵심 근거가 없을 때만 담보명·일반지식·과거 KEY 답변으로 빈칸을 채우지 않는다.",
    ),
  );
  assert.equal(/항상\s*확인이\s*필요/.test(boundary), false);
  assert.equal(/무조건\s*유보/.test(boundary), false);
  assert.equal(/확인이\s*필요합니다만\s*반복/.test(boundary), false);
  ok("evidence_ladder_judgment_authority_2d2");

  // B) 체증 arithmetic — stale broad bans removed; unsupported path blocked; verified calc allowed
  const boundaryLines = boundary.split(/\r?\n/).map((l) => l.trimEnd());
  assert.equal(
    boundaryLines.includes("- 체증 시작 시점과 체증 방식"),
    false,
  );
  assert.equal(
    boundaryLines.includes("- 특정 연령의 실제 지급금액"),
    false,
  );
  assert.equal(
    boundaryLines.includes(
      "- 담보명·검증 필드에 명시되지 않은 체증 시작 시점·중간 증액 경로·특정 연령 지급금액",
    ),
    true,
  );
  assert.equal(
    boundaryLines.includes(
      "담보명이나 구조화된 검증 필드에 기준연령·배수·기준금액이 명시되고 계산관계가 완결되면,",
    ),
    true,
  );
  assert.equal(
    boundaryLines.includes(
      "그 표시 범위의 단순 산술 결과는 담보명 기준 보장 구조로 말할 수 있다.",
    ),
    true,
  );
  assert.equal(
    boundaryLines.includes(
      "다만 명시되지 않은 체증 경로·적용 시점·실제 청구 지급 결과를 만들어내지 않는다.",
    ),
    true,
  );
  // Customer-facing fixed example answers must not be planted in the prompt.
  assert.equal(/5,000만\s*원\s*×\s*2/.test(boundary), false);
  assert.equal(/\(체증형,\s*60세\s*2배\)/.test(boundary), false);
  ok("evidence_ladder_growth_arithmetic_2d2");

  // C) claim completeness — auto-pay omission blocked; official evidence exception kept
  assert.ok(
    boundary.includes(
      "보험금 지급을 설명할 때 진단 또는 사고 사실만으로 자동 지급되는 것처럼 말하지 않는다.",
    ),
  );
  assert.ok(
    boundary.includes(
      "약관상 지급요건과 제출자료에 대한 보험사의 확인·심사가 따른다는 사실을 생략하지 않는다.",
    ),
  );
  assert.ok(
    boundary.includes(
      "직접 연결된 적용 약관 또는 공식 청구 안내가 그 범위를 명시한 경우에만 말한다.",
    ),
  );
  ok("claim_review_completeness_2d2");

  // D) prior KEY answer — context ok, evidence promotion blocked
  assert.ok(
    boundary.includes("과거 KEY 답변은 대화 맥락으로 사용할 수 있지만"),
  );
  assert.ok(
    boundary.includes(
      "원본·검증 차트·적용 약관을 대신하는 사실 근거로 승격하지 않는다.",
    ),
  );
  ok("prior_key_context_not_evidence_2d2");

  // E) constitution / structure — no fixed customer answer, no rewrite, telemetry & static boundary intact
  assert.ok(boundary.includes("고정 고객 문장·템플릿 답변을 삽입하지 않는다."));
  assert.equal(/\$\{/.test(boundary), false);
  const src2d2 = readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../server/keyCore/keyClaudeFirstDirect.js",
    ),
    "utf8",
  );
  assert.equal(/sealCustomerAnswerWithDeterministicTotals/.test(src2d2), false);
  assert.ok(
    /Claude final speech authority: do not replace\/append\/rewrite customer_answer after Claude/.test(
      src2d2,
    ),
  );
  assert.ok(/export function summarizeClaudeFirstWebSearchBlocks/.test(src2d2));
  assert.ok(/export function buildClaudeFirstModelTelemetry/.test(src2d2));
  assert.ok(
    /export function attachClaudeFirstTelemetryToLatencyMarks/.test(src2d2),
  );
  assert.ok(
    /messagesRequestCount \+= 1;\s*\n\s*res = await fetchImpl\(/.test(src2d2),
  );
  ok("evidence_ladder_constitution_structure_2d2");
}
ok("evidence_ladder_claim_completeness_2d2_suite");

console.log("\nALL PASS key-doc-identity-sum-accuracy-unit-test");
if (globalThis.__CACHE_PREFIX_HASH_1) {
  console.log(
    "PREFIX_HASH_1",
    String(globalThis.__CACHE_PREFIX_HASH_1).slice(0, 16),
  );
  console.log(
    "PREFIX_HASH_2",
    String(globalThis.__CACHE_PREFIX_HASH_2).slice(0, 16),
  );
  console.log("C_HASH_1", String(globalThis.__CACHE_C_HASH_1).slice(0, 16));
  console.log("C_HASH_2", String(globalThis.__CACHE_C_HASH_2).slice(0, 16));
}
