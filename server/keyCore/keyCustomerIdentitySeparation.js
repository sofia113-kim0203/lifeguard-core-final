/**
 * Authenticated customer identity ↔ document subject identity separation.
 * Soft materials for Claude/KEY only — never merges into verified_customer_chart.
 */

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function trimStr(value) {
  const s = String(value ?? "").trim();
  return s || null;
}

/** Normalize Korean/person name for inequality checks only — never invents identity. */
export function normalizePersonNameKey(name = null) {
  const s = String(name ?? "")
    .replace(/\s+/g, "")
    .replace(/[·ㆍ.]/g, "")
    .trim();
  return s || null;
}

function birthYearFromDate(value) {
  const s = trimStr(value);
  if (!s) return null;
  const m = s.match(/^(\d{4})/);
  if (!m) return null;
  const y = Number(m[1]);
  return Number.isFinite(y) && y >= 1900 && y <= 2100 ? y : null;
}

function fieldEntry(value, source, verificationLevel) {
  const v = value == null || value === "" ? null : value;
  return {
    value: v,
    source: v == null ? null : source,
    verification_level: v == null ? null : verificationLevel,
  };
}

/**
 * Minimal authenticated-customer identity anchor from profile (+ signup name/sex/birth only if profile missing).
 * Never promotes signup into verified chart.
 */
export function buildAuthenticatedCustomerIdentity({
  customerId = null,
  profile = null,
  signupOnboardingBrief = null,
} = {}) {
  const cid = trimStr(customerId);
  if (!cid) return null;
  const p = asObject(profile) || {};
  const signup = asObject(signupOnboardingBrief) || {};
  const signupHealth = asObject(signup.health) || {};
  const signupIdentity = asObject(signup.identity) || asObject(signup.profile) || {};

  const nameFromProfile = trimStr(p.display_name);
  const nameFromSignup = trimStr(
    signupIdentity.name ?? signupIdentity.display_name ?? signupHealth.name,
  );
  const sexFromProfile = trimStr(p.gender);
  const sexFromSignup = trimStr(
    signupIdentity.sex ?? signupIdentity.gender ?? signupHealth.sex ?? signupHealth.gender,
  );
  const birthYearFromProfile = birthYearFromDate(p.birth_date);
  const birthYearFromSignup = birthYearFromDate(
    signupIdentity.birth_date ??
      signupIdentity.birth_year ??
      signupHealth.birth_date ??
      signupHealth.birth_year,
  );

  const name = nameFromProfile
    ? fieldEntry(nameFromProfile, "customer_profiles.display_name", "profile_field")
    : nameFromSignup
      ? fieldEntry(nameFromSignup, "signup_onboarding", "customer_reported")
      : fieldEntry(null, null, null);

  const sex = sexFromProfile
    ? fieldEntry(sexFromProfile, "customer_profiles.gender", "profile_field")
    : sexFromSignup
      ? fieldEntry(sexFromSignup, "signup_onboarding", "customer_reported")
      : fieldEntry(null, null, null);

  const birth_year = birthYearFromProfile
    ? fieldEntry(birthYearFromProfile, "customer_profiles.birth_date", "profile_field")
    : birthYearFromSignup
      ? fieldEntry(birthYearFromSignup, "signup_onboarding", "customer_reported")
      : fieldEntry(null, null, null);

  return {
    customer_id: cid,
    name,
    sex,
    birth_year,
    note: "authenticated_login_customer_identity_anchor_not_document_subject",
  };
}

function firstPersonName(...candidates) {
  for (const c of candidates) {
    const n = trimStr(c);
    if (n) return n;
  }
  return null;
}

function extractNamesFromTextBlob(text = "") {
  const t = String(text ?? "");
  if (!t.trim()) return { policyholder: null, insured: null, beneficiary: null };
  const policyholder = t.match(/계약자\s*[:：]?\s*([가-힣]{2,6})/)?.[1] ?? null;
  const insured = t.match(/피보험자\s*[:：]?\s*([가-힣]{2,6})/)?.[1] ?? null;
  const beneficiary = t.match(/수익자\s*[:：]?\s*([가-힣]{2,6})/)?.[1] ?? null;
  return {
    policyholder: trimStr(policyholder),
    insured: trimStr(insured),
    beneficiary: trimStr(beneficiary),
  };
}

