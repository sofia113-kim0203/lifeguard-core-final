/**
 * GO2 — KEY verified literal conflict (sentence-level, pre-commit).
 * Only KEY-confirmed facts (key_claude_original_document) vs assertive current-contract claims.
 * Ambiguous / negation / unclear → pass. No Claude call. No answer rewrite.
 */

const ALLOWED_FIELDS = Object.freeze([
  "insurer_name",
  "product_name",
  "monthly_premium",
  "policyholder",
  "insured",
  "beneficiary",
]);

const KEY_CONFIRMATION = "key_claude_original_document";

const FACT_TYPE_TO_FIELD = Object.freeze({
  insurer_name: "insurer_name",
  insurer: "insurer_name",
  product_name: "product_name",
  monthly_premium: "monthly_premium",
  premium: "monthly_premium",
  policyholder: "policyholder",
  insured: "insured",
  beneficiary: "beneficiary",
});

const CURRENT_CONTRACT_DEIXIS =
  /이\s*계약|이\s*증권|현재\s*(?:계약|증권)|방금\s*올린|올려\s*주신|첨부(?:된|한)?\s*(?:증권|서류|문서|파일)|이\s*문서|증권상|문서상|계약\s*서류상/;

/** 월 보험료 / 매월 납 역할은 그 자체로 현재 계약 보험료 지칭으로 본다. */
const PREMIUM_IMPLICIT_DEIXIS = /월\s*보험료(?:는|은)|매월\s*[0-9,]+/;

const QUESTION_RE = /\?|인가요|일까요|아닌가요|맞나요|궁금|할까요/;
const ASSUME_RE = /가정하면|라고\s*가정|이라면|한다고\s*치면|라고\s*치면/;
const COMPARE_RE =
  /(?:와|과|를|을)\s*비교(?:하면|해\s*보면|하면)|비교하면|대비하면|보다\s*(?:높|낮|비싸|싸|유리|불리)/;
const UNCERTAIN_RE =
  /확인이\s*필요|확인\s*필요|확인되지\s*않|미확인|정확히는|정확히\s*모르겠|모르겠|모르겠습니다|알\s*수\s*없|추정|가능성/;
const PAST_RE = /과거\s*계약|예전에|이전\s*계약|해지된|만료된|예전에\s*가입/;
const MARKET_RE = /일반적으로|시장에서|보통\s*보험사|시중\s*상품/;
/** Grounded market / recommendation speech — never silently strip insurer names. */
const RECOMMENDATION_OR_CANDIDATE_RE =
  /추천|비교\s*후보|후보로|검토해\s*보|보시면\s*(?:돼요|됩니다|좋)|중심으로\s*비교|여러\s*보험사|보험사를\s*비교/;
/** Assertive personal enrollment / owned-contract claim only. */
const PERSONAL_ENROLLMENT_ASSERT_RE =
  /(?:고객(?:님)?(?:은|이)|당신(?:은|이)|본인(?:은|이))?.{0,12}(?:가입(?:했|한|되어)|계약(?:이\s*)?(?:있|체결)|증권(?:번호)?(?:는|이|가)\s*[A-Z0-9])|(?:가입(?:했|한)\s*(?:보험|상품)|에\s*가입되어)/;
/** Real doc-party vs login-customer distinction — not bare 증권상 alone. */
const PROFILE_VS_DOC_RE =
  /(?:문서상|계약\s*서류상|증권상).{0,40}(?:로그인\s*고객|고객\s*프로필)|(?:로그인\s*고객|고객\s*프로필).{0,40}(?:문서상|계약\s*서류상|증권상|와\s*다|과\s*다)/;

const NEGATION_RE =
  /이\s*아닙니다|가\s*아닙니다|는\s*아닙니다|은\s*아닙니다|이\s*아니에요|가\s*아니에요|는\s*아니에요|은\s*아니에요|이\s*아님|가\s*아님|아닙니다|아니에요|아닌\s*것/;

