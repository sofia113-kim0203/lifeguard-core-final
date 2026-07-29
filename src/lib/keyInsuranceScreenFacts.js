/**
 * KEY insurance screen facts — customer card + current KEY turn only.
 * No separate API / Claude / recommender.
 * Also hosts read-only industry coverage baseline comparison (display only).
 */
import { resolvePolicyPremium } from "./resolvePolicyPremium.js";
import {
  KEY_INDUSTRY_COVERAGE_BASELINE_ITEMS,
  KEY_INDUSTRY_COVERAGE_BASELINE_VERSION,
  KEY_INDUSTRY_COVERAGE_BASELINE_AS_OF,
  KEY_INDUSTRY_COMPARISON_BASELINE_TITLE,
  BASELINE_STRUCTURED_AXES,
  MAJOR_TREATMENT_REGIONS,
} from "./keyIndustryCoverageBaselineTable.js";
import {
  KEY_BASELINE_DIAGNOSIS_ITEM_IDS,
  KEY_BASELINE_FACT_STATUSES,
  KEY_BASELINE_STRUCTURED_ITEM_IDS,
  collectKeyCoverageBaselineFactsFromPolicies,
  isVerifiedBaselineFact,
  policiesHaveKeyBaselineFacts,
} from "./keyCoverageBaselineFacts.js";

export const KEY_TURN_MIRROR_EMPTY = "\uC544\uC9C1 \uC774 \uB300\uD654\uC5D0\uC11C \uD655\uC778\uB41C \uB0B4\uC6A9\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.";

/** Left-rail honesty: auto-lookup is not ready; upload only (no fake auth CTA). */
export const KEY_INSURANCE_UPLOAD_GUIDANCE_SHORT =
  "현재는 KEY가 보험계약을 자동으로 불러오는 연결이 아직 준비되지 않았습니다.\n" +
  "보험자료를 올려주시면 KEY가 전체 계약을 정리해 드립니다.";

export const KEY_INSURANCE_UPLOAD_GUIDANCE_DETAIL =
  "현재는 KEY가 보험계약을 자동으로 불러오는 연결이 아직 준비되지 않았습니다.\n" +
  "보험증권·보장내역서 또는 내보험다보여 조회자료를 올려주시면, KEY가 전체 계약을 정리하고 부족하거나 겹치는 보장을 확인해 드릴게요.\n" +
  "자동조회 연동이 준비되면 본인인증과 동의만으로 KEY가 직접 보험계약을 불러오게 됩니다.";

/** Full guidance (regression / prompt honesty). */
export const KEY_INSURANCE_UPLOAD_GUIDANCE = KEY_INSURANCE_UPLOAD_GUIDANCE_DETAIL;

export function sumConfirmedMonthlyPremium(policies = []) {
  let sum = 0;
  let has = false;
  for (const row of Array.isArray(policies) ? policies : []) {
    if (row?.status !== "\uD655\uC778\uB428") continue;
    const numeric = Number(row?.monthly_premium);
    if (!Number.isFinite(numeric) || numeric <= 0) continue;
    sum += numeric;
    has = true;
  }
  return has ? sum : null;
}

const INSURANCE_TURN_RE =
  /\uBCF4\uD5D8|\uACC4\uC57D|\uBCF4\uC7A5|\uBCF4\uD5D8\uB8CC|\uC9C4\uB2E8\uBE44|\uC2E4\uC190|\uC554|\uB0A9\uC785|\uC99D\uAD8C|\uD2B9\uC57D|\uBCF4\uD5D8\uC0AC|\uC0C1\uD488\uBA85|\uD655\uC778\uB428|\uBBF8\uD655\uC778|\uD655\uC778\\s*\uD544\uC694/;

export function isRetiredPolicyRow(policy = null) {
  if (!policy || typeof policy !== "object") return true;
  const summary =
    policy.coverage_summary && typeof policy.coverage_summary === "object"
      ? policy.coverage_summary
      : {};
  const retiredReason = String(summary.retired_reason ?? policy.retired_reason ?? "").trim();
  if (retiredReason) return true;
  if (policy.deleted_at != null && policy.deleted_at !== "") return true;
  if (policy.is_active === false && String(policy.policy_status ?? "").includes("retired")) {
    return true;
  }
  return false;
}

/** Normalize identity tokens — whitespace / case / common separators only. */
export function normalizeIdentityToken(value = "") {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s\-_/.,·•]+/g, "");
}

function summaryOf(policy) {
  return policy?.coverage_summary && typeof policy.coverage_summary === "object"
    ? policy.coverage_summary
    : {};
}

function pickPolicyNumber(policy) {
  const s = summaryOf(policy);
  return (
    String(
      policy?.policy_number ??
        s.policy_number ??
        s.extraction_json?.policy_number ??
        "",
    ).trim() || null
  );
}

function pickSourceSha(policy) {
  const s = summaryOf(policy);
  const sha = String(
    policy?.source_content_sha256 ??
      s.source_content_sha256 ??
      s.source_sha256 ??
      "",
  )
    .trim()
    .toLowerCase();
  return sha || null;
}

function pickLocator(policy) {
  const s = summaryOf(policy);
  const loc = String(
    s.source_page_or_image ??
      s.source_locator ??
      s.contract_locator ??
      s.page_index ??
      policy?.source_page_or_image ??
      "",
  ).trim();
  return loc || null;
}

function partyNames(policy) {
  const s = summaryOf(policy);
  const contractor = String(
    s.contractor_name ?? s.contract_holder ?? s.contractor ?? policy?.contractor_name ?? "",
  ).trim();
  const insured = String(
    s.insured_name ?? s.insured ?? policy?.insured_name ?? "",
  ).trim();
  return { contractor: contractor || null, insured: insured || null };
}

