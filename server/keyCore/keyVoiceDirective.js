/**

 * Slice 6 — KEY Voice Directive (KEY → Claude 지시서).

 * Decision/Reality/Reflection은 읽기만; 변경하지 않는다.

 */

import { formatPremiumFromRaw } from "./speakFactRenderer.js";



export const KEY_VOICE_DIRECTIVE_SCHEMA = "key-voice-directive-v3";



function normalizeQuestion(question = "") {

  return String(question ?? "")

    .replace(/\s+/g, " ")

    .trim();

}



/**

 * @param {string} question

 * @param {object|null} decision

 */

export function deriveKeyVoiceQuestionFocus(question = "", decision = null) {

  const q = normalizeQuestion(question);

  if (/^(?:안녕|반가|하이|hello|hi)/i.test(q)) return "greeting";

  if (/처음\s*왔/.test(q)) return "first_visit";

  if (/둘러/.test(q)) return "browse";

  if (/암/.test(q) && /딱\s*말|그냥\s*말/.test(q)) return "cancer_direct";

  if (/암/.test(q)) return "cancer_coverage";

  if (/보험료/.test(q) && /얼마/.test(q)) return "premium_amount";

  if (/보험료/.test(q) && /부담/.test(q)) return "premium_burden";

  if (/줄이|빼야/.test(q) && /보험료/.test(q)) return "premium_reduction";

  if (/분석|가르쳐|알려/.test(q) && /보험/.test(q)) return "policy_overview";

  if (/힘들|지쳤|우울|버텼/.test(q) && !/보험/.test(q)) return "emotional_support";

  if (/뭐부터|어디부터/.test(q)) return "next_step";

  return decision?.situation_key ?? "general";

}



function shouldWithholdFactsForFocus(focus) {

  return new Set([
    "greeting",
    "first_visit",
    "browse",
    "emotional_support",
    "daily_recommendation",
    "non_insurance_general",
    "claim_need_check",
  ]).has(focus);

}



function usesAnalysisConsultingMode(focus) {

  return new Set([

    "cancer_coverage",

    "cancer_direct",

    "next_step",

    "policy_overview",

    "premium_burden",

    "premium_reduction",

    "premium_amount",

  ]).has(focus);

}



function needsPremiumScopeSeparation(allowedFactTokens = {}) {

  const count = allowedFactTokens.policy_count != null ? Number(allowedFactTokens.policy_count) : null;

  return (

    count != null &&

    Number.isFinite(count) &&

    count > 1 &&

    Boolean(allowedFactTokens.monthly_premium_display)

  );

}



function buildPremiumScopePolicy(questionFocus, allowedFactTokens = {}) {

  const multiPremiumFocuses = new Set([

    "policy_overview",

    "premium_amount",

    "premium_burden",

    "premium_reduction",

  ]);

  if (!multiPremiumFocuses.has(questionFocus) || !needsPremiumScopeSeparation(allowedFactTokens)) {

    return null;

  }

  const count = Number(allowedFactTokens.policy_count);

  const countLabel = `${count}건`;

  const insurer = String(allowedFactTokens.insurer ?? "").trim();

  const product = String(allowedFactTokens.product ?? "").trim();

  const premium = String(allowedFactTokens.monthly_premium_display ?? "").trim();

  const contractLabel = [insurer, product].filter(Boolean).join(" ") || "대표 확인 계약";

  return {

    separation_required: true,

    policy_count_scope: "등록된 계약 전체",

    premium_scope: "대표 확인 계약 한 건의 월 납입액 (전체 합계 아님)",

    number_pairing_rule:

      "policy_count와 monthly_premium을 같은 문장에서 '기준'으로 묶거나 전체 보험료로 읽히게 하지 않는다.",

    forbidden_readings: [

      `${countLabel}, ${premium} 기준`,

      `${countLabel} 전체를 놓고 보면, ${premium}`,

      `${premium} 기준으로 전체 보험료`,

      `${countLabel} 전체 보험료가 ${premium}`,

    ],

    preferred_phrases: [

      `등록된 계약은 ${countLabel}이고, 그중 ${contractLabel}의 월 납입액 ${premium}이 확인돼 있어요.`,

      `${countLabel} 전체 월 납입 합계는 아직 정리 중이에요.`,

      "전체 흐름은 계약별 납입액이 더 확인되어야 정확히 볼 수 있어요.",

    ],

  };

}



