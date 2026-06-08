const ACTION_PRIORITY = ["review", "change", "add", "reduce", "keep"];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function currentPremium(currentPortfolio = {}) {
  return toNumber(currentPortfolio.monthly_premium ?? currentPortfolio.total_monthly_premium, 0);
}

function currentCoverageScore(currentPortfolio = {}) {
  return toNumber(currentPortfolio.coverage_score, 0);
}

function duplicateCount(currentPortfolio = {}) {
  return toNumber(currentPortfolio.duplicate_count ?? currentPortfolio.duplicate_warnings?.length, 0);
}

function hasRisk(design = {}, context = {}) {
  return design.requires_agent_review === true ||
    (design.warnings ?? []).length > 0 ||
    context.underwritingRiskResult?.underwriting_risk_level === "high";
}

function bestDesign(designDraft = {}) {
  return designDraft.customer_top2_designs?.[0] ?? designDraft.recommended_designs?.[0] ?? null;
}

function estimateDesignPremium(design) {
  return toNumber(design?.monthly_premium_estimate ?? design?.estimated_monthly_premium, null);
}

function improvementScore(design, coverageGapResult = {}) {
  const focusCount = design?.design_focus?.length ?? 0;
  const gapSeverityBoost = (coverageGapResult.coverage_gaps ?? [])
    .filter((gap) => design?.design_focus?.includes(gap.coverage_type))
    .reduce((sum, gap) => sum + (gap.severity === "high" ? 14 : gap.severity === "medium" ? 8 : 3), 0);
  return focusCount * 6 + gapSeverityBoost;
}

function chooseAction({ premiumDelta, improvement, duplicates, risky, currentScore }) {
  if (risky) return "review";
  if (duplicates >= 2 && improvement < 12) return "reduce";
  if (improvement >= 28 && premiumDelta <= 20000) return "add";
  if (improvement >= 28 && premiumDelta > 20000) return "change";
  if (improvement >= 15 && currentScore < 60) return "add";
  if (duplicates > 0 && premiumDelta <= 0) return "reduce";
  return "keep";
}

function actionReason(action, { improvement, premiumDelta, duplicates }) {
  if (action === "keep") return "현재 보장 구조를 유지하면서 정기 점검하는 편이 우선입니다.";
  if (action === "add") return `월 ${Math.abs(premiumDelta).toLocaleString("ko-KR")}원 수준 변화로 보장 개선 여지가 있습니다.`;
  if (action === "change") return "기존 구성보다 보장 개선 폭이 커서 변경 검토 가치가 있습니다.";
  if (action === "reduce") return `중복/과다 가능성이 ${duplicates}건 있어 감액 또는 정리 검토가 필요합니다.`;
  return "건강 memory 또는 인수위험 요소로 설계사 검토가 먼저 필요합니다.";
}

function summarizeForMonthlyReport(action, score, reasons) {
  return `이번 달 리밸런싱 판단은 ${action}이며 점수는 ${score}점입니다. ${reasons[0] ?? "추가 검토가 필요합니다."}`;
}

function summarizeForKakao(action, requiresReview) {
  if (requiresReview) return "보험 리밸런싱 검토가 필요합니다. 담당 설계사 확인을 권장합니다.";
  if (action === "keep") return "현재 보험 구성은 유지 관점입니다. 다음 점검 때 다시 확인하세요.";
  if (action === "add") return "보장 공백 보완 여지가 있습니다. 추가 검토가 필요합니다.";
  if (action === "change") return "기존 구성 변경 검토 가치가 있습니다. 설계사와 확인하세요.";
  if (action === "reduce") return "중복 보장 정리 가능성이 있습니다. 감액 검토가 필요합니다.";
  return "보험 리밸런싱 결과를 확인하세요.";
}

export function analyzeRebalancing({
  customer_id = null,
  currentPortfolio = {},
  designDraft = {},
  coverageGapResult = {},
  underwritingRiskResult = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const design = bestDesign(designDraft);
  const current = currentPremium(currentPortfolio);
  const designPremium = estimateDesignPremium(design);
  const premiumDelta = designPremium == null ? 0 : designPremium - current;
  const improvement = improvementScore(design, coverageGapResult);
  const duplicates = duplicateCount(currentPortfolio) + (coverageGapResult.duplicate_warnings?.length ?? 0);
  const risky = hasRisk(design, { underwritingRiskResult });
  const currentScore = currentCoverageScore(currentPortfolio);
  const action = chooseAction({ premiumDelta, improvement, duplicates, risky, currentScore });
  const baseScore = 50 + improvement - Math.max(0, premiumDelta / 5000) - duplicates * 5 - (risky ? 18 : 0);
  const rebalancing_score = clamp(Math.round(baseScore), 0, 100);
  const reasons = [actionReason(action, { improvement, premiumDelta, duplicates })];
  const risk_warnings = [
    ...(design?.warnings ?? []),
    ...(underwritingRiskResult.underwriting_risk_level === "high" ? ["인수심사 위험 검토가 필요합니다."] : []),
  ];
  const requires_agent_review = action === "review" || risk_warnings.length > 0 || design?.requires_agent_review === true;

  return {
    customer_id,
    rebalancing_score,
    action,
    reasons,
    premium_change: {
      current_monthly_premium: current,
      proposed_monthly_premium: designPremium,
      delta: premiumDelta,
    },
    coverage_improvement: {
      score: improvement,
      focus: design?.design_focus ?? [],
    },
    risk_warnings: Array.from(new Set(risk_warnings)),
    monthly_report_summary: summarizeForMonthlyReport(action, rebalancing_score, reasons),
    kakao_notification_summary: summarizeForKakao(action, requires_agent_review),
    requires_agent_review,
    generated_at: generatedAt,
  };
}

export { ACTION_PRIORITY };