const PRODUCT_ROLE_RE =
  /(?:이\s*계약|현재\s*증권|이\s*증권|방금\s*올린\s*증권).{0,24}상품(?:명)?(?:은|는)/;

const INSURER_ROLE_RE =
  /(?:이\s*계약|이\s*증권|현재\s*(?:계약|증권)).{0,24}(?:보험사|보험\s*회사)(?:는|은)|(?:보험사|보험\s*회사)(?:는|은)\s*|이\s*계약(?:은|는)\s*|이\s*증권(?:은|는)\s*|현재\s*(?:계약|증권)(?:은|는)\s*/;

const PREMIUM_ROLE_RE =
  /월\s*보험료(?:는|은)|(?:이\s*계약|이\s*증권|현재\s*(?:계약|증권)).{0,16}(?:월\s*)?보험료(?:는|은)|매월\s*(?:\d|납)/;

const PARTY_ASSERT = {
  insured: /피보험자(?:는|은|가)\s*/,
  policyholder: /계약자(?:는|은|가)\s*/,
  beneficiary: /수익자(?:는|은|가)\s*/,
};

const INSURER_BRAND_RE =
  /삼성화재|현대해상|KB손해보험|KB손보|디비손해보험|DB손해보험|메리츠화재|한화손해보험|한화생명|삼성생명|교보생명|농협손해보험|NH손해보험|롯데손해보험|흥국화재|AXA|악사손해보험|라이나생명|신한라이프|미래에셋생명|동양생명|ABL생명|푸본현대생명|처브라이프|하나생명|IBK연금보험|우체국보험/;

const NON_PREMIUM_AMOUNT_CONTEXT =
  /진단비|가입\s*금액|보장\s*금액|수술비|입원\s*일당|일당|사망\s*보험금|후유장해/;

function isActivePolicyRow(policy = null) {
  if (!policy || typeof policy !== "object") return false;
  if (policy.is_active === false) return false;
  const summary =
    policy.coverage_summary && typeof policy.coverage_summary === "object"
      ? policy.coverage_summary
      : {};
  if (String(summary.retired_reason ?? policy.retired_reason ?? "").trim()) return false;
  if (policy.deleted_at != null && policy.deleted_at !== "") return false;
  const status = String(policy.policy_status ?? summary.policy_status ?? "")
    .trim()
    .toLowerCase();
  if (status.includes("retired")) return false;
  return true;
}

function normalizeText(raw = "") {
  return String(raw ?? "")
    .replace(/\s+/g, "")
    .replace(/\(주\)|㈜|주식회사/g, "")
    .trim();
}

function normalizePremium(raw = "") {
  const digits = String(raw ?? "").replace(/[^\d]/g, "");
  return digits || "";
}

function normalizeName(raw = "") {
  return String(raw ?? "").replace(/\s+/g, "").trim();
}

function normalizeForField(field, raw) {
  if (field === "monthly_premium") return normalizePremium(raw);
  if (field === "policyholder" || field === "insured" || field === "beneficiary") {
    return normalizeName(raw);
  }
  return normalizeText(raw);
}

function literalsCompatible(field, verifiedNorm, claimedNorm) {
  if (!verifiedNorm || !claimedNorm) return true;
  if (verifiedNorm === claimedNorm) return true;
  if (field === "product_name" || field === "insurer_name") {
    if (verifiedNorm.includes(claimedNorm) || claimedNorm.includes(verifiedNorm)) return true;
  }
  return false;
}

/**
 * Build verified literal set from active policies' KEY-confirmed facts only.
 */