/** Known non-customer fixture / placeholder subjects — never personal confirmed. */
const FOREIGN_SUBJECT_RE =
  /^(홍길동|김철수|이영희|테스트|test\s*user|qa\s*fixture)$/i;

/**
 * Ownership / subject / scope gate for personal customer surfaces.
 * Uses existing verification fields only — never insurer/product hardcoding.
 * opts.customerNameHints: optional list of accepted names for this customer.
 */
export function isPersonalOwnershipOk(policy, opts = {}) {
  const s = summaryOf(policy);
  const claimScope = String(policy?.claim_scope ?? s.claim_scope ?? "")
    .trim()
    .toLowerCase();
  const subjectScope = String(policy?.subject_scope ?? s.subject_scope ?? "")
    .trim()
    .toLowerCase();
  if (claimScope === "corporate" || subjectScope === "corporate") return false;
  if (subjectScope === "fixture" || claimScope === "fixture") return false;

  const { contractor, insured } = partyNames(policy);
  const hints = Array.isArray(opts.customerNameHints)
    ? opts.customerNameHints.map((n) => normalizeIdentityToken(n)).filter(Boolean)
    : [];
  for (const name of [contractor, insured]) {
    if (!name) continue;
    if (FOREIGN_SUBJECT_RE.test(name.trim())) return false;
    if (hints.length) {
      const norm = normalizeIdentityToken(name);
      if (norm && !hints.some((h) => h && (h === norm || norm.includes(h) || h.includes(norm)))) {
        return false;
      }
    }
  }
  return true;
}

/** Active rows that may appear on personal customer UI / chart / Claude personal review. */
export function filterPersonalCustomerPolicies(policies = [], opts = {}) {
  return (Array.isArray(policies) ? policies : []).filter(
    (p) =>
      p &&
      !isRetiredPolicyRow(p) &&
      p.is_active !== false &&
      isPersonalOwnershipOk(p, opts),
  );
}

/** Contract fact fingerprint from verified schema fields only (no LLM prose). */
export function buildContractFactFingerprint(policy = {}) {
  const s = summaryOf(policy);
  const insurer = normalizeIdentityToken(policy.insurer_name ?? s.insurer ?? "");
  const product = normalizeIdentityToken(policy.product_name ?? s.product_name ?? "");
  const pn = normalizeIdentityToken(pickPolicyNumber(policy) ?? "");
  const start = normalizeIdentityToken(
    policy.effective_from ?? s.effective_from ?? s.policy_start_date ?? s.contract_date ?? "",
  );
  const end = normalizeIdentityToken(
    s.maturity_date ?? s.policy_end_date ?? s.end_date ?? "",
  );
  const premium = resolvePolicyPremium(policy);
  const premPart = premium != null && Number.isFinite(Number(premium)) ? String(Number(premium)) : "";
  const { contractor, insured } = partyNames(policy);
  const locator = normalizeIdentityToken(pickLocator(policy) ?? "");
  const parts = [
    insurer,
    product,
    pn,
    start,
    end,
    premPart,
    normalizeIdentityToken(contractor ?? ""),
    normalizeIdentityToken(insured ?? ""),
    locator,
  ];
  if (!parts.some(Boolean)) return null;
  return parts.join("|");
}

/**
 * source_fact_key — same original extract re-run identity (idempotent persist).
 * Prefer SHA+locator+fingerprint; else document_id+fingerprint.
 */
export function buildSourceFactKey(policy = {}) {
  const existing = String(policy.source_fact_key ?? summaryOf(policy).source_fact_key ?? "").trim();
  if (existing) return existing;
  const sha = pickSourceSha(policy);
  const docId = String(
    summaryOf(policy).source_document_id ?? policy.source_document_id ?? "",
  ).trim();
  const fp = buildContractFactFingerprint(policy);
  const locator = pickLocator(policy) || "";
  if (sha && fp) return `sha:${sha}:loc:${locator}:fp:${fp}`;
  if (docId && fp) return `doc:${docId}:loc:${locator}:fp:${fp}`;
  if (sha && docId) return `sha:${sha}:doc:${docId}:loc:${locator}`;
  return null;
}

/**
 * Strong contract identity only:
 * 1) verified policy_number
 * 2) stored contract_identity_key / verified contract id
 * 3) SHA + locator + fact fingerprint
 * Never insurer+product(+premium) alone.
 */
export function buildContractIdentityKey(policy = {}, opts = {}) {
  const existing = String(
    policy.contract_identity_key ?? summaryOf(policy).contract_identity_key ?? "",
  ).trim();
  if (existing) {
    return isPersonalOwnershipOk(policy, opts) ? existing : null;
  }
  if (!isPersonalOwnershipOk(policy, opts)) return null;

  const pn = pickPolicyNumber(policy);
  // Keep hyphenated numbers usable: normalize only for the key; length uses de-spaced raw.
  const pnCompact = String(pn ?? "").replace(/\s+/g, "");
  const pnNorm = normalizeIdentityToken(pn ?? "");
  if (pn && pnCompact.length >= 3 && pnNorm.length >= 3) {
    return `pn:${pnNorm}`;
  }

  const verifiedId = String(
    summaryOf(policy).verified_contract_id ?? policy.verified_contract_id ?? "",
  ).trim();
  if (verifiedId) return `vcid:${normalizeIdentityToken(verifiedId)}`;

  const sha = pickSourceSha(policy);
  const locator = pickLocator(policy);
  const fp = buildContractFactFingerprint(policy);
  if (sha && locator && fp) {
    return `sha:${sha}:loc:${normalizeIdentityToken(locator)}:fp:${fp}`;
  }
  // Same SHA + fingerprint without locator still strong enough when policy_number absent
  // only if fingerprint includes policy_number or dates — require locator OR policy_number part in fp
  if (sha && fp && (fp.includes("|") && pn)) {
    return `sha:${sha}:fp:${fp}`;
  }
  return null;
}

