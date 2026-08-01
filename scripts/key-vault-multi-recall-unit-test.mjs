/**
 * KEY vault multi-recall — unit regression (no network, no Claude, no secrets).
 */
import assert from "node:assert/strict";
import {
  wantsOwnedInsuranceVaultEvidence,
  shouldRunOwnedVaultRecall,
  shouldProvideOwnedInsuranceVaultOriginals,
  isMultiDocumentVaultRecallQuestion,
} from "../src/lib/chatActiveAttachment.js";
import { buildHomeBrainFactRequestBody } from "../src/lib/homeBrainFactRequestBody.js";
import { decidePdfAttachMode } from "../server/keyCore/keyClaudePdfAttachPolicy.js";
import {
  mergeOwnedDocumentAttachRows,
  verifyAndFetchCustomerPdfOriginal,
  orderDocumentsPdfFirstForVaultRecall,
  CLAUDE_FIRST_VAULT_MAX_UNIQUE_ATTACH,
} from "../server/keyCore/keyClaudeFullDocumentDirect.js";

function ok(name) {
  console.log(`PASS ${name}`);
}

// 1) Singular document questions stay singular (no vault multi intent).
assert.equal(
  wantsOwnedInsuranceVaultEvidence("이 증권 보험료가 얼마야?"),
  false,
);
assert.equal(isMultiDocumentVaultRecallQuestion("이 증권 보험료가 얼마야?"), false);
assert.equal(
  shouldRunOwnedVaultRecall({
    wantsVaultEvidence: false,
    isPresenceTurn: false,
  }),
  false,
);
ok("singular_question_no_vault_multi");

// 1b) Active attach alone must NOT open vault (request-scope only).
assert.equal(wantsOwnedInsuranceVaultEvidence("분석해줘 키"), false);
assert.equal(
  shouldProvideOwnedInsuranceVaultOriginals({
    question: "분석해줘 키",
    attachedDocumentId: "doc-active",
    isPresenceTurn: false,
  }),
  false,
);
assert.equal(
  shouldProvideOwnedInsuranceVaultOriginals({
    question: "이 보험 전체적으로 어때?",
    attachedDocumentId: "doc-active",
  }),
  false,
);
assert.equal(
  shouldProvideOwnedInsuranceVaultOriginals({
    question: "전체 보험 분석해줘",
    attachedDocumentId: "doc-active",
  }),
  true,
);
ok("active_attach_no_auto_vault");

// 2) activeAttachmentId present + vault intent → still run vault recall.
const vaultQs = [
  "문서함에 있는 나머지 문서도 함께 분석해줘",
  "문서함에 있는 자료 전체를 봐줘",
  "나머지 문서도 분석해줘",
];
for (const q of vaultQs) {
  assert.equal(wantsOwnedInsuranceVaultEvidence(q), true, q);
  assert.equal(
    shouldRunOwnedVaultRecall({
      wantsVaultEvidence: true,
      isPresenceTurn: false,
    }),
    true,
    q,
  );
}
// Gate must ignore singular document_id (helper has no document_id param by design).
assert.equal(
  shouldRunOwnedVaultRecall({ wantsVaultEvidence: true, isPresenceTurn: false }),
  true,
);
ok("active_attach_does_not_block_vault_intent");

// 3) Explicit + vault merge dedupes by id and sha.
const merged = mergeOwnedDocumentAttachRows({
  explicitDocumentId: "doc-a",
  explicitAttachment: {
    document_id: "doc-a",
    pdfBase64: "AAA",
    mediaType: "application/pdf",
    content_sha256: "sha-a",
  },
  vaultAttachments: [
    {
      document_id: "doc-a",
      pdfBase64: "AAA",
      mediaType: "application/pdf",
      content_sha256: "sha-a",
    },
    {
      document_id: "doc-b",
      pdfBase64: "BBB",
      mediaType: "application/pdf",
      content_sha256: "sha-b",
    },
    {
      document_id: "doc-c",
      pdfBase64: "CCC",
      mediaType: "application/pdf",
      content_sha256: "sha-a", // duplicate bytes of doc-a
    },
  ],
  maxUnique: CLAUDE_FIRST_VAULT_MAX_UNIQUE_ATTACH,
});
assert.equal(merged.length, 2);
assert.equal(merged[0].document_id, "doc-a");
assert.deepEqual(
  merged.map((r) => r.document_id).sort(),
  ["doc-a", "doc-b"],
);
ok("explicit_and_vault_dedupe");