export function buildVerifiedLiteralSetFromPolicies(
  policies = [],
  { activeDocumentId = null } = {},
) {
  const activeId = String(activeDocumentId ?? "").trim() || null;
  const entries = [];
  const rows = Array.isArray(policies) ? policies : [];

  for (const policy of rows) {
    if (!isActivePolicyRow(policy)) continue;
    const summary =
      policy.coverage_summary && typeof policy.coverage_summary === "object"
        ? policy.coverage_summary
        : {};
    const facts = Array.isArray(summary.key_confirmed_source_facts)
      ? summary.key_confirmed_source_facts
      : [];
    for (const fact of facts) {
      if (!fact || typeof fact !== "object") continue;
      if (String(fact.confirmation_source ?? "").trim() !== KEY_CONFIRMATION) continue;
      const sid = String(fact.source_document_id ?? "").trim();
      if (!sid) continue;
      const factType = String(fact.fact_type ?? "")
        .trim()
        .toLowerCase();
      const field = FACT_TYPE_TO_FIELD[factType];
      if (!field || !ALLOWED_FIELDS.includes(field)) continue;
      const literal = String(fact.literal_value ?? "").trim();
      if (!literal) continue;
      const literal_norm = normalizeForField(field, literal);
      if (!literal_norm) continue;
      entries.push({
        field,
        literal_norm,
        source_document_id: sid,
        policy_active: true,
        confirmation_source: KEY_CONFIRMATION,
      });
    }
  }

  return {
    active_document_id: activeId,
    entries,
  };
}

function softPassReason(sentence = "") {
  const t = String(sentence ?? "");
  if (!t.trim()) return "empty_sentence";
  if (QUESTION_RE.test(t)) return "question";
  if (ASSUME_RE.test(t)) return "assumption";
  if (NEGATION_RE.test(t)) return "negation";
  if (COMPARE_RE.test(t)) return "comparison";
  if (UNCERTAIN_RE.test(t)) return "uncertain";
  if (PAST_RE.test(t)) return "past_contract";
  if (MARKET_RE.test(t)) return "market_general";
  if (PROFILE_VS_DOC_RE.test(t)) return "doc_vs_customer_distinction";
  return null;
}

function detectAssertedField(sentence = "") {
  const t = String(sentence ?? "");
  if (PARTY_ASSERT.insured.test(t)) return "insured";
  if (PARTY_ASSERT.policyholder.test(t)) return "policyholder";
  if (PARTY_ASSERT.beneficiary.test(t)) return "beneficiary";
  if (PREMIUM_ROLE_RE.test(t)) return "monthly_premium";
  if (PRODUCT_ROLE_RE.test(t)) return "product_name";
  if (INSURER_ROLE_RE.test(t) && INSURER_BRAND_RE.test(t)) return "insurer_name";
  return null;
}

function extractClaimedLiteral(field, sentence = "") {
  const t = String(sentence ?? "");
  if (field === "insurer_name") {
    const roleBound = t.match(
      /(?:보험사|보험\s*회사)(?:는|은)\s*([^\n.!?。]{2,40}?)(?:입니다|이에요|예요)/,
    );
    if (roleBound) {
      const m = String(roleBound[1]).match(INSURER_BRAND_RE);
      if (m) return m[0];
    }
    const contractBound = t.match(
      /(?:이\s*계약|이\s*증권|현재\s*(?:계약|증권))(?:은|는)\s*([^\n.!?。]{2,40}?)(?:입니다|이에요|예요)/,
    );
    if (contractBound) {
      const m = String(contractBound[1]).match(INSURER_BRAND_RE);
      if (m) return m[0];
    }
    return null;
  }
  if (field === "monthly_premium") {
    // Role-bound premium amount only — never first 원 in the sentence.
    const patterns = [
      /월\s*보험료(?:는|은)\s*([0-9,]+)\s*원/,
      /(?:이\s*계약|이\s*증권|현재\s*(?:계약|증권)).{0,16}(?:월\s*)?보험료(?:는|은)\s*([0-9,]+)\s*원/,
      /매월\s*([0-9,]+)\s*원(?:을|를)?\s*납/,
    ];
    for (const re of patterns) {
      const m = t.match(re);
      if (m?.[1]) {
        // Reject if the matched amount window is a non-premium benefit label.
        const idx = t.indexOf(m[0]);
        const window = t.slice(Math.max(0, idx - 12), idx + m[0].length);
        if (NON_PREMIUM_AMOUNT_CONTEXT.test(window)) continue;
        return m[1];
      }
    }
    return null;
  }
  if (field === "product_name") {
    const m = t.match(
      /(?:이\s*계약|현재\s*증권|이\s*증권|방금\s*올린\s*증권).{0,24}상품(?:명)?(?:은|는)\s*([^\n.!?]{2,80}?)(?:입니다|이에요|예요|임\b)/,
    );
    return m ? m[1].trim() : null;
  }
  if (field === "insured" || field === "policyholder" || field === "beneficiary") {
    const re = PARTY_ASSERT[field];
    if (!re) return null;
    const m = t.match(
      new RegExp(re.source + "([가-힣]{2,8})(?:입니다|이에요|예요|이고|이며|임\\b)"),
    );
    return m ? m[1] : null;
  }
  return null;
}

