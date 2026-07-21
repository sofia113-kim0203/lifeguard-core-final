/**
 * Corporate Claim Guardian Slice 3 — unit tests (no network).
 * Reuses Claim Guardian 1A–1C sidecar; no separate corporate engine.
 */
import assert from "node:assert/strict";
import {
  normalizeKeyClaimCaseUpdates,
  filterKeyActiveClaimCasesByScope,
  mergeKeyActiveClaimCases,
} from "../server/documentPolicyUploadPersist.js";
import {
  buildKeyClaimIntakeUpdate,
  detectCorporateClaimEvent,
  isExplicitCorporateClaimUtterance,
  resolveClaimIntakeTurnScope,
  resolveClaimAttachDocumentId,
  extractPreparedDocumentsFromUtterance,
} from "../server/keyCore/keyClaimIntakeSidecar.js";
import { canSupportCorporateClaims } from "../server/entity/entityAuthorityConsent.js";
import {
  buildCorporateClaimHandSeatAudit,
  resolveClaimSelectedEntityId,
} from "../server/keyCore/keyClaudeFirstDirect.js";

const ENTITY_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ENTITY_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

assert.equal(
  isExplicitCorporateClaimUtterance("우리 회사 사업장에서 화재가 났어."),
  true,
);
assert.equal(detectCorporateClaimEvent("우리 회사 사업장에서 화재가 났어.")?.event_kind, "workplace_fire");
assert.equal(isExplicitCorporateClaimUtterance("지난주에 입원해서 수술했는데 보험금 청구할 수 있을까?"), false);
assert.equal(canSupportCorporateClaims({ ok: true, scopes_entity_level: ["claim_support"] }), true);

// Normalize: corporate without entity_id dropped; personal keeps null entity.
const normalized = normalizeKeyClaimCaseUpdates([
  {
    claim_case_key: "customer_statement:kind:surgery",
    claim_scope: "personal",
    status: "identified",
    source: "customer_statement",
  },
  {
    claim_case_key: "corporate:bad:customer_statement:kind:workplace_fire",
    claim_scope: "corporate",
    status: "identified",
    source: "customer_statement",
  },
  {
    claim_case_key: `corporate:${ENTITY_A}:customer_statement:kind:workplace_fire`,
    claim_scope: "corporate",
    entity_id: ENTITY_A,
    status: "identified",
    source: "customer_statement",
  },
]);
assert.equal(normalized.length, 2);
assert.equal(normalized.find((r) => r.claim_scope === "personal")?.entity_id, null);
assert.equal(normalized.find((r) => r.claim_scope === "corporate")?.entity_id, ENTITY_A);

const personalOnly = filterKeyActiveClaimCasesByScope(normalized, {
  claim_scope: "personal",
});
assert.equal(personalOnly.length, 1);
assert.equal(personalOnly[0].claim_scope, "personal");

const corpA = filterKeyActiveClaimCasesByScope(normalized, {
  claim_scope: "corporate",
  entity_id: ENTITY_A,
});
assert.equal(corpA.length, 1);
assert.equal(
  filterKeyActiveClaimCasesByScope(normalized, {
    claim_scope: "corporate",
    entity_id: ENTITY_B,
  }).length,
  0,
);

// Seat A — create corporate claim only with claim_support + entity.
const denied = buildKeyClaimIntakeUpdate({
  question: "우리 회사 사업장에서 화재가 났어.",
  existingCases: [],
  entityId: ENTITY_A,
  corporateClaimAllowed: false,
  sessionId: "corp-claim-a-denied",
});
assert.equal(denied.ok, false);
assert.equal(denied.authorization_denied, true);

const created = buildKeyClaimIntakeUpdate({
  question: "우리 회사 사업장에서 화재가 났어.",
  existingCases: [],
  entityId: ENTITY_A,
  corporateClaimAllowed: true,
  sessionId: "corp-claim-a",
});
assert.equal(created.ok, true);
assert.equal(created.action, "create");
assert.equal(created.updates[0].claim_scope, "corporate");
assert.equal(created.updates[0].entity_id, ENTITY_A);
assert.equal(created.updates[0].status, "identified");
assert.equal(created.updates[0].source, "customer_statement");
assert.equal(created.updates[0].insurer_verified, false);
assert.match(String(created.claim_case_key), new RegExp(`corporate:${ENTITY_A}:`));

// Personal intake unchanged (no corporate stamp).
const personal = buildKeyClaimIntakeUpdate({
  question: "지난주에 입원해서 수술했는데 보험금 청구할 수 있을까?",
  existingCases: created.updates,
  entityId: ENTITY_A,
  corporateClaimAllowed: true,
  sessionId: "personal-claim",
});
assert.equal(personal.ok, true);
assert.equal(personal.updates[0].claim_scope, "personal");
assert.equal(personal.updates[0].entity_id, null);

