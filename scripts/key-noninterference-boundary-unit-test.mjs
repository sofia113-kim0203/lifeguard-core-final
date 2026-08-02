/**
 * KEY non-interference boundary — unit regression (no network / Claude / secrets).
 */
import assert from "node:assert/strict";
import {
  pickActiveInsuranceDocumentCaseFromConversationRows,
  shouldProvideOwnedInsuranceVaultOriginals,
  shouldRunOwnedVaultRecall,
  wantsOwnedInsuranceVaultEvidence,
} from "../src/lib/chatActiveAttachment.js";
import { resolveActiveInsuranceDocumentCase } from "../server/keyCore/keyActiveInsuranceDocumentCase.js";
import { neutralizeUnsupportedInsurerProductLiterals } from "../server/keyCore/keyVerifiedLiteralConflict.js";
import { buildTurnEvidencePackageMeta } from "../server/keyCore/keyPolicyTruthEvidence.js";
import { shouldRunClaudeFirstHomeChatQuestion } from "../server/keyCore/oneKeyCoreFlags.js";
import { decidePdfAttachMode } from "../server/keyCore/keyClaudePdfAttachPolicy.js";
import { CLAUDE_FIRST_VAULT_MAX_UNIQUE_ATTACH } from "../server/keyCore/keyClaudeFullDocumentDirect.js";

function ok(name) {
  console.log(`PASS ${name}`);
}

// --- Eye: attach/active case alone must NOT pull vault; explicit vault scope only ---
const noVaultQs = [
  "분석해줘 키",
  "이 보험 전체적으로 어때?",
  "보장 내용을 봐줘",
  "아까 보험에서 부족한 게 뭐야?",
];
for (const q of noVaultQs) {
  assert.equal(
    shouldProvideOwnedInsuranceVaultOriginals({
      question: q,
      attachedDocumentId: "doc-active-1",
      isPresenceTurn: false,
    }),
    false,
    `no_auto_vault:${q}`,
  );
  assert.equal(
    shouldRunOwnedVaultRecall({
      wantsVaultEvidence: shouldProvideOwnedInsuranceVaultOriginals({
        question: q,
        attachedDocumentId: "doc-active-1",
      }),
      isPresenceTurn: false,
    }),
    false,
    `no_run_vault:${q}`,
  );
}
assert.equal(
  shouldProvideOwnedInsuranceVaultOriginals({
    question: "문서함에 있는 나머지도 같이 봐줘",
    attachedDocumentId: "doc-active-1",
  }),
  true,
);
assert.equal(
  shouldProvideOwnedInsuranceVaultOriginals({
    question: "전체 보험 분석해줘",
    attachedDocumentId: null,
  }),
  true,
);
assert.equal(
  shouldProvideOwnedInsuranceVaultOriginals({
    question: "분석해줘 키",
    attachedDocumentId: "doc-1",
    isPresenceTurn: true,
  }),
  false,
);
ok("eye_attach_scope_no_auto_vault");

// Explicit vault/history phrases still open vault without attach id.
assert.equal(wantsOwnedInsuranceVaultEvidence("분석해줘 키"), false);
assert.equal(wantsOwnedInsuranceVaultEvidence("보관 문서 확인해줘"), true);
assert.equal(
  shouldProvideOwnedInsuranceVaultOriginals({
    question: "과거 자료와 비교해줘",
    attachedDocumentId: null,
  }),
  true,
);
ok("eye_explicit_vault_scope_only");

// Active case forces full original even if client sent prior_attach.
const mode = decidePdfAttachMode({
  documentId: "doc-1",
  priorAttachFollowUp: true,
  question: "분석해줘 키",
  chunkCount: 3,
  forceFullOriginal: true,
  vaultMultiRecall: false,
});
assert.equal(mode.attach_full_base64, true);
assert.equal(mode.reason, "force_full_original_reread");
ok("eye_active_case_force_original_bytes");

// --- Mouth: preserve grounded recommendations ---
const rec = neutralizeUnsupportedInsurerProductLiterals(
  "비교 후보는 한화생명, 삼성생명, 교보생명입니다.",
  { allowedEntities: [] },
);
assert.equal(rec.changed, false, "recommendation_preserved");
assert.equal(rec.stripped_count, 0);
assert.match(rec.text, /한화생명/);
assert.match(rec.text, /삼성생명/);
assert.match(rec.text, /교보생명/);
ok("mouth_recommendation_preserved");

const market = neutralizeUnsupportedInsurerProductLiterals(
  "시장에서 흔히 비교하는 한화생명과 삼성생명을 보시면 됩니다.",
  { allowedEntities: [] },
);
assert.equal(market.changed, false);
ok("mouth_market_compare_preserved");

const falsePersonal = neutralizeUnsupportedInsurerProductLiterals(
  "고객은 삼성생명 상품에 가입했습니다.",
  { allowedEntities: ["한화생명"] },
);
assert.equal(falsePersonal.changed, true);
assert.ok(falsePersonal.stripped_count >= 1);
assert.doesNotMatch(falsePersonal.text, /삼성생명/);
ok("mouth_false_personal_enrollment_stripped");

// --- Memory / evidence manifest ---
const meta = buildTurnEvidencePackageMeta({
  evidence_scope: "owned_insurance_vault",
  vaultRecall: {
    mode: "partial_attach",
    listing: [{ id: "a" }, { id: "b" }, { id: "c" }],
    attachments: [{ document_id: "a", content_sha256: "sha1" }],
    failed: [{ document_id: "b", reason: "undecodable_image" }],
    excluded: [{ document_id: "c" }],
    stage_counts: { sha_dupes_skipped: 1, cap_stop: false, budget_stop: false },
  },
});
assert.equal(meta.candidate_count, 3);
assert.equal(meta.attached_count, 1);
assert.equal(meta.dropped_count, 3); // failed + excluded + sha dupe
assert.match(String(meta.read_scope_authority), /attached_count/);
ok("memory_evidence_manifest_counts");

