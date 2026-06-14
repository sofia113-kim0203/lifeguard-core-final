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
