/**
 * Slice 5 — Decision (Judgment + Lead 통합 · Runtime 핵심).
 */
import { formatPremiumFromRaw } from "./speakFactRenderer.js";

export const KEY_DECISION_SCHEMA = "key-decision-v1";

const INSURANCE_TOPIC_RE =
  /보험|보험료|보장|암|실손|담보|청구|보험금|해지|중복|유지|가입|설계|부족|괜찮|납입|계약/;

function normalizeQuestion(question = "") {
  return String(question ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function policyFactRows(reality = {}) {
  const policies = reality.policies ?? [];
  const p = policies[0];
  const count = reality.policy_count ?? policies.length ?? 0;
  return {
    count,
    insurer: p?.insurer_name ?? null,
    product: p?.product_name ?? null,
    premiumRaw: p?.monthly_premium ?? p?.premium_amount ?? null,
  };
}

function pushSpokenFromIds(ids, reality) {
  const facts = policyFactRows(reality);
  const spoken = [];
  const withheld = [];

  for (const id of ids) {
    if (id === "policy_count" && facts.count > 0) {
      spoken.push({ fact_id: "policy_count", value: String(facts.count), source: "factory" });
    } else if (id === "insurer" && facts.insurer) {
      spoken.push({ fact_id: "insurer", value: facts.insurer, source: "factory" });
    } else if (id === "product" && facts.product) {
      spoken.push({ fact_id: "product", value: facts.product, source: "factory" });
    } else if (id === "monthly_premium") {
      if (facts.premiumRaw != null) {
        spoken.push({ fact_id: "monthly_premium", value: String(facts.premiumRaw), source: "factory" });
      } else {
        withheld.push({ fact: "monthly_premium", reason: "unknown_declared" });
      }
    }
  }

  return { spoken, withheld };
}

function classifySituation(question = "", reality = {}, reflection = {}) {
  const q = normalizeQuestion(question);
  const readings = Array.isArray(reflection?.situation_reading)
    ? reflection.situation_reading.map((s) => String(s).trim()).filter(Boolean)
    : [];
  const readingText = readings.join(" ");

  // Reflection readings first — KEY interprets, does not copy raw soft into Speak
  if (readingText) {
    if (/보험료가 이대로 괜찮은지|보험료.*걱정|유지 부담/.test(readingText)) {
      return "premium_burden";
    }
    if (/보험과 무관한 일반/.test(readingText)) {
      if (/맛집|식당|음식/.test(q)) return "daily_recommendation";
      if (reality.domain === "emotion" || /감정·컨디션이 먼저/.test(readingText)) {
        return "emotional_space";
      }
      return "non_insurance_general";
    }
    if (/가입된 보험이 무엇인지|내 보험에 대해 설명/.test(readingText)) {
      return "enrolled_policy_list";
    }
    if (/전체 보장 상태가 괜찮은지/.test(readingText)) {
      return "coverage_assessment_whole";
    }
    if (/암 보장이 충분한지/.test(readingText)) {
      return "coverage_assessment_cancer_axis";
    }
    if (/추천|방향/.test(readingText)) {
      return "direction_choice";
    }
    if (/감정·컨디션이 먼저/.test(readingText)) {
      return "emotional_space";
    }
  }

  // Question-based fallback
  if (reality.phase === "closing") return "respect_close";
  if (reality.domain === "emotion" && !INSURANCE_TOPIC_RE.test(q)) return "emotional_space";
  if (/맛집|식당|음식/.test(q) && !INSURANCE_TOPIC_RE.test(q)) return "daily_recommendation";
  if (/보험료/.test(q) && /얼마/.test(q)) return "enrolled_policy_list";
  if (/보험료/.test(q) && /부담/.test(q)) return "premium_burden";
  if (/가입한\s*보험|보험\s*뭐|내보험/.test(q)) return "enrolled_policy_list";
  if (/가르쳐|알려/.test(q) && /보험|내보험/.test(q)) return "enrolled_policy_list";
  if (/괜찮/.test(q) && INSURANCE_TOPIC_RE.test(q)) return "coverage_assessment_whole";
  if (/암/.test(q) && /부족/.test(q)) return "coverage_assessment_cancer_axis";
  if (/추천|설계/.test(q)) return "direction_choice";
  if (/심심/.test(q)) return "social_presence";
  if (!INSURANCE_TOPIC_RE.test(q)) return "non_insurance_general";
  return "general_inquiry";
}

function buildDirectAnswerHint(question = "", situation = "") {
  const q = normalizeQuestion(question);
  switch (situation) {
    case "premium_burden":
      return "보험료 부담이시군요.";
    case "enrolled_policy_list":
      return /가르쳐|알려|설명/.test(q) ? "내 보험부터 짚어드릴게요." : "가입 보험부터 확인할게요.";
    case "coverage_assessment_whole":
      return "전체적으로 보시는 거죠.";
    case "coverage_assessment_cancer_axis":
      return "암 보장 쪽이 걸리시는 거죠.";
    case "direction_choice":
      return "방향부터 같이 잡아볼게요.";
    case "emotional_space":
      return "오늘 많이 버티셨네요.";
    case "daily_recommendation":
      return "분당 쪽이시면 선택지가 꽤 있어요.";
    case "non_insurance_general":
      return "그 질문부터 볼게요.";
    case "respect_close":
      return "네, 알겠습니다. 고마워요.";
    case "social_presence":
      return "편하게 오셔도 돼요.";
    default:
      return null;
  }
}

/**
 * @param {object} params
 */
export function buildDecision({
  reflection = null,
  reality = null,
  question = "",
  evidenceBundle = null,
} = {}) {
  const q = normalizeQuestion(question || reflection?.customer_said || "");
  const situation = classifySituation(q, reality, reflection);
  const facts = policyFactRows(reality ?? {});
  const count = facts.count;

  let factsToSpeak = [];
  let factsToWithhold = [];
  let keyJudgment = "";
  let direction = { type: null, move: "" };
  let invite = { allowed: false, prompt: null };

  const pushInsuranceFacts = () => {
    if (facts.count > 0) {
      factsToSpeak = ["policy_count", "insurer", "product", "monthly_premium"];
    } else {
      factsToWithhold.push({ fact: "policies", reason: "policies_absent" });
    }
  };

  switch (situation) {
    case "premium_burden":
      pushInsuranceFacts();
      factsToWithhold.push({ fact: "structure_breakdown", reason: "unknown_declared" });
      if (count > 1) {
        keyJudgment = "여러 건이 등록돼 있어서, 한 건이 아니라 전체 납입을 먼저 보는 게 맞습니다.";
        direction = {
          type: "offer_direction",
          move: `${count}건 전체 월 보험료부터 확인하는 게 좋겠습니다`,
        };
      } else if (count === 1) {
        keyJudgment = "지금 확인된 월 보험료가 부담의 핵심일 수 있습니다.";
        direction = {
          type: "offer_direction",
          move: "이 보험료가 적정한지부터 보면 됩니다",
        };
      } else {
        keyJudgment = "등록된 보험이 없어 숫자부터는 확인이 어렵습니다.";
        direction = { type: "offer_fact_first", move: "가입 정보가 있으면 그걸 기준으로 보겠습니다" };
      }
      invite = { allowed: true, prompt: "여기부터 같이 보실까요?" };
      break;

    case "enrolled_policy_list":
      pushInsuranceFacts();
      factsToWithhold.push({ fact: "structure_breakdown", reason: "unknown_declared" });
      keyJudgment = "지금 등록된 목록 기준으로 말씀드리겠습니다.";
      direction = {
        type: "offer_fact_first",
        move: count > 1 ? "건수와 대표 상품부터 확인" : "확인된 한 건부터 설명",
      };
      invite = { allowed: true, prompt: "더 깊게 볼 부분이 있으면 이어갈게요." };
      break;

    case "coverage_assessment_whole":
      pushInsuranceFacts();
      factsToWithhold.push(
        { fact: "other_coverage_axes", reason: "unknown_declared" },
        { fact: "whole_coverage_verdict", reason: "analysis_pending" },
      );
      keyJudgment = "전체를 단정하긴 어렵고, 확인된 것부터 짚겠습니다.";
      direction = {
        type: "offer_direction",
        move: "실손·보험료부터 볼지, 다른 보장부터 볼지 정하면 됩니다",
      };
      invite = { allowed: true, prompt: "어느 쪽부터 볼까요?" };
      break;

    case "coverage_assessment_cancer_axis": {
      pushInsuranceFacts();
      factsToWithhold.push(
        { fact: "other_coverage_axes", reason: "unknown_declared" },
        { fact: "whole_coverage_verdict", reason: "analysis_pending" },
      );
      const topConcern = evidenceBundle?.coverage_gap?.top_concerns?.[0] ?? null;
      const signalLabel =
        typeof topConcern === "string"
          ? topConcern
          : topConcern?.label ?? topConcern?.category ?? null;
      keyJudgment =
        signalLabel && /암/.test(String(signalLabel))
          ? "암 보장 쪽 신호가 있어 그게 마음 쓰이실 수 있습니다."
          : "암 담보를 따로 들고 계신지는 이 목록만으로는 확답하기 어렵습니다.";
      direction = {
        type: "offer_direction",
        move: "암 보장부터 볼지, 전체를 같이 볼지 고르면 됩니다",
      };
      invite = { allowed: true, prompt: "편한 쪽부터 이어갈게요." };
      break;
    }

    case "direction_choice":
      pushInsuranceFacts();
      factsToWithhold.push(
        { fact: "binding_product_name", reason: "hold_binding_recommendation" },
        { fact: "design_bundle", reason: "direction_not_fixed" },
      );
      keyJudgment = "지금은 특정 상품보다 보험료와 보장 중 어디가 먼저인지가 중요합니다.";
      direction = {
        type: "offer_direction",
        move:
          count > 1
            ? `${count}건 기준으로 보험료를 줄일지, 빠진 보장을 채울지 정하면 됩니다`
            : "보험료를 줄일지, 빠진 보장을 채울지 정하면 됩니다",
      };
      invite = { allowed: true, prompt: "어느 쪽이 더 끌리세요?" };
      break;

    case "emotional_space":
      factsToWithhold.push({ fact: "insurance_facts", reason: "emotional_turn" });
      keyJudgment = "오늘은 보험 이야기보다 쉬는 게 먼저입니다.";
      direction = { type: "offer_space", move: "보험 얘기는 잠깐 내려둘게요" };
      invite = { allowed: true, prompt: "가볍게만 말해 주셔도 돼요." };
      break;

    case "daily_recommendation":
      factsToWithhold.push({ fact: "insurance_facts", reason: "domain_daily" });
      keyJudgment = "한식이 편하시면 서현 쪽, 가볍게 혼밥이면 정자 쪽이 무난합니다.";
      direction = { type: "offer_recommendation", move: "정자역 일대 일식·서현역 근처 한식부터 보시면 됩니다" };
      invite = { allowed: true, prompt: "더 좁히고 싶으시면 말씀해 주세요." };
      break;

    case "non_insurance_general":
      factsToWithhold.push({ fact: "insurance_facts", reason: "domain_non_insurance" });
      keyJudgment = "보험 밖 질문으로 보고 그 초점만 다루겠습니다.";
      direction = { type: "offer_space", move: "지금 질문 초점만 이어서 보겠습니다" };
      invite = { allowed: true, prompt: "그 방향으로 짧게 이어갈까요?" };
      break;

    case "respect_close":
      factsToWithhold.push({ fact: "insurance_facts", reason: "respect_close" });
      keyJudgment = "오늘은 여기까지 해도 됩니다. 고마워요.";
      direction = { type: "respect_close", move: "다음에 이어서 보고 싶으실 때 편하게 오세요" };
      invite = { allowed: false, prompt: null };
      break;

    case "social_presence":
      factsToWithhold.push({ fact: "insurance_facts", reason: "social_turn" });
      keyJudgment = "가볍게 이야기만 해도 괜찮습니다.";
      direction = { type: "offer_space", move: "오늘은 보험 얘기 없이 편하게만 해도 됩니다" };
      invite = { allowed: false, prompt: null };
      break;

    default:
      if (facts.count > 0) pushInsuranceFacts();
      else factsToWithhold.push({ fact: "policies", reason: "policies_absent" });
      keyJudgment = "확인된 것부터 말씀드리겠습니다.";
      direction = { type: "offer_fact_first", move: "등록 정보 기준으로 이어가겠습니다" };
      invite = { allowed: true, prompt: "이어서 볼까요?" };
  }

  const { spoken, withheld: premiumWithheld } = pushSpokenFromIds(factsToSpeak, reality ?? {});
  const allWithheld = [...factsToWithhold, ...premiumWithheld];

  if (!direction.move?.trim()) {
    invite = { allowed: false, prompt: null };
  }

  const premiumFormatted =
    facts.premiumRaw != null ? formatPremiumFromRaw(facts.premiumRaw) : null;

  const readings = Array.isArray(reflection?.situation_reading)
    ? reflection.situation_reading.map((s) => String(s).trim()).filter(Boolean)
    : [];
  const readingConfidence = reflection?.reading_confidence ?? null;

  // KEY interprets — never copy raw readings as customer facts
  const customer_situation_hypothesis = readings.length ? readings.slice(0, 3) : null;

  let key_situation_judgment = null;
  let response_priority = null;
  const key_next_move = direction?.move ?? null;
  const confirm_question = invite?.allowed ? (invite.prompt ?? null) : null;

  switch (situation) {
    case "premium_burden":
      key_situation_judgment =
        "고객이 보험료 적정성·효율을 먼저 확인하고 싶어 하는 상황으로 본다.";
      response_priority = "premium_adequacy_check";
      break;
    case "enrolled_policy_list":
      key_situation_judgment =
        /보험료/.test(q) && /얼마/.test(q)
          ? "보험료 금액 사실 조회가 우선이다."
          : "등록 보험 사실 조회가 우선이다.";
      response_priority = "fact_lookup";
      break;
    case "coverage_assessment_whole":
      key_situation_judgment = "전체 보장 상태를 확인된 범위부터 짚는 상황으로 본다.";
      response_priority = "coverage_assessment";
      break;
    case "coverage_assessment_cancer_axis":
      key_situation_judgment = "암 보장 축을 먼저 확인하는 상황으로 본다.";
      response_priority = "cancer_axis_check";
      break;
    case "direction_choice":
      key_situation_judgment = "방향·우선순위를 함께 잡는 상황으로 본다.";
      response_priority = "direction_choice";
      break;
    case "emotional_space":
      key_situation_judgment = "감정·컨디션이 먼저인 상황으로 본다.";
      response_priority = "emotional_space";
      break;
    case "daily_recommendation":
      key_situation_judgment = "일상 추천 초점만 다룬다.";
      response_priority = "daily_focus";
      break;
    case "non_insurance_general":
      key_situation_judgment = "보험 밖 질문 초점만 다룬다.";
      response_priority = "non_insurance_focus";
      break;
    case "respect_close":
      key_situation_judgment = "대화를 마무리하는 상황으로 본다.";
      response_priority = "respect_close";
      break;
    case "social_presence":
      key_situation_judgment = "가벼운 대화 공간만 연다.";
      response_priority = "social_presence";
      break;
    default:
      key_situation_judgment = keyJudgment || "확인된 범위부터 이어간다.";
      response_priority = situation || "general";
  }

  return {
    schema_version: KEY_DECISION_SCHEMA,
    situation_key: situation,
    direct_answer_hint: buildDirectAnswerHint(q, situation),
    facts_to_speak: factsToSpeak,
    facts_to_withhold: allWithheld,
    fact_selection: {
      facts_spoken: spoken,
      facts_withheld: allWithheld,
    },
    key_judgment: keyJudgment,
    direction,
    invite,
    decision_complete: Boolean(keyJudgment && direction.type && direction.move),
    customer_situation_hypothesis,
    key_situation_judgment,
    response_priority,
    key_next_move,
    confirm_question,
    reading_confidence: readingConfidence,
    trace_meta: {
      policy_count: count,
      premium_display: premiumFormatted,
    },
  };
}

export function isDecisionComplete(decision = {}) {
  return decision.decision_complete === true;
}