function toRailCard(policy, statusLabel) {
  const insurer = String(policy.insurer_name ?? "").trim() || null;
  const product = String(policy.product_name ?? "").trim() || null;
  const premium = resolvePolicyPremium(policy);
  return {
    id: String(policy.id ?? policy.contract_identity_key ?? ""),
    insurer_name: insurer,
    product_name: product,
    monthly_premium: premium,
    status: statusLabel,
    contract_identity_key: policy.contract_identity_key ?? null,
    source_fact_key: policy.source_fact_key ?? null,
    source_document_id:
      summaryOf(policy).source_document_id != null
        ? String(summaryOf(policy).source_document_id)
        : null,
  };
}

/**
 * Canonical contract projection — single SSOT for count / list / UI / Claude.
 * confirmed = strong identity only; weak personal → personal_review_candidates.
 * Full review_candidates keeps foreign/corporate/fixture for audit evidence only.
 * Customer surfaces must consume personal_* only (never CSS-hide, never delete rows).
 */
export function projectCanonicalContracts(policies = [], opts = {}) {
  const rows = Array.isArray(policies) ? policies : [];
  const active = rows.filter((p) => p && !isRetiredPolicyRow(p) && p.is_active !== false);
  const confirmedByKey = new Map();
  const review_candidates = [];
  const personal_review_candidates = [];
  const source_links = [];
  let ownership_exclusions = 0;

  for (const policy of active) {
    const source_fact_key = buildSourceFactKey(policy);
    const contract_identity_key = buildContractIdentityKey(policy, opts);
    const enriched = {
      ...policy,
      source_fact_key,
      contract_identity_key,
    };
    const docId = summaryOf(policy).source_document_id ?? null;
    if (docId || pickSourceSha(policy)) {
      source_links.push({
        policy_id: policy.id ?? null,
        source_document_id: docId != null ? String(docId) : null,
        source_content_sha256_present: Boolean(pickSourceSha(policy)),
        contract_identity_key,
        source_fact_key,
      });
    }

    if (!isPersonalOwnershipOk(policy, opts)) {
      ownership_exclusions += 1;
      review_candidates.push({
        ...enriched,
        review_reason: "ownership_mismatch_or_foreign_subject",
      });
      continue;
    }

    if (!contract_identity_key) {
      const weak = {
        ...enriched,
        review_reason: "weak_identity",
      };
      review_candidates.push(weak);
      personal_review_candidates.push(weak);
      continue;
    }

    const prev = confirmedByKey.get(contract_identity_key);
    if (!prev) {
      confirmedByKey.set(contract_identity_key, enriched);
    } else {
      // Prefer row with more source linkage; keep single confirmed contract.
      const prevLinks = Number(Boolean(summaryOf(prev).source_document_id)) +
        Number(Boolean(pickSourceSha(prev)));
      const nextLinks = Number(Boolean(docId)) + Number(Boolean(pickSourceSha(policy)));
      if (nextLinks > prevLinks) confirmedByKey.set(contract_identity_key, enriched);
    }
  }

  const confirmed_contracts = [...confirmedByKey.values()];
  const personal_confirmed_contracts = confirmed_contracts;
  return {
    confirmed_contracts,
    personal_confirmed_contracts,
    review_candidates,
    personal_review_candidates,
    active_distinct_count: confirmed_contracts.length,
    // Customer-facing review count = personal only (foreign kept in review_candidates for audit).
    review_candidate_count: personal_review_candidates.length,
    personal_review_candidate_count: personal_review_candidates.length,
    audit_review_candidate_count: review_candidates.length,
    foreign_rows_excluded: ownership_exclusions,
    raw_source_row_count: active.length,
    source_links,
    ownership_exclusions,
  };
}

export function buildMyInsuranceStatus(policies = [], opts = {}) {
  const projection = projectCanonicalContracts(policies, opts);
  const confirmedCards = projection.personal_confirmed_contracts.map((p) =>
    toRailCard(p, "\uD655\uC778\uB428"),
  );
  const reviewCards = projection.personal_review_candidates.map((p) =>
    toRailCard(p, "\uD655\uC778 \uD544\uC694"),
  );
  return {
    policies: [...confirmedCards, ...reviewCards],
    confirmedPolicies: confirmedCards,
    reviewCandidates: reviewCards,
    confirmedCount: confirmedCards.length,
    needsCount: reviewCards.length,
    // UI / authority 건수 = 확정만
    totalCount: confirmedCards.length,
    active_distinct_count: projection.active_distinct_count,
    review_candidate_count: projection.personal_review_candidate_count,
    personal_review_candidate_count: projection.personal_review_candidate_count,
    foreign_rows_excluded: projection.foreign_rows_excluded,
    raw_source_row_count: projection.raw_source_row_count,
    canonical: projection,
  };
}

export function formatWonMonthly(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return `\uC6D4 ${Math.round(numeric).toLocaleString("ko-KR")}\uC6D0`;
}