function buildNumberForwardPolicy(questionFocus, allowedFactTokens = {}, allowedNumbers = []) {

  const focusNeedsNumbers = new Set([

    "policy_overview",

    "premium_amount",

    "premium_burden",

    "premium_reduction",

    "cancer_coverage",

    "cancer_direct",

    "next_step",

  ]);

  if (!focusNeedsNumbers.has(questionFocus)) {

    return { enabled: false, place_in_first_two_sentences: false, targets: [] };

  }

  const scopeSeparation = needsPremiumScopeSeparation(allowedFactTokens);

  const targets = [];

  if (allowedFactTokens.policy_count != null) {

    targets.push({

      number: `${allowedFactTokens.policy_count}건`,

      relevance: "policy_count",

      with_meaning: scopeSeparation ? "등록된 계약 전체 건수" : "등록된 계약 규모",

      do_not_pair_with: scopeSeparation ? ["monthly_premium"] : [],

    });

  }

  if (

    allowedFactTokens.monthly_premium_display &&

    ["premium_amount", "premium_burden", "premium_reduction", "policy_overview"].includes(questionFocus)

  ) {

    targets.push({

      number: allowedFactTokens.monthly_premium_display,

      relevance: "monthly_premium",

      with_meaning: scopeSeparation

        ? "대표 확인 계약 한 건의 월 납입액 (전체 합계 아님)"

        : "확인된 납입액",

      do_not_pair_with: scopeSeparation ? ["policy_count"] : [],

    });

  }

  return {

    enabled: targets.length > 0,

    place_in_first_two_sentences: true,

    use_only_allowed_numbers: true,

    forbid_unrelated_number_dump: true,

    explain_meaning_with_number: true,

    separate_premium_from_policy_count: scopeSeparation,

    targets,

    allowed_numbers: allowedNumbers,

  };

}



function buildIntimacyPolicy() {

  return {

    speak_to_customer_not_report: true,

    forbid_report_style_opening: true,

    report_opening_forbidden_examples: [

      "확인된 것부터 말씀드리겠습니다",

      "등록 정보 기준으로",

      "현재 파악된 바로는",

      "보고드리면",

    ],

    warmth_with_ground_ok: true,

    warmth_phrase_examples: [

      "그럴 만해요",

      "당연히 헷갈릴 수 있어요",

      "제가 먼저 정리해드릴게요",

    ],

    conversational_endings_ok: ["~할게요", "~거든요", "~보면 좋아요"],

    formal_overuse_forbidden: [

      "확인해 드리겠습니다",

      "파악하시는 것이 중요합니다",

    ],

    maintain_polite_register: true,

  };

}



function buildOverFamiliarityBoundary() {

  return {

    no_informal_speech: true,

    no_emoji: true,

    no_exaggerated_reaction: true,

    no_customer_emotion_certainty: true,

    forbidden_assertions: ["무조건", "걱정 마세요", "완벽합니다", "완벽해요"],

    forbidden_examples: [

      "힘드시겠죠",

      "걱정되실 거예요",

      "완전 괜찮아요",

    ],

  };

}




/**
 * Verified speak allowlist from factory reality — counts/entities Claude+Gate may use.
 * Does not invent; only tallies existing policies.
 */
export function collectVerifiedSpeakAllowlistFromReality(reality = null) {
  const numbers = new Set();
  const entities = new Set();
  const policies = Array.isArray(reality?.policies) ? reality.policies : [];
  const declared = Number(reality?.policy_count ?? policies.length ?? 0) || 0;
  if (declared > 0) numbers.add(String(declared));
  if (policies.length > 0) numbers.add(String(policies.length));
  const byInsurer = new Map();
  const byProduct = new Map();
  for (const p of policies) {
    const insurer = String(p?.insurer_name ?? p?.company_name ?? "").trim();
    const product = String(p?.product_name ?? "").trim();
    if (insurer) {
      entities.add(insurer);
      byInsurer.set(insurer, (byInsurer.get(insurer) || 0) + 1);
    }
    if (product) {
      entities.add(product);
      byProduct.set(product, (byProduct.get(product) || 0) + 1);
    }
    const prem = p?.monthly_premium ?? p?.premium_amount;
    if (prem != null) {
      for (const n of String(prem).match(/\d+/g) ?? []) numbers.add(n);
    }
  }
  for (const c of byInsurer.values()) numbers.add(String(c));
  for (const c of byProduct.values()) numbers.add(String(c));
  return {
    allowed_numbers: [...numbers],
    allowed_entities: [...entities],
    insurer_counts: Object.fromEntries(byInsurer),
    product_counts: Object.fromEntries(byProduct),
  };
}

