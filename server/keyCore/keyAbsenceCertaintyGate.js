/**
 * Human Gate Repair A — personal-contract absence certainty.
 * Blocks asserting "없음/포함되지 않음" without verified negative evidence.
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
const ABSENCE_ASSERT_RE =
  /포함돼\s*있지\s*않(?:습니다|아요|다)|포함되어\s*있지\s*않(?:습니다|아요|다)|포함되지\s*않(?:습니다|아요|았|다)|보장되지\s*않(?:습니다|아요|다)|보장받을\s*수\s*없(?:습니다|어요|다)|받을\s*수\s*없(?:습니다|어요|다)|진단비가\s*없(?:습니다|어요|다)|보장이\s*없(?:습니다|어요|다)|담보가\s*없(?:습니다|어요|다)|가입되어\s*있지\s*않(?:습니다|아요|다)/;

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
 * @returns {{ ok: boolean, reason: string|null, claims: string[] }}
 */
export function evaluateAbsenceCertaintyGate({
  text = "",
  verifiedNegativeEvidence = null,
} = {}) {
  const evidence = Array.isArray(verifiedNegativeEvidence)
    ? verifiedNegativeEvidence
    : collectVerifiedNegativeCoverageEvidence(verifiedNegativeEvidence || {});

  const claims = [];
  for (const sentence of splitCustomerSpeechSentences(text)) {
    if (!sentenceHasUnverifiedAbsenceCertaintyShape(sentence)) continue;
    const topics = extractAbsenceClaimTopics(sentence);
    // Absence assert without a topic still counts (e.g. bare 포함돼 있지 않습니다 with 이 계약).
    const supported =
      topics.length > 0
        ? evidenceSupportsTopics(evidence, topics)
        : evidence.length > 0 &&
          evidenceSupportsTopics(evidence, ["diagnosis_benefit", "cancer_diagnosis", "brain_diagnosis"]);
    if (!supported) claims.push(sentence);
  }

  if (!claims.length) {
    return { ok: true, reason: null, claims: [] };
  }
  return {
    ok: false,
    reason: "unverified_customer_coverage_claim",
    claims,
  };
}

/** Convenience boolean for answer-facing collectors. */
export function voiceHasUnverifiedAbsenceCertaintyClaim(
  voice = "",
  verifiedNegativeEvidence = null,
) {
  return evaluateAbsenceCertaintyGate({ text: voice, verifiedNegativeEvidence }).ok === false;
}

/**
 * Repair A2 — pre-emit veto only (no rewrite / no substitute prose).
 * Return false → do not commit/emit this customer slice.
 */
export function shouldEmitAbsenceCertaintySlice(
  slice = "",
  verifiedNegativeEvidence = null,
) {
  if (!String(slice ?? "").trim()) return true;
  return (
    evaluateAbsenceCertaintyGate({
      text: slice,
      verifiedNegativeEvidence,
    }).ok !== false
  );
}
