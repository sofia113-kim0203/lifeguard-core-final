/**
 * KEY Judgment Validation v1 — read-only utilization checks (Tom Audit input).
 */
const AXIS_FACTORY_KEY = {
  memory: "memory",
  coverage_gap: "coverage_gap",
  underwriting: "underwriting",
  recommendation: "recommendation",
};

const HONEST_ABSENCE_RE =
  /(?:확인(?:된|되지)|저장(?:된|되지)|아직|없(?:어|습니다)|찾지\s*못|단정(?:하|하기)\s*(?:어렵|불가)|검증\s*(?:전|이\s*필요))/;

const UNDERWRITING_ANSWER_RE =
  /(?:가입|인수|거절|심사|고지|추가\s*확인|건강|위험|부담\s*증|표준\s*가능)/;

const RECOMMENDATION_ANSWER_RE =
  /(?:추천|추가|보완|우선|먼저|필요|점검|볼\s*여지|부족|공백)/;

function factoryEntry(factoryAudit = {}, axis = "") {
  const key = AXIS_FACTORY_KEY[axis] ?? axis;
  return factoryAudit?.[key] ?? null;
}

function answerAxisSignal(judgmentAudit = {}, axis = "", answerText = "") {
  const text = String(answerText ?? "");
  const facts = judgmentAudit?.fact_count ?? {};
  if (axis === "memory") {
    return (facts.memory_fact_count ?? 0) > 0 || HONEST_ABSENCE_RE.test(text);
  }
  if (axis === "coverage_gap") {
    return (facts.coverage_gap_fact_count ?? 0) > 0 || /(?:부족|공백|볼\s*여지|점검|유지)/.test(text);
  }
  if (axis === "underwriting") {
    return (judgmentAudit?.limitation_count ?? 0) > 0 || UNDERWRITING_ANSWER_RE.test(text);
  }
  if (axis === "recommendation") {
    return (judgmentAudit?.judgment_count ?? 0) > 0 || RECOMMENDATION_ANSWER_RE.test(text);
  }
  return false;
}

const RECOMMENDATION_SALES_PUSH_RE =
  /(?:추천|권유)드립니다|가입하세요|이\s*상품(?:이|은)\s*좋|(?:이|그)\s*걸\s*선택|가장\s*좋은\s*보험|정답(?:입니다|이에요)|필수(?:입니다|예요)/;

export function classifyUtilization({ axis, factoryAudit = {}, judgmentAudit = {}, answerText = "" } = {}) {
  const entry = factoryEntry(factoryAudit, axis);
  const available = entry?.available === true;
  const loaded = entry?.loaded === true;
  const used = entry?.used === true;
  const answerSignal = answerAxisSignal(judgmentAudit, axis, answerText);

  let level = "unavailable";
  const text = String(answerText ?? "");
  if (axis === "recommendation" && RECOMMENDATION_SALES_PUSH_RE.test(text)) {
    level = "misuse";
  } else if (available && used) level = "used";
  else if (available && loaded && !used) level = "loaded_not_used";
  else if (available && !loaded) level = "available_not_loaded";
  else if (!available && answerSignal && HONEST_ABSENCE_RE.test(String(answerText))) {
    level = "honest_absence";
  } else if (available && !used && answerSignal && !HONEST_ABSENCE_RE.test(String(answerText))) {
    level = "misuse";
  } else if (
    axis === "recommendation" &&
    !available &&
    answerSignal &&
    !HONEST_ABSENCE_RE.test(String(answerText))
  ) {
    level = "misuse";
  } else if (!available) level = "unavailable";

  const disconnect =
    factoryAudit?.primary_disconnect?.factory === AXIS_FACTORY_KEY[axis]
      ? factoryAudit.primary_disconnect
      : null;

  return {
    axis,
    level,
    factory: {
      available,
      loaded,
      used,
      record_count: entry?.record_count ?? 0,
      source: entry?.source ?? null,
    },
    answer_signal: answerSignal,
    judgment_present: (judgmentAudit?.judgment_count ?? 0) > 0,
    limitation_present: (judgmentAudit?.limitation_count ?? 0) > 0,
    disconnect,
    hypothesis: factoryAudit?.hypothesis ?? null,
    hypothesis_label: factoryAudit?.hypothesis_label ?? null,
  };
}

export function assessJudgmentStep({
  id,
  axis,
  question,
  answerText = "",
  factoryAudit = null,
  judgmentAudit = null,
  answerEvidence = [],
} = {}) {
  const utilization = classifyUtilization({
    axis,
    factoryAudit: factoryAudit ?? {},
    judgmentAudit: judgmentAudit ?? {},
    answerText,
  });

  const notes = [];
  if (utilization.level === "loaded_not_used") {
    notes.push("factory_loaded_answer_underuses");
  }
  if (utilization.level === "available_not_loaded") {
    notes.push("factory_available_not_loaded");
  }
  if (utilization.disconnect) {
    notes.push(`disconnect:${utilization.disconnect.disconnect}`);
  }
  if (
    judgmentAudit?.disposition?.hypothesis_signals?.factory_evidence_without_answer_facts
  ) {
    notes.push("factory_evidence_without_answer_facts");
  }

  return {
    id,
    axis,
    question,
    utilization,
    answer_evidence: answerEvidence,
    judgment_ratios: judgmentAudit?.ratios ?? null,
    disposition_primary: judgmentAudit?.disposition?.primary_label ?? null,
    notes,
  };
}

export function aggregateJudgmentValidation(steps = []) {
  const byAxis = {};
  for (const axis of Object.keys(AXIS_FACTORY_KEY)) {
    byAxis[axis] = { total: 0, used: 0, honest_absence: 0, disconnect: 0, misuse: 0, unavailable: 0 };
  }

  for (const step of steps) {
    const axis = step.axis;
    if (!byAxis[axis]) continue;
    byAxis[axis].total += 1;
    const level = step.utilization?.level;
    if (level === "used") byAxis[axis].used += 1;
    else if (level === "honest_absence") byAxis[axis].honest_absence += 1;
    else if (level === "misuse") byAxis[axis].misuse += 1;
    else if (level === "loaded_not_used" || level === "available_not_loaded") {
      byAxis[axis].disconnect += 1;
    } else if (level === "unavailable") byAxis[axis].unavailable += 1;
  }

  const probeOk = steps.filter((s) => s.probe_ok !== false).length;
  const disconnectCount = steps.filter((s) =>
    ["loaded_not_used", "available_not_loaded"].includes(s.utilization?.level),
  ).length;
  const misuseCount = steps.filter((s) => s.utilization?.level === "misuse").length;

  return {
    questions_probed: steps.length,
    probe_ok: `${probeOk}/${steps.length}`,
    disconnect_count: disconnectCount,
    misuse_count: misuseCount,
    by_axis: byAxis,
    factory_hypothesis_summary: summarizeHypotheses(steps),
  };
}

function summarizeHypotheses(steps = []) {
  const counts = {};
  for (const step of steps) {
    const h = step.utilization?.hypothesis ?? "unknown";
    counts[h] = (counts[h] ?? 0) + 1;
  }
  return counts;
}
