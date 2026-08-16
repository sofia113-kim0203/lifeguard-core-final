/**
 * Human Gate Repair A — personal-contract absence certainty.
 * HARD only when absence contradicts a verified-present coverage.
 * Unverified "없음" (not-found) is SOFT — does not block customer speech.
 * Does not block uncertainty ("확인되지 않습니다") or general market structure talk.
 * No rewrite / no second Claude — Gate judgment only.
 */

function asText(v) {
  return String(v ?? "").trim();
}

/** Split into rough Korean/English sentence units for claim-local judgment. */
export function splitCustomerSpeechSentences(text = "") {
  const src = asText(text);
  if (!src) return [];
  return src
    .split(/(?<=[.!?。])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const UNCERTAINTY_RE =
  /확인할\s*수\s*없|확인되지\s*않|확인되지\s*못|확인이\s*필요|미확인|현재\s*자료에서는|제공된\s*자료에서는|원본에서\s*확인되지|자료에서는\s*확인/;

const GENERAL_STRUCTURE_RE =
  /일반적으로|보통\s*(?:은|이|약관|상품)|흔히|많은\s*상품|상품\s*구조|시장에서|약관은\s*보통|진단비\s*→\s*수술비|구성(?:하는\s*것)?이\s*효율적/;

/** Assertive absence of coverage/benefit on a personal/current contract (not soft uncertainty). */
/** Particle note: both subject 가/이 and topic 는/은 ("진단비는 없어요") are absence asserts. */
const ABSENCE_ASSERT_RE =
  /포함돼\s*있지\s*않(?:습니다|아요|다)|포함되어\s*있지\s*않(?:습니다|아요|다)|포함되지\s*않(?:습니다|아요|았|다)|보장되지\s*않(?:습니다|아요|다)|보장받을\s*수\s*없(?:습니다|어요|다)|받을\s*수\s*없(?:습니다|어요|다)|진단비(?:가|는)\s*없(?:습니다|어요|다)|보장(?:이|은)\s*없(?:습니다|어요|다)|담보(?:가|는)\s*없(?:습니다|어요|다)|가입되어\s*있지\s*않(?:습니다|아요|다)/;

const PERSONAL_OR_COVERAGE_ANCHOR_RE =
  /이\s*계약|이\s*원본|원본에서|현재\s*확인된\s*계약|고객님|가입하신|진단비|수술비|담보|보장/;

const TOPIC_RULES = Object.freeze([
  {
    key: "cancer_diagnosis",
    claim: /암/,
    claimNeed: /진단|진단비/,
    evidence: /암|cancer/i,
  },
  {
    key: "brain_diagnosis",
    claim: /뇌|뇌혈관/,
    claimNeed: /진단|진단비|혈관/,
    evidence: /뇌|뇌혈관|brain/i,
  },
  {
    key: "heart_diagnosis",
    claim: /심장|심근|허혈/,
    claimNeed: /진단|진단비/,
    evidence: /심장|심근|허혈|heart|cardiac/i,
  },
  {
    key: "diagnosis_benefit",
    claim: /진단비/,
    claimNeed: null,
    evidence: /진단비|diagnosis/i,
  },
]);

export function extractAbsenceClaimTopics(sentence = "") {
  const s = asText(sentence);
  const topics = [];
  for (const rule of TOPIC_RULES) {
    if (!rule.claim.test(s)) continue;
    if (rule.claimNeed && !rule.claimNeed.test(s)) continue;
    topics.push(rule.key);
  }
  return topics;
}

/**
 * Collect verified-negative coverage rows from KEY-confirmed materials.
 * Accepts coverages / facts with verified_absent | known_gap | explicit 없음 literals.
 */
export function collectVerifiedNegativeCoverageEvidence({
  coverages = [],
  confirmedFacts = [],
  coverageBaselineFacts = [],
} = {}) {
  const out = [];
  const pushRow = (row) => {
    if (!row || typeof row !== "object") return;
    const status = asText(row.status ?? row.verification_status).toLowerCase();
    const verifiedAbsent =
      row.verified_absent === true ||
      row.known_gap === true ||
      status === "verified_absent" ||
      status === "known_gap";
    const literal = asText(
      row.literal ?? row.literal_value ?? row.coverage_name ?? row.item ?? row.fact_type,
    );
    const literalAbsent = /없(?:음|다)|미포함|미가입|not\s*covered|absent/i.test(literal);
    if (!verifiedAbsent && !literalAbsent) return;
    const blob = [
      row.fact_type,
      row.coverage_name,
      row.coverage_type,
      row.item,
      row.literal,
      row.literal_value,
      row.normalized_name,
    ]
      .map(asText)
      .filter(Boolean)
      .join(" ");
    out.push({
      status: verifiedAbsent ? "verified_absent" : "literal_absent",
      blob,
      topics: extractAbsenceClaimTopics(blob || literal),
    });
  };

  for (const row of Array.isArray(coverages) ? coverages : []) pushRow(row);
  for (const row of Array.isArray(confirmedFacts) ? confirmedFacts : []) pushRow(row);
  for (const row of Array.isArray(coverageBaselineFacts) ? coverageBaselineFacts : []) {
    pushRow(row);
  }
  return out;
}

/**
 * Verified-present coverage rows (not absent / not gap).
 * Used only to prove absence contradicts the source — never to invent gaps.
 */
export function collectVerifiedPresentCoverageEvidence({
  coverages = [],
  confirmedFacts = [],
  coverageBaselineFacts = [],
} = {}) {
  const out = [];
  const pushRow = (row) => {
    if (!row || typeof row !== "object") return;
    const status = asText(row.status ?? row.verification_status).toLowerCase();
    if (row.verified_absent === true || row.known_gap === true) return;
    if (status === "verified_absent" || status === "known_gap") return;
    const literal = asText(
      row.literal ?? row.literal_value ?? row.coverage_name ?? row.item ?? row.fact_type,
    );
    if (/없(?:음|다)|미포함|미가입|not\s*covered|absent/i.test(literal)) return;
    const blob = [
      row.fact_type,
      row.coverage_name,
      row.coverage_type,
      row.item,
      row.literal,
      row.literal_value,
      row.normalized_name,
    ]
      .map(asText)
      .filter(Boolean)
      .join(" ");
    if (!blob && !literal) return;
    out.push({
      status: "verified_present",
      blob: blob || literal,
      topics: extractAbsenceClaimTopics(blob || literal),
    });
  };

  for (const row of Array.isArray(coverages) ? coverages : []) pushRow(row);
  for (const row of Array.isArray(confirmedFacts) ? confirmedFacts : []) pushRow(row);
  for (const row of Array.isArray(coverageBaselineFacts) ? coverageBaselineFacts : []) {
    pushRow(row);
  }
  return out;
}

function asPresentEvidenceRows(verifiedPresentCoverages) {
  if (!Array.isArray(verifiedPresentCoverages) || verifiedPresentCoverages.length === 0) {
    return [];
  }
  if (verifiedPresentCoverages[0]?.blob != null) return verifiedPresentCoverages;
  return collectVerifiedPresentCoverageEvidence({
    coverages: verifiedPresentCoverages,
  });
}

function presentCoverageContradictsAbsence(sentence, presentRows) {
  const rows = Array.isArray(presentRows) ? presentRows : [];
  if (!rows.length) return false;
  const topics = extractAbsenceClaimTopics(sentence);
  if (topics.length && evidenceSupportsTopics(rows, topics)) return true;
  const kindRes = [];
  if (/암/.test(sentence) && /진단/.test(sentence)) kindRes.push(/암/);
  if (/뇌|뇌혈관/.test(sentence) && /진단/.test(sentence)) kindRes.push(/뇌|뇌혈관/);
  if (/심장|심근|허혈/.test(sentence) && /진단/.test(sentence)) {
    kindRes.push(/심장|심근|허혈/);
  }
  if (/진단비/.test(sentence)) kindRes.push(/진단비/);
  if (/수술비/.test(sentence)) kindRes.push(/수술비/);
  if (!kindRes.length) return false;
  return rows.some((row) => kindRes.some((re) => re.test(asText(row.blob))));
}

function evidenceSupportsTopics(evidenceRows, topics) {
  if (!topics.length) return false;
  const rows = Array.isArray(evidenceRows) ? evidenceRows : [];
  if (!rows.length) return false;
  for (const topic of topics) {
    const rule = TOPIC_RULES.find((r) => r.key === topic);
    const matched = rows.some((row) => {
      if (Array.isArray(row.topics) && row.topics.includes(topic)) return true;
      const blob = asText(row.blob);
      if (!blob) return false;
      if (rule?.evidence?.test(blob)) return true;
      if (topic === "diagnosis_benefit" && /진단/.test(blob)) return true;
      return false;
    });
    if (matched) return true;
  }
  return false;
}

/**
 * True when a sentence asserts personal-coverage absence as fact (not uncertainty / general structure).
 */
export function sentenceHasUnverifiedAbsenceCertaintyShape(sentence = "") {
  const s = asText(sentence);
  if (!s) return false;
  if (UNCERTAINTY_RE.test(s)) return false;
  if (GENERAL_STRUCTURE_RE.test(s)) return false;
  if (!ABSENCE_ASSERT_RE.test(s)) return false;
  if (!PERSONAL_OR_COVERAGE_ANCHOR_RE.test(s)) return false;
  return true;
}

/**
 * Gate judgment.
 * HARD only when absence contradicts verified-present coverage.
 * Not-found absence is SOFT (ok: true).
 * @returns {{ ok: boolean, reason: string|null, claims: string[] }}
 */
export function evaluateAbsenceCertaintyGate({
  text = "",
  verifiedNegativeEvidence = null,
  verifiedPresentCoverages = null,
} = {}) {
  const negative = Array.isArray(verifiedNegativeEvidence)
    ? verifiedNegativeEvidence
    : collectVerifiedNegativeCoverageEvidence(verifiedNegativeEvidence || {});
  const present = asPresentEvidenceRows(verifiedPresentCoverages);

  const contradictions = [];
  const unverified = [];
  for (const sentence of splitCustomerSpeechSentences(text)) {
    if (!sentenceHasUnverifiedAbsenceCertaintyShape(sentence)) continue;
    const topics = extractAbsenceClaimTopics(sentence);
    const supportedNegative =
      topics.length > 0
        ? evidenceSupportsTopics(negative, topics)
        : negative.length > 0 &&
          evidenceSupportsTopics(negative, [
            "diagnosis_benefit",
            "cancer_diagnosis",
            "brain_diagnosis",
          ]);
    if (supportedNegative) continue;
    if (presentCoverageContradictsAbsence(sentence, present)) {
      contradictions.push(sentence);
      continue;
    }
    unverified.push(sentence);
  }

  if (contradictions.length) {
    return {
      ok: false,
      reason: "absence_contradicts_verified_coverage",
      claims: contradictions,
    };
  }
  return {
    ok: true,
    reason: unverified.length ? "unverified_absence_claim" : null,
    claims: unverified,
  };
}

/** Convenience boolean for answer-facing collectors. */
export function voiceHasUnverifiedAbsenceCertaintyClaim(
  voice = "",
  verifiedNegativeEvidence = null,
  verifiedPresentCoverages = null,
) {
  return (
    evaluateAbsenceCertaintyGate({
      text: voice,
      verifiedNegativeEvidence,
      verifiedPresentCoverages,
    }).ok === false
  );
}

/**
 * Pre-emit veto only for proven absence contradiction.
 * Return false → do not commit/emit this customer slice.
 */
export function shouldEmitAbsenceCertaintySlice(
  slice = "",
  verifiedNegativeEvidence = null,
  verifiedPresentCoverages = null,
) {
  if (!String(slice ?? "").trim()) return true;
  return (
    evaluateAbsenceCertaintyGate({
      text: slice,
      verifiedNegativeEvidence,
      verifiedPresentCoverages,
    }).ok !== false
  );
}

/* ── S10D — coverage amount attribution integrity (pre-emit veto family) ──
 * Blocks only CLEAR_MISMATCH: customer-visible text attributes a verified
 * amount to a coverage kind that verified tuples do not support (incl. grouped
 * expansion 1·2종). MATCH / NOT_CHECKABLE → emit. No rewrite / no 2nd Claude.
 */

export const COVERAGE_AMOUNT_ATTRIBUTION_CLASS = Object.freeze({
  MATCH: "MATCH",
  CLEAR_MISMATCH: "CLEAR_MISMATCH",
  NOT_CHECKABLE: "NOT_CHECKABLE",
});

const KIND_AMOUNT_ANCHOR_RE =
  /수술비|담보|이\s*계약|원본|확인된\s*계약|질병\s*1\s*[~～\-]\s*5\s*종|질병1\s*[~～\-]\s*5종|1\s*[~～\-]\s*5\s*종\s*수술/;

const GENERAL_AMOUNT_TALK_RE =
  /일반적으로|보통\s*(?:은|이|약관|상품)|흔히|많은\s*상품|시장에서|이야기하는\s*경우|경우도\s*있|예시|대략|정도/;

/** Parse kind digits from a kind-list fragment like "1·2" / "3,4" / "1". */
export function parseCoverageKindList(fragment = "") {
  const raw = String(fragment ?? "");
  if (!raw.trim()) return [];
  // Range inside kind list without explicit enumeration → not high-confidence.
  if (/(\d)\s*[~～\-]\s*(\d)/.test(raw) && !/[·,]/.test(raw)) return [];
  const kinds = [];
  const seen = new Set();
  for (const m of raw.matchAll(/(\d)/g)) {
    const k = String(m[1]);
    if (seen.has(k)) continue;
    seen.add(k);
    kinds.push(k);
  }
  return kinds;
}

/**
 * High-confidence kinds from a verified coverage_name.
 * Prefers parenthetical specific kinds: "(1종)", "(1·2종)".
 * Family ranges like "1~5종" alone do not yield kinds.
 */
export function extractKindsFromCoverageName(name = "") {
  const s = String(name ?? "");
  if (!s.trim()) return [];
  const paren = s.match(/[（(]\s*([\d·,.\s]+)\s*종\s*[）)]/);
  if (paren) return parseCoverageKindList(paren[1]);
  // No parenthetical specific kind — do not treat family "1~5종" as kinds.
  if (/\d\s*[~～\-]\s*\d\s*종/.test(s)) return [];
  return [];
}

/** Normalize amount to 만원-unit digit string, or null if not high-confidence. */
export function normalizeCoverageAmountKey(amount = null) {
  if (amount == null || amount === "") return null;
  const s = String(amount).replace(/,/g, "").replace(/\s+/g, "").trim();
  if (!s) return null;
  const manWon = s.match(/^(\d+)만원?$/);
  if (manWon) return String(Number(manWon[1]));
  const manOnly = s.match(/^(\d+)만$/);
  if (manOnly) return String(Number(manOnly[1]));
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (n >= 10000 && n % 10000 === 0) return String(n / 10000);
    if (n < 10000) return String(n);
  }
  return null;
}

/**
 * Build amount → Set(kinds) from verified coverage rows (name+amount only).
 * Rows without extractable kind or amount are skipped (not inventable).
 */
export function buildVerifiedCoverageAmountKindIndex(coverages = []) {
  const amountToKinds = new Map();
  const kindToAmount = new Map();
  let indexedRowCount = 0;
  for (const row of Array.isArray(coverages) ? coverages : []) {
    if (!row || typeof row !== "object") continue;
    const kinds = extractKindsFromCoverageName(
      row.coverage_name ?? row.original_coverage_name ?? "",
    );
    const amountKey = normalizeCoverageAmountKey(row.coverage_amount);
    if (!kinds.length || !amountKey) continue;
    indexedRowCount += 1;
    if (!amountToKinds.has(amountKey)) amountToKinds.set(amountKey, new Set());
    const set = amountToKinds.get(amountKey);
    for (const k of kinds) {
      set.add(k);
      // First verified amount wins for a kind; conflict → leave both for mismatch checks.
      if (!kindToAmount.has(k)) kindToAmount.set(k, amountKey);
    }
  }
  return { amountToKinds, kindToAmount, indexedRowCount };
}

/**
 * Extract high-confidence kind→amount attribution claims from customer-visible text.
 * Only patterns like "(1·2종) 각 50만원" / "1종 50만원" with coverage/surgery anchor.
 */
export function extractCoverageAmountAttributionClaims(text = "") {
  const src = asText(text);
  if (!src) return [];
  if (GENERAL_AMOUNT_TALK_RE.test(src) && !KIND_AMOUNT_ANCHOR_RE.test(src)) {
    return [];
  }
  if (!KIND_AMOUNT_ANCHOR_RE.test(src) && !/\d\s*종/.test(src)) {
    return [];
  }

  const claims = [];
  const push = (kinds, amountKey, raw) => {
    if (!kinds.length || !amountKey) return;
    claims.push({ kinds, amountKey, raw });
  };

  // (1·2종) 각 50만원  /  （3·4종） 각 500만원
  for (const m of src.matchAll(
    /[（(]\s*([\d·,.\s]+)\s*종\s*[）)]\s*(?:각\s*)?(\d+)\s*만\s*원?/g,
  )) {
    push(parseCoverageKindList(m[1]), normalizeCoverageAmountKey(`${m[2]}만원`), m[0]);
  }

  // 1·2종 각 50만원 (no parens) — require 각 or tight amount adjacency
  for (const m of src.matchAll(
    /(?<![（(\d])([\d·,.]+)\s*종\s*(?:각\s+)(\d+)\s*만\s*원?/g,
  )) {
    push(parseCoverageKindList(m[1]), normalizeCoverageAmountKey(`${m[2]}만원`), m[0]);
  }

  // 1종 50만원 / 1종	50만원 (single kind, amount nearby)
  for (const m of src.matchAll(
    /(?<![·,.\d～~\-])(\d)\s*종\s*(?:은|는|:|：|=|→)?\s*(\d+)\s*만\s*원?/g,
  )) {
    push([String(m[1])], normalizeCoverageAmountKey(`${m[2]}만원`), m[0]);
  }

  return claims;
}

/**
 * @returns {{
 *   ok: boolean,
 *   class: 'MATCH'|'CLEAR_MISMATCH'|'NOT_CHECKABLE',
 *   reason: string|null,
 *   claims: object[],
 * }}
 */
export function evaluateCoverageAmountAttributionGate({
  text = "",
  verifiedCoverages = null,
} = {}) {
  const coverages = Array.isArray(verifiedCoverages) ? verifiedCoverages : [];
  const index = buildVerifiedCoverageAmountKindIndex(coverages);
  const claims = extractCoverageAmountAttributionClaims(text);

  if (!claims.length) {
    return {
      ok: true,
      class: COVERAGE_AMOUNT_ATTRIBUTION_CLASS.MATCH,
      reason: null,
      claims: [],
    };
  }
  if (index.indexedRowCount === 0) {
    return {
      ok: true,
      class: COVERAGE_AMOUNT_ATTRIBUTION_CLASS.NOT_CHECKABLE,
      reason: "no_verified_kind_amount_tuples",
      claims,
    };
  }

  const mismatches = [];
  let sawCheckable = false;

  for (const claim of claims) {
    const verifiedKindsForAmount = index.amountToKinds.get(claim.amountKey);
    if (!verifiedKindsForAmount || verifiedKindsForAmount.size === 0) {
      // Amount not present on any kind-indexed verified row → do not guess.
      continue;
    }
    sawCheckable = true;
    const extra = claim.kinds.filter((k) => !verifiedKindsForAmount.has(k));
    if (extra.length > 0) {
      mismatches.push({ ...claim, extraKinds: extra });
      continue;
    }
    // All claimed kinds verified for this amount — also flag wrong amount for a known kind.
    for (const k of claim.kinds) {
      const verifiedAmt = index.kindToAmount.get(k);
      if (verifiedAmt && verifiedAmt !== claim.amountKey) {
        mismatches.push({ ...claim, extraKinds: [k], wrongAmount: true });
      }
    }
  }

  if (mismatches.length > 0) {
    return {
      ok: false,
      class: COVERAGE_AMOUNT_ATTRIBUTION_CLASS.CLEAR_MISMATCH,
      reason: "coverage_amount_kind_attribution_mismatch",
      claims: mismatches,
    };
  }
  if (!sawCheckable) {
    return {
      ok: true,
      class: COVERAGE_AMOUNT_ATTRIBUTION_CLASS.NOT_CHECKABLE,
      reason: "claims_not_bound_to_verified_amounts",
      claims,
    };
  }
  return {
    ok: true,
    class: COVERAGE_AMOUNT_ATTRIBUTION_CLASS.MATCH,
    reason: null,
    claims,
  };
}

/**
 * S10D — pre-emit veto only for CLEAR_MISMATCH coverage amount attribution.
 * Return false → do not commit/emit. MATCH / NOT_CHECKABLE → true (emit).
 */
export function shouldEmitCoverageAmountIntegritySlice(
  slice = "",
  verifiedCoverages = null,
) {
  if (!String(slice ?? "").trim()) return true;
  const gate = evaluateCoverageAmountAttributionGate({
    text: slice,
    verifiedCoverages,
  });
  return gate.class !== COVERAGE_AMOUNT_ATTRIBUTION_CLASS.CLEAR_MISMATCH;
}
