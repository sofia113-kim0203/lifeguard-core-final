/**
 * Advisor Brain P1 — Evidence guardrails (미확인 ≠ 미보유, contradiction, unsupported facts).
 */

const NOT_OWNED_STATUSES = new Set(["missing", "not_owned", "미보유", "none", "absent"]);
const UNKNOWN_LABEL = "미확인";
const NOT_OWNED_LABEL = "미보유";

export function normalizeUnknownVsNotOwned({ status, hasCoverageSummary = true } = {}) {
  const raw = String(status ?? "").trim();
  if (!raw) return UNKNOWN_LABEL;

  const lacksSummary = hasCoverageSummary === false;
  if (lacksSummary && (NOT_OWNED_STATUSES.has(raw) || raw === NOT_OWNED_LABEL)) {
    return UNKNOWN_LABEL;
  }

  if (NOT_OWNED_STATUSES.has(raw)) return NOT_OWNED_LABEL;
  if (raw === "unknown" || raw === "not_evaluated") return UNKNOWN_LABEL;
  return raw;
}

export function detectContradictionBetweenPolicyCountAndGap({
  policyCount = 0,
  coverageGapResult = null,
} = {}) {
  const count = Number(policyCount ?? 0);
  if (count <= 0) return { contradicted: false, reason: null };

  const items = Array.isArray(coverageGapResult?.items) ? coverageGapResult.items : [];
  if (!items.length) return { contradicted: false, reason: null };

  const evaluable = items.filter((item) => item?.current_status !== "not_evaluated");
  if (!evaluable.length) return { contradicted: false, reason: null };

  const allMissing = evaluable.every(
    (item) => item.current_status === "missing" || item.gap_level === "critical",
  );

  if (allMissing) {
    return {
      contradicted: true,
      reason: "policy_count_positive_but_all_gap_items_missing",
      policy_count: count,
      gap_item_count: evaluable.length,
    };
  }

  return { contradicted: false, reason: null };
}

export function buildUncertaintyNotice({
  contradictions = [],
  unknownItems = [],
  toolFailures = [],
} = {}) {
  const lines = [];

  for (const contradiction of contradictions) {
    if (contradiction?.contradicted) {
      lines.push(
        "등록된 보험 건수와 보장 공백 분석 결과가 서로 맞지 않을 수 있어, 단정적 표현을 피하고 추가 확인이 필요합니다.",
      );
    }
  }

  if (unknownItems.length) {
    lines.push(
      `보장 요약이 없는 계약 ${unknownItems.length}건은 '미보유'가 아니라 '${UNKNOWN_LABEL}'으로 취급합니다.`,
    );
  }

  if (toolFailures.length) {
    lines.push("일부 근거 도구가 실패하여 확인되지 않은 항목은 미확인으로 남깁니다.");
  }

  return lines.join("\n");
}

const UNSUPPORTED_ASSERTION_PATTERNS = [
  /반드시\s*가입\s*가능/,
  /100%\s*보장/,
  /확실히\s*받을\s*수\s*있/,
  /보험료는\s*\d/,
];

export function assertNoUnsupportedFact(text = "", { hasPremiumEvidence = false, hasCoverageEvidence = false } = {}) {
  const normalized = String(text ?? "").trim();
  if (!normalized) return { ok: true, violations: [] };

  const violations = [];

  for (const pattern of UNSUPPORTED_ASSERTION_PATTERNS) {
    if (pattern.test(normalized)) {
      violations.push({ rule: "unsupported_assertion_pattern", pattern: String(pattern) });
    }
  }

  if (!hasPremiumEvidence && /월\s*보험료|보험료\s*합계/.test(normalized)) {
    violations.push({ rule: "premium_without_evidence" });
  }

  if (!hasCoverageEvidence && /(미보유|없습니다|가입되어\s*있지)/.test(normalized)) {
    violations.push({ rule: "coverage_absence_without_evidence" });
  }

  return { ok: violations.length === 0, violations };
}