function buildAllowedFactTokens(facts = []) {

  const tokens = {

    policy_count: null,

    insurer: null,

    product: null,

    monthly_premium_raw: null,

    monthly_premium_display: null,

  };

  for (const f of facts) {

    if (f.fact_id === "policy_count") tokens.policy_count = f.value;

    if (f.fact_id === "insurer") tokens.insurer = f.value;

    if (f.fact_id === "product") tokens.product = f.value;

    if (f.fact_id === "monthly_premium") {

      tokens.monthly_premium_raw = f.value;

      tokens.monthly_premium_display = formatPremiumFromRaw(f.value);

    }

  }

  return tokens;

}



function buildAllowedNumbers(facts = []) {

  const nums = new Set();

  for (const f of facts) {

    if (f.fact_id === "policy_count" && f.value != null) {

      nums.add(String(f.value));

    }

    if (f.fact_id === "monthly_premium" && f.value != null) {

      const raw = String(f.value);

      nums.add(raw);

      const n = Number(raw);

      if (Number.isFinite(n)) {

        nums.add(n.toLocaleString("ko-KR"));

        if (n >= 10000) {

          const man = Math.floor(n / 10000);

          const cheon = Math.floor((n % 10000) / 1000);

          if (cheon > 0) nums.add(String(man * 10 + cheon));

          nums.add(String(man));

        }

      }

      const display = formatPremiumFromRaw(f.value);

      if (display) nums.add(display.replace(/\s/g, ""));

    }

  }

  return [...nums].filter(Boolean);

}



function buildOptionalClaims(decisionFacts = []) {

  const claims = [];

  for (const f of decisionFacts) {

    if (f.fact_id === "policy_count") {

      claims.push({

        id: "policy_count",

        fact_id: "policy_count",

        claim: `현재 등록된 보험은 ${f.value}건이다`,

        optional: true,

      });

    }

    if (f.fact_id === "insurer") {

      claims.push({

        id: "insurer",

        fact_id: "insurer",

        claim: `${f.value}이 확인된다`,

        optional: true,

      });

    }

    if (f.fact_id === "product") {

      claims.push({

        id: "product",

        fact_id: "product",

        claim: `${f.value}이 확인된다`,

        optional: true,

      });

    }

    if (f.fact_id === "monthly_premium") {

      const display = formatPremiumFromRaw(f.value);

      claims.push({

        id: "monthly_premium",

        fact_id: "monthly_premium",

        claim: `확인된 월 보험료는 ${display ?? f.value}이다`,

        optional: true,

      });

    }

  }

  return claims;

}



