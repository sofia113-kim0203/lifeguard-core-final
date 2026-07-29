/**
 * Personal KEY time continuity — LV-2 J6/J7 · LV-5.5 time memory wiring.
 * Mirrors corporateKeySpeech time axis for personal seat (non-entity).
 */
const KEY_GENERIC_FILLER_RE = /확인된\s*범위\s*안에서만\s*조심스럽게/;

const RC_CONTINUITY_COMPANION_CLUSTER_ID = "RC-CONTINUITY-COMPANION-v1";
const RC_RECOGNITION_COMPANION_CLUSTER_ID = "RC-RECOGNITION-COMPANION-v1";

const TIME_CONTINUITY_INTENT_BLOCKLIST = new Set([
  "design_priority_check",
  "design_review_check",
  "coverage_gap_check",
  "coverage_review_request",
  "recommendation_priority_check",
  "recommendation_request",
  "underwriting_bound_check",
  "claim_eligibility_check",
]);

const TIME_CONTINUITY_QUESTION_BLOCKLIST = [
  "저장된 설계",
  "우선순위 알려",
  "보험료 얼마",
  "몇 개야",
  "보험사는",
  "부족한 부분",
  "가입 가능",
  "뭐부터 추가",
  "어떤 보장",
  "청구",
  "보험금",
];

const TIME_HUMAN_SIGNAL_RE =
  /(?:지난|아까|이어|약속|변화|형편|기억|그때|반영|판단|부담|말씀|이야기)/;