const ADVISOR_POLICY_COUNT_SAFE_REPLACEMENT =
  "가입 보험은 등록 정보 기준으로 확인 중입니다";

/** Strip LLM/stale-memory insurance policy *count* claims (건수). Premium amounts unchanged. */
function stripInsurancePolicyCountFromAdvisorMessage(text = "") {
  let out = String(text ?? "");

  const patterns = [
    /(?:현재\s*)?(?:등록(?:된)?\s*)?(?:확인(?:되(?:는|된)|되는)\s*)?(?:(?:가입|보유)\s*)?보험(?:은|이|를|의|은)?\s*(?:총\s*)?[\d,]+\s*건(?:의\s*(?:(?:가입|보유)\s*)?보험)?(?:입니다|이에요|으로\s*확인(?:됩니다|돼요|되)?)?/gi,
    /[\d,]+\s*건(?:의\s*(?:(?:가입|보유)\s*)?보험)(?:입니다|이에요)?/gi,
  ];

  if (/보험/.test(out)) {
    patterns.push(/(?:포함\s*)?(?:총|합계)\s*[\d,]+\s*건(?:입니다|이에요)?/gi);
  }

  for (const pattern of patterns) {
    out = out.replace(pattern, ADVISOR_POLICY_COUNT_SAFE_REPLACEMENT);
  }

  const escapedSafe = ADVISOR_POLICY_COUNT_SAFE_REPLACEMENT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  out = out.replace(new RegExp(`(?:${escapedSafe}\\s*){2,}`, "g"), `${ADVISOR_POLICY_COUNT_SAFE_REPLACEMENT} `);

  return out.replace(/\s{2,}/g, " ").trim();
}

export function sanitizeAdvisorBrainMessage(
  message,
  { hasPremiumEvidence = false, hasCoverageEvidence = false } = {},
) {
  const original = String(message ?? "").trim();
  if (!original) return original;

  let sanitized = stripInsurancePolicyCountFromAdvisorMessage(original);

  const factCheck = assertNoUnsupportedFact(sanitized, {
    hasPremiumEvidence,
    hasCoverageEvidence,
  });
  if (factCheck.ok) return sanitized;

  sanitized = sanitized.replace(/반드시\s*가입\s*가능/gi, "확인 필요");
  sanitized = sanitized.replace(/100%\s*보장/gi, "확인 필요");
  sanitized = sanitized.replace(/확실히\s*받을\s*수\s*있/gi, "확인 필요");
  sanitized = sanitized.replace(/월\s*보험료\s*[:：]?\s*[\d,]+원?/gi, "월 보험료: 미확인");
  sanitized = sanitized.replace(/보험료는\s*[\d,]+원?/gi, "보험료: 미확인");
  sanitized = sanitized.replace(/보험료\s*합계(?:는)?\s*[\d,]+원?/gi, "보험료 합계: 미확인");
  sanitized = sanitized.replace(/확인된\s*월\s*보험료\s*합계(?:는)?\s*[\d,]+원?/gi, "월 보험료 합계: 미확인");

  const recheck = assertNoUnsupportedFact(sanitized, {
    hasPremiumEvidence,
    hasCoverageEvidence,
  });
  if (!recheck.ok) {
    return `${sanitized}\n\n일부 항목은 현재 등록 정보 기준으로 미확인이며, 증권 확인이 필요합니다.`;
  }

  return sanitized;
}

export function applyGuardrailsToPolicies(policies = []) {
  return (policies ?? []).map((policy) => {
    const hasCoverageSummary =
      policy?.coverage_summary != null &&
      typeof policy.coverage_summary === "object" &&
      Object.keys(policy.coverage_summary).length > 0;

    const ownershipStatus = normalizeUnknownVsNotOwned({
      status: hasCoverageSummary ? "held" : "missing",
      hasCoverageSummary,
    });

    return {
      ...policy,
      advisor_guarded_ownership_status: ownershipStatus,
      advisor_has_coverage_summary: hasCoverageSummary,
    };
  });
}