function collectDocumentPartyHints({
  pdfMeta = null,
  documentEvidence = null,
  policies = null,
} = {}) {
  const meta = asObject(pdfMeta) || {};
  const parties = asObject(meta.parties) || {};
  let policyholder = firstPersonName(
    parties.policyholder,
    meta.policyholder,
    meta.contractor,
  );
  let insured = firstPersonName(
    parties.insured,
    meta.insured,
    meta.insured_name,
  );
  let beneficiary = firstPersonName(
    parties.beneficiary,
    Array.isArray(parties.beneficiaries) ? parties.beneficiaries[0] : null,
    meta.beneficiary,
  );
  let diagnosisSubject = firstPersonName(
    meta.diagnosis_subject,
    meta.claim_subject,
    parties.diagnosis_subject,
    parties.claim_subject,
  );

  const chunks = Array.isArray(documentEvidence) ? documentEvidence : [];
  for (const row of chunks) {
    const blob = [row?.text, row?.excerpt, row?.content, row?.literal]
      .map((x) => String(x ?? ""))
      .join("\n");
    const fromText = extractNamesFromTextBlob(blob);
    if (!policyholder && fromText.policyholder) policyholder = fromText.policyholder;
    if (!insured && fromText.insured) insured = fromText.insured;
    if (!beneficiary && fromText.beneficiary) beneficiary = fromText.beneficiary;
  }

  const docId = trimStr(meta.document_id);
  const rows = Array.isArray(policies) ? policies : [];
  for (const p of rows) {
    const summary = asObject(p?.coverage_summary) || {};
    const srcDoc = trimStr(
      p?.source_document_id ?? summary.source_document_id ?? summary.document_id,
    );
    if (docId && srcDoc && srcDoc !== docId) continue;
    const ph = firstPersonName(p?.policyholder, summary.policyholder);
    const ins = firstPersonName(p?.insured, p?.insured_name, summary.insured, summary.insured_name);
    const ben = firstPersonName(
      Array.isArray(summary.beneficiaries) ? summary.beneficiaries[0]?.name : null,
      summary.beneficiary,
    );
    if (!policyholder && ph) policyholder = ph;
    if (!insured && ins) insured = ins;
    if (!beneficiary && ben) beneficiary = ben;
  }

  return {
    policyholder,
    insured,
    beneficiary,
    diagnosis_or_claim_subject: diagnosisSubject,
    document_id: docId,
    original_filename: trimStr(meta.original_filename),
  };
}

/**
 * same_as_authenticated_customer:
 * - false when a document person name clearly differs from authenticated name
 * - never true from name-equality alone
 * - unknown when insufficient evidence / customer confirmation missing
 */
export function resolveSameAsAuthenticatedCustomer({
  authenticatedCustomerIdentity = null,
  documentParties = null,
} = {}) {
  const authName = normalizePersonNameKey(
    authenticatedCustomerIdentity?.name?.value ?? null,
  );
  const parties = asObject(documentParties) || {};
  const docNames = [
    parties.insured,
    parties.policyholder,
    parties.beneficiary,
    parties.diagnosis_or_claim_subject,
  ]
    .map((n) => normalizePersonNameKey(n))
    .filter(Boolean);

  if (!authName || docNames.length === 0) {
    return {
      same_as_authenticated_customer: "unknown",
      reason: "insufficient_name_evidence_or_missing_customer_confirmation",
    };
  }

  const differing = docNames.filter((n) => n !== authName);
  if (differing.length > 0) {
    return {
      same_as_authenticated_customer: false,
      reason: "document_person_name_differs_from_authenticated_customer_name",
      differing_names: differing,
    };
  }

  // Name match alone never confirms same person.
  return {
    same_as_authenticated_customer: "unknown",
    reason: "name_match_alone_does_not_confirm_same_person",
  };
}

/**
 * Document subject identity block for Claude/KEY materials.
 * Returns null when no document is in play.
 */