function normalizeQuestion(question = "") {
  return String(question ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(text = "") {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function pickVariant(question, variants = []) {
  if (!variants.length) return "";
  let hash = 0;
  for (const ch of normalizeQuestion(question)) {
    hash = (hash + ch.charCodeAt(0)) % variants.length;
  }
  return variants[hash];
}

export function lastAssistantExcerpt(history = []) {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const row = history[i];
    if (row?.role === "assistant" && String(row.content ?? "").trim()) {
      return String(row.content).replace(/\s+/g, " ").trim();
    }
  }
  return "";
}

/** J6 — customer life/time change; insurance topic may be present but human change leads. */
export function isPersonalCustomerChangeTurn(question = "") {
  const q = normalizeQuestion(question);
  if (!q) return false;
  if (/(?:얼마|몇\s*원|총액|몇\s*개|개수)/.test(q) && !/(?:올해|작년|형편|바뀌|늘|줄)/.test(q)) {
    return false;
  }
  return (
    /(?:올해|작년|요즘|내년|형편|예전|그때).*(?:부담|커|늘|바뀌|줄|힘)/.test(q) ||
    /(?:부담|형편|생활).*(?:커|늘|바뀌|달라)/.test(q) ||
    /(?:가족|형편).*(?:바뀌|늘|줄|커|작)/.test(q)
  );
}

/** TC3 — prior promise follow-up. */
export function isPersonalPriorPromiseTurn(question = "") {
  const q = normalizeQuestion(question);
  if (!q) return false;
  if (/^지난번\s*이야기\s*기억/.test(q)) return false;
  if (/기억해\?$/.test(q) && !/(?:어떻게\s*됐|부담\s*줄|약속)/.test(q)) return false;
  return (
    /(?:지난번|아까|전에|그때).*(?:약속|부담\s*줄|어떻게\s*됐)/.test(q) ||
    /(?:지난번|아까).*(?:이야기).*(?:어떻게\s*됐|부담\s*줄|약속)/.test(q) ||
    /(?:어떻게\s*됐).*(?:지난|아까|이야기|약속|부담\s*줄)/.test(q)
  );
}

/** TC4 — prior judgment reflection. */
export function isPersonalPriorJudgmentTurn(question = "") {
  const q = normalizeQuestion(question);
  if (!q) return false;
  if (/기억해\?$/.test(q) && !/판단/.test(q)) return false;
  if (/^(?:전에|지난번|아까).*(?:말했|이야기).*(?:기억)/.test(q) && !/판단/.test(q)) return false;
  return (
    /(?:지난번|아까|전에|그때).*(?:판단)/.test(q) ||
    /(?:당신이\s*말|그\s*판단).*(?:맞|아직|지난|그때)/.test(q) ||
    /(?:아직\s*맞).*(?:판단|말)/.test(q)
  );
}

/** TC5 — growth recall with time axis (not plain memory_recall_lookup Q10 shape). */
export function isPersonalMemoryGrowthRecallTurn(question = "", { classificationIntent = "" } = {}) {
  const q = normalizeQuestion(question);
  if (!q) return false;
  if (/^지난번\s*이야기\s*기억/.test(q)) return false;
  if (/기억해\?$/.test(q) && !/(?:말한\s*부분|반영|기억하시)/.test(q)) return false;
  if (classificationIntent === "memory_recall_lookup" && !/(?:말한\s*부분|반영|기억하시)/.test(q)) {
    return false;
  }
  return (
    /(?:지난번|아까|전에|그때).*(?:말한\s*부분|반영|기억하시)/.test(q) ||
    /(?:반영).*(?:지난|아까|됐|됐어)/.test(q)
  );
}

/** J7 — KEY growth · prior promise/judgment reflection (not memory_recall_lookup). */
export function isPersonalKeyGrowthReflectionTurn(question = "", { classificationIntent = "" } = {}) {
  const q = normalizeQuestion(question);
  if (!q) return false;
  if (classificationIntent === "memory_recall_lookup") return false;
  if (/기억/.test(q) && !/반영/.test(q)) return false;
  return (
    /(?:지난번|아까|전에|저번|그때).*(?:반영|말한\s*부분|약속)/.test(q) ||
    /(?:반영).*(?:지난번|아까|전에|저번)/.test(q)
  );
}

/** Agent-turn used flags only — ignores finalize loaded→used merge inflation (LV-5.5.1). */
export function resolveTimeContinuityGateUsedFlags(factBundle = {}) {
  const snap = factBundle?.time_gate_used_snapshot;
  if (snap) {
    return {
      design_used: snap.design_used === true,
      recommendation_used: snap.recommendation_used === true,
      underwriting_used: snap.underwriting_used === true,
      coverage_gap_used: snap.coverage_gap_used === true,
    };
  }
  return {
    design_used: factBundle?.design_used === true,
    recommendation_used: factBundle?.recommendation_used === true,
    underwriting_used: factBundle?.underwriting_used === true,
    coverage_gap_used: factBundle?.coverage_gap_used === true,
  };
}

export function isTimeContinuityExcluded({
  question = "",
  classificationIntent = "",
  factBundle = {},
} = {}) {
  const q = normalizeQuestion(question);
  const intent = String(classificationIntent ?? "").trim();
  const gateUsed = resolveTimeContinuityGateUsedFlags(factBundle);

  if (factBundle?.companion_cluster === RC_CONTINUITY_COMPANION_CLUSTER_ID) return true;
  if (factBundle?.companion_cluster === RC_RECOGNITION_COMPANION_CLUSTER_ID) return true;

  if (intent && TIME_CONTINUITY_INTENT_BLOCKLIST.has(intent)) return true;
  if (intent === "memory_recall_lookup") {
    if (isPersonalMemoryGrowthRecallTurn(q, { classificationIntent: intent })) return false;
    return true;
  }
  if (intent === "factual_lookup" && factBundle?.lookup_sub_intent === "premium_lookup") {
    return true;
  }

  if (gateUsed.design_used === true) return true;
  if (factBundle?.design_loaded === true && /^design_/.test(intent)) return true;
  if (gateUsed.coverage_gap_used === true && /(?:부족|gap|공백)/.test(q)) return true;
  if (gateUsed.recommendation_used === true) return true;
  if (gateUsed.underwriting_used === true) return true;

  if (TIME_CONTINUITY_QUESTION_BLOCKLIST.some((shape) => q.includes(shape))) return true;

  if (/(?:보장|담보|추천)/.test(q) && !/(?:지난|아까|그때|형편|바뀌|반영|약속|판단)/.test(q)) {
    return true;
  }

  return false;
}

export function hasHybridTimeContinuityInput({ humanFrame = {}, factBundle = {} } = {}) {
  const history = humanFrame.conversation_history ?? [];
  const prior = lastAssistantExcerpt(history);
  const memoryCount = factBundle?.memory_fact_count ?? 0;
  return Boolean(prior) || memoryCount > 0 || history.length >= 2;
}

export function matchesPersonalTimeContinuityAxis({
  question = "",
  classificationIntent = "",
} = {}) {
  const q = normalizeQuestion(question);
  return (
    isPersonalCustomerChangeTurn(q) ||
    isPersonalPriorPromiseTurn(q) ||
    isPersonalPriorJudgmentTurn(q) ||
    isPersonalKeyGrowthReflectionTurn(q, { classificationIntent }) ||
    isPersonalMemoryGrowthRecallTurn(q, { classificationIntent })
  );
}

export function shouldUsePersonalTimeContinuityCompose({
  question = "",
  humanFrame = {},
  classificationIntent = "",
  factBundle = {},
} = {}) {
  const q = normalizeQuestion(question || humanFrame.surface_question || "");
  const intent = classificationIntent || humanFrame.classification_intent || "";

  if (isTimeContinuityExcluded({ question: q, classificationIntent: intent, factBundle })) {
    return false;
  }

  if (!matchesPersonalTimeContinuityAxis({ question: q, classificationIntent: intent })) {
    return false;
  }

  return true;
}

export function hasTimeContinuityUsedSignal(text = "") {
  const opening = normalizeText(text).slice(0, 120);
  if (!opening) return false;
  if (/^등록된\s*가입\s*보험이\s*아직\s*없습니다/.test(opening)) return false;
  if (KEY_GENERIC_FILLER_RE.test(opening)) return false;
  return TIME_HUMAN_SIGNAL_RE.test(opening);
}

export function buildPersonalTimeContinuityResponse({ question = "", humanFrame = {} } = {}) {
  const q = normalizeQuestion(question || humanFrame.surface_question || "");
  const history = humanFrame.conversation_history ?? [];
  const prior = lastAssistantExcerpt(history);

  if (isPersonalPriorPromiseTurn(q)) {
    if (prior && !KEY_GENERIC_FILLER_RE.test(prior)) {
      return normalizeText(
        `지난번 이야기했던 부담 줄이기, ${prior.slice(0, 48)}… 그 흐름부터 이어갈게요.`,
      );
    }
    return normalizeText(
      pickVariant(q, [
        "지난번 이야기했던 약속, 그 흐름부터 이어갈게요. 어떻게 됐는지 같이 짚어볼까요.",
        "아까 나눈 부담 줄이기 이야기 기억하고 있어요. 이어서 같이 보면 됩니다.",
      ]),
    );
  }

  if (isPersonalPriorJudgmentTurn(q)) {
    if (prior && !KEY_GENERIC_FILLER_RE.test(prior)) {
      return normalizeText(
        `지난번 말씀드린 ${prior.slice(0, 48)}… 그 판단 기준으로 아직 맞는지 같이 짚어볼게요.`,
      );
    }
    return normalizeText(
      pickVariant(q, [
        "지난번 말씀드린 판단, 아직 맞는지 같이 짚어볼게요. 그때 흐름 기억하고 있어요.",
        "그때 정리했던 판단 기준, 지금 형편에도 맞는지 이어서 보면 됩니다.",
      ]),
    );
  }

  if (isPersonalKeyGrowthReflectionTurn(q) || isPersonalMemoryGrowthRecallTurn(q)) {
    if (prior && !KEY_GENERIC_FILLER_RE.test(prior)) {
      return normalizeText(
        `지난번 말씀하신 ${prior.slice(0, 48)}… 그 흐름 반영해 볼게요. 아까 이야기 이어서 같이 짚어도 됩니다.`,
      );
    }
    return normalizeText(
      pickVariant(q, [
        "지난번 말씀하신 부분, 그 흐름 반영해 볼게요. 이어서 같이 짚어도 됩니다.",
        "아까 나눈 이야기 반영해서 이어갈게요. 기억하고 있으니 편하게 말씀해 주세요.",
      ]),
    );
  }

  if (isPersonalCustomerChangeTurn(q)) {
    return normalizeText(
      pickVariant(q, [
        "올해 부담이 커지셨군요. 형편이 바뀌신 만큼 먼저 짚을게요. 보험 얘기는 그다음에 같이 보면 됩니다.",
        "요즘 부담이 늘으셨군요. 바뀐 형편부터 이해할게요. 보험은 그다음에 천천히 같이 보면 됩니다.",
      ]),
    );
  }

  return "";
}
