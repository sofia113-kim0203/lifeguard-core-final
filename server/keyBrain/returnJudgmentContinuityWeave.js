/**
 * CONN-005 — Continuity Weave (Hand only).
 * Time + change ONLY — no judgment · no design action · no coverage labels in weave text.
 */
import { polishLifeguardCustomerText } from "../lifeguardOutputGuard.js";

export const CONN_005_SPEAK_SCHEMA_VERSION = "conn-005-continuity-weave-v1";

export const RETURN_JUDGMENT_CONTINUITY_CANONICAL =
  "지난번 함께 확인했던 이후 달라진 부분이 있습니다.";

export const RETURN_JUDGMENT_CONTINUITY_FORBIDDEN = [
  /보장/,
  /부족|충분/,
  /가입(?:\s*조건|\s*가능|\s*불가)/,
  /인수심사|심사\s*경로/,
  /설계(?:해보|안을|안\s*을)/,
  /keep|add|reduce|review/i,
  /리밸런싱/,
  /중복\s*여부/,
];

const RETURN_JUDGMENT_COMPOUND_FORBIDDEN = [
  /memory/i,
  /memory_fact/i,
  /저장(?:해|된)/i,
  /기억(?:하고|나요|해\s*드)/i,
  /보험\s*\d+\s*건/i,
  /분석\s*결과\s*요약/i,
  /파일명/i,
  /시스템\s*알림/i,
];

const REBALANCING_HUMAN_TEMPLATES = {
  keep: {
    withLabel: "지금은 {label}은 그대로 유지하시면 됩니다.",
    fallback: "지금은 그대로 유지하시면 됩니다.",
  },
  add: {
    withLabel: "{label} 부분은 새로 보완하면 좋겠습니다.",
    fallback: "이 부분은 새로 보완하면 좋겠습니다.",
  },
  reduce: {
    withLabel: "이 부분은 함께 다시 살펴보면 좋겠습니다.",
    fallback: "이 부분은 함께 다시 살펴보면 좋겠습니다.",
  },
  review: {
    withLabel: "{label}은 다시 확인해보면 좋겠습니다.",
    fallback: "다시 확인해보면 좋겠습니다.",
  },
};

export function isReturnJudgmentGapOrUwPrimaryWired(result = {}) {
  return result.conn_002_panel_wired === true || result.conn_003_panel_wired === true;
}

export function isReturnJudgmentContinuityEligible(factBundle = {}) {
  if (factBundle.maintenance_return_eligible === false) return false;
  if (factBundle.return_judgment !== true && factBundle.classification_intent !== "return_judgment") {
    return false;
  }
  return (
    factBundle.maintenance_return_eligible === true ||
    (factBundle.rebalancing_used === true && factBundle.rebalancing_loaded === true)
  );
}

export function buildReturnJudgmentContinuityWeave() {
  return RETURN_JUDGMENT_CONTINUITY_CANONICAL;
}

export function scanReturnJudgmentContinuitySentence(text = "") {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return { ok: false, reason: "empty" };
  if (trimmed.length > 80) return { ok: false, reason: "too_long" };
  for (const pattern of RETURN_JUDGMENT_CONTINUITY_FORBIDDEN) {
    if (pattern.test(trimmed)) {
      return { ok: false, reason: `continuity_forbidden:${pattern.source}` };
    }
  }
  for (const pattern of RETURN_JUDGMENT_COMPOUND_FORBIDDEN) {
    if (pattern.test(trimmed)) {
      return { ok: false, reason: `forbidden:${pattern.source}` };
    }
  }
  if (!/지난|이후|달라진/.test(trimmed)) {
    return { ok: false, reason: "missing_time_change_signal" };
  }
  return { ok: true, reason: null };
}

function resolveItemLabel(item = {}) {
  return String(item.coverage_label ?? item.label ?? "").trim();
}