// --- Second brain isolation (ROOT_07: legacy escape hatch locked) ---
assert.equal(shouldRunClaudeFirstHomeChatQuestion({}), true);
assert.equal(
  shouldRunClaudeFirstHomeChatQuestion({ KEY_CLAUDE_FIRST_DIRECT: "0" }),
  true,
  "misconfigured OFF must not open factory speech",
);
assert.equal(
  shouldRunClaudeFirstHomeChatQuestion({
    KEY_CLAUDE_FIRST_DIRECT: "0",
    KEY_CLAUDE_FIRST_ALLOW_LEGACY_HOMECHAT: "1",
  }),
  true,
  "ALLOW_LEGACY must not reopen SalesDirector/keySpeak customer outlet",
);
assert.equal(
  shouldRunClaudeFirstHomeChatQuestion({
    KEY_CLAUDE_FIRST_DIRECT: "off",
    KEY_CLAUDE_FIRST_ALLOW_LEGACY_HOMECHAT: "1",
  }),
  true,
);
ok("factory_isolation_homechat_claude_first_forced");

// --- Server active insurance document case restore ---
const sessionRows = [
  {
    role: "user",
    metadata_json: {
      session_id: "sess-a",
      active_attachment_id: "doc-case-1",
    },
  },
  {
    role: "assistant",
    metadata_json: {
      session_id: "sess-a",
      evidence_package: {
        attached_count: 3,
        attached_document_ids: ["doc-case-1", "doc-case-2"],
      },
    },
  },
];
const pickedSession = pickActiveInsuranceDocumentCaseFromConversationRows({
  rows: sessionRows,
  sessionId: "sess-a",
});
assert.equal(pickedSession.documentId, "doc-case-1");
assert.equal(pickedSession.caseSource, "session_active_insurance_case");
// Restored case id re-fetches that original — it must not open the whole vault.
assert.equal(
  shouldProvideOwnedInsuranceVaultOriginals({
    question: "분석해줘 키",
    attachedDocumentId: pickedSession.documentId,
  }),
  false,
);
assert.equal(
  shouldProvideOwnedInsuranceVaultOriginals({
    question: "전체 보험 다시 봐줘",
    attachedDocumentId: pickedSession.documentId,
  }),
  true,
);
ok("case_restore_session_without_request_document_id");

const pickedNone = pickActiveInsuranceDocumentCaseFromConversationRows({
  rows: [{ role: "user", metadata_json: { session_id: "sess-empty" } }],
  sessionId: "sess-empty",
});
assert.equal(pickedNone.documentId, null);
assert.equal(
  shouldProvideOwnedInsuranceVaultOriginals({
    question: "분석해줘 키",
    attachedDocumentId: pickedNone.documentId,
  }),
  false,
);
ok("case_absent_no_random_vault");

const owned = new Set(["doc-owned-1", "doc-owned-2"]);
const restored = await resolveActiveInsuranceDocumentCase({
  supabase: {
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
        limit() {
          return Promise.resolve({
            data: [
              {
                role: "user",
                metadata_json: {
                  session_id: "sess-b",
                  active_attachment_id: "doc-owned-1",
                },
              },
              {
                role: "assistant",
                metadata_json: {
                  session_id: "sess-b",
                  evidence_package: {
                    attached_document_ids: ["doc-owned-1", "doc-owned-2"],
                  },
                },
              },
            ],
            error: null,
          });
        },
        maybeSingle() {
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  },
  customerId: "cust-1",
  sessionId: "sess-b",
  clientDocumentId: null,
  verifyOwned: async ({ documentId }) => owned.has(String(documentId)),
});
assert.equal(restored.documentId, "doc-owned-1");
assert.equal(restored.caseSource, "session_active_insurance_case");
assert.equal(restored.restored, true);
ok("case_restore_async_owned_session");

const denied = await resolveActiveInsuranceDocumentCase({
  supabase: {
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
        limit() {
          return Promise.resolve({
            data: [
              {
                role: "user",
                metadata_json: {
                  session_id: "sess-c",
                  active_attachment_id: "doc-other-customer",
                },
              },
            ],
            error: null,
          });
        },
        maybeSingle() {
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  },
  customerId: "cust-1",
  sessionId: "sess-c",
  clientDocumentId: "doc-other-customer",
  verifyOwned: async () => false,
});
assert.equal(denied.documentId, null);
assert.equal(denied.reason, "no_active_case");
ok("case_restore_blocks_foreign_document");

assert.ok(CLAUDE_FIRST_VAULT_MAX_UNIQUE_ATTACH <= 6);
ok("vault_cap_not_full_box");

const metaCase = buildTurnEvidencePackageMeta({
  evidence_scope: "owned_insurance_vault",
  case_source: "session_active_insurance_case",
  case_restored: true,
  case_document_id: "doc-case-1",
  vaultRecall: {
    mode: "attach",
    listing: [{ id: "a" }, { id: "b" }],
    attachments: [
      { document_id: "a", content_sha256: "s1" },
      { document_id: "b", content_sha256: "s2" },
    ],
    failed: [],
    excluded: [],
  },
});
assert.equal(metaCase.case_source, "session_active_insurance_case");
assert.equal(metaCase.case_restored, true);
assert.equal(metaCase.attached_count, 2);
ok("evidence_manifest_case_source");

console.log("PASS key-noninterference-boundary-unit-test");
