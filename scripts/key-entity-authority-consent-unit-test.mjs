/**
 * Corporate authority consent Slice 2 — unit tests (no network).
 */
import assert from "node:assert/strict";
import {
  isAuthorityRowActive,
  filterDocumentsByAuthority,
  hasEntityLevelScope,
  hasSubjectScope,
  canLoadCorporateProfileHand,
  canSupportCorporateClaims,
  buildAuthorityHandBrief,
  resolveDocumentSubjectUserId,
} from "../server/entity/entityAuthorityConsent.js";

const employee = "11111111-1111-4111-8111-111111111111";

const grantPack = {
  ok: true,
  scopes_entity_level: ["corporate_profile", "corporate_documents", "insurance_consultation"],
  subjects: {
    [employee]: ["corporate_documents"],
  },
  authority_types: ["representative"],
};

assert.equal(isAuthorityRowActive({ status: "active" }), true);
assert.equal(isAuthorityRowActive({ status: "revoked", revoked_at: "2026-01-01" }), false);
assert.equal(
  isAuthorityRowActive({
    status: "active",
    expires_at: "2020-01-01T00:00:00.000Z",
  }),
  false,
);

assert.equal(hasEntityLevelScope(grantPack, "corporate_profile"), true);
assert.equal(hasEntityLevelScope(grantPack, "claim_support"), false);
assert.equal(hasSubjectScope(grantPack, employee, "corporate_documents"), true);
assert.equal(hasSubjectScope(grantPack, employee, "corporate_profile"), false);
assert.equal(canLoadCorporateProfileHand(grantPack), true);
assert.equal(canLoadCorporateProfileHand({ ok: true, scopes_entity_level: [] }), false);
assert.equal(canSupportCorporateClaims(grantPack), false);
assert.equal(
  canSupportCorporateClaims({
    ok: true,
    scopes_entity_level: ["claim_support"],
  }),
  true,
);

const docs = [
  { document_id: "d1", entity_id: "e1", subject_user_id: null },
  {
    document_id: "d2",
    entity_id: "e1",
    subject_user_id: employee,
    metadata_json: { subject_user_id: employee },
  },
  {
    document_id: "d3",
    entity_id: "e1",
    metadata_json: { subject_user_id: "22222222-2222-4222-8222-222222222222" },
  },
];

const filtered = filterDocumentsByAuthority(docs, grantPack);
assert.equal(filtered.some((d) => d.document_id === "d1"), true);
assert.equal(filtered.some((d) => d.document_id === "d2"), true);
assert.equal(filtered.some((d) => d.document_id === "d3"), false, "no consent employee excluded");

const noDocScope = filterDocumentsByAuthority(docs, {
  ok: true,
  scopes_entity_level: ["corporate_profile", "insurance_consultation"],
  subjects: {},
});
assert.equal(noDocScope.length, 0, "entity docs blocked without corporate_documents");

assert.equal(resolveDocumentSubjectUserId(docs[2]), "22222222-2222-4222-8222-222222222222");

const brief = buildAuthorityHandBrief(grantPack);
assert.equal(brief.membership_is_not_consent, true);
assert.equal(brief.authority_verified, true);
assert.deepEqual(
  buildAuthorityHandBrief({ ok: false }).allowed_scopes_entity_level,
  [],
);

console.log("key-entity-authority-consent-unit-test: PASS");