function buildCancerRequiredClaims(focus) {

  const base = [

    {

      id: "cancer_focus",

      claim: "고객 질문의 초점이 암 보장임을 먼저 잡는다",

      check_patterns: [/암/],

    },

    {

      id: "no_cancer_verdict",

      claim: "암 보장 충분/부족은 현재 단정하지 않는다",

      check_patterns: [
        /(?:어렵|확답|단정|목록만|바로\s*(?:단정|판단))/,
        /충분.{0,120}부족/,
        /(?:봐야|확인).{0,30}부족/,
        /말씀드리기\s*보다/,
        /(?:제대로|정확).{0,16}말씀/,
        /(?:딱|바로).{0,24}(?:말|단정).{0,60}(?:먼저|봐야)/,
      ],

      forbidden_patterns: [/충분합니다|부족합니다|문제\s*없(?:어|습니다)|완벽(?:해|합니다)|틀림없/],

    },

    {

      id: "cancer_benefits_check",

      claim: "암 진단비·수술비·치료비 확인이 필요하다",

      check_patterns: [/진단비|수술비|치료비/],

    },

    {

      id: "key_leads_cancer_axis",

      claim: "KEY가 먼저 암 진단비·수술비·치료비부터 확인하겠다고 주체적으로 제시한다",

      check_patterns: [

        /(?:제가|먼저).*(?:암|진단|확인|짚|살펴)/,

        /(?:진단비|수술비|치료비).*(?:부터|먼저|확인)/,

        /암\s*진단비.*(?:부터|먼저)/,

      ],

    },

  ];

  if (focus === "cancer_direct") {

    base.push({

      id: "direct_without_handoff",

      claim: "딱 말해달라는 요청에 고객에게 다시 떠넘기지 않는다",

      forbidden_patterns: [/어느\s*쪽부터\s*볼까요/, /편한\s*쪽(?:을)?\s*말씀/],

    });

  } else {

    base.push({

      id: "no_customer_handoff",

      claim: "고객에게 선택을 다시 떠넘기지 않는다",

      forbidden_patterns: [/어느\s*쪽부터\s*볼까요/, /편한\s*쪽(?:을)?\s*말씀/],

    });

  }

  return base;

}



function buildNextStepRequiredClaims() {

  return [

    {

      id: "key_leads_next_order",

      claim: "KEY가 무엇을 먼저 보겠다는 주체적 다음 순서를 제시한다",

      check_patterns: [

        /(?:제가|먼저).*(?:부터|순서|확인|살펴|짚)/,

        /이어서\s*보실\s*순서/,

        /(?:다음|첫\s*(?:번째)?\s*순서)/,

      ],

    },

    {

      id: "next_step_not_defer_only",

      claim: "확인이 필요합니다로만 끝내지 않는다",

      forbidden_patterns: [/확인이\s*필요합니다\.?\s*$/, /확인(?:이)?\s*필요(?:합니다)?\.?\s*$/],

    },

    {

      id: "next_step_consulting_move",

      claim: "확인된 숫자의 의미 또는 점검 기준을 설명한다",

      check_patterns: [

        /(?:먼저|부터|순서|기준|적용|흐름|하나씩|살펴|확인)/,

      ],

    },

  ];

}



function buildAnalysisRequiredClaims(focus, decision) {

  if (focus === "cancer_coverage" || focus === "cancer_direct") {

    return buildCancerRequiredClaims(focus);

  }

  if (focus === "next_step") {

    return buildNextStepRequiredClaims();

  }

  if (focus === "policy_overview") {

    return [

      {

        id: "overview_not_dump",

        claim: "사실만 나열하지 않고 분석·안내 의도를 포함한다",

        check_patterns: [/(?:분석|현황|살펴|확인|안내|볼\s*수|하나씩)/],

      },

      {

        id: "key_leads_overview",

        claim: "KEY가 무엇을 먼저 보겠다고 주체적으로 제시한다",

        check_patterns: [/(?:제가|먼저|이어서|하나씩|함께)/],

      },

    ];

  }

  if (focus === "premium_burden" || focus === "premium_reduction") {

    return [

      {

        id: "premium_focus",

        claim: "보험료 부담 또는 절감 초점을 먼저 잡는다",

        check_patterns: [/보험료|부담|줄이|납입|합산/],

      },

      {

        id: "key_leads_premium_move",

        claim: "KEY가 다음 확인 순서 또는 판단 기준을 제시한다",

        check_patterns: [/(?:제가|먼저|다음|부터|함께|확인|합산|순서)/],

      },

    ];

  }

  if (focus === "premium_amount") {

    return [

      {

        id: "premium_amount_focus",

        claim: "보험료 금액 질문에 직접 응답한다",

        check_patterns: [/보험료|월\s*\d|만\s*\d|원/],

      },

    ];

  }

  return [];

}