function summarizeKeyJudgment(answerText = "") {
  const text = String(answerText ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const parts = text.split(/(?<=[.。!?？])\s+/).filter(Boolean);
  const summary = parts.slice(0, 2).join(" ").trim();
  if (!summary) return null;
  return summary.length > 220 ? `${summary.slice(0, 217)}\u2026` : summary;
}

function extractLinesByPattern(answerText, pattern) {
  const text = String(answerText ?? "");
  if (!text.trim()) return [];
  const lines = text
    .split(/\n+/)
    .map((line) => line.replace(/^[-*\u2022]\s*/, "").trim())
    .filter(Boolean);
  const out = [];
  for (const line of lines) {
    if (pattern.test(line) && !out.includes(line)) out.push(line);
  }
  return out.slice(0, 8);
}

function factsFromVisualBlocks(visualBlocks = []) {
  const confirmed = [];
  const needs = [];
  const blocks = Array.isArray(visualBlocks) ? visualBlocks : [];
  for (const block of blocks) {
    const title = String(block?.title ?? block?.block_title ?? "").trim();
    const rows = Array.isArray(block?.rows) ? block.rows : [];
    for (const row of rows) {
      const label = String(row?.label ?? row?.[0] ?? "").trim();
      const value = String(row?.value ?? row?.[1] ?? row?.status ?? "").trim();
      const cell = [label, value].filter(Boolean).join(": ");
      if (!cell) continue;
      if (/\uBBF8\uD655\uC778|\uD655\uC778\s*\uD544\uC694|\uC544\uC9C1/.test(cell) || value === "\u2014" || value === "-") {
        if (!needs.includes(cell)) needs.push(cell);
      } else if (value) {
        const item = title ? `${title} \u00B7 ${cell}` : cell;
        if (!confirmed.includes(item)) confirmed.push(item);
      }
    }
    const cells = Array.isArray(block?.cells) ? block.cells : [];
    for (const cell of cells) {
      const t = String(cell?.text ?? cell?.value ?? "").trim();
      if (!t) continue;
      if (/\uBBF8\uD655\uC778|\uD655\uC778\s*\uD544\uC694|\uC544\uC9C1/.test(t)) {
        if (!needs.includes(t)) needs.push(t);
      } else if (!confirmed.includes(t)) {
        confirmed.push(t);
      }
    }
  }
  return { confirmed: confirmed.slice(0, 8), needs: needs.slice(0, 8) };
}

function cardFactsMentionedInAnswer(answerText, insuranceStatus) {
  const text = String(answerText ?? "");
  const confirmed = [];
  const needs = [];
  for (const row of insuranceStatus.policies ?? []) {
    const insurer = row.insurer_name ?? "";
    const product = row.product_name ?? "";
    const mentioned =
      (insurer && text.includes(insurer)) || (product && text.includes(product));
    if (!mentioned) continue;
    const premiumLabel = formatWonMonthly(row.monthly_premium);
    const label = [insurer, product, premiumLabel].filter(Boolean).join(" \u00B7 ");
    if (!label) continue;
    if (row.status === "\uD655\uC778\uB428") confirmed.push(label);
    else needs.push(label);
  }
  return { confirmed, needs };
}

export function buildKeyTurnMirror({
  answerText = "",
  visualBlocks = [],
  policies = [],
} = {}) {
  const text = String(answerText ?? "").trim();
  const blocks = Array.isArray(visualBlocks) ? visualBlocks : [];
  const insuranceStatus = buildMyInsuranceStatus(policies);
  const insuranceTurn =
    blocks.length > 0 || (text && INSURANCE_TURN_RE.test(text));

  if (!insuranceTurn || !text) {
    return {
      empty: true,
      emptyMessage: KEY_TURN_MIRROR_EMPTY,
      judgment: null,
      confirmed: [],
      needsConfirmation: [],
    };
  }

  const fromBlocks = factsFromVisualBlocks(blocks);
  const fromAnswerConfirmed = extractLinesByPattern(
    text,
    /\uD655\uC778\uB428|\uD655\uC778\uD55C|\uC11C\uB958\uC5D0\uC11C|\uC6D4\s*[\d,]+\uC6D0|\uC9C4\uB2E8\uBE44/,
  ).filter((line) => !/\uBBF8\uD655\uC778|\uD655\uC778\s*\uD544\uC694|\uC544\uC9C1\s*\uD655\uC778/.test(line));
  const fromAnswerNeeds = extractLinesByPattern(
    text,
    /\uBBF8\uD655\uC778|\uD655\uC778\s*\uD544\uC694|\uC544\uC9C1\s*\uD655\uC778|\uD568\uAED8\s*\uBCF4\uBA74|\uB354\s*\uD544\uC694/,
  );
  const fromCard = cardFactsMentionedInAnswer(text, insuranceStatus);

  const confirmed = [
    ...fromBlocks.confirmed,
    ...fromCard.confirmed,
    ...fromAnswerConfirmed,
  ].filter((item, index, arr) => arr.indexOf(item) === index).slice(0, 8);

  const needsConfirmation = [
    ...fromBlocks.needs,
    ...fromCard.needs,
    ...fromAnswerNeeds,
  ].filter((item, index, arr) => arr.indexOf(item) === index).slice(0, 8);

  const judgment = summarizeKeyJudgment(text);
  const empty = !judgment && confirmed.length === 0 && needsConfirmation.length === 0;

  return {
    empty,
    emptyMessage: KEY_TURN_MIRROR_EMPTY,
    judgment,
    confirmed,
    needsConfirmation,
  };
}

/** Baseline status tokens — display only; never rewrite KEY answers. */
export const BASELINE_STATUS = {
  MET: "충족",
  SHORT: "미달",
  NEED: "확인 필요",
  OVERLAP: "중복 점검",
  TABLE_PENDING: "기준 확인 중",
};

export const BASELINE_STATUS_COLOR = {
  [BASELINE_STATUS.MET]: "#167C6A",
  [BASELINE_STATUS.SHORT]: "#C87516",
  [BASELINE_STATUS.NEED]: "#64748B",
  [BASELINE_STATUS.OVERLAP]: "#7656C8",
  [BASELINE_STATUS.TABLE_PENDING]: "#64748B",
};

export const BASELINE_STATUS_BG = {
  [BASELINE_STATUS.MET]: "#EAF7F3",
  [BASELINE_STATUS.SHORT]: "#FFF4E5",
  [BASELINE_STATUS.NEED]: "#F1F5F9",
  [BASELINE_STATUS.OVERLAP]: "#F1EDFF",
  [BASELINE_STATUS.TABLE_PENDING]: "#F1F5F9",
};

function normalizeCoverageName(name = "") {
  return String(name ?? "")
    .replace(/\s+/g, "")
    .replace(/[()[\]【】]/g, "")
    .toLowerCase();
}

function parseCoverageAmount(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  const raw = String(value).replace(/,/g, "").trim();
  if (!raw) return null;
  const man = raw.match(/^(\d+(?:\.\d+)?)\s*만\s*원?$/);
  if (man) return Math.round(Number(man[1]) * 10000);
  const cheon = raw.match(/^(\d+(?:\.\d+)?)\s*천\s*만\s*원?$/);
  if (cheon) return Math.round(Number(cheon[1]) * 10000000);
  const digits = raw.replace(/[^\d.]/g, "");
  const n = Number(digits);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * Major-treatment region — limited name heuristic only (not primary judge).
 * @returns {"cancer"|"brain_heart"|null}
 */
export function classifyMajorTreatmentRegion(coverageName = "") {
  const n = normalizeCoverageName(coverageName);
  if (!n) return null;

  if (n === "로봇수술" || n === "주요치료" || n === "방사선" || n === "수술") {
    return null;
  }

  const cancerSignal =
    /암수술|암.*수술/.test(n) ||
    /항암/.test(n) ||
    /표적/.test(n) ||
    /면역항암/.test(n) ||
    (/고가/.test(n) && /방사선/.test(n)) ||
    (/암/.test(n) && /방사선/.test(n)) ||
    (/암/.test(n) && /로봇/.test(n)) ||
    (/암/.test(n) && /주요치료/.test(n));

  const brainHeartSignal =
    (/뇌혈관/.test(n) && /치료|시술|수술|주요/.test(n) && !/진단/.test(n)) ||
    (/허혈성심장/.test(n) && /치료|시술|수술|주요/.test(n) && !/진단/.test(n)) ||
    /혈전용해|혈전제거/.test(n) ||
    (/중환자/.test(n) && /(뇌|심|혈관)/.test(n)) ||
    /심뇌혈관.*주요치료|주요치료.*심뇌/.test(n);

  if (cancerSignal && brainHeartSignal) return null;
  if (cancerSignal) return "cancer";
  if (brainHeartSignal) return "brain_heart";
  return null;
}

/**
 * Limited diagnosis-name fallback only — NOT the primary baseline classifier.
 * Structured items (caregiving/hospital/surgery/major_treatment) always return null here.
 * @returns {string|null} diagnosis baseline item id or null
 */
export function classifyCoverageToBaselineItem(coverageName = "") {
  const n = normalizeCoverageName(coverageName);
  if (!n) return null;

  // Exclude micro/similar cancer from general cancer diagnosis total.
  if (/유사암|소액암|경계성|제자리암|상피내/.test(n) && !/일반암/.test(n)) {
    return null;
  }

  // Diagnosis-only fallback scope (amount cards).
  if (/일반암|암진단/.test(n) || (/암/.test(n) && /진단/.test(n) && !/유사|소액|경계|제자리|상피내/.test(n))) {
    return "cancer_diagnosis";
  }

  if (/뇌출혈|뇌경색|뇌졸중/.test(n) && !/뇌혈관/.test(n)) {
    return null;
  }
  if (
    (/뇌혈관/.test(n) && /진단|담보|보험금|급여/.test(n)) ||
    n === "뇌혈관질환" ||
    n === "뇌혈관질환진단비" ||
    /^뇌혈관질환진단/.test(n)
  ) {
    return "cerebrovascular_diagnosis";
  }

  if (/급성심근|심근경색/.test(n) && !/허혈성심장/.test(n)) {
    return null;
  }
  if (/허혈성심장/.test(n) && /진단|담보|보험금|급여/.test(n)) {
    return "ischemic_heart_diagnosis";
  }
  if (/허혈성심장질환진단/.test(n) || n === "허혈성심장질환진단비") {
    return "ischemic_heart_diagnosis";
  }

  // Structured items: never classify via regex (Claude + KEY facts only).
  return null;
}

function collectRiderRowsFromPolicy(policy) {
  const summary =
    policy?.coverage_summary && typeof policy.coverage_summary === "object"
      ? policy.coverage_summary
      : {};
  const rows = [];
  if (Array.isArray(summary.rider_details)) {
    for (const detail of summary.rider_details) {
      if (detail && typeof detail === "object") rows.push(detail);
    }
  }
  if (Array.isArray(summary.riders)) {
    for (const rider of summary.riders) {
      if (rider && typeof rider === "object") rows.push(rider);
    }
  }
  if (summary.coverage_name != null || summary.coverage_amount != null) {
    rows.push({
      coverage_name: summary.coverage_name,
      rider_name: summary.rider_name,
      coverage_amount: summary.coverage_amount,
    });
  }
  return rows;
}

/**
 * Collect rider rows for drawer / limited diagnosis fallback.
 * Attribution uses diagnosis-only regex; structured items stay unclassified here.
 */
export function collectVerifiedCoverageRows(policies = []) {
  const out = [];
  const seen = new Set();
  for (const policy of Array.isArray(policies) ? policies : []) {
    if (isRetiredPolicyRow(policy)) continue;
    const policyId = String(policy.id ?? "");
    const insurer = String(policy.insurer_name ?? "").trim();
    const product = String(policy.product_name ?? "").trim();
    for (const row of collectRiderRowsFromPolicy(policy)) {
      const name = String(row.coverage_name ?? row.rider_name ?? row.name ?? "").trim();
      if (!name) continue;
      const amount = parseCoverageAmount(row.coverage_amount ?? row.amount);
      const itemId = classifyCoverageToBaselineItem(name);
      const dedupeKey = `${policyId}::${normalizeCoverageName(name)}::${amount ?? "na"}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      out.push({
        policy_id: policyId,
        insurer_name: insurer || null,
        product_name: product || null,
        coverage_name: name,
        coverage_amount: amount,
        baseline_item_id: itemId,
        major_treatment_region: null,
        has_amount: amount != null,
        source: "rider_details",
      });
    }
  }
  return out;
}

function axisIdsConfirmedByKeyFact(fact, itemId) {
  const ids = new Set();
  if (!isVerifiedBaselineFact(fact)) return ids;
  if (fact.structured_axis_id) ids.add(String(fact.structured_axis_id));
  if (itemId === "caregiving") {
    if (fact.coverage_amount != null || fact.payment_unit) ids.add("daily_amount");
    if (fact.maximum_payment_days != null) ids.add("max_days");
    if (fact.renewal != null) ids.add("renewal");
    if (fact.reduction_condition) ids.add("reduction");
  }
  if (itemId === "hospital_daily") {
    if (fact.maximum_payment_days != null) ids.add("max_pay_days");
  }
  if (itemId === "surgery" || itemId === "major_treatment") {
    if (fact.payment_frequency) ids.add("repeat_pay");
  }
  if (itemId === "caregiving" && /간호간병|통합병동/.test(normalizeCoverageName(fact.original_coverage_name))) {
    ids.add("nursing_integrated");
  }
  if (itemId === "caregiving" && /간병인/.test(normalizeCoverageName(fact.original_coverage_name))) {
    ids.add("caregiver_direct");
  }
  return ids;
}

/**
 * Structured axes — verified KEY baseline facts only (never regex 확인됨).
 */
export function resolveStructuredAxisStates(itemId, verifiedKeyFacts = []) {
  const facts = (Array.isArray(verifiedKeyFacts) ? verifiedKeyFacts : []).filter(
    (f) => isVerifiedBaselineFact(f) && f.baseline_item_id === itemId,
  );

  if (itemId === "major_treatment") {
    return MAJOR_TREATMENT_REGIONS.map((region) => {
      const regionFacts = facts.filter((f) => f.major_treatment_region === region.id);
      const confirmedIds = new Set();
      for (const fact of regionFacts) {
        for (const id of axisIdsConfirmedByKeyFact(fact, itemId)) confirmedIds.add(id);
      }
      return {
        id: region.id,
        label: region.label,
        axes: region.axes.map((axis) => ({
          id: axis.id,
          label: axis.label,
          status: confirmedIds.has(axis.id) ? "확인됨" : "미확인",
          detail: null,
        })),
      };
    });
  }

  const defs = BASELINE_STRUCTURED_AXES[itemId];
  if (!Array.isArray(defs)) return [];
  const confirmedIds = new Set();
  for (const fact of facts) {
    for (const id of axisIdsConfirmedByKeyFact(fact, itemId)) confirmedIds.add(id);
  }
  return defs.map((axis) => ({
    id: axis.id,
    label: axis.label,
    status: confirmedIds.has(axis.id) ? "확인됨" : "미확인",
    detail: null,
  }));
}

function riderAmountForName(policies, coverageName) {
  const key = normalizeCoverageName(coverageName);
  if (!key) return null;
  for (const policy of Array.isArray(policies) ? policies : []) {
    if (isRetiredPolicyRow(policy)) continue;
    for (const row of collectRiderRowsFromPolicy(policy)) {
      const name = String(row.coverage_name ?? row.rider_name ?? row.name ?? "").trim();
      if (normalizeCoverageName(name) !== key) continue;
      const amount = parseCoverageAmount(row.coverage_amount ?? row.amount);
      if (amount != null) return amount;
    }
  }
  return null;
}

/**
 * Build included coverage rows for one baseline item (priority order).
 * 1) verified key_coverage_baseline_facts
 * 2) rider amount when KEY fact name matches but amount missing
 * 3) diagnosis-only regex fallback when no KEY baseline facts exist at all
 */
function collectBaselineItemRows(policies, itemId) {
  const allKeyFacts = collectKeyCoverageBaselineFactsFromPolicies(policies);
  const hasKeyBaseline = allKeyFacts.length > 0;
  const verified = allKeyFacts.filter(
    (f) => isVerifiedBaselineFact(f) && f.baseline_item_id === itemId,
  );

  const out = [];
  const seen = new Set();

  for (const fact of verified) {
    const sha = String(fact.source_content_sha256 ?? "").trim().toLowerCase();
    const policyNo = String(fact.policy_number ?? fact.contract_number ?? "").trim();
    const identity = sha
      ? `sha:${sha}::${normalizeCoverageName(fact.original_coverage_name)}::${fact.baseline_item_id}::${fact.coverage_amount ?? ""}`
      : policyNo
        ? `contract:${policyNo}::${normalizeCoverageName(fact.original_coverage_name)}::${fact.baseline_item_id}::${fact.coverage_amount ?? ""}`
        : `${fact.source_document_id ?? ""}::${normalizeCoverageName(fact.original_coverage_name)}::${fact.baseline_item_id}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    let amount = fact.coverage_amount != null ? Number(fact.coverage_amount) : null;
    if (amount == null || !Number.isFinite(amount)) {
      amount = riderAmountForName(policies, fact.original_coverage_name);
    }
    out.push({
      policy_id: fact.policy_id ?? "",
      insurer_name: fact.insurer_name ?? null,
      product_name: fact.product_name ?? null,
      coverage_name: fact.original_coverage_name,
      coverage_amount: amount,
      baseline_item_id: itemId,
      major_treatment_region: fact.major_treatment_region ?? null,
      structured_axis_id: fact.structured_axis_id ?? null,
      has_amount: amount != null,
      source: "key_coverage_baseline_facts",
      status: KEY_BASELINE_FACT_STATUSES.VERIFIED,
      key_fact: fact,
    });
  }

  if (out.length) return out;

  // Limited fallback: only diagnosis amount cards, and only when KEY baseline facts are absent.
  if (
    hasKeyBaseline ||
    !KEY_BASELINE_DIAGNOSIS_ITEM_IDS.includes(itemId) ||
    KEY_BASELINE_STRUCTURED_ITEM_IDS.includes(itemId)
  ) {
    return out;
  }

  for (const row of collectVerifiedCoverageRows(policies)) {
    if (row.baseline_item_id !== itemId) continue;
    const dedupe = `${row.policy_id}::${normalizeCoverageName(row.coverage_name)}::${row.coverage_amount ?? "na"}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push({ ...row, source: "rider_details_diagnosis_fallback" });
  }
  return out;
}

function formatWonAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}

/** Customer-facing manwon label (e.g. 8,000만원). Falls back to 원. */
export function formatManwonAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n % 10000 === 0) {
    return `${Math.round(n / 10000).toLocaleString("ko-KR")}만원`;
  }
  return formatWonAmount(n);
}

function formatIndustryRange(item) {
  if (item.industry_range_low == null || item.industry_range_high == null) {
    return "기준 확인 중";
  }
  return `${formatManwonAmount(item.industry_range_low)}~${formatManwonAmount(item.industry_range_high)}`;
}

/** True when industry range/limit numbers are present — only then may UI show bars. */
export function isIndustryBaselineTableReady(item = null) {
  if (!item || typeof item !== "object") return false;
  return (
    item.industry_range_low != null &&
    item.industry_range_high != null &&
    Number.isFinite(Number(item.industry_range_low)) &&
    Number.isFinite(Number(item.industry_range_high))
  );
}

/** Pure lump-sum compare — used by UI builder and unit tests. */
export function evaluateLumpSumBaselineStatus(sumAmount, low, high) {
  if (low == null || high == null || !Number.isFinite(Number(low)) || !Number.isFinite(Number(high))) {
    return BASELINE_STATUS.TABLE_PENDING;
  }
  if (sumAmount == null || !Number.isFinite(Number(sumAmount))) {
    return BASELINE_STATUS.NEED;
  }
  const n = Number(sumAmount);
  const lo = Number(low);
  const hi = Number(high);
  if (n < lo) return BASELINE_STATUS.SHORT;
  if (n > hi) return BASELINE_STATUS.OVERLAP;
  return BASELINE_STATUS.MET;
}

function decideBaselineStatus({ item, matchedRows, sumAmount, compareMode }) {
  const tableReady =
    item.industry_range_low != null &&
    item.industry_range_high != null &&
    Number.isFinite(Number(item.industry_range_low)) &&
    Number.isFinite(Number(item.industry_range_high));

  if (!tableReady) {
    return {
      status: BASELINE_STATUS.TABLE_PENDING,
      reason: "업계 누적/일반 구간 기준자료가 아직 확보되지 않았습니다. 공개 상품 가입금액을 한도로 쓰지 않습니다.",
    };
  }

  if (compareMode !== "lump_sum") {
    if (!matchedRows.length) {
      return {
        status: BASELINE_STATUS.NEED,
        reason: "해당 담보의 일당·일수·범위·조건이 충분히 확인되지 않았습니다. 미확인을 미달로 보지 않습니다.",
      };
    }
    const structuredReady = matchedRows.every((r) => r.has_amount);
    if (!structuredReady) {
      return {
        status: BASELINE_STATUS.NEED,
        reason: "금액·일수·범위 중 확인되지 않은 조건이 있어 확인 필요입니다.",
      };
    }
    return {
      status: BASELINE_STATUS.NEED,
      reason: "구조화 비교에 필요한 일수·면책·범위 조건이 기준표와 함께 더 확인되어야 합니다.",
    };
  }

  if (!matchedRows.length) {
    return {
      status: BASELINE_STATUS.NEED,
      reason: "해당 담보 금액이 verified로 확인되지 않았습니다. 미확인은 0원·미가입·미달이 아닙니다.",
    };
  }

  const unclear = matchedRows.some((r) => !r.has_amount);
  if (unclear || sumAmount == null) {
    return {
      status: BASELINE_STATUS.NEED,
      reason: "포함된 특약 중 금액이 확인되지 않은 항목이 있습니다.",
    };
  }

  const low = Number(item.industry_range_low);
  const high = Number(item.industry_range_high);
  const status = evaluateLumpSumBaselineStatus(sumAmount, low, high);
  if (status === BASELINE_STATUS.SHORT) {
    return {
      status,
      reason: `확인된 합산 ${formatWonAmount(sumAmount)}이 비교 구간 하단(${formatWonAmount(low)}) 미만입니다. 부족 가능성.`,
    };
  }
  if (status === BASELINE_STATUS.OVERLAP) {
    return {
      status,
      reason: `확인된 합산 ${formatWonAmount(sumAmount)}이 비교 구간 상단(${formatWonAmount(high)})을 초과합니다. 중복·보험료 점검(해지 권유 아님).`,
    };
  }
  return {
    status: BASELINE_STATUS.MET,
    reason: `확인된 합산 ${formatWonAmount(sumAmount)}이 비교 구간(${formatWonAmount(low)}~${formatWonAmount(high)}) 안입니다. 적정 구간.`,
  };
}
/**
 * Build read-only industry baseline comparison for the right rail.
 * Priority: verified key_coverage_baseline_facts → matching rider amount →
 * diagnosis-only regex fallback when no KEY baseline facts exist.
 * Never invents industry numbers; never treats unknown as shortfall.
 * pending/conflict/unresolved never enter amounts or 확인됨 counts.
 */
export function buildIndustryCoverageBaseline(policies = [], opts = {}) {
  // Customer rail/detail: personal ownership only — foreign/corporate/fixture stay in audit projection.
  const personalPolicies = filterPersonalCustomerPolicies(policies, opts);
  const allKeyFacts = collectKeyCoverageBaselineFactsFromPolicies(personalPolicies);
  const verifiedKeyFacts = allKeyFacts.filter(isVerifiedBaselineFact);

  const items = KEY_INDUSTRY_COVERAGE_BASELINE_ITEMS.map((item) => {
    const matched = collectBaselineItemRows(personalPolicies, item.id);
    let sumAmount = null;
    if (item.compareMode === "lump_sum") {
      let sum = 0;
      let has = false;
      for (const row of matched) {
        if (row.coverage_amount == null) continue;
        // Only verified KEY rows or diagnosis fallback rows (never pending/conflict).
        if (row.status && row.status !== KEY_BASELINE_FACT_STATUSES.VERIFIED && row.source === "key_coverage_baseline_facts") {
          continue;
        }
        sum += row.coverage_amount;
        has = true;
      }
      sumAmount = has ? sum : null;
    }

    const decision = decideBaselineStatus({
      item,
      matchedRows: matched,
      sumAmount,
      compareMode: item.compareMode,
    });

    let currentDisplay = "확인 필요";
    if (item.compareMode === "lump_sum") {
      currentDisplay = sumAmount != null ? formatManwonAmount(sumAmount) : "확인 필요";
    } else if (matched.length) {
      currentDisplay = item.compareMode === "daily_structured" ? "일당·일수 확인 필요" : "범위·조건 확인 필요";
    }

    const tableReady = isIndustryBaselineTableReady(item);
    const includedCoverages = matched.map((row) => ({
      ...row,
      coverage_amount_display:
        row.coverage_amount != null ? formatManwonAmount(row.coverage_amount) : null,
    }));
    const isAmountMode = item.compareMode === "lump_sum";
    const structuredAxes = isAmountMode
      ? null
      : resolveStructuredAxisStates(
          item.id,
          verifiedKeyFacts.filter((f) => f.baseline_item_id === item.id),
        );

    return {
      id: item.id,
      label: item.label,
      shortLabel: item.shortLabel,
      definition: item.definition,
      unit: item.unit,
      compareMode: item.compareMode,
      currentAmount: isAmountMode ? sumAmount : null,
      currentDisplay,
      industryRangeDisplay: formatIndustryRange(item),
      industry_range_low: item.industry_range_low,
      industry_representative: item.industry_representative ?? null,
      industry_range_high: item.industry_range_high,
      industry_cumulative_limit: item.industry_cumulative_limit,
      apply_conditions: item.apply_conditions,
      source: item.source,
      source_kind: item.source_kind,
      sourceDisplay: item.source_kind === "none" ? "미확보" : item.source,
      as_of: item.as_of,
      version: item.version,
      status: decision.status,
      statusColor: BASELINE_STATUS_COLOR[decision.status] || BASELINE_STATUS_COLOR[BASELINE_STATUS.NEED],
      statusBg: BASELINE_STATUS_BG[decision.status] || BASELINE_STATUS_BG[BASELINE_STATUS.NEED],
      tableReady,
      /** Amount graphs only for lump_sum when industry numbers exist. */
      showCompareBar: isAmountMode && tableReady,
      isAmountMode,
      structuredAxes,
      reason: decision.reason,
      includedCoverages,
      unclearParts: matched.filter((r) => !r.has_amount).map((r) => r.coverage_name),
      key_baseline_fact_count: verifiedKeyFacts.filter((f) => f.baseline_item_id === item.id).length,
      has_key_baseline_facts: policiesHaveKeyBaselineFacts(personalPolicies),
    };
  });

  const counts = {
    met: 0,
    short: 0,
    need: 0,
    overlap: 0,
    tablePending: 0,
  };
  for (const row of items) {
    if (row.status === BASELINE_STATUS.MET) counts.met += 1;
    else if (row.status === BASELINE_STATUS.SHORT) counts.short += 1;
    else if (row.status === BASELINE_STATUS.OVERLAP) counts.overlap += 1;
    else if (row.status === BASELINE_STATUS.TABLE_PENDING) counts.tablePending += 1;
    else counts.need += 1;
  }

  return {
    title: KEY_INDUSTRY_COMPARISON_BASELINE_TITLE,
    version: KEY_INDUSTRY_COVERAGE_BASELINE_VERSION,
    as_of: KEY_INDUSTRY_COVERAGE_BASELINE_AS_OF,
    counts,
    items,
  };
}

export function buildPolicyDetailForDrawer(policy = null) {
  if (!policy || typeof policy !== "object") return null;
  if (isRetiredPolicyRow(policy)) return null;
  const premium = resolvePolicyPremium(policy);
  const coverages = collectVerifiedCoverageRows([policy]);
  return {
    kind: "policy",
    title: String(policy.insurer_name ?? "보험사 미확인"),
    subtitle: String(policy.product_name ?? "상품명 확인 필요"),
    monthly_premium: premium,
    monthly_premium_display: formatWonMonthly(premium) || "월 보험료 확인 필요",
    coverages,
    note: "삭제·retired 계약은 표시하지 않습니다.",
  };
}

export function buildBaselineDetailForDrawer(baselineItem = null) {
  if (!baselineItem || typeof baselineItem !== "object") return null;
  return {
    kind: "baseline",
    title: baselineItem.label,
    subtitle: baselineItem.status,
    ...baselineItem,
  };
}