function resolveScopedEntries(verifiedSet, field) {
  const entries = (verifiedSet?.entries ?? []).filter((e) => e.field === field);
  if (entries.length === 0) return { ok: false, reason: "no_verified_value" };

  const activeDoc = String(verifiedSet?.active_document_id ?? "").trim() || null;

  // Fail-closed: activeDocumentId present → only that source; never fall through.
  let scoped;
  if (activeDoc) {
    scoped = entries.filter((e) => e.source_document_id === activeDoc);
    if (scoped.length === 0) {
      return { ok: false, reason: "active_document_no_verified_facts" };
    }
  } else {
    scoped = entries;
  }

  const distinctDocs = new Set(scoped.map((e) => e.source_document_id));
  if (distinctDocs.size > 1) {
    return { ok: false, reason: "ambiguous_multiple_contracts" };
  }

  const norms = new Set(scoped.map((e) => e.literal_norm));
  if (norms.size > 1) {
    return { ok: false, reason: "ambiguous_multiple_values" };
  }

  return {
    ok: true,
    entry: scoped[0],
    source_scope: activeDoc ? "active_document" : "active_policy",
  };
}

function pass(reason) {
  return {
    conflict: false,
    field: null,
    source_scope: null,
    reason: reason || "pass",
  };
}

function conflict(field, source_scope, reason) {
  return {
    conflict: true,
    field,
    source_scope,
    reason: reason || "direct_assertion_mismatch",
  };
}

/**
 * Sentence vs KEY verified literals. Ambiguous → pass (no conflict).
 */
export function detectKeyVerifiedLiteralConflict(sentence = "", verifiedSet = null) {
  const soft = softPassReason(sentence);
  if (soft) return pass(soft);

  const sentenceText = String(sentence ?? "");
  const field = detectAssertedField(sentenceText);
  if (!field) return pass("no_asserted_field");

  const hasDeixis =
    CURRENT_CONTRACT_DEIXIS.test(sentenceText) ||
    (field === "monthly_premium" && PREMIUM_IMPLICIT_DEIXIS.test(sentenceText));
  if (!hasDeixis) {
    return pass("no_current_contract_deixis");
  }

  if (field === "product_name" && !PRODUCT_ROLE_RE.test(String(sentence ?? ""))) {
    return pass("product_role_not_explicit");
  }
  if (field === "insurer_name" && !INSURER_ROLE_RE.test(String(sentence ?? ""))) {
    return pass("insurer_role_not_explicit");
  }
  if (field === "monthly_premium" && !PREMIUM_ROLE_RE.test(String(sentence ?? ""))) {
    return pass("premium_role_not_explicit");
  }

  // Positive assertion marker required (negation already soft-passed).
  if (!/(?:입니다|이에요|예요|임\b)/.test(String(sentence ?? ""))) {
    return pass("no_positive_assertion");
  }

  const scoped = resolveScopedEntries(verifiedSet, field);
  if (!scoped.ok) return pass(scoped.reason);

  const claimedRaw = extractClaimedLiteral(field, sentence);
  if (!claimedRaw) return pass("claimed_literal_unclear");

  const claimedNorm = normalizeForField(field, claimedRaw);
  if (!claimedNorm) return pass("claimed_literal_unclear");

  if (literalsCompatible(field, scoped.entry.literal_norm, claimedNorm)) {
    return pass("compatible_with_verified");
  }

  return conflict(field, scoped.source_scope, "direct_assertion_mismatch");
}

