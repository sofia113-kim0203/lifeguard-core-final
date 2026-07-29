/**
 * Slice 5 — Reflection (사람처럼 이해 · Goal/Need/Intent/Speak 금지).
 */
import { detectConversationPhase, detectEmotionSignal } from "./keyThinkingFlow.js";

export const KEY_REFLECTION_SCHEMA = "key-reflection-v1";

const INSURANCE_TOPIC_RE =
  /보험|보험료|보장|암|실손|담보|청구|보험금|해지|중복|유지|가입|설계|부족|괜찮|납입|계약/;

function normalizeQuestion(question = "") {
  return String(question ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildKnownList(reality = {}) {
  const known = [];
  if (reality.policy_count > 0) {
    known.push("policy_count");
    const p = reality.policies?.[0];
    if (p?.insurer_name) known.push("insurer");
    if (p?.product_name) known.push("product");
    if (p?.monthly_premium != null || p?.premium_amount != null) known.push("monthly_premium");
  }
  if (reality.domain) known.push(`domain:${reality.domain}`);
  if (reality.phase) known.push(`phase:${reality.phase}`);
  return known;
}

function buildUnknownList(reality = {}) {
  const unknown = [];
  if (!reality.policies_present) {
    unknown.push("policies");
  } else if (reality.policy_count > 1) {
    unknown.push("per_policy_breakdown");
    unknown.push("total_monthly_premium_all");
  }
  if (reality.domain === "insurance") {
    unknown.push("whole_coverage_verdict");
    unknown.push("structure_breakdown");
  }
  return unknown;
}

function buildSituationReading(question = "", reality = {}) {
  const q = normalizeQuestion(question);
  const readings = [];

  if (reality.phase === "closing") {
    readings.push("대화를 여기서 마무리하려는 신호");
    return readings;
  }

  if (reality.domain === "emotion" || detectEmotionSignal(q)) {
    if (!INSURANCE_TOPIC_RE.test(q)) {
      readings.push("지금은 보험보다 감정·컨디션이 먼저인 것 같음");
      return readings;
    }
  }

  if (/맛집|식당|음식/.test(q) && !INSURANCE_TOPIC_RE.test(q)) {
    readings.push("일상적인 식사 추천 요청");
    return readings;
  }

  if (/보험료/.test(q) && /부담/.test(q)) {
    readings.push("매달 나가는 보험료가 걱정인 것 같음");
    readings.push("보험료 자체보다 유지 부담을 말하는 것 같음");
    return readings;
  }

  if (/가입한\s*보험|보험\s*뭐|내보험/.test(q)) {
    readings.push("지금 가입된 보험이 무엇인지 알고 싶어함");
    return readings;
  }

  if (/가르쳐|알려|설명/.test(q) && /보험|내보험/.test(q)) {
    readings.push("내 보험에 대해 설명을 원함");
    return readings;
  }

  if (/괜찮/.test(q) && INSURANCE_TOPIC_RE.test(q)) {
    readings.push("전체 보장 상태가 괜찮은지 걱정");
    return readings;
  }

  if (/암/.test(q) && /부족/.test(q)) {
    readings.push("암 보장이 충분한지 불안");
    return readings;
  }

  if (/추천|설계/.test(q)) {
    readings.push("막연히 방향이나 추천을 원함");
    return readings;
  }

  if (/심심/.test(q)) {
    readings.push("가볍게 대화하고 싶어함");
    return readings;
  }

  if (/보험료/.test(q) && /(?:맞(?:는|은)\s*건가|맞는지|괜찮은지|고민|망설|싶어서)/.test(q)) {
    readings.push("보험료가 이대로 괜찮은지 마음에 걸릴 수 있음");
    return readings;
  }

  if (!INSURANCE_TOPIC_RE.test(q)) {
    readings.push("보험과 무관한 일반 질문으로 보임");
    return readings;
  }

  readings.push("보험 상담 맥락에서 추가 확인이 필요함");
  return readings;
}

function buildSaidParaphrase(question = "", reality = {}) {
  const q = normalizeQuestion(question);
  if (reality.phase === "closing") return "대화 마무리 의사";
  if (/보험료/.test(q) && /부담/.test(q)) return "보험료 부담 호소";
  if (/가입한\s*보험|보험\s*뭐/.test(q)) return "가입 보험 확인 요청";
  if (/가르쳐|알려/.test(q)) return "내 보험 설명 요청";
  if (/괜찮/.test(q)) return "전체 보장 상태 확인 요청";
  if (/암/.test(q)) return "암 보장 충분성 확인 요청";
  if (/추천|설계/.test(q)) return "보험 방향·추천 요청";
  if (/힘들|지쳤/.test(q)) return "오늘 힘듦 호소";
  if (/맛집/.test(q)) return "맛집 추천 요청";
  if (/심심/.test(q)) return "가벼운 대화 요청";
  return q.slice(0, 80) || "고객 발화";
}

/**
 * @param {object} params
 * @param {string} params.customerSaid
 * @param {object} params.reality — buildCustomerReality output
 */
export function buildReflection({ customerSaid = "", reality = null } = {}) {
  const question = customerSaid || reality?.question || "";

  return {
    schema_version: KEY_REFLECTION_SCHEMA,
    customer_said: normalizeQuestion(question),
    said_paraphrase: buildSaidParaphrase(question, reality),
    known: buildKnownList(reality ?? {}),
    unknown: buildUnknownList(reality ?? {}),
    situation_reading: buildSituationReading(question, reality ?? {}),
    reading_confidence: "hypothesis",
  };
}

export function isReflectionComplete(reflection = {}) {
  return (
    Boolean(reflection.said_paraphrase) &&
    Array.isArray(reflection.known) &&
    Array.isArray(reflection.unknown) &&
    Array.isArray(reflection.situation_reading) &&
    reflection.situation_reading.length > 0
  );
}