function buildUnknownHandling(focus, withheld = []) {

  if (withheld.length === 0) {

    return "확인된 사실만 말하고, 모르는 부분은 단정하지 않는다.";

  }

  const reasons = withheld.map((w) => w.reason).filter(Boolean);

  if (focus === "cancer_coverage" || focus === "cancer_direct") {

    return "암 담보 확답이 없으면 단정하지 말고, 암 진단비·수술비·치료비 확인 순서와 KEY가 먼저 볼 암 보장 축을 제시한다.";

  }

  if (focus === "next_step") {

    return "다음 순서는 KEY가 주체적으로 제시한다. allowed_numbers 밖 계산 숫자는 쓰지 않는다.";

  }

  if (

    focus === "premium_amount" ||

    focus === "premium_burden" ||

    focus === "premium_reduction" ||

    focus === "policy_overview"

  ) {

    return "등록 건수와 대표 확인 계약 납입액은 scope를 분리해 말한다. 전체 월 납입 합계는 아직 정리 중이면 합계를 지어내지 않고, 계약별 납입 확인이 더 필요하다고 말한다.";

  }

  return `아직 확인되지 않은 항목(${reasons.slice(0, 2).join(", ")})은 지어내지 않고 다음 확인 순서를 제시한다.`;

}



function buildRepetitionAvoidance(previousAnswerSummary = "") {

  const prev = String(previousAnswerSummary ?? "").trim();

  if (!prev) {

    return "이전 답변과 같은 문장·같은 순서·같은 마무리를 반복하지 않는다.";

  }

  return `이전 답변("${prev.slice(0, 120)}")과 같은 표현, 같은 fact 나열 순서, '등록 정보 기준으로 이어가겠습니다' 같은 마무리를 반복하지 않는다.`;

}



function buildAnswerShape(focus) {

  if (focus === "cancer_coverage" || focus === "cancer_direct") {

    return [

      "1. 고객 질문의 초점이 암 보장임을 먼저 잡는다.",

      "2. 확인된 숫자는 필요하면 보조로만 말한다 (optional_claims).",

      "3. 암 보장 충분/부족은 단정하지 않는다.",

      "4. 암 진단비·수술비·치료비 확인이 필요하다고 말한다.",

      "5. KEY가 먼저 암 진단비·수술비·치료비부터 확인하겠다고 주체적으로 제시한다.",

      "6. '보장 축'·'암 축' 표현은 쓰지 않는다.",

      "7. 가입/해지/추가 가입 권유는 하지 않는다.",

    ];

  }

  if (focus === "next_step") {

    return [

      "1. KEY가 먼저 무엇부터 볼지 순서를 제시한다.",

      "2. 확인된 숫자는 보조로만 쓰고, allowed_numbers 밖 계산 숫자는 금지한다.",

      "3. 사실만 나열하지 말고 점검 순서·의미를 설명한다.",

      "4. 고객에게 '어느 쪽부터'처럼 다시 떠넘기지 않는다.",

    ];

  }

  if (focus === "policy_overview") {

    return [

      "1. 내보험 분석·현황 질문임을 먼저 잡는다.",

      "2. 등록 건수와 확인된 월 납입액은 scope를 분리한다 (전체 합계로 읽히게 하지 않는다).",

      "3. 대표 확인 계약 납입만 숫자로 말하고, 전체 월 합계는 아직 정리 중임을 분리해 말한다.",

      "4. KEY가 무엇을 먼저 보겠다고 주체적으로 제시한다.",

    ];

  }

  if (focus === "premium_amount" || focus === "premium_burden" || focus === "premium_reduction") {

    return [

      "1. 보험료 질문 초점을 먼저 잡는다.",

      "2. 등록 건수와 확인된 월 납입액은 scope를 분리한다 (전체 합계로 읽히게 하지 않는다).",

      "3. 대표 확인 계약 납입만 숫자로 말하고, 전체 월 합계는 아직 정리 중임을 분리해 말한다.",

      "4. KEY가 다음 확인 순서를 제시한다.",

    ];

  }

  return null;

}



/**

 * Decision-owned situation fields for Directive/Speak.

 * Raw Reflection must NOT reach Speak — only KEY Decision interpretation.

 */

export function buildDirectiveSituationFromDecision(decision = null) {

  if (!decision) {

    return {

      customer_situation_hypothesis: null,

      key_situation_judgment: null,

      response_priority: null,

      key_next_move: null,

      confirm_question: null,

    };

  }

  return {

    customer_situation_hypothesis: decision.customer_situation_hypothesis ?? null,

    key_situation_judgment: decision.key_situation_judgment ?? null,

    response_priority: decision.response_priority ?? null,

    key_next_move: decision.key_next_move ?? decision.direction?.move ?? null,

    confirm_question:

      decision.confirm_question ??

      (decision.invite?.allowed ? decision.invite?.prompt : null) ??

      null,

  };

}



