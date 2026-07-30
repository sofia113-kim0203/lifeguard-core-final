/**
 * KEY non-interference boundary — unit regression (no network / Claude / secrets).
 */
import assert from "node:assert/strict";
import {
  shouldProvideOwnedInsuranceVaultOriginals,
  shouldRunOwnedVaultRecall,
  wantsOwnedInsuranceVaultEvidence,
} from "../src/lib/chatActiveAttachment.js";
import { neutralizeUnsupportedInsurerProductLiterals } from "../server/keyCore/keyVerifiedLiteralConflict.js";
import { buildTurnEvidencePackageMeta } from "../server/keyCore/keyPolicyTruthEvidence.js";
import { shouldRunClaudeFirstHomeChatQuestion } from "../server/keyCore/oneKeyCoreFlags.js";
import { decidePdfAttachMode } from "../server/keyCore/keyClaudePdfAttachPolicy.js";

function ok(name) {
  console.log(`PASS ${name}`);
}

// --- Eye: active insurance document case — no keyword required ---
const caseQs = [
  "분석해줘 키",
  "이 보험 전체적으로 어때?",
  "보장 내용을 봐줘",
  "아까 보험에서 부족한 게 뭐야?",
  "문서함에 있는 나머지도 같이 봐줘",
];
for (const q of caseQs) {
  assert.equal(
    shouldProvideOwnedInsuranceVaultOriginals({
      question: q,
      attachedDocumentId: "doc-active-1",
      isPresenceTurn: false,
    }),
    true,
    `active_case:${q}`,
  );
  assert.equal(
    shouldRunOwnedVaultRecall({
      wantsVaultEvidence: shouldProvideOwnedInsuranceVaultOriginals({
        question: q,
        attachedDocumentId: "doc-active-1",
      }),
      isPresenceTurn: false,
    }),
    true,
    `run_vault:${q}`,
  );
}
assert.equal(
  shouldProvideOwnedInsuranceVaultOriginals({
    question: "분석해줘 키",
    attachedDocumentId: null,
    isPresenceTurn: false,
  }),
  false,
);
assert.equal(
  shouldProvideOwnedInsuranceVaultOriginals({
    question: "문서함에 있는 나머지도 같이 봐줘",
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
ok("eye_active_case_no_keyword_gate");

// Keyword alone must not be required when active case exists.
assert.equal(wantsOwnedInsuranceVaultEvidence("분석해줘 키"), false);
assert.equal(
  shouldProvideOwnedInsuranceVaultOriginals({
    question: "분석해줘 키",
    attachedDocumentId: "doc-1",
  }),
  true,
);
ok("eye_keyword_not_sole_permission");

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

// --- Second brain isolation ---
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
  false,
);
ok("factory_isolation_homechat_claude_first_forced");

console.log("PASS key-noninterference-boundary-unit-test");