export const KEY_VERIFIED_LITERAL_CONFLICT_FIELDS = ALLOWED_FIELDS;

/** Existing brand regex — not a new insurer catalog. */
export { INSURER_BRAND_RE };

/**
 * Short forms derived only from INSURER_BRAND_RE entries (no new insurer catalog).
 * Longest-first for matching.
 */
function deriveInsurerBrandForms() {
  const brands = String(INSURER_BRAND_RE.source).split("|").filter(Boolean);
  const forms = new Set();
  for (const brand of brands) {
    forms.add(brand);
    if (brand.endsWith("손해보험")) {
      forms.add(`${brand.slice(0, -4)}손보`); // 한화손해보험 → 한화손보
      forms.add(brand.slice(0, -4)); // 한화손해보험 → 한화
    } else if (brand.endsWith("생명")) {
      forms.add(brand.slice(0, -2)); // 한화생명 → 한화
    } else if (brand.endsWith("화재")) {
      forms.add(brand.slice(0, -2));
    } else if (brand.endsWith("해상")) {
      forms.add(brand.slice(0, -2));
    }
  }
  // Drop ultra-short / ambiguous tokens that are not useful alone.
  return [...forms]
    .filter((f) => f && f.length >= 2)
    .sort((a, b) => b.length - a.length);
}