/** @deprecated Use buildDirectiveSituationFromDecision — raw Reflection must not reach Speak. */

export function buildSoftCustomerContextFromReflection() {

  return {

    soft_customer_reading: null,

    soft_reading_confidence: null,

    soft_response_guidance: null,

  };

}



/**

 * @param {object} params

 * @param {string} params.question

 * @param {object|null} params.decision

 * @param {string} [params.previousAnswerSummary]

 * @param {Array<{role:string,text:string}>} [params.history]

 */

export function buildKeyVoiceDirective({

  question = "",

  decision = null,

  previousAnswerSummary = "",

  history = [],

  reality = null,

} = {}) {

  const q = normalizeQuestion(question);

  const questionFocus = deriveKeyVoiceQuestionFocus(q, decision);

  const decisionFacts = decision?.fact_selection?.facts_spoken ?? [];

  const optionalFacts = shouldWithholdFactsForFocus(questionFocus) ? [] : [...decisionFacts];

  const optionalClaims = buildOptionalClaims(optionalFacts);

  const withheld = decision?.fact_selection?.facts_withheld ?? [];

  const answerMode = usesAnalysisConsultingMode(questionFocus) ? "analysis_consulting" : "direct_response";

  const requiredClaims = answerMode === "analysis_consulting"

    ? buildAnalysisRequiredClaims(questionFocus, decision)

    : [];



  const keyJudgment = decision?.key_judgment ?? null;

  const keyDirection = {

    type: decision?.direction?.type ?? null,

    move: decision?.direction?.move ?? null,

    invite_allowed: decision?.invite?.allowed ?? false,

    invite_prompt: decision?.invite?.prompt ?? null,

  };



  const allowedFactTokens = buildAllowedFactTokens(optionalFacts);

  const allowedNumbers = buildAllowedNumbers(optionalFacts);
  const realityAllow = collectVerifiedSpeakAllowlistFromReality(reality);
  for (const n of realityAllow.allowed_numbers) allowedNumbers.push(n);
  const _seenN = new Set();
  const allowedNumbersDedup = [];
  for (const n of allowedNumbers) {
    const k = String(n);
    if (_seenN.has(k)) continue;
    _seenN.add(k);
    allowedNumbersDedup.push(n);
  }
  allowedNumbers.length = 0;
  allowedNumbers.push(...allowedNumbersDedup);


  const premiumScopePolicy = buildPremiumScopePolicy(questionFocus, allowedFactTokens);



  const situationFromDecision = buildDirectiveSituationFromDecision(decision);



  return {

    schema_version: KEY_VOICE_DIRECTIVE_SCHEMA,

    original_user_question: q,

    question_focus: questionFocus,

    answer_mode: answerMode,

    answer_shape: buildAnswerShape(questionFocus),

    required_claims: requiredClaims,

    optional_claims: optionalClaims,

    facts_to_speak: optionalFacts,

    allowed_fact_tokens: allowedFactTokens,

    allowed_numbers: allowedNumbers,

    premium_scope_policy: premiumScopePolicy,

    number_policy: {

      use_only_allowed_numbers: true,

      forbid_calculated_numbers: true,

      forbid_patterns: [

        "나머지 N건",

        "절반",

        "대부분",

        "몇 개 더",

        "비율",

        "N개 계약에서 파생한 다른 숫자",

        "N건, 월 X 기준",

        "월 X 기준으로 전체 보험료",

        "N건 전체를 놓고 보면, 월 X",

      ],

      examples_forbidden: ["나머지 21건", "22건 중 1건을 빼면 21건"],

      examples_allowed: ["22건", "45,000원", "4만5천 원"],

    },

    answer_behavior: answerMode === "analysis_consulting"

      ? {

          do_not_fact_dump_only: true,

          explain_meaning_of_confirmed_numbers: true,

          include_consulting_interpretation: true,

          do_not_end_with_defer_only: true,

          present_next_check_order_or_criteria: true,

          include_key_led_move_sentence: true,

        }

      : null,

    advice_boundary: {

      no_enrollment_recommendation: true,

      no_cancellation_recommendation: true,

      no_definitive_coverage_verdict: true,

      allow_check_order: true,

      allow_comparison_criteria: true,

      allow_confirmation_direction: true,

    },

    unknowns: withheld.map((w) => ({ fact: w.fact, reason: w.reason })),

    unknown_handling: buildUnknownHandling(questionFocus, withheld),

    key_judgment: keyJudgment,

    key_direction: keyDirection,

    voice_forbidden_phrases: [
      "보장 축",
      "암 축",
      "어느 쪽부터 볼까요",
      "나머지 21건",
      "KEY가",
      "확인된 것부터 말씀드리겠습니다",
      "파악하시는 것이 중요합니다",
      "기준으로 전체 보험료",
      "전체를 놓고 보면, 월",
      ...(decision?.situation_key === "claim_need_check" ||
      decision?.response_priority === "claim_prep"
        ? [
            "가능한 경우가 많",
            "지급됩니다",
            "받을 수 있습니다",
            "청구 가능합니다",
            "22건",
          ]
        : []),
    ],

    forbidden_claims: [
      "new_numbers",
      "calculated_numbers_outside_allowed",
      "new_insurers",
      "new_products",
      "new_coverage_names",
      "enrollment_recommendation",
      "cancellation_recommendation",
      "definitive_coverage_verdict",
      "underwriting_decision",
      "final_binding_close",
      "customer_handoff_question",
    ],

    tone_policy: {

      register: "polite_korean",

      warmth: "grounded_warm",

      intimacy_level: "consulting_conversational",

      conversational_polite: true,

      no_scare: true,

      no_definitive_verdict: true,

      no_product_push: true,

    },

    intimacy_policy: buildIntimacyPolicy(),

    over_familiarity_boundary: buildOverFamiliarityBoundary(),

    number_forward_policy: buildNumberForwardPolicy(questionFocus, allowedFactTokens, allowedNumbers),

    format_policy: {

      sentences_min: 2,

      sentences_max: 5,

      markdown: false,

      lead_with_question_focus: true,

      no_lego_wrapper: true,

    },

    previous_answer_summary: String(previousAnswerSummary ?? "").trim() || null,

    repetition_avoidance_instruction: buildRepetitionAvoidance(previousAnswerSummary),

    // Full session history — no artificial slice(-4).
    conversation_history: (Array.isArray(history) ? history : []).map((h) => ({
      role: h?.role ?? null,
      text: h?.text ?? h?.content ?? "",
    })),

    conversation_history_count: Array.isArray(history) ? history.length : 0,

    decision_situation_key: decision?.situation_key ?? null,

    direct_answer_hint: decision?.direct_answer_hint ?? null,

    soft_customer_reading: null,

    soft_response_guidance: null,

    ...situationFromDecision,

    session_goal: {
      situation_key: decision?.situation_key ?? null,
      response_priority: decision?.response_priority ?? null,
      key_next_move:
        decision?.key_next_move ?? decision?.direction?.move ?? null,
      key_situation_judgment: decision?.key_situation_judgment ?? null,
      inferred_goal: decision?.situation_key ?? null,
    },

  };

}