// Seat B — prep updates corporate case only; personal untouched.
assert.deepEqual(
  extractPreparedDocumentsFromUtterance("소방서 확인서와 수리 견적서는 준비했어."),
  ["소방서확인서", "수리견적서"],
);
const prep = buildKeyClaimIntakeUpdate({
  question: "소방서 확인서와 수리 견적서는 준비했어.",
  existingCases: mergeKeyActiveClaimCases(created.updates, personal.updates),
  entityId: ENTITY_A,
  corporateClaimAllowed: true,
  sessionId: "corp-claim-b",
});
assert.equal(prep.ok, true);
assert.equal(prep.action, "update");
assert.equal(prep.updates[0].claim_scope, "corporate");
assert.equal(prep.updates[0].entity_id, ENTITY_A);
assert.equal(prep.updates[0].status, "preparing");
assert.ok(prep.updates[0].available_documents.includes("소방서확인서"));
assert.ok(prep.updates[0].available_documents.includes("수리견적서"));
assert.equal(prep.claim_case_key, created.claim_case_key);

// Document scope — personal doc must not attach to corporate case.
assert.equal(
  resolveClaimAttachDocumentId({
    attachedDocumentId: "doc-personal",
    attachedDocumentEntityId: null,
    claim_scope: "corporate",
    entity_id: ENTITY_A,
  }),
  null,
);
assert.equal(
  resolveClaimAttachDocumentId({
    attachedDocumentId: "doc-corp",
    attachedDocumentEntityId: ENTITY_A,
    claim_scope: "corporate",
    entity_id: ENTITY_A,
  }),
  "doc-corp",
);

// Seat C — outcome still customer_statement / insurer_verified false.
const submitted = buildKeyClaimIntakeUpdate({
  question: "보험사에 접수했어.",
  existingCases: prep.updates,
  entityId: ENTITY_A,
  corporateClaimAllowed: true,
  sessionId: "corp-claim-c",
});
assert.equal(submitted.ok, true);
assert.equal(submitted.updates[0].status, "submitted_by_customer");
assert.equal(submitted.updates[0].source, "customer_statement");
assert.equal(submitted.updates[0].insurer_verified, false);

// Seat D — turn scope isolates personal vs corporate.
const both = mergeKeyActiveClaimCases(prep.updates, personal.updates);
const turnCorp = resolveClaimIntakeTurnScope({
  question: "우리 회사 사업장에서 화재가 났어.",
  existingCases: both,
  entityId: ENTITY_A,
  corporateClaimAllowed: true,
});
assert.equal(turnCorp.claim_scope, "corporate");
const turnPersonal = resolveClaimIntakeTurnScope({
  question: "지난주에 입원해서 수술했는데 보험금 청구할 수 있을까?",
  existingCases: both,
  entityId: ENTITY_A,
  corporateClaimAllowed: true,
});
assert.equal(turnPersonal.claim_scope, "personal");

// Seat F — revoke claim_support → hand denied, cases still stored.
const handDenied = buildCorporateClaimHandSeatAudit({
  claimCases: both,
  selectedEntityId: ENTITY_A,
  corporateClaimAllowed: false,
  authorizationDenied: true,
});
assert.equal(handDenied.authorization_denied, true);
assert.equal(handDenied.ready_corporate_claim, false);
assert.equal(handDenied.contexts_count, 0);

const handOk = buildCorporateClaimHandSeatAudit({
  claimCases: both,
  selectedEntityId: ENTITY_A,
  corporateClaimAllowed: true,
  authorizationDenied: false,
});
assert.equal(handOk.authorization_denied, false);
assert.equal(handOk.ready_corporate_claim, true);
assert.equal(handOk.status, "preparing");

// D — single corporate context must not auto-select on personal questions.
assert.equal(
  resolveClaimSelectedEntityId({
    selectedEntityIdHint: null,
    question: "내 개인 수술 청구 상태 알려줘.",
    corporateContexts: [{ entity_id: ENTITY_A }],
  }),
  null,
);
assert.equal(
  resolveClaimSelectedEntityId({
    selectedEntityIdHint: null,
    question: "우리 회사 사업장에서 화재가 났어.",
    corporateContexts: [{ entity_id: ENTITY_A }],
  }),
  ENTITY_A,
);
assert.equal(
  resolveClaimSelectedEntityId({
    selectedEntityIdHint: ENTITY_A,
    question: "내 개인 수술 청구 상태 알려줘.",
    corporateContexts: [{ entity_id: ENTITY_A }],
  }),
  ENTITY_A,
);
const personalHand = buildCorporateClaimHandSeatAudit({
  claimCases: both,
  selectedEntityId: null,
  corporateClaimAllowed: true,
  omitForPersonalTurn: true,
});
assert.equal(personalHand.ready_corporate_claim, false);
assert.equal(personalHand.omitted_reason, "personal_claim_turn");
assert.equal(personalHand.contexts_count, 0);

console.log("key-corporate-claim-guardian-unit-test: PASS");
