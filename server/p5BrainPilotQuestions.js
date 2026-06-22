/**
 * P5-BRAIN — pilot question matcher (4 questions only; all others unchanged).
 */
export const P5_BRAIN_PILOT_KEYS = {
  PREMIUM_BURDEN: "premium_burden",
  CANCER_COVERAGE: "cancer_coverage",
  INSURANCE_ANALYSIS: "insurance_analysis",
  CONTINUE_CONVERSATION: "continue_conversation",
};

function normalizePilotQuestion(question = "") {
  return String(question ?? "")
    .replace(/\s+/g, " ")
    .replace(/[?!.?！？。]/g, "")
    .trim()
    .toLowerCase();
}

/** @returns {string|null} one of P5_BRAIN_PILOT_KEYS */
export function matchP5BrainPilotQuestion(question = "") {
  const q = normalizePilotQuestion(question);
  if (!q) return null;

  if (/보험료.*(비싼|부담|높)/.test(q) || q.includes("보험료 너무 비싼")) {
    return P5_BRAIN_PILOT_KEYS.PREMIUM_BURDEN;
  }
  if (/암보험.*(부족|없|괜찮)/.test(q) || q.includes("암보험 부족")) {
    return P5_BRAIN_PILOT_KEYS.CANCER_COVERAGE;
  }
  if (/내\s*보험.*분석/.test(q) || /보험.*분석해/.test(q)) {
    return P5_BRAIN_PILOT_KEYS.INSURANCE_ANALYSIS;
  }
  if (/지난번.*(이어|계속)/.test(q) || /이어서\s*하자/.test(q)) {
    return P5_BRAIN_PILOT_KEYS.CONTINUE_CONVERSATION;
  }

  return null;
}
