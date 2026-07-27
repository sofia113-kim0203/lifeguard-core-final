/**
 * Authenticated customer identity ↔ document subject identity separation.
 */
import assert from "node:assert/strict";
import {
  buildAuthenticatedCustomerIdentity,
  buildDocumentSubjectIdentity,
  detectFactIdentityMismatch,
  normalizePersonNameKey,
  resolveSameAsAuthenticatedCustomer,
} from "../server/keyCore/keyCustomerIdentitySeparation.js";
import {
  buildSystemPrompt,
  buildDomainContextSystemAddendum,
  buildUserPayload,
  hardOnlySafetyCheck,
} from "../server/keyCore/keyClaudeFirstDirect.js";
import {
  extractSignupOnboardingChartMaterial,
} from "../server/keyCore/keySignupOnboardingChart.js";

const auth = buildAuthenticatedCustomerIdentity({
  customerId: "cust-jinwoo",
  profile: {
    display_name: "김진우",
    gender: "male",
    birth_date: "1988-03-01",
  },
  signupOnboardingBrief: null,
});
assert.equal(auth.customer_id, "cust-jinwoo");
assert.equal(auth.name.value, "김진우");
assert.equal(auth.name.source, "customer_profiles.display_name");
assert.equal(auth.name.verification_level, "profile_field");
assert.equal(auth.sex.value, "male");
assert.equal(auth.birth_year.value, 1988);

const signupMaterial = extractSignupOnboardingChartMaterial({
  signup_onboarding: {
    health: { treatment: "치료 있음", medication: "복약 있음" },
    insurance: {
      hasInsurance: "있음",
      policyCount: "3~5건",
      monthlyPremium: "10~30만 원",
    },
  },
});
assert.ok(signupMaterial);

const docSubject = buildDocumentSubjectIdentity({
  pdfMeta: {
    document_id: "doc-1",
    original_filename: "kimsujeong.pdf",
    attached: true,
    insured: "김수정",
    policyholder: "김수정",
  },
  authenticatedCustomerIdentity: auth,
  documentInPlay: true,
});
assert.equal(docSubject.insured, "김수정");
assert.equal(docSubject.policyholder, "김수정");
assert.equal(docSubject.same_as_authenticated_customer, false);
assert.match(String(docSubject.judgment_basis), /differs/);

const sameNameUnknown = resolveSameAsAuthenticatedCustomer({
  authenticatedCustomerIdentity: auth,
  documentParties: { insured: "김진우", policyholder: "김진우" },
});
assert.equal(sameNameUnknown.same_as_authenticated_customer, "unknown");
assert.match(String(sameNameUnknown.reason), /name_match_alone/);

assert.equal(normalizePersonNameKey("김 진 우"), "김진우");

const payload = buildUserPayload({
  question: "내 기록을 토대로 제안해줘",
  chart: { policy_count: { status: "verified", value: 0 }, contracts: [] },
  contextPack: { recent_conversation_originals: [], older_conversation_summary: null },
  signupOnboardingBrief: signupMaterial,
  authenticatedCustomerIdentity: auth,
  documentSubjectIdentity: docSubject,
  pdfMeta: {
    document_id: "doc-1",
    original_filename: "kimsujeong.pdf",
    attached: true,
    insured: "김수정",
  },
});
assert.ok(payload.current_context.authenticated_customer_identity);
assert.equal(payload.current_context.authenticated_customer_identity.name.value, "김진우");
assert.ok(payload.current_context.document_subject_identity);
assert.equal(payload.current_context.document_subject_identity.insured, "김수정");
assert.equal(
  payload.current_context.document_subject_identity.same_as_authenticated_customer,
  false,
);
assert.ok(payload.current_context.signup_onboarding);
assert.equal(payload.current_context.signup_onboarding.verified, false);
assert.equal(
  Object.prototype.hasOwnProperty.call(
    payload.available_verified_evidence.personal.chart || {},
    "signup_onboarding",
  ),
  false,
);

// Empty history / empty verified chart must not drop soft signup on customer turns.
const emptyHistPayload = buildUserPayload({
  question: "내가 가입한 보험 알려줘",
  chart: { policy_count: { status: "verified", value: 0 }, contracts: [] },
  contextPack: { recent_conversation_originals: [], older_conversation_summary: null },
  signupOnboardingBrief: signupMaterial,
  authenticatedCustomerIdentity: auth,
});
assert.ok(emptyHistPayload.current_context.signup_onboarding);
assert.equal(
  emptyHistPayload.current_context.signup_onboarding.insurance.policyCount,
  "3~5건",
);

// Presence-style: identity anchor ok; caller omits full signup.
const presencePayload = buildUserPayload({
  question: "PRESENCE_TURN",
  chart: null,
  contextPack: { recent_conversation_originals: [], older_conversation_summary: null },
  authenticatedCustomerIdentity: auth,
  signupOnboardingBrief: null,
  presenceContext: { visit_kind: "first_visit", candidates: [] },
});
assert.ok(presencePayload.current_context.authenticated_customer_identity);
assert.equal(presencePayload.current_context.signup_onboarding, undefined);

const prompt = buildSystemPrompt();
assert.equal(
  /authenticated_customer_identity/.test(prompt),
  false,
  "identity detail is dynamic DOMAIN_CONTEXT",
);
const domain = buildDomainContextSystemAddendum({
  authenticatedCustomerIdentity: auth,
  documentSubjectIdentity: { same_as_authenticated_customer: false },
  signupOnboardingBrief: { source: "signup_onboarding" },
});
assert.match(domain, /authenticated_customer_identity/);
assert.match(domain, /document_subject_identity/);
assert.match(domain, /등록된 고객 기록이 없다/);

const mismatch = detectFactIdentityMismatch(
  "고객님 본인은 김수정입니다. 1976년생이세요.",
  {
    authenticatedCustomerIdentity: auth,
    documentSubjectIdentity: docSubject,
  },
);
assert.equal(mismatch.hard_fail, true);
assert.ok(mismatch.hard.includes("fact_identity_mismatch"));

const okAnswer = detectFactIdentityMismatch(
  "문서상 피보험자는 김수정이고, 로그인 고객 김진우와는 동일인 확인이 없습니다.",
  {
    authenticatedCustomerIdentity: auth,
    documentSubjectIdentity: docSubject,
  },
);
assert.equal(okAnswer.hard_fail, false);

const safety = hardOnlySafetyCheck("고객님 본인 이름은 김수정입니다.", {
  allowed_numbers: [],
  allowed_entities: [],
  authenticatedCustomerIdentity: auth,
  documentSubjectIdentity: docSubject,
});
assert.equal(safety.hard_fail, true);
assert.ok(safety.hard.includes("fact_identity_mismatch"));

console.log("key-customer-identity-separation-unit-test: PASS");