const INSURER_BRAND_FORMS = deriveInsurerBrandForms();
const INSURER_BRAND_FORMS_RE = new RegExp(
  `(${INSURER_BRAND_FORMS.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
);

function expandInsurerNorm(raw = "") {
  return normalizeText(raw).replace(/손보/g, "손해보험");
}

function insurerFormAllowed(claimedForm, allowedEntities = []) {
  const claimed = expandInsurerNorm(claimedForm);
  if (!claimed) return true;
  const allowed = (Array.isArray(allowedEntities) ? allowedEntities : [])
    .map((e) => expandInsurerNorm(e))
    .filter(Boolean);
  if (allowed.length === 0) return false;
  // Exact / expanded equality only — no bare-stem green light (한화 ↛ 한화손보).
  return allowed.some((a) => a === claimed);
}

function productFormAllowed(productForm, allowedEntities = []) {
  const product = normalizeText(productForm);
  if (!product) return true;
  const allowed = (Array.isArray(allowedEntities) ? allowedEntities : [])
    .map((e) => normalizeText(e))
    .filter(Boolean);
  if (allowed.length === 0) return false;
  return allowed.some((a) => a === product || a.includes(product) || product.includes(a));
}

/**
 * Sentence-level / phrase-level guard — no second Claude call, no full rewrite.
 * Strips unverified insurer(+product) literals using existing brand forms only.
 * Keeps generic presence wording (e.g. 단체보험이 있음).
 */
export function neutralizeUnsupportedInsurerProductLiterals(
  text = "",
  { allowedEntities = [] } = {},
) {
  const raw = String(text ?? "");
  if (!raw.trim()) {
    return {
      text: raw,
      changed: false,
      stripped_count: 0,
      stripped_forms: [],
      reason: "empty",
    };
  }

  // Soft / non-assertive whole-answer passes stay untouched at this layer.
  // Per-match we still skip clearly comparative / uncertain local windows below.
  const stripped_forms = [];
  let stripped_count = 0;

  // Brand + optional specific product token ending in 보험/실손/종신/연금.
  const phraseRe = new RegExp(
    `${INSURER_BRAND_FORMS_RE.source}(?:\\s*[가-힣A-Za-z0-9·\\-]{2,40}?(?:보험|실손|종신|연금))?`,
    "g",
  );

  let next = raw.replace(phraseRe, (match, brand, offset) => {
    const productPart = String(match.slice(String(brand).length) ?? "").trim();
    const brandOk = insurerFormAllowed(brand, allowedEntities);
    const productOk = !productPart || productFormAllowed(productPart, allowedEntities);
    if (brandOk && productOk) return match;

    const window = raw.slice(Math.max(0, offset - 40), offset + match.length + 40);
    // Preserve recommendation / market / comparison / educational speech entirely.
    if (
      RECOMMENDATION_OR_CANDIDATE_RE.test(window) ||
      ASSUME_RE.test(window) ||
      MARKET_RE.test(window) ||
      COMPARE_RE.test(window)
    ) {
      return match;
    }
    if (QUESTION_RE.test(window) && /\?|인가요|일까요|아닌가요|맞나요/.test(window)) {
      return match;
    }
    if (NEGATION_RE.test(window) && window.indexOf(match) > window.search(NEGATION_RE)) {
      return match;
    }
    if (UNCERTAIN_RE.test(match)) return match;

    // Only neutralize assertive personal enrollment / current-contract claims.
    const personalAssert =
      PERSONAL_ENROLLMENT_ASSERT_RE.test(window) || CURRENT_CONTRACT_DEIXIS.test(window);
    if (!personalAssert) return match;

    stripped_count += 1;
    stripped_forms.push(String(brand));
    if (productPart) stripped_forms.push(productPart);

    const after = raw.slice(offset + match.length);
    if (/^\s*에서/.test(after) || /에서$/.test(match)) {
      return brandOk ? `${brand}` : "보험사";
    }
    // Presence-only corporate wording: keep generic 단체보험, never invented product.
    if (/단체/.test(match) || /단체/.test(productPart)) return "단체보험";
    if (brandOk && productPart) return String(brand);
    if (/(?:보험|실손|종신|연금)$/.test(match)) return "해당 보험";
    return "";
  });

  // Product-code residue (e.g. 무배당2604). Not a catalog — Hangul glued to 3+ digits only.
  // Keeps spaced general wording like "무배당 상품". Verified allowlist literals preserved.
  const productCodeRe = /(?:무배당\d{3,8}|[가-힣]{2,24}\d{3,8})/g;
  next = next.replace(productCodeRe, (code, offset) => {
    if (productFormAllowed(code, allowedEntities)) return code;
    const window = next.slice(Math.max(0, offset - 16), offset + code.length + 16);
    // Keep educational "무배당 상품/보험" — those are spaced, not matched. Extra soft skips:
    if (MARKET_RE.test(window) || ASSUME_RE.test(window) || COMPARE_RE.test(window)) {
      return code;
    }
    if (QUESTION_RE.test(window) && /\?|인가요|일까요|아닌가요|맞나요/.test(window)) {
      return code;
    }
    stripped_count += 1;
    stripped_forms.push(code);
    return "";
  });

  // Clean doubled spaces / empty wrappers from removals (whitespace only).
  const cleaned = next
    .replace(/\(\s*단체보험\s*\)/g, "(단체보험)")
    .replace(/단체보험\s+(?=[)\].,，。])/g, "단체보험")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ \n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\(\s*\)/g, "");

  return {
    text: cleaned,
    changed: cleaned !== raw,
    stripped_count,
    stripped_forms: [...new Set(stripped_forms)].slice(0, 12),
    reason:
      stripped_count > 0 ? "unsupported_insurer_product_literal" : "no_unsupported_literal",
  };
}