export function buildDocumentSubjectIdentity({
  pdfMeta = null,
  documentEvidence = null,
  policies = null,
  authenticatedCustomerIdentity = null,
  documentInPlay = false,
} = {}) {
  const meta = asObject(pdfMeta);
  const hasMetaDoc = Boolean(
    meta &&
      (meta.document_id ||
        meta.original_filename ||
        meta.attached === true ||
        Array.isArray(meta.document_box_listing) && meta.document_box_listing.length > 0),
  );
  const hasEvidence = Array.isArray(documentEvidence) && documentEvidence.length > 0;
  if (!documentInPlay && !hasMetaDoc && !hasEvidence) return null;

  const parties = collectDocumentPartyHints({ pdfMeta, documentEvidence, policies });
  const same = resolveSameAsAuthenticatedCustomer({
    authenticatedCustomerIdentity,
    documentParties: parties,
  });

  return {
    policyholder: parties.policyholder,
    insured: parties.insured,
    beneficiary: parties.beneficiary,
    diagnosis_or_claim_subject: parties.diagnosis_or_claim_subject,
    document_id: parties.document_id,
    original_filename: parties.original_filename,
    same_as_authenticated_customer: same.same_as_authenticated_customer,
    judgment_basis: same.reason,
    ...(Array.isArray(same.differing_names) ? { differing_names: same.differing_names } : {}),
    note: "document_subject_identity_only_never_auto_promote_to_authenticated_customer",
  };
}

/**
 * Hard-only detection: answer treats a differing document person as the logged-in customer self.
 * Trace / hard reason only — does not rewrite answer text.
 */
export function detectFactIdentityMismatch(text = "", {
  authenticatedCustomerIdentity = null,
  documentSubjectIdentity = null,
} = {}) {
  const answer = String(text ?? "");
  if (!answer.trim()) {
    return { hard_fail: false, hard: [], detail: null };
  }
  const doc = asObject(documentSubjectIdentity);
  if (!doc || doc.same_as_authenticated_customer !== false) {
    return { hard_fail: false, hard: [], detail: null };
  }
  const authName = trimStr(authenticatedCustomerIdentity?.name?.value);
  const docNames = [doc.insured, doc.policyholder, doc.beneficiary, doc.diagnosis_or_claim_subject]
    .map((n) => trimStr(n))
    .filter(Boolean)
    .filter((n) => normalizePersonNameKey(n) !== normalizePersonNameKey(authName));

  if (docNames.length === 0) {
    return { hard_fail: false, hard: [], detail: null };
  }

  // Narrow: only when the differing document person is asserted as the login customer's self.
  // Comparative phrasing ("문서 피보험자 김수정 / 로그인 고객 김진우") must not trip.
  const mentionsDocAsSelf = docNames.some((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(
        `${escaped}\\s*(?:님)?\\s*(?:이|가|은|는)?\\s*(?:고객님\\s*)?본인`,
      ),
      new RegExp(`(?:고객님\\s*)?본인(?:이|의|은|는)?\\s*${escaped}`),
      new RegExp(
        `(?:고객(?:님)?(?:의)?\\s*)?(?:본인\\s*)?이름(?:은|이|가)?\\s*${escaped}`,
      ),
      new RegExp(
        `(?:고객님\\s*)?본인\\s*이름(?:은|이|가)?\\s*${escaped}`,
      ),
      new RegExp(
        `${escaped}\\s*(?:님)?\\s*(?:이|가|은|는)?\\s*고객(?:님)?(?:이|가|입니다|이에요|예요)`,
      ),
    ];
    return patterns.some((re) => re.test(answer));
  });

  if (!mentionsDocAsSelf) {
    return { hard_fail: false, hard: [], detail: null };
  }

  return {
    hard_fail: true,
    hard: ["fact_identity_mismatch"],
    detail: {
      authenticated_name: authName,
      document_names: docNames,
      same_as_authenticated_customer: false,
    },
  };
}

export function softAuthenticatedCustomerIdentityContext(identity = null) {
  if (!identity || typeof identity !== "object") return null;
  return {
    authenticated_customer_identity: {
      ...identity,
      note:
        identity.note ||
        "authenticated_login_customer_identity_anchor_not_document_subject",
    },
  };
}

export function softDocumentSubjectIdentityContext(identity = null) {
  if (!identity || typeof identity !== "object") return null;
  return {
    document_subject_identity: {
      ...identity,
      note:
        identity.note ||
        "document_subject_identity_only_never_auto_promote_to_authenticated_customer",
    },
  };
}