export function summarizeKeyVoiceDirective(directive = {}) {

  return [

    `focus=${directive.question_focus}`,

    `mode=${directive.answer_mode ?? "direct"}`,

    `required=${(directive.required_claims ?? []).map((c) => c.id).join(",") || "none"}`,

    `optional=${(directive.optional_claims ?? []).map((c) => c.id).join(",") || "none"}`,

    `judgment=${String(directive.key_judgment ?? "").slice(0, 40)}`,

    `priority=${directive.response_priority ?? "none"}`,

    `next=${String(directive.key_next_move ?? "").slice(0, 40)}`,

  ].join(" | ");

}

/**
 * Constrained one-regeneration directive — reuses S6 Speak path.
 * Does NOT paste customer-facing Decision sentences (judgment/move/invite).
 */
export function buildAnswerRegenerationDirective({
  directive = null,
  decision = null,
  failReasons = [],
  rejectedAnswer = "",
  publicResearchEvidence = null,
} = {}) {
  const base = directive && typeof directive === "object" ? { ...directive } : {};
  const situation = String(decision?.situation_key ?? base.question_focus ?? "").trim();
  const priority = String(decision?.response_priority ?? base.response_priority ?? "").trim();
  const researchResults = [
    ...(Array.isArray(publicResearchEvidence?.results) ? publicResearchEvidence.results : []),
    ...(Array.isArray(publicResearchEvidence?.citations)
      ? publicResearchEvidence.citations.map((c) => ({
          title: c.title,
          url: c.url,
          domain: c.domain,
          cited_text: c.cited_text,
          claim_or_summary: c.cited_text,
        }))
      : []),
  ].slice(0, 12);

  const keyChart =
    situation === "claim_need_check" || priority === "claim_prep"
      ? {
          current_goal: "청구 가능성 확인 준비",
          allowed: [
            "걱정 인정",
            "확인 전 지급 여부는 알 수 없음",
            "담보·사고 내용·진단서·영수증·진료비 세부내역 확인 필요",
            "다음 확인 행동 제안",
          ],
          withheld: ["전체 계약 수(22건)", "현재 요청과 무관한 보험 목록 dump"],
          forbidden: [
            "지급 가능성·확정 단정",
            "가능한 경우가 많다",
            "청구 실행(S9)",
          ],
        }
      : isDailyOwnedFocus(situation, priority, base)
        ? {
            current_goal: "현재 일상 요청에 실제로 답하기",
            allowed: [
              "현재 요청에 대한 자연스러운 답",
              "맥락 확인 질문 1개",
              ...(researchResults.length
                ? ["공개 검색 evidence에 있는 장소·사실만 사용"]
                : ["research_unavailable — 장소명 창작 금지"]),
            ],
            withheld: ["보험 사실", "계약 수", "보험료·보장 제안"],
            forbidden: [
              "보험 판매·가입·해지",
              "무관한 보험 전환",
              "보험 문의 초대",
              "보험 상담 전환",
              "출처 없는 평점·영업시간·주차·가격 단정",
              "evidence에 없는 구체 주소",
              "evidence에 없는 역 출구·건물·층수",
              "evidence에 없는 장소 세부 위치",
              "검색하지 않은 식당명 창작",
              "재검색",
            ],
            public_research_evidence: researchResults.map((r) => ({
              title: r.title,
              url: r.url,
              source: r.source ?? r.domain,
              page_age: r.page_age ?? null,
              claim_or_summary: r.claim_or_summary ?? r.cited_text ?? null,
              customer_specific_fact: false,
            })),
            research_status: publicResearchEvidence?.status ?? null,
            reuse_same_evidence_only: true,
          }
        : {
            current_goal: "현재 고객 요청에 답하되 KEY Hard Direction을 지킨다",
            allowed: ["검증된 사실만", "다음 확인 행동"],
            withheld: (base.unknowns ?? []).map((u) => u.fact).filter(Boolean),
            forbidden: base.forbidden_claims ?? [],
          };

  return {
    ...base,
    // Do not feed Decision customer sentences into regen Speak
    key_judgment: null,
    direct_answer_hint: null,
    key_next_move: null,
    confirm_question: null,
    key_direction: {
      type: base.key_direction?.type ?? decision?.direction?.type ?? null,
      move: null,
      invite_allowed: false,
      invite_prompt: null,
    },
    optional_claims: base.optional_claims ?? [],
    regeneration: {
      mode: "answer_constrained_once",
      fail_reasons: (Array.isArray(failReasons) ? failReasons : [failReasons]).filter(Boolean),
      rejected_answer_preview: String(rejectedAnswer ?? "").slice(0, 280),
      key_chart: keyChart,
      instruction:
        "Regenerate ONE natural Korean customer answer for the current question. Follow key_chart allowed/withheld/forbidden. Do not paste internal Decision fields. Do not invent facts or numbers. Do not invite insurance when the customer did not ask.",
    },
  };
}

function isDailyOwnedFocus(situation, priority, directive) {
  return (
    priority === "daily_focus" ||
    priority === "non_insurance_focus" ||
    situation === "daily_recommendation" ||
    situation === "non_insurance_general" ||
    directive?.question_focus === "daily_recommendation" ||
    directive?.key_direction?.type === "general_daily"
  );
}


