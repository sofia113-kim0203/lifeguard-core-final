/**
 * KEY Care Plan continuation — P2-02 voice bridge (numbered markers forbidden).
 */
export const P2_02_SLICE_ID = "P2-02-key-care-plan-continuation";

export const KEY_CARE_PLAN_BRIDGE = "다만 제가 하나씩 같이 챙겨드리고 싶은 게 있어요.";

export const NUMBERED_CARE_PLAN_RE = /[①②③④⑤]/;

function normalizeText(text = "") {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function phraseCarePlanAction(action = "") {
  const trimmed = String(action ?? "").trim();
  if (!trimmed) return "";
  if (/구조\s*확인$/.test(trimmed)) {
    return trimmed.replace(/구조\s*확인$/, "구조부터 확인해");
  }
  if (/점검$/.test(trimmed)) {
    if (/순서대로/.test(trimmed)) {
      return trimmed.replace(/점검$/, "점검해");
    }
    return trimmed.replace(/\s*점검$/, "도 같이 점검해");
  }
  if (/확인$/.test(trimmed)) {
    return trimmed.replace(/확인$/, "부터 확인해");
  }
  return `${trimmed}해`;
}

function formatCarePlanStep(step = {}, index = 0, total = 1) {
  const timeframe = String(step.timeframe ?? "").trim();
  const action = phraseCarePlanAction(step.action);
  if (!timeframe || !action) return "";

  if (timeframe === "갱신 시기") {
    return `${timeframe}에 ${action} 보면 좋겠습니다`;
  }
  if (index === 0) {
    return `우선 ${timeframe}에는 ${action} 보면 좋겠고`;
  }
  if (index === total - 1) {
    return `${timeframe}에는 ${action} 보면 좋겠습니다`;
  }
  return `${timeframe}에는 ${action} 보면 좋겠고`;
}

/** @param {Array<{ timeframe?: string, action?: string }>} steps */
export function formatKeyCarePlanContinuation(steps = []) {
  const filtered = (Array.isArray(steps) ? steps : []).filter(
    (step) => step?.timeframe && step?.action,
  );
  if (!filtered.length) {
    return KEY_CARE_PLAN_BRIDGE;
  }
  const body = filtered
    .map((step, index) => formatCarePlanStep(step, index, filtered.length))
    .filter(Boolean)
    .join(", ");
  return normalizeText(`${KEY_CARE_PLAN_BRIDGE} ${body}.`);
}