// 4) Other-customer document never included (ownership denied).
{
  const denied = await verifyAndFetchCustomerPdfOriginal({
    supabase: null,
    customerId: "customer-1",
    documentId: "doc-other",
    injectedPdfBytes: Buffer.from("%PDF-1.4 other"),
    injectedDocument: {
      id: "doc-other",
      customer_id: "customer-2",
      mime_type: "application/pdf",
      original_filename: "other.pdf",
    },
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.reason, "document_ownership_denied");
}
ok("cross_customer_ownership_denied");

// 5) Max 6 unique attaches retained.
{
  const vaultAttachments = Array.from({ length: 10 }, (_, i) => ({
    document_id: `doc-${i}`,
    pdfBase64: `B${i}`,
    mediaType: "application/pdf",
    content_sha256: `sha-${i}`,
  }));
  const capped = mergeOwnedDocumentAttachRows({
    vaultAttachments,
    maxUnique: CLAUDE_FIRST_VAULT_MAX_UNIQUE_ATTACH,
  });
  assert.equal(CLAUDE_FIRST_VAULT_MAX_UNIQUE_ATTACH, 6);
  assert.equal(capped.length, 6);
}
ok("max_six_unique_cap");

// 6) Follow-up vault multi → originals attach even with prior_attach_follow_up.
{
  const mode = decidePdfAttachMode({
    documentId: "doc-a",
    priorAttachFollowUp: true,
    question: "문서함에 있는 나머지 문서도 함께 분석해줘",
    chunkCount: 12,
    vaultMultiRecall: true,
  });
  assert.equal(mode.attach_full_base64, true);
  assert.equal(mode.reason, "vault_multi_recall_force_original_bytes");
}
{
  // Without vault multi, prior_attach still skips bytes (singular soft follow-up).
  const soft = decidePdfAttachMode({
    documentId: "doc-a",
    priorAttachFollowUp: true,
    question: "짧게 정리해줘",
    chunkCount: 12,
    vaultMultiRecall: false,
  });
  assert.equal(soft.attach_full_base64, false);
  assert.equal(soft.reason, "prior_attach_follow_up_skip_full_base64");
}
ok("followup_vault_multi_attaches_originals");

// 7) One Claude call contract: request body remains a single turn payload
//    (singular document_id field + server vault merge — no second-engine flag).
{
  const body = buildHomeBrainFactRequestBody(
    "문서함에 있는 자료 전체를 봐줘",
    [],
    {
      currentTurnDocumentIds: ["doc-a"],
      documentIds: ["doc-a"],
      priorAttachFollowUp: false,
      sessionId: "sess-1",
    },
  );
  assert.equal(body.document_id, "doc-a");
  assert.deepEqual(body.current_turn_document_ids, ["doc-a"]);
  assert.equal(body.prior_attach_follow_up, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(body, "document_ids"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(body, "second_claude"), false);
}
ok("single_claude_turn_request_shape");

// Presence never runs vault.
assert.equal(
  shouldRunOwnedVaultRecall({ wantsVaultEvidence: true, isPresenceTurn: true }),
  false,
);
ok("presence_never_vault");

// 8) Vault fetch order prefers PDFs before images (Anthropic image-process failures).
{
  const ordered = orderDocumentsPdfFirstForVaultRecall([
    { id: "img-new", mime_type: "image/png" },
    { id: "pdf-a", mime_type: "application/pdf" },
    { id: "img-old", mime_type: "image/jpeg" },
    { id: "pdf-b", mime_type: "application/pdf" },
  ]);
  assert.deepEqual(
    ordered.map((d) => d.id),
    ["pdf-a", "pdf-b", "img-new", "img-old"],
  );
}
ok("vault_pdf_first_order");

console.log("\nALL PASS key-vault-multi-recall-unit-test");
