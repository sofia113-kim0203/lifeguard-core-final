/**
 * Slice 5 — Decision (Judgment + Lead 통합 · Runtime 핵심).
 */
import { formatPremiumFromRaw } from "./speakFactRenderer.js";
import {
  classifyStage3Lane,
  STAGE3_LANES,
} from "./keyBorrowedSensesStage3.js";

export const KEY_DECISION_SCHEMA = "key-decision-v1";

const INSURANCE_TOPIC_RE =
  /보험|보험료|보장|암|실손|담보|청구|보험금|해지|중복|유지|가입|설계|부족|괜찮|납입|계약/;

/** Active insurance ask in the current question (not mere deferral mention). */
const ACTIVE_INSURANCE_ASK_RE =
  /보험료|보장|암\s*보험|가입한\s*보험|내\s*보험|해지|납입|실손|담보|특약/;

/** Existing F3 daily lexical set — reuse only, do not expand into a new detector. */
const F3_DAILY_LEX_RE = /맛집|심심|날씨|영화|여행|게임|농담|안녕|뭐해|심심해|식당|음식/;

function normalizeQuestion(question = "") {
  return String(question ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function understandingMaterials(reflection = {}, borrowedUnderstanding = null) {
  const readings = Array.isArray(reflection?.situation_reading)
    ? reflection.situation_reading.map((s) => String(s).trim()).filter(Boolean)
    : [];
  const claudeHyps = Array.isArray(borrowedUnderstanding?.understanding_hypotheses)
    ? borrowedUnderstanding.understanding_hypotheses.map((s) => String(s).trim()).filter(Boolean)
    : [];
  const intent = String(borrowedUnderstanding?.customer_intent ?? "").trim();
  return { readings, claudeHyps, intent };
}

/**
 * Mixed current ask: daily + active insurance in the same turn.
 * Must NOT collapse to general_daily alone.
 */
function isMixedInsuranceAndDailyAsk(question = "", borrowedUnderstanding = null) {
  const q = normalizeQuestion(question);
  const intent = String(borrowedUnderstanding?.customer_intent ?? "");
  const dailyInQ = F3_DAILY_LEX_RE.test(q) || /체중|다이어트/.test(q);
  const insuranceInQ = ACTIVE_INSURANCE_ASK_RE.test(q);
  if (dailyInQ && insuranceInQ) return true;
  if (
    /(?:맛집|일상|식사)/.test(intent) &&
    /(?:보험료|보장|내\s*보험)/.test(intent) &&
    /(?:도\s*(?:궁금|봐|확인)|함께|같이|그리고)/.test(`${intent} ${q}`)
  ) {
    return true;
  }
  return false;
}

/**
 * Clear general_daily / non-insurance current intent.
 * Reuses F3 lane + Borrowed customer_intent + Reflection readings — no new classifier.
 */
function resolveClearNonInsuranceSituation(
  question = "",
  reflection = {},
  borrowedUnderstanding = null,
  f3Lane = null,
) {
  if (isMixedInsuranceAndDailyAsk(question, borrowedUnderstanding)) return null;

  const q = normalizeQuestion(question);
  const { readings, claudeHyps, intent } = understandingMaterials(
    reflection,
    borrowedUnderstanding,
  );
  const material = [...readings, ...claudeHyps, intent].filter(Boolean).join(" ");
  const claudeBlob = [...claudeHyps, intent].filter(Boolean).join(" ");

  // Borrowed/Claude insurance reading beats weak Reflection "무관" on bare percent-cut questions
  const claudeSaysInsurance =
    /보험료|보장|납입|가입|해지|절감|실손|암\s*보험/.test(claudeBlob) &&
    !/무관|일상(?:적인)?\s*(?:식사|질문|요청)|비보험|맛집|식사 추천/.test(claudeBlob);

  // Strong active insurance ask in current question (without deferral) → not non-insurance
  const deferredInsurance =
    /보험\s*(?:얘기|이야기|상담).{0,16}(?:나중|나중에|잠깐|말고)/.test(q) ||
    /(?:나중|나중에).{0,12}보험/.test(q);
  if (ACTIVE_INSURANCE_ASK_RE.test(q) && !deferredInsurance) return null;
  if (claudeSaysInsurance && !deferredInsurance) return null;

  const f3IsDaily = f3Lane?.lane === STAGE3_LANES.GENERAL_DAILY;
  const understandingNonInsurance =
    /보험\s*(?:상담과\s*)?무관|보험\s*외(?:\s*질문)?|일상(?:적인)?\s*(?:식사|질문|요청)|보험보다\s*(?:감정|쉬는)|가벼운\s*(?:톤|대화)|보험\s*관련\s*질문\s*이\s*없|비보험/.test(
      material,
    ) ||
    readings.some((r) =>
      /일상적인 식사 추천|보험과 무관한 일반|가볍게 대화|감정·컨디션이 먼저/.test(r),
    );

  // Emotion-only signal must not create non-insurance lane by itself
  const emotionOnly =
    !f3IsDaily &&
    !intent &&
    readings.length > 0 &&
    readings.every((r) => /감정·컨디션이 먼저/.test(r)) &&
    !claudeHyps.length;

  if (emotionOnly) return null;

  // F3 general_daily alone is not enough when understanding already points to insurance
  // (e.g. bare "30% 줄일 수 있지?" → F3 daily without context, but Claude says 보험료 절감)
  const f3DailyTrusted =
    f3IsDaily &&
    (understandingNonInsurance ||
      F3_DAILY_LEX_RE.test(q) ||
      /체중|다이어트|월급|연봉|급여|월세|렌트|칼로리/.test(q) ||
      readings.some((r) => /일상|무관|식사|감정·컨디션|가볍게 대화/.test(r)));

  if (!f3DailyTrusted && !understandingNonInsurance && !deferredInsurance) return null;
  if (deferredInsurance && !F3_DAILY_LEX_RE.test(q) && !understandingNonInsurance && !f3DailyTrusted) {
    return null;
  }

  // Prefer existing daily_recommendation when Reflection/F3 already marked meal/daily chitchat
  if (
    readings.some((r) => /일상적인 식사 추천/.test(r)) ||
    (f3DailyTrusted && F3_DAILY_LEX_RE.test(q)) ||
    (/식사|맛집|식당|음식/.test(material) && !ACTIVE_INSURANCE_ASK_RE.test(q))
  ) {
    return "daily_recommendation";
  }
  if (readings.some((r) => /감정·컨디션이 먼저/.test(r)) && !INSURANCE_TOPIC_RE.test(q)) {
    return "emotional_space";
  }
  return "non_insurance_general";
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

function classifySituation(question = "", reality = {}, reflection = {}, borrowedUnderstanding = null) {
  const q = normalizeQuestion(question);
  const { readings, claudeHyps, intent } = understandingMaterials(
    reflection,
    borrowedUnderstanding,
  );
  const readingText = readings.join(" ");
  const claudeText = [...claudeHyps, intent].filter(Boolean).join(" ");
  const materialText = [readingText, claudeText].filter(Boolean).join(" ");
  const claudeInsurance = /보험료|보장|납입|가입|해지|절감|실손|암\s*보험/.test(claudeText);
  // Reuse existing F3 current-intent lane (no new classifier)
  const f3Lane = classifyStage3Lane(q, {});

  // Clear general_daily / non-insurance current intent beats stale insurance direction_choice
  const clearNonInsurance = resolveClearNonInsuranceSituation(
    q,
    reflection,
    borrowedUnderstanding,
    f3Lane,
  );
  if (clearNonInsurance) return clearNonInsurance;

  // Claude understanding can recover ambiguous questions Reflection marked non-insurance
  if (claudeInsurance && !isMixedInsuranceAndDailyAsk(q, borrowedUnderstanding)) {
    if (/보험료.*(?:걱정|부담|적정)|적정성|맞는\s*건가|유지 부담/.test(claudeText)) {
      return "premium_burden";
    }
    if (/줄이|절감|방향|우선/.test(claudeText) && !/무관|일상|맛집|식사/.test(claudeText)) {
      return "direction_choice";
    }
    if (/가입된 보험|내 보험|목록|금액 확인|얼마/.test(claudeText)) {
      return "enrolled_policy_list";
    }
  }

  // Reflection + Claude understanding materials — KEY interprets, does not copy raw soft into Speak
  if (materialText) {
    if (/보험료가 이대로 괜찮은지|보험료.*걱정|유지 부담|적정성|부담.*맥락|맞는\s*건가/.test(materialText)) {
      return "premium_burden";
    }
    if (
      (/보험과 무관한 일반|체중|다이어트|운동/.test(materialText) || /체중|다이어트/.test(q)) &&
      !ACTIVE_INSURANCE_ASK_RE.test(q) &&
      !claudeInsurance
    ) {
      if (F3_DAILY_LEX_RE.test(q) || /맛집|식당|음식/.test(q)) return "daily_recommendation";
      if (reality.domain === "emotion" || /감정·컨디션이 먼저/.test(materialText)) {
        return "emotional_space";
      }
      return "non_insurance_general";
    }
    if (/가입된 보험이 무엇인지|내 보험에 대해 설명/.test(materialText)) {
      return "enrolled_policy_list";
    }
    if (/전체 보장 상태가 괜찮은지/.test(materialText)) {
      return "coverage_assessment_whole";
    }
    if (/암 보장이 충분한지/.test(materialText)) {
      return "coverage_assessment_cancer_axis";
    }
    // "추천|방향" alone is NOT insurance direction_choice — require insurance context
    if (
      /추천|방향/.test(materialText) &&
      (claudeInsurance || ACTIVE_INSURANCE_ASK_RE.test(q) || /보험|보장|설계|절감/.test(materialText)) &&
      !/무관|일상(?:적인)?\s*(?:식사|질문)|식사 추천/.test(materialText)
    ) {
      return "direction_choice";
    }
    if (/감정·컨디션이 먼저/.test(materialText) && !ACTIVE_INSURANCE_ASK_RE.test(q)) {
      return "emotional_space";
    }
  }

  // Question-based fallback
  if (reality.phase === "closing") return "respect_close";
  if (reality.domain === "emotion" && !INSURANCE_TOPIC_RE.test(q)) return "emotional_space";
  if (F3_DAILY_LEX_RE.test(q) && !ACTIVE_INSURANCE_ASK_RE.test(q)) return "daily_recommendation";
  if (/체중|다이어트/.test(q) && !ACTIVE_INSURANCE_ASK_RE.test(q)) return "non_insurance_general";
  if (/보험료/.test(q) && /얼마/.test(q)) return "enrolled_policy_list";
  if (/보험료/.test(q) && /(?:부담|맞는\s*건가|이게\s*맞)/.test(q)) return "premium_burden";
  if (/줄일\s*수\s*있/.test(q) && (INSURANCE_TOPIC_RE.test(q) || claudeInsurance)) {
    return "direction_choice";
  }
  if (/가입한\s*보험|보험\s*뭐|내보험/.test(q)) return "enrolled_policy_list";
  if (/가르쳐|알려/.test(q) && /보험|내보험/.test(q)) return "enrolled_policy_list";
  if (/괜찮/.test(q) && INSURANCE_TOPIC_RE.test(q)) return "coverage_assessment_whole";
  if (/암/.test(q) && /(?:부족|충분)/.test(q)) return "coverage_assessment_cancer_axis";
  // Insurance recommendation/design only — bare "추천" is not direction_choice
  if (/추천|설계/.test(q) && (INSURANCE_TOPIC_RE.test(q) || /설계/.test(q))) {
    return "direction_choice";
  }
  if (/심심/.test(q)) return "social_presence";
  // Explicit claim/payout worry — docs/담보 prep, not inventory dump
  if (
    /(?:보험금|청구)/.test(q) &&
    /(?:걱정|받을\s*수|가능|수술비)/.test(q)
  ) {
    return "claim_need_check";
  }
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
      return "어떤 분위기가 편하세요?";
    case "non_insurance_general":
      return "그 이야기부터 들을게요.";
    case "claim_need_check":
      return "수술비·보험금 걱정이시군요.";
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
  borrowedUnderstanding = null,
} = {}) {
  const q = normalizeQuestion(question || reflection?.customer_said || "");
  const situation = classifySituation(q, reality, reflection, borrowedUnderstanding);
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
      keyJudgment = "말씀하신 것부터 이어갈게요.";
      direction = {
        type: "general_daily",
        move: "필요한 맥락을 하나만 확인하고 이어갈게요",
      };
      invite = { allowed: true, prompt: "조금만 더 알려주실래요?" };
      break;

    case "non_insurance_general":
      factsToWithhold.push({ fact: "insurance_facts", reason: "domain_non_insurance" });
      keyJudgment = "그 이야기부터 들을게요.";
      direction = {
        type: "general_daily",
        move: "지금 말씀하신 것부터 이어서 볼게요",
      };
      invite = { allowed: true, prompt: "조금만 더 말씀해 주실래요?" };
      break;

    case "claim_need_check":
      factsToWithhold.push(
        { fact: "policy_count", reason: "claim_prep_withhold_inventory" },
        { fact: "insurer", reason: "claim_prep_docs_first" },
        { fact: "product", reason: "claim_prep_docs_first" },
        { fact: "monthly_premium", reason: "claim_prep_docs_first" },
        { fact: "insurance_facts", reason: "claim_prep_docs_first" },
      );
      keyJudgment =
        "걱정되시는 마음 알겠어요. 확인 전에는 지급 여부를 단정할 수 없어요.";
      direction = {
        type: "claim_prep",
        move: "진단서·영수증·진료비 세부내역과 해당 담보부터 확인하겠습니다",
      };
      invite = { allowed: true, prompt: "서류부터 볼까요, 담보 확인부터 볼까요?" };
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
  const claudeHyps = Array.isArray(borrowedUnderstanding?.understanding_hypotheses)
    ? borrowedUnderstanding.understanding_hypotheses.map((s) => String(s).trim()).filter(Boolean)
    : [];
  const readingConfidence = reflection?.reading_confidence ?? null;

  // KEY interprets — never copy raw readings/hypotheses as customer facts
  const customer_situation_hypothesis = (() => {
    const merged = [...readings, ...claudeHyps].filter(Boolean);
    return merged.length ? [...new Set(merged)].slice(0, 5) : null;
  })();

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
      key_situation_judgment =
        /줄일\s*수\s*있|30\s*%/.test(q)
          ? "보험료 절감 가능성을 잠정 방향으로만 보고, 비율 확정은 하지 않는다."
          : "방향·우선순위를 함께 잡는 상황으로 본다.";
      response_priority = "direction_choice";
      break;
    case "emotional_space":
      key_situation_judgment = "감정·컨디션이 먼저인 상황으로 본다.";
      response_priority = "emotional_space";
      break;
    case "daily_recommendation":
      key_situation_judgment = "일상 요청에 먼저 답하고 자연스럽게 이어간다.";
      response_priority = "daily_focus";
      break;
    case "non_insurance_general":
      key_situation_judgment = "현재 비보험 요청에 먼저 답한다.";
      response_priority = "non_insurance_focus";
      break;
    case "claim_need_check":
      key_situation_judgment =
        "고객이 명시한 보험금 걱정을 청구 확인 준비로 본다. 지급 가능 여부는 확인 전 단정하지 않는다.";
      response_priority = "claim_prep";
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

  // Materials KEY used — not Speak inputs
  const hypothesis_used = {
    understanding_hypotheses: claudeHyps.slice(0, 5),
    customer_intent: borrowedUnderstanding?.customer_intent ?? null,
    emotional_signal: borrowedUnderstanding?.emotional_signal ?? null,
    hesitation_signal: borrowedUnderstanding?.hesitation_signal ?? null,
    context_carryover: borrowedUnderstanding?.context_carryover ?? null,
    visual_observation: borrowedUnderstanding?.visual_observation ?? null,
    proposal_direction: borrowedUnderstanding?.proposal_direction ?? null,
    next_decision_point: Array.isArray(borrowedUnderstanding?.next_decision_point)
      ? borrowedUnderstanding.next_decision_point
      : [],
    confidence: borrowedUnderstanding?.confidence ?? null,
    reflection_readings: readings.slice(0, 3),
  };

  const decision_confidence =
    borrowedUnderstanding?.confidence ??
    readingConfidence ??
    (claudeHyps.length || readings.length ? "hypothesis" : "question_classify");

  const key_direction = {
    type: direction?.type ?? null,
    move: direction?.move ?? null,
  };

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
    customer_situation_judgment: key_situation_judgment,
    response_priority,
    key_next_move,
    key_direction,
    confirm_question,
    reading_confidence: readingConfidence,
    decision_confidence,
    hypothesis_used,
    trace_meta: {
      policy_count: count,
      premium_display: premiumFormatted,
    },
  };
}

/**
 * D2 — Claude may emit decision/session_goal; KEY validates and records.
 * fact_selection always stays KEY-owned (from buildDecision baseline).
 */
export function validateAndRecordClaudeDecision({
  reflection = null,
  reality = null,
  question = "",
  evidenceBundle = null,
  borrowedUnderstanding = null,
} = {}) {
  const keyBaseline = buildDecision({
    reflection,
    reality,
    question,
    evidenceBundle,
    borrowedUnderstanding,
  });
  const proposal =
    borrowedUnderstanding?.decision && typeof borrowedUnderstanding.decision === "object"
      ? borrowedUnderstanding.decision
      : null;
  const sessionGoal =
    borrowedUnderstanding?.session_goal != null
      ? String(borrowedUnderstanding.session_goal).trim() || null
      : null;

  if (!proposal) {
    return {
      ...keyBaseline,
      hypothesis_used: {
        ...(keyBaseline.hypothesis_used ?? {}),
        claude_decision_proposal: null,
        claude_session_goal: sessionGoal,
        decision_source: "key_fallback",
        d2_output_incomplete: true,
      },
    };
  }

  const situation_key =
    String(proposal.situation_key ?? "").trim() || keyBaseline.situation_key;
  const key_judgment =
    String(proposal.key_judgment ?? "").trim() || keyBaseline.key_judgment;
  const key_situation_judgment =
    String(proposal.key_situation_judgment ?? "").trim() ||
    keyBaseline.key_situation_judgment;
  const response_priority =
    String(proposal.response_priority ?? "").trim() || keyBaseline.response_priority;
  const key_next_move =
    String(proposal.key_next_move ?? "").trim() || keyBaseline.key_next_move;

  let direction = keyBaseline.direction;
  if (proposal.direction && typeof proposal.direction === "object") {
    const type = String(proposal.direction.type ?? "").trim() || direction?.type || null;
    const move = String(proposal.direction.move ?? "").trim() || direction?.move || "";
    if (type && move) direction = { type, move };
  }

  let invite = keyBaseline.invite;
  const confirm_question =
    proposal.confirm_question != null
      ? String(proposal.confirm_question).trim() || null
      : keyBaseline.confirm_question;
  if (confirm_question) {
    invite = { allowed: true, prompt: confirm_question };
  }

  const decision_complete = Boolean(key_judgment && direction?.type && direction?.move);

  return {
    ...keyBaseline,
    situation_key,
    key_judgment,
    key_situation_judgment,
    customer_situation_judgment: key_situation_judgment,
    response_priority,
    key_next_move,
    direction,
    key_direction: {
      type: direction?.type ?? null,
      move: direction?.move ?? null,
    },
    invite,
    confirm_question,
    // KEY vault — never delegated to Claude
    fact_selection: keyBaseline.fact_selection,
    facts_to_speak: keyBaseline.facts_to_speak,
    facts_to_withhold: keyBaseline.facts_to_withhold,
    decision_complete,
    hypothesis_used: {
      ...(keyBaseline.hypothesis_used ?? {}),
      claude_decision_proposal: proposal,
      claude_session_goal: sessionGoal,
      decision_source: decision_complete
        ? "claude_proposal_validated"
        : "key_fallback_incomplete_proposal",
      d2_output_incomplete: !decision_complete || !sessionGoal,
    },
  };
}

export function isDecisionComplete(decision = {}) {
  return decision.decision_complete === true;
}