function applyHumanTemplate(template, label) {
  if (label && template.withLabel.includes("{label}")) {
    return template.withLabel.replace("{label}", label);
  }
  return template.fallback;
}

export function buildRebalancingHumanSpeak(rebalancingContext = {}) {
  const keep = (rebalancingContext.keep_items ?? [])[0];
  const add = (rebalancingContext.add_items ?? [])[0];
  const reduce = (rebalancingContext.reduce_items ?? [])[0];
  const review = (rebalancingContext.review_items ?? [])[0];

  const clauses = [];
  if (keep) clauses.push({ item_type: "keep", text: applyHumanTemplate(REBALANCING_HUMAN_TEMPLATES.keep, resolveItemLabel(keep)) });
  if (add) clauses.push({ item_type: "add", text: applyHumanTemplate(REBALANCING_HUMAN_TEMPLATES.add, resolveItemLabel(add)) });
  if (review) clauses.push({ item_type: "review", text: applyHumanTemplate(REBALANCING_HUMAN_TEMPLATES.review, resolveItemLabel(review)) });
  if (!add && !review && reduce) {
    clauses.push({
      item_type: "reduce",
      text: applyHumanTemplate(REBALANCING_HUMAN_TEMPLATES.reduce, resolveItemLabel(reduce)),
    });
  }

  return {
    clauses,
    keep_label: keep ? resolveItemLabel(keep) : null,
    strengthen_label: add ? resolveItemLabel(add) : null,
    review_label: review ? resolveItemLabel(review) : null,
    reduce_signal: Boolean(reduce),
  };
}

export function scanMaintenanceCompoundSentence(text = "") {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return { ok: false, reason: "empty" };
  if (trimmed.length > 200) return { ok: false, reason: "too_long" };
  for (const pattern of RETURN_JUDGMENT_COMPOUND_FORBIDDEN) {
    if (pattern.test(trimmed)) {
      return { ok: false, reason: `forbidden:${pattern.source}` };
    }
  }
  return { ok: true, reason: null };
}

function scanCombinedWithPrimaryBudget(text = "", primaryScanFn = null) {
  const trimmed = String(text ?? "").trim();
  if (primaryScanFn) {
    const primaryScan = primaryScanFn(trimmed);
    if (primaryScan.ok) return primaryScan;
  }
  return scanMaintenanceCompoundSentence(trimmed);
}

export function appendReturnJudgmentContinuityWeave(compoundResult, { factBundle = {}, primaryScanFn = null } = {}) {
  if (!compoundResult?.text) return compoundResult;
  if (!isReturnJudgmentContinuityEligible(factBundle)) return compoundResult;
  if (!isReturnJudgmentGapOrUwPrimaryWired(compoundResult)) return compoundResult;

  const continuityRaw = buildReturnJudgmentContinuityWeave();
  const continuityScan = scanReturnJudgmentContinuitySentence(continuityRaw);
  if (!continuityScan.ok) return compoundResult;

  const primaryTrimmed = compoundResult.text.trim().replace(/\.\s*$/, "");
  const continuityPolished = polishLifeguardCustomerText(continuityRaw);
  const combined = `${continuityPolished} ${primaryTrimmed}.`;
  const combinedScan = scanCombinedWithPrimaryBudget(combined, primaryScanFn);
  if (!combinedScan.ok) return compoundResult;

  const polishedCombined = polishLifeguardCustomerText(combined);
  const finalScan = scanCombinedWithPrimaryBudget(polishedCombined, primaryScanFn);
  if (!finalScan.ok) return compoundResult;

  const baseOutlet = compoundResult.persona_outlet ?? "return_judgment_p5c";
  return {
    ...compoundResult,
    text: polishedCombined,
    conn_005_continuity_weave_wired: true,
    conn_005_continuity_text: continuityPolished,
    persona_outlet: `${baseOutlet}+conn_005_continuity_weave`,
    generation_mode: `${compoundResult.generation_mode ?? "return_judgment_p5c"}_conn_005_continuity`,
  };
}
