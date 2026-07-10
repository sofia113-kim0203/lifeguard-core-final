/**
 * S7-a Borrowed Senses gate unit tests (no Claude · local only).
 */
import { gateBorrowedSensesOutput } from "../server/keyCore/keyBorrowedSensesGate.js";
import {
  repairProposalDirection,
  repairNextDecisionPoints,
  buildQuestionLeadershipHint,
} from "../server/keyCore/keyBorrowedSensesSpeak.js";

const directivePremium = {
  allowed_fact_tokens: {
    policy_count: "22",
    insurer: "삼성생명",
    product: "실손의료비보험",
    monthly_premium_display: "4만5천 원",
  },
  allowed_numbers: ["22", "45000"],
  facts_to_speak: [
    { fact_id: "policy_count" },
    { fact_id: "monthly_premium_representative" },
  ],
};

const cases = [
  {
    id: "G1_safe_greeting",
    borrowed: {
      understanding_hypotheses: ["고객이 가벼운 인사로 대화를 시작하려는 것 같다"],
      customer_intent: "인사 및 관계 시작",
      emotional_signal: null,
      hesitation_signal: null,
      context_carryover: null,
      visual_observation: null,
      answer_purpose: "S6 인사 답변의 톤을 유지",
      must_not_assume: ["보험 상담 의사를 단정하지 않음"],
      used_facts: [],
      recommendation_basis: null,
      voice_raw_candidate: "반갑게 맞이하되 부담 없이 대화할 수 있다는 신호를 준다",
      final_answer_source: "s6",
    },
    directive: { allowed_fact_tokens: {}, facts_to_speak: [] },
    history: [],
    question: "안녕하세요",
    expectOk: true,
  },
  {
    id: "G2_premium_scope_safe",
    borrowed: {
      understanding_hypotheses: ["전체 보험료가 궁금하지만 아직 합산은 정리 중일 수 있다"],
      customer_intent: "월 보험료 확인",
      emotional_signal: null,
      hesitation_signal: null,
      context_carryover: null,
      visual_observation:
        "화면 표는 3개 행으로 구성 — 등록 22건, 대표 계약 월 4만5천 원, 전체 합산 아직 정리 중",
      answer_purpose: "확인된 대표 계약만 먼저 설명",
      must_not_assume: ["22건 전체 월 납입을 대표 납입과 동일시하지 않음"],
      used_facts: ["policy_count", "monthly_premium_representative"],
      recommendation_basis: null,
      voice_raw_candidate: "대표로 확인된 4만5천 원부터 말하고 전체 합산은 정리 중임을 분리한다",
      final_answer_source: "s6",
    },
    directive: directivePremium,
    history: [],
    question: "내 보험료 얼마야?",
    expectOk: true,
  },
  {
    id: "G5_must_not_assume_negation_safe",
    borrowed: {
      understanding_hypotheses: ["해지 가능 여부를 탐색 중일 수 있음"],
      customer_intent: "해지 가능 여부 확인",
      emotional_signal: null,
      hesitation_signal: null,
      context_carryover: null,
      visual_observation: null,
      answer_purpose: "해지 전 확인 유도",
      must_not_assume: [
        "이전 대화 내용이 있었다고 가정하지 않음",
        "conversation_history 없음",
      ],
      used_facts: ["policy_count"],
      recommendation_basis: null,
      voice_raw_candidate: "어떤 계약인지 먼저 짚어보면서 이어가 볼까요?",
      final_answer_source: "s6",
    },
    directive: directivePremium,
    history: [],
    question: "해지해도 돼?",
    expectOk: true,
  },
  {
    id: "G6_visual_scope_safe",
    borrowed: {
      understanding_hypotheses: ["직전 표의 각 행 의미를 확인하려는 것 같다"],
      customer_intent: "표 해석",
      emotional_signal: null,
      hesitation_signal: null,
      context_carryover: "직전 보험료 답변의 표를 가리킴",
      visual_observation:
        "표에는 등록 계약 수 22건, 대표 확인 계약 납입 월 4만5천 원, 전체 월 납입 합계 아직 정리 중 행이 있음",
      answer_purpose: "표 행별 의미 설명",
      must_not_assume: ["대표 납입을 22건 전체 합계로 단정하지 않음"],
      used_facts: ["policy_count", "monthly_premium_representative"],
      recommendation_basis: null,
      voice_raw_candidate: "위쪽은 대표 계약 납입이고 아래 합산 행은 아직 정리 중이라고 설명한다",
      final_answer_source: "s6",
    },
    directive: directivePremium,
    history: [{ role: "user", text: "내보험료 얼마야?" }],
    question: "표가 무슨 뜻이야?",
    visualBlocks: [
      {
        type: "premium_summary_table",
        title: "확인된 납입 요약",
        rows: [
          ["등록 계약 수", "22건", "전체 등록 기준"],
          ["대표 확인 계약 납입", "월 4만5천 원", "삼성생명 실손의료비보험 · 대표 계약 기준"],
          ["전체 월 납입 합계", "아직 정리 중", "22건 합산 · 확인 전"],
        ],
      },
    ],
    expectOk: true,
  },
  {
    id: "G7_context_carryover_absence_meta_safe",
    borrowed: {
      understanding_hypotheses: ["첫 인사일 수 있음"],
      customer_intent: "인사",
      emotional_signal: null,
      hesitation_signal: null,
      context_carryover: "이전 대화 이력 없음 (conversation_history: [])",
      visual_observation: null,
      answer_purpose: "인사 응대",
      must_not_assume: ["보험 상담 의사를 단정하지 않음"],
      used_facts: [],
      recommendation_basis: null,
      voice_raw_candidate: "반갑게 맞이한다",
      final_answer_source: "s6",
    },
    directive: { allowed_fact_tokens: {}, facts_to_speak: [] },
    history: [],
    question: "안녕하세요",
    expectOk: true,
  },
  {
    id: "G8_used_facts_colon_format_safe",
    borrowed: {
      understanding_hypotheses: ["보험료 확인"],
      customer_intent: "월 보험료 확인",
      emotional_signal: null,
      hesitation_signal: null,
      context_carryover: null,
      visual_observation: "표 3개 행",
      answer_purpose: "대표 계약 납입 안내",
      must_not_assume: ["전체 합계로 단정하지 않음"],
      used_facts: ["policy_count: 22건", "monthly_premium_display: 4만5천 원"],
      recommendation_basis: null,
      voice_raw_candidate: "대표 계약 4만5천 원부터",
      final_answer_source: "s6",
    },
    directive: directivePremium,
    history: [],
    question: "내 보험료 얼마야?",
    expectOk: true,
  },
  {
    id: "G9_descriptive_used_facts_visual_row_safe",
    borrowed: {
      understanding_hypotheses: ["보험료 확인"],
      customer_intent: "월 보험료 확인",
      emotional_signal: null,
      hesitation_signal: null,
      context_carryover: null,
      visual_observation: "표 3개 행",
      answer_purpose: "대표 계약 납입 안내",
      must_not_assume: ["전체 합계로 단정하지 않음"],
      used_facts: [
        "policy_count: 22건",
        "insurer: 삼성생명",
        "visual row 3: 전체 월 납입 합계 = 아직 정리 중",
      ],
      recommendation_basis: null,
      voice_raw_candidate: "대표 계약 4만5천 원부터",
      final_answer_source: "s6",
    },
    directive: directivePremium,
    history: [],
    question: "내 보험료 얼마야?",
    expectOk: true,
  },
  {
    id: "G10_recommendation_negation_basis_safe",
    borrowed: {
      understanding_hypotheses: ["고객이 추천을 요청했지만 방향이 없을 수 있음"],
      customer_intent: "상품 추천 요청",
      emotional_signal: null,
      hesitation_signal: null,
      context_carryover: null,
      visual_observation: null,
      answer_purpose: "추천 대신 방향 질문",
      must_not_assume: ["특정 상품 적합성을 단정하지 않음"],
      used_facts: ["policy_count"],
      recommendation_basis: "특정 상품 추천 불가 — 방향 설정 선행 필요",
      voice_raw_candidate: "어느 쪽이 더 마음에 걸리세요? 보험료 줄이는 쪽인지, 빠진 보장 확인 쪽인지요.",
      final_answer_source: "s6",
    },
    directive: directivePremium,
    history: [],
    question: "아무거나 추천해줘",
    expectOk: true,
  },
  {
    id: "G3_blocked_recommendation_push",
    borrowed: {
      understanding_hypotheses: ["고객이 선택 부담을 줄이려 추천을 요청한 것 같다"],
      customer_intent: "상품 추천 요청",
      emotional_signal: "결정 피로",
      hesitation_signal: "무엇을 골라야 할지 모르겠다",
      context_carryover: null,
      visual_observation: null,
      answer_purpose: "추천 대신 방향 선택 질문으로 전환",
      must_not_assume: ["특정 상품이 적합하다고 단정하지 않음"],
      used_facts: ["policy_count"],
      recommendation_basis: "지금은 이 상품을 바로 추천하기 어렵다",
      voice_raw_candidate: "지금은 이 상품 가입을 추천드리기보다 보험료와 보장 중 어디가 먼저인지 같이 정해볼게요",
      final_answer_source: "s6",
    },
    directive: directivePremium,
    history: [],
    question: "아무거나 추천해줘",
    expectOk: false,
    expectGates: { unsupported_recommendation: true },
  },
  {
    id: "G4_blocked_context_hallucination",
    borrowed: {
      understanding_hypotheses: ["이전 대화를 이어 달라는 요청"],
      customer_intent: "이전 상담 이어하기",
      emotional_signal: null,
      hesitation_signal: null,
      context_carryover: "지난번에 말씀하신 암보험 부족 이야기를 이어서 본다",
      visual_observation: null,
      answer_purpose: "이전 맥락 확인",
      must_not_assume: [],
      used_facts: [],
      recommendation_basis: null,
      voice_raw_candidate: "지난번 암보험 이야기부터 이어갈게요",
      final_answer_source: "s6",
    },
    directive: directivePremium,
    history: [
      { role: "user", text: "내보험 분석해줘" },
      { role: "assistant", text: "등록된 계약은 22건입니다." },
    ],
    question: "지난번에 말한 거 이어서 봐줘",
    expectOk: false,
    expectGates: { context_hallucination: true },
  },
  {
    id: "B1_leadership_safe_premium",
    borrowed: {
      understanding_hypotheses: ["전체 보험료가 궁금하지만 합산은 아직 정리 중일 수 있다"],
      customer_intent: "월 보험료 확인",
      emotional_signal: null,
      hesitation_signal: null,
      context_carryover: null,
      visual_observation: "표 3행 — 등록 22건, 대표 4만5천 원, 합산 정리 중",
      answer_purpose: "확인된 대표 계약부터",
      must_not_assume: ["22건 전체를 대표 납입과 동일시하지 않음"],
      used_facts: ["policy_count", "monthly_premium_representative"],
      recommendation_basis: null,
      voice_raw_candidate: "대표 계약 4만5천 원부터 말하고 합산은 다음 단계로 둔다",
      key_purpose: "확인된 납입부터 공유해 신뢰를 쌓고 다음 단계로 안내",
      leadership_move: "대표 확인 계약 1건의 월 납입을 먼저 짚고 22건 합산은 그다음으로 둔다",
      insurance_expertise_angle: ["납입부담", "계약정리"],
      insurance_expertise_rationale: "22건은 한 번에 합치면 착시가 생기므로 확인된 계약부터",
      proposal_direction: "지금 확인된 납입을 먼저 말씀드리고 나머지는 순서대로 맞춰 보겠다",
      next_decision_point: ["전체 월 납입 합계부터 볼지", "계약별 납입부터 하나씩 볼지"],
      final_answer_source: "s6",
    },
    directive: directivePremium,
    history: [],
    question: "내 보험료 얼마야?",
    expectOk: true,
  },
  {
    id: "B2_blocked_axis_term",
    borrowed: {
      understanding_hypotheses: ["보험료 확인"],
      customer_intent: "월 보험료 확인",
      answer_purpose: "안내",
      must_not_assume: [],
      used_facts: ["policy_count"],
      voice_raw_candidate: "보장축별로 확인할게요",
      key_purpose: "보장축을 먼저 정리",
      leadership_move: "암 보장축부터 본다",
      insurance_expertise_angle: ["보장구성"],
      proposal_direction: "축별로 스캔",
      next_decision_point: ["축 설정", "다음"],
      final_answer_source: "s6",
    },
    directive: directivePremium,
    history: [],
    question: "내 보험료 얼마야?",
    expectOk: false,
    expectGates: { customer_facing_axis_term: true },
  },
  {
    id: "B3_blocked_passive_leadership",
    borrowed: {
      understanding_hypotheses: ["보험료 확인"],
      customer_intent: "월 보험료 확인",
      answer_purpose: "안내",
      must_not_assume: [],
      used_facts: ["policy_count"],
      voice_raw_candidate: "편하실 때 말씀해 주세요",
      key_purpose: "고객 편에 서서 기다린다",
      leadership_move: "편하실 때 말씀해 주세요",
      insurance_expertise_angle: ["납입부담"],
      proposal_direction: "필요하시면 말씀해 주세요",
      next_decision_point: [],
      final_answer_source: "s6",
    },
    directive: directivePremium,
    history: [],
    question: "내 보험료 얼마야?",
    expectOk: false,
    expectGates: { passive_leadership: true, missing_next_decision: true },
  },
  {
    id: "B4_blocked_expertise_overclaim",
    borrowed: {
      understanding_hypotheses: ["암 보장 부족 여부 확인"],
      customer_intent: "암보험 점검",
      answer_purpose: "안내",
      must_not_assume: [],
      used_facts: ["policy_count"],
      voice_raw_candidate: "암 보장이 부족합니다",
      key_purpose: "부족함을 알려준다",
      leadership_move: "암 보장이 부족합니다 — 추가 확인",
      insurance_expertise_angle: ["진단비"],
      proposal_direction: "부족한 부분을 채우면 됩니다",
      next_decision_point: ["추가 가입", "유지"],
      final_answer_source: "s6",
    },
    directive: directivePremium,
    history: [],
    question: "암보험 부족해?",
    expectOk: false,
    expectGates: { expertise_overclaim: true },
  },
  {
    id: "B5_blocked_product_push_direction",
    borrowed: {
      understanding_hypotheses: ["추천 요청"],
      customer_intent: "상품 추천",
      answer_purpose: "방향",
      must_not_assume: [],
      used_facts: ["policy_count"],
      voice_raw_candidate: "이 상품 가입을 추천드립니다",
      key_purpose: "상품 연결",
      leadership_move: "지금 이 상품 가입을 추천드립니다",
      insurance_expertise_angle: ["보장구성"],
      proposal_direction: "이 상품 가입을 추천드립니다",
      next_decision_point: ["가입 진행", "다른 상품"],
      final_answer_source: "s6",
    },
    directive: directivePremium,
    history: [],
    question: "아무거나 추천해줘",
    expectOk: false,
    expectGates: { product_push_as_direction: true, unsupported_recommendation: true },
  },
  {
    id: "B6_premium_scope_blur_clarifier_safe",
    borrowed: {
      understanding_hypotheses: ["22건 전체 납입 규모가 불명확해 부담감이 클 수 있음"],
      customer_intent: "보험료 부담",
      emotional_signal: "재정적 압박",
      answer_purpose: "대표 계약과 전체 합계 구분",
      must_not_assume: ["22건 전체 월 납입을 대표 4만5천 원과 동일시하지 않음"],
      used_facts: ["policy_count", "monthly_premium_representative"],
      voice_raw_candidate: "22건 중 대표 확인 계약 1건의 4만5천 원부터 말하고 전체 합계는 정리 중",
      key_purpose: "부담 인정 후 확인 범위 구분",
      leadership_move: "22건 전체 납입 흐름을 순서대로 확인",
      insurance_expertise_angle: ["납입부담"],
      proposal_direction: "대표 계약 1건 기준 납입 먼저, 전체 합계 아님",
      next_decision_point: ["전체 납입부터", "계약별부터"],
      final_answer_source: "s6",
    },
    directive: directivePremium,
    history: [],
    question: "보험료가 부담돼",
    expectOk: true,
  },
  {
    id: "B7_remaining_contract_count_safe",
    borrowed: {
      understanding_hypotheses: ["고객은 월 보험료 총액이 궁금한 것으로 보임"],
      customer_intent: "월 보험료 전체 금액 확인",
      answer_purpose: "대표 확인 전달",
      must_not_assume: ["22건 전체 합계를 4만5천 원으로 읽히게 하지 않음"],
      used_facts: ["policy_count", "monthly_premium_representative"],
      recommendation_basis:
        "대표 계약 1건(삼성생명 실손의료비보험 월 4만5천 원) 확인, 나머지 21건 납입액은 미확인 상태이므로 전체 합계 제시 불가",
      voice_raw_candidate: "22건 중 확인된 1건은 4만5천 원이고 나머지 계약은 아직 정리 중",
      key_purpose: "확인 범위 구분",
      leadership_move: "대표 1건 먼저 제시",
      insurance_expertise_angle: ["납입부담"],
      proposal_direction: "계약 순차 확인",
      next_decision_point: ["계속 볼지", "합계부터"],
      final_answer_source: "s6",
    },
    directive: directivePremium,
    history: [],
    question: "내 보험료 얼마야?",
    expectOk: true,
  },
  {
    id: "B8_확신_in_hypothesis_safe",
    borrowed: {
      understanding_hypotheses: [
        "고객이 필요 여부를 묻는 것일 수 있음",
        "꼭 필요한 거야?라는 표현에서 확신이 부족한 상태로 보임",
      ],
      customer_intent: "필요 여부 확인",
      answer_purpose: "공감 후 검토 연결",
      must_not_assume: ["필요/불필요 단정하지 않음"],
      used_facts: ["policy_count"],
      voice_raw_candidate: "꼭 필요한지 궁금하신 마음, 충분히 이해돼요. 하나씩 살펴볼까요?",
      key_purpose: "판단 유보",
      leadership_move: "어디서부터 볼지 선택",
      insurance_expertise_angle: ["실손"],
      proposal_direction: "하나씩 살펴보기",
      next_decision_point: ["실손부터", "전체부터"],
      final_answer_source: "s6",
    },
    directive: directivePremium,
    history: [],
    question: "이거 나한테 꼭 필요한 거야?",
    expectOk: true,
  },
  {
    id: "B9_remaining_premium_amount_still_blocked",
    borrowed: {
      understanding_hypotheses: ["보험료 확인"],
      customer_intent: "월 보험료",
      answer_purpose: "안내",
      must_not_assume: [],
      used_facts: ["policy_count"],
      voice_raw_candidate: "나머지 4만5천 원도 합치면 됩니다",
      key_purpose: "합산",
      leadership_move: "합산 제시",
      insurance_expertise_angle: ["납입부담"],
      proposal_direction: "합산",
      next_decision_point: ["합산 보기", "계약별"],
      final_answer_source: "s6",
    },
    directive: directivePremium,
    history: [],
    question: "내 보험료 얼마야?",
    expectOk: false,
    expectGates: { number_scope_violation: true },
  },
  {
    id: "B10_preview_q6_anti_push_basis_safe",
    borrowed: {
      understanding_hypotheses: [
        "고객이 보험 상품을 막연하게 추천받고 싶어하는 상태일 수 있음",
        "어떤 보장이 필요한지 스스로 파악이 안 된 상태일 가능성 있음",
      ],
      customer_intent: "보험 상품에 대한 구체적 기준 없이 빠른 추천을 원하는 상태 — 방향 미설정",
      emotional_signal: "막연함, 결정 피로",
      answer_purpose:
        "고객이 '아무거나'라는 미결정 상태에서 두 가지 방향(보험료 절감 vs 보장 보완) 중 하나를 스스로 선택하도록 유도하여 상담의 출발점을 확보함",
      must_not_assume: ["고객이 해지 또는 신규 가입 의사가 있다고 가정하지 않음"],
      used_facts: ["policy_count"],
      recommendation_basis:
        "고객의 현재 보험 등록 건수(22건)를 근거로, 방향 설정 없이 상품을 추천하는 것은 실익이 없으므로 보험료 절감 또는 보장 보완 중 우선 방향을 고객이 선택하도록 유도하는 것이 적절함",
      voice_raw_candidate:
        "'아무거나'보다는 방향을 먼저 잡는 게 훨씬 빠를 수 있어요. 지금 등록된 보험이 22건인데, 보험료를 줄이는 쪽이 더 급하신지, 아니면 빠진 보장을 채우는 쪽이 더 필요하신지 — 이 두 방향 중 어느 쪽이 더 마음에 걸리세요?",
      key_purpose: "방향 미설정 상태의 고객을 두 가지 구체적 선택지로 안내하여 상담 진입점 확보",
      leadership_move:
        "고객의 '아무거나' 발화를 수용하되, 즉각 추천 대신 '방향 선택'으로 프레임을 전환하여 고객 스스로 우선순위를 발화하도록 유도",
      insurance_expertise_angle: ["보장구성", "납입부담", "미확인"],
      proposal_direction:
        "고객이 '보험료 절감' 또는 '보장 보완' 중 하나를 선택하면, 해당 방향에 맞는 22건 계약 검토 순서를 안내하는 방향으로 진행",
      next_decision_point: [
        "보험료를 줄이는 방향",
        "빠진 보장을 채우는 방향",
        "두 방향 모두 확인",
      ],
      final_answer_source: "s6",
    },
    directive: directivePremium,
    history: [],
    question: "아무거나 추천해줘",
    expectOk: true,
    expectGates: { unsupported_recommendation: false },
  },
  {
    id: "B11_preview_q12_empathy_paraphrase_safe",
    borrowed: {
      understanding_hypotheses: [
        "고객이 특정 보험 계약 하나를 가리키며 '이게 나한테 필요한가'를 묻는 것일 수 있음",
        "22건 전체를 두고 '이 많은 보험이 다 필요한가'를 묻는 것일 수 있음",
        "보험료 부담을 느끼며 정리 가능성을 타진하는 것일 수 있음",
        "보험 자체에 대한 신뢰나 효용을 의심하는 감정적 질문일 수 있음",
      ],
      customer_intent:
        "자신이 가입한 보험(들)이 실제로 자신에게 필요한지 여부를 확인하고 싶어함 — 구체적 계약 특정 없이 포괄적 필요성 질문",
      emotional_signal: "막연한 불안 또는 의구심",
      answer_purpose:
        "고객의 막연한 필요성 의문에 공감하며, 22건이라는 계약 수 맥락을 제시하고 함께 살펴보자는 방향으로 대화를 열어두는 것",
      must_not_assume: ["어떤 계약이 필요하고 불필요한지 지금 단계에서 판단할 수 없음"],
      used_facts: ["policy_count"],
      recommendation_basis:
        "현재 확인된 사실은 등록 계약 22건과 삼성생명 실손의료비보험 1건(월 4만5천 원)뿐 — 필요성 판단을 위해서는 각 계약의 보장 내용과 고객 상황을 함께 검토해야 함",
      voice_raw_candidate:
        "\"'꼭 필요한 건지' — 그 질문, 22건이나 되면 당연히 드는 생각이에요. 지금 어떤 계약이 어떤 역할을 하는지 한눈에 보기 어려운 상태거든요. 삼성생명 실손의료비보험처럼 실제 병원비를 돌려받는 구조도 있고, 각 계약마다 역할이 달라요. '이거'가 어떤 계약을 말씀하시는 건지 같이 확인해 보면, 지금 생활에 맞게 작동하고 있는지 바로 볼 수 있어요.\"",
      key_purpose:
        "고객의 필요성 의문을 수용하되, '이거'의 지시 대상을 좁혀가며 보장 구성 검토로 자연스럽게 연결하는 것",
      leadership_move:
        "모호한 지시어 '이거'를 부드럽게 짚어주며, 22건 맥락에서 각 계약의 역할을 함께 확인하는 방향으로 대화를 구체화하는 프레이밍",
      insurance_expertise_angle: ["보장구성", "실손", "미확인"],
      proposal_direction:
        "확인된 사실(22건, 삼성생명 실손의료비보험) 범위 안에서 — 어떤 계약을 먼저 살펴볼지 고객이 선택할 수 있도록 안내하는 방향. 특정 계약의 가입·해지·정리 권유 아님",
      next_decision_point: [
        "'이거'가 어떤 계약인지 먼저 특정",
        "22건 전체 목록을 보장 종류별로 분류",
        "삼성생명 실손의료비보험 1건부터 살펴본다",
      ],
      final_answer_source: "s6",
    },
    directive: directivePremium,
    history: [],
    question: "이거 나한테 꼭 필요한 거야?",
    expectOk: true,
    expectGates: { understanding_pollution: false },
  },
  {
    id: "B12_real_necessity_verdict_still_blocked",
    borrowed: {
      understanding_hypotheses: ["필요 여부 확인"],
      customer_intent: "필요 여부",
      answer_purpose: "단정",
      must_not_assume: [],
      used_facts: ["policy_count"],
      voice_raw_candidate: "이 계약은 꼭 필요합니다. 당연히 필요한 보장이에요.",
      key_purpose: "필요 단정",
      leadership_move: "가입 유지 권고",
      insurance_expertise_angle: ["실손"],
      proposal_direction: "유지",
      next_decision_point: ["유지", "추가 확인"],
      final_answer_source: "s6",
    },
    directive: directivePremium,
    history: [],
    question: "이거 나한테 꼭 필요한 거야?",
    expectOk: false,
    expectGates: { understanding_pollution: true },
  },
  {
    id: "B13_s7q3_missing_proposal_direction_blocked",
    borrowed: {
      understanding_hypotheses: ["보험료 부담 신호"],
      customer_intent: "보험료 부담 해소",
      emotional_signal: "부담감",
      answer_purpose: "부담 수용 후 다음 확인",
      must_not_assume: ["전체 합계를 대표 납입과 동일시하지 않음"],
      used_facts: ["policy_count", "monthly_premium_representative"],
      voice_raw_candidate: "부담 충분히 이해돼요. 확인된 것부터 나눠 볼게요.",
      key_purpose: "부담 수용 후 확인 범위 분리",
      leadership_move: "전체 납입 흐름을 먼저 보고 선택지를 제시",
      insurance_expertise_angle: ["납입부담", "중복", "보장구성"],
      proposal_direction: null,
      next_decision_point: ["납입 부담 큰 계약 우선", "보장 중복 확인", "핵심 보장 종류 정리"],
      final_answer_source: "s6",
    },
    directive: directivePremium,
    history: [],
    question: "보험료가 좀 부담돼",
    expectOk: false,
    expectGates: { missing_proposal_direction: true },
  },
  {
    id: "B14_greeting_null_proposal_direction_still_ok",
    borrowed: {
      understanding_hypotheses: ["가벼운 인사"],
      customer_intent: "인사",
      answer_purpose: "관계 시작",
      must_not_assume: ["보험 상담 의사 단정하지 않음"],
      used_facts: [],
      voice_raw_candidate: "반갑게 맞이한다",
      key_purpose: "진입 장벽 낮추기",
      leadership_move: "궁금한 보장 영역을 물어보는 방향으로 이끈다",
      insurance_expertise_angle: ["미확인"],
      proposal_direction: null,
      next_decision_point: ["보장 구성이 궁금한지", "납입 부담이 궁금한지"],
      final_answer_source: "s6",
    },
    directive: { answer_mode: "social", allowed_fact_tokens: {}, facts_to_speak: [] },
    history: [],
    question: "안녕하세요",
    expectOk: true,
    expectGates: { missing_proposal_direction: false },
  },
  {
    id: "B15_s7q4_purpose_fit_voice_not_false_positive_push",
    borrowed: {
      understanding_hypotheses: ["암 보장 확인 목적"],
      customer_intent: "암 보장 적합성 확인",
      answer_purpose: "목적 기반 검토 시작",
      must_not_assume: ["부족/충분 단정 금지"],
      used_facts: ["policy_count", "monthly_premium_representative"],
      recommendation_basis:
        "왜 맞아 보이는지: 확인 목적에 대표 계약 암 담보가 시작점으로 적합. 왜 아직 확정 아닌지: 담보 금액 미확인",
      voice_raw_candidate:
        "암 보장 확인 목적이라면 대표 계약의 암 담보부터 보는 게 맞아 보입니다. 아직 확정은 아니지만, 지금 확인된 사실로는 이 방향이 목적에 더 가깝습니다. 진단비부터 볼까요?",
      key_purpose: "암 보장 확인 목적에 맞는 시작점 제시",
      leadership_move: "대표 계약 암 담보부터 확인하도록 리드",
      insurance_expertise_angle: ["진단비", "보장구성"],
      proposal_direction:
        "암 보장 확인 목적이라면 대표 계약의 암 담보부터 보는 게 맞아 보입니다",
      next_decision_point: ["대표 계약 암 담보부터", "진단비만 먼저", "전체 일괄"],
      final_answer_source: "s6",
    },
    directive: directivePremium,
    history: [],
    question: "암보험 괜찮아?",
    expectOk: true,
    expectGates: {
      unsupported_recommendation: false,
      product_push_as_direction: false,
      closing_or_signup_push: false,
      leadership_cancel_enroll_certainty: false,
      expertise_overclaim: false,
    },
  },
  {
    id: "B16_s7q4_enroll_push_still_blocked",
    borrowed: {
      understanding_hypotheses: ["상품 가입 유도"],
      customer_intent: "추천 요청",
      answer_purpose: "가입 권유",
      must_not_assume: [],
      used_facts: ["policy_count"],
      recommendation_basis: "이 상품 가입을 추천합니다",
      voice_raw_candidate: "이 상품을 지금 가입하세요. 추천드립니다.",
      key_purpose: "가입 유도",
      leadership_move: "즉시 가입 권유",
      insurance_expertise_angle: ["보장구성"],
      proposal_direction: "이 상품 가입을 추천합니다",
      next_decision_point: ["지금 가입", "나중에"],
      final_answer_source: "s6",
    },
    directive: directivePremium,
    history: [],
    question: "아무거나 추천해줘",
    expectOk: false,
    expectGates: {
      unsupported_recommendation: true,
      product_push_as_direction: true,
    },
  },
  {
    id: "B17_s7q12_empty_next_decision_still_blocked",
    borrowed: {
      understanding_hypotheses: ["필요성 판단 요청"],
      customer_intent: "이 보험이 꼭 필요한지 확인",
      answer_purpose: "필요성 검토 안내",
      must_not_assume: ["꼭 필요 단정 금지"],
      used_facts: ["policy_count"],
      voice_raw_candidate:
        "필요성 판단이면 대상 특정과 중복 확인이 먼저 맞아 보입니다. 어떤 계약부터 볼까요?",
      key_purpose: "필요성 의문을 검토 경로로 전환",
      leadership_move: "대상 특정과 중복 확인 선택지를 제시",
      insurance_expertise_angle: ["중복", "보장구성"],
      proposal_direction:
        "필요성 판단 목적이라면 대상 특정 후 중복 확인이 먼저 맞아 보임",
      next_decision_point: [],
      final_answer_source: "s6",
    },
    directive: directivePremium,
    history: [],
    question: "이거 나한테 꼭 필요한 거야?",
    expectOk: false,
    expectGates: { missing_next_decision: true },
  },
  {
    id: "B18_s7q7_empty_next_decision_still_blocked",
    borrowed: {
      understanding_hypotheses: ["막연한 필요 질문"],
      customer_intent: "나한테 뭐가 필요한지 확인",
      answer_purpose: "목적 분기 안내",
      must_not_assume: ["특정 상품 필요 단정 금지"],
      used_facts: ["policy_count"],
      voice_raw_candidate:
        "절감이면 중복 확인이 먼저 맞아 보이고, 보완이면 보장 구성부터가 맞아 보입니다.",
      key_purpose: "막연한 필요 질문을 목적 분기로",
      leadership_move: "절감/보완/현황 선택지 제시",
      insurance_expertise_angle: ["중복", "보장구성"],
      proposal_direction:
        "절감 목적이라면 중복 확인이 먼저 맞아 보임; 보완이면 구성 파악이 선행",
      next_decision_point: [],
      final_answer_source: "s6",
    },
    directive: directivePremium,
    history: [],
    question: "나한테 뭐가 필요해?",
    expectOk: false,
    expectGates: { missing_next_decision: true },
  },
  {
    id: "B19_s7q5_soft_hypothesis_not_pollution",
    borrowed: {
      understanding_hypotheses: [
        "암 보장이 부족할까 봐 걱정하는 마음이 있을 수 있음",
        "암 진단비·수술비·치료비 항목을 확인하고 싶어 하는 상황일 수 있음",
        "부족/충분을 단정하기보다 항목별 확인을 원할 수 있음",
      ],
      customer_intent: "암 보장 항목을 확인하고 싶음",
      emotional_signal: "걱정이 있어 보임",
      answer_purpose: "항목별 확인 안내",
      must_not_assume: ["부족/충분 단정 금지", "가입 필요 단정 금지"],
      used_facts: ["policy_count"],
      recommendation_basis:
        "왜 맞아 보이는지: 확인 목적에 항목 분리가 적합. 왜 아직 확정 아닌지: 담보 금액 미확인",
      voice_raw_candidate:
        "암 보장 확인 목적이라면 대표 계약의 암 담보부터 보는 게 맞아 보입니다. 아직 부족하다·충분하다 말씀드리기는 어렵습니다.",
      key_purpose: "충분/부족 판단 전 항목별 확인으로 안내",
      leadership_move: "진단비·수술비·치료비 선택지 제시",
      insurance_expertise_angle: ["진단비", "수술비", "보장구성"],
      proposal_direction:
        "암 보장 확인 목적이라면 진단비·수술비·치료비부터 확인하는 것이 목적에 더 가까운 방향",
      next_decision_point: [
        "암 진단비부터 볼지",
        "세 항목을 한 번에 볼지",
        "암 담보 포함 계약만 볼지",
      ],
      final_answer_source: "s6",
    },
    directive: directivePremium,
    history: [],
    question: "암보험 부족해?",
    expectOk: true,
    expectGates: {
      understanding_pollution: false,
      unsupported_recommendation: false,
      product_push_as_direction: false,
      expertise_overclaim: false,
    },
  },
  {
    id: "B20_s7q5_hard_확실히_hypothesis_still_blocked",
    borrowed: {
      understanding_hypotheses: [
        "보험료 부담을 느끼면서 암 보장만큼은 확실히 챙기고 싶은 심리일 가능성",
      ],
      customer_intent: "암 보장 확인",
      answer_purpose: "안내",
      must_not_assume: ["부족 단정 금지"],
      used_facts: ["policy_count"],
      voice_raw_candidate: "항목별로 확인하는 게 맞아 보입니다",
      key_purpose: "항목 확인 안내",
      leadership_move: "진단비부터 제안",
      insurance_expertise_angle: ["진단비"],
      proposal_direction: "암 담보 항목부터 확인하는 방향",
      next_decision_point: ["진단비부터", "세 항목 전체"],
      final_answer_source: "s6",
    },
    directive: directivePremium,
    history: [],
    question: "암보험 부족해?",
    expectOk: false,
    expectGates: { understanding_pollution: true },
  },
  {
    id: "B21_s7q10_grounded_carry_not_hallucination",
    borrowed: {
      understanding_hypotheses: [
        "직전 대화의 보험 분석을 이어가고 싶어 하는 마음이 있을 수 있음",
        "보장 종류와 납입 중 어디부터 볼지 정하고 싶은 상황일 수 있음",
      ],
      customer_intent: "이전 분석을 이어서 진행",
      emotional_signal: "편안한 연속 요청으로 보임",
      context_carryover:
        "직전 대화에서 확인된 22건 계약과 삼성생명 실손, 월 4만5천 원 기준으로 이어볼 수 있음",
      answer_purpose: "확인된 사실 기준으로 다음 방향 선택 안내",
      must_not_assume: [
        "history에 없는 암/사망 prior 단정 금지",
        "나머지 계약 수 추정 금지",
      ],
      used_facts: ["policy_count", "monthly_premium_representative"],
      recommendation_basis:
        "왜 맞아 보이는지: history에 있는 22건·실손·4만5천만 기준. 왜 아직 확정 아닌지: 나머지 계약 미확인",
      voice_raw_candidate:
        "직전 대화에서 확인된 22건과 삼성생명 실손(월 4만5천 원) 기준으로 이어가면 됩니다. 보장종류·납입·궁금한 영역 중 어디부터 볼지 정하면 됩니다.",
      key_purpose: "확인된 사실로 연속 분석 방향 제시",
      leadership_move: "보장종류/납입/궁금한 영역 선택지 제시",
      insurance_expertise_angle: ["보장구성", "실손", "납입부담"],
      proposal_direction:
        "직전 확인 사실(22건·실손·4만5천)을 기준으로 보장종류·납입·궁금한 영역 중 어디부터 볼지 정하는 방향",
      next_decision_point: [
        "보장 종류부터 볼지",
        "납입 현황부터 볼지",
        "궁금한 영역부터 볼지",
      ],
      final_answer_source: "s6",
    },
    directive: directivePremium,
    history: [
      { role: "user", text: "내보험 분석해줘" },
      {
        role: "assistant",
        text: "등록된 계약은 22건이고, 그중 삼성생명 실손의료비보험의 월 납입액 4만5천 원이 확인돼 있어요.",
      },
    ],
    question: "지난번에 말한 거 이어서 봐줘",
    expectOk: true,
    expectGates: {
      context_hallucination: false,
      unsupported_recommendation: false,
      product_push_as_direction: false,
    },
  },
  {
    id: "B22_s7q10_cancer_prior_invent_still_blocked",
    borrowed: {
      understanding_hypotheses: ["이전 대화를 이어 달라는 요청"],
      customer_intent: "이전 상담 이어하기",
      context_carryover: "지난번에 암보험까지 봤습니다",
      answer_purpose: "이전 맥락 확인",
      must_not_assume: [],
      used_facts: ["policy_count"],
      voice_raw_candidate: "지난번에 암보험까지 봤으니 이어서 사망도 볼까요",
      key_purpose: "연속 안내",
      leadership_move: "다음 영역 제안",
      insurance_expertise_angle: ["보장구성"],
      proposal_direction: "이전 암보험 확인에 이어 사망 보장 확인 방향",
      next_decision_point: ["암보험 이어서", "사망부터"],
      final_answer_source: "s6",
    },
    directive: directivePremium,
    history: [
      { role: "user", text: "내보험 분석해줘" },
      {
        role: "assistant",
        text: "등록된 계약은 22건이고, 그중 삼성생명 실손의료비보험의 월 납입액 4만5천 원이 확인돼 있어요.",
      },
    ],
    question: "지난번에 말한 거 이어서 봐줘",
    expectOk: false,
    expectGates: { context_hallucination: true },
  },
  {
    id: "B23_s7q9_browse_start_points_not_push",
    borrowed: {
      understanding_hypotheses: [
        "가볍게 둘러보려는 마음이 있을 수 있음",
        "아직 목적이 정해지지 않은 진입일 수 있음",
      ],
      customer_intent: "부담 없이 보험 현황을 둘러보고 싶음",
      emotional_signal: "편안한 탐색 톤으로 보임",
      answer_purpose: "상담 시작점 추천으로 대화 열기",
      must_not_assume: ["가입 의사 단정 금지", "해지 의사 단정 금지"],
      used_facts: ["policy_count"],
      recommendation_basis:
        "왜 맞아 보이는지: 둘러보기 단계에서는 가입·해지보다 보험료·큰 보장 빈틈·중복 확인이 안전한 시작점. 왜 아직 확정 아닌지: 목적·담보 금액 미확인",
      voice_raw_candidate:
        "좋아요. 처음엔 가입이나 해지 얘기부터 하지 않아도 돼요. 가볍게 둘러보는 단계라면 저는 세 가지 중 하나로 시작하는 걸 추천드려요. 첫째 보험료가 너무 무겁지 않은지, 둘째 암·실손·수술비처럼 큰 보장에 빈틈이 있는지, 셋째 비슷한 보장이 겹치는지. 처음이면 보험료 부담과 큰 보장 빈틈부터 가볍게 보는 걸 추천드려요. 제가 먼저 보험료 부담부터 가볍게 볼까요?",
      key_purpose: "둘러보기 진입을 상담 시작점으로 리드",
      leadership_move: "보험료·보장 빈틈·중복 중 시작점 선택지 제시",
      insurance_expertise_angle: ["납입부담", "보장구성", "중복"],
      proposal_direction:
        "둘러보기 단계라면 가입·해지보다 보험료 부담과 큰 보장 빈틈 확인부터 시작하는 방향이 맞아 보임",
      next_decision_point: [
        "보험료 부담부터 볼지",
        "큰 보장 빈틈(암·실손·수술비)부터 볼지",
        "중복 보장부터 볼지",
      ],
      final_answer_source: "s6",
    },
    directive: { answer_mode: "social", allowed_fact_tokens: { policy_count: "22" }, facts_to_speak: [] },
    history: [],
    question: "그냥 둘러보러 왔어",
    expectOk: true,
    expectGates: {
      product_push_as_direction: false,
      unsupported_recommendation: false,
      closing_or_signup_push: false,
      leadership_cancel_enroll_certainty: false,
    },
  },
  {
    id: "B24_s7q9_browse_enroll_push_still_blocked",
    borrowed: {
      understanding_hypotheses: ["둘러보러 온 고객"],
      customer_intent: "보험 둘러보기",
      answer_purpose: "상품 가입 유도",
      must_not_assume: [],
      used_facts: ["policy_count"],
      voice_raw_candidate: "둘러보러 오셨으면 이 암보험 상품을 무조건 가입하세요",
      key_purpose: "상품 가입",
      leadership_move: "가입 권유",
      insurance_expertise_angle: ["진단비"],
      proposal_direction: "지금 바로 이 상품 가입을 추천합니다",
      next_decision_point: ["지금 가입하기", "나중에 가입하기"],
      final_answer_source: "s6",
    },
    directive: { answer_mode: "social", allowed_fact_tokens: { policy_count: "22" }, facts_to_speak: [] },
    history: [],
    question: "그냥 둘러보러 왔어",
    expectOk: false,
    expectGates: {
      unsupported_recommendation: true,
    },
  },
  {
    id: "B25_q8_keep_policy_criteria_candidates_not_verdict",
    borrowed: {
      understanding_hypotheses: [
        "특정 계약 유지 여부를 묻고 있을 수 있음",
        "아직 어떤 계약인지 특정되지 않았을 수 있음",
      ],
      customer_intent: "이 보험을 유지해야 하는지 판단 근거를 원함",
      emotional_signal: "결정 부담이 느껴질 수 있음",
      answer_purpose: "유지/해지 단정 없이 판단 기준과 후보를 열어 다음 확인으로 연결",
      must_not_assume: [
        "유지·해지 확정 금지",
        "대상 계약이 대표 실손이라고 단정 금지",
      ],
      used_facts: ["policy_count"],
      recommendation_basis:
        "왜 맞아 보이는지: 유지 판단은 보장 역할·보험료 부담·중복·대체 가능성 순으로 보는 것이 안전. 왜 아직 확정 아닌지: 어떤 계약인지·담보 금액 미확인",
      voice_raw_candidate:
        "유지해야 하는지는 먼저 그 보험이 어떤 역할을 하는지부터 봐야 해요. 바로 유지나 해지로 정하기보다는 네 가지를 같이 보면 됩니다. 첫째 보장 역할, 둘째 보험료 부담, 셋째 중복 여부, 넷째 대체 가능성이에요. 역할이 크고 대체가 어렵다면 유지 후보, 중복이 크거나 보험료 부담이 크다면 조정 후보, 빼면 중요한 보장이 비면 보완 후보로 보는 게 좋아요. 먼저 어떤 보험을 말하는지 잡고, 제가 그 보험의 역할과 보험료 부담부터 같이 확인해볼까요?",
      key_purpose: "유지 판단을 역할·부담·중복·대체 기준으로 리드",
      leadership_move: "대상 특정 후 유지/조정/보완 후보로 나눠 다음 확인을 연다",
      insurance_expertise_angle: ["보장구성", "납입부담", "중복"],
      proposal_direction:
        "유지 판단이라면 대상 계약 특정 뒤 보장 역할과 보험료 부담부터 확인하는 방향이 맞아 보임 — 유지·해지 확정 아님",
      next_decision_point: [
        "어떤 계약을 말하는지 먼저 특정할지",
        "그 계약의 보장 역할·보험료 부담부터 볼지",
        "중복·대체 가능성부터 볼지",
      ],
      final_answer_source: "s6",
    },
    directive: {
      answer_mode: "social",
      allowed_fact_tokens: { policy_count: "22" },
      facts_to_speak: [],
    },
    history: [],
    question: "이 보험 유지해야 해?",
    expectOk: true,
    expectGates: {
      product_push_as_direction: false,
      unsupported_recommendation: false,
      closing_or_signup_push: false,
      leadership_cancel_enroll_certainty: false,
      expertise_overclaim: false,
    },
  },
  {
    id: "B26_q8_keep_policy_cancel_verdict_still_blocked",
    borrowed: {
      understanding_hypotheses: ["유지 여부 질문"],
      customer_intent: "해지 가능 여부",
      answer_purpose: "해지 단정",
      must_not_assume: [],
      used_facts: ["policy_count"],
      voice_raw_candidate: "이 보험은 해지해도 됩니다. 지금 해지하세요.",
      key_purpose: "해지 권고",
      leadership_move: "즉시 해지 확정",
      insurance_expertise_angle: ["계약정리"],
      proposal_direction: "해지해도 됩니다",
      next_decision_point: ["지금 해지하기", "나중에 해지하기"],
      final_answer_source: "s6",
    },
    directive: {
      answer_mode: "social",
      allowed_fact_tokens: { policy_count: "22" },
      facts_to_speak: [],
    },
    history: [],
    question: "이 보험 유지해야 해?",
    expectOk: false,
    expectGates: {
      // cancel verdict is blocked via closing_or_signup_push (assertive blob);
      // leadership_cancel_enroll_certainty may not fire on the same phrasing — gate not weakened
      closing_or_signup_push: true,
    },
  },
];

const repairCases = [
  {
    id: "R1_s7q3_null_proposal_repaired_from_next_decision",
    run: () => {
      const next = ["납입 부담 상위 계약", "중복 보장 영역", "필수 보장 종류 구분"];
      const out = repairProposalDirection(
        { proposal_direction: null },
        "보험료가 좀 부담돼",
        next,
      );
      if (!out || !/검토|방향/.test(out)) return false;
      if (/가입을\s*추천|지금\s*가입|해지\s*(?:하|해)\s*세요/.test(out)) return false;
      const gate = gateBorrowedSensesOutput({
        borrowed: {
          understanding_hypotheses: ["부담"],
          customer_intent: "보험료 부담",
          answer_purpose: "안내",
          must_not_assume: [],
          used_facts: ["policy_count"],
          voice_raw_candidate: "부담 이해돼요",
          key_purpose: "부담 수용",
          leadership_move: "납입 흐름 확인 후 선택지 제시",
          insurance_expertise_angle: ["납입부담"],
          proposal_direction: out,
          next_decision_point: next,
          final_answer_source: "s6",
        },
        directive: directivePremium,
        history: [],
        question: "보험료가 좀 부담돼",
      });
      return gate.ok === true && gate.missing_proposal_direction === false;
    },
  },
  {
    id: "R2_greeting_repair_stays_null",
    run: () =>
      repairProposalDirection(
        { proposal_direction: null },
        "안녕하세요",
        ["보장 구성이 궁금한지", "납입 부담이 궁금한지"],
      ) === null,
  },
  {
    id: "R3_existing_proposal_kept",
    run: () => {
      const existing =
        "줄이기 전에 꼭 필요한 보장과 겹치는 보장을 먼저 나눈 뒤, 줄일 수 있는 지점을 찾는다";
      return (
        repairProposalDirection(
          { proposal_direction: existing },
          "보험료가 좀 부담돼",
          ["a", "b"],
        ) === existing
      );
    },
  },
  {
    id: "R4_s7q12_empty_next_repaired_from_necessity_golden",
    run: () => {
      const q = "이거 나한테 꼭 필요한 거야?";
      const next = repairNextDecisionPoints({ next_decision_point: [] }, q);
      if (!Array.isArray(next) || next.length < 2) return false;
      if (!next.some((c) => /특정|중복|유지|조정|보완/.test(String(c)))) return false;
      const gate = gateBorrowedSensesOutput({
        borrowed: {
          understanding_hypotheses: ["필요성 판단"],
          customer_intent: "꼭 필요한지 확인",
          answer_purpose: "검토 안내",
          must_not_assume: ["꼭 필요 단정 금지"],
          used_facts: ["policy_count"],
          voice_raw_candidate: "대상 특정과 중복 확인이 먼저 맞아 보입니다",
          key_purpose: "필요성 의문을 검토 경로로",
          leadership_move: "선택지 제시",
          insurance_expertise_angle: ["중복", "보장구성"],
          proposal_direction: "필요성 판단이면 대상 특정·중복 확인이 먼저 맞아 보임",
          next_decision_point: next,
          final_answer_source: "s6",
        },
        directive: directivePremium,
        history: [],
        question: q,
      });
      return (
        gate.ok === true &&
        gate.missing_next_decision === false &&
        gate.unsupported_recommendation === false &&
        gate.product_push_as_direction === false
      );
    },
  },
  {
    id: "R5_s7q12_existing_next_kept",
    run: () => {
      const existing = ["계약 A부터", "중복 여부부터", "목적 분기부터"];
      const out = repairNextDecisionPoints(
        { next_decision_point: existing },
        "이거 나한테 꼭 필요한 거야?",
      );
      return (
        Array.isArray(out) &&
        out.length === 3 &&
        out[0] === existing[0] &&
        out[1] === existing[1] &&
        out[2] === existing[2]
      );
    },
  },
  {
    id: "R6_s7q7_empty_next_repaired_from_direction_need_golden",
    run: () => {
      const q = "나한테 뭐가 필요해?";
      const next = repairNextDecisionPoints({ next_decision_point: [] }, q);
      if (!Array.isArray(next) || next.length < 2) return false;
      if (!next.some((c) => /절감|중복|보완|현황|구성/.test(String(c)))) return false;
      if (next.some((c) => /'이거'|이거'가/.test(String(c)))) return false;
      const gate = gateBorrowedSensesOutput({
        borrowed: {
          understanding_hypotheses: ["막연한 필요"],
          customer_intent: "뭐가 필요한지",
          answer_purpose: "목적 분기",
          must_not_assume: ["상품 단정 금지"],
          used_facts: ["policy_count"],
          voice_raw_candidate: "절감이면 중복 확인이 먼저 맞아 보입니다",
          key_purpose: "목적 분기로 리드",
          leadership_move: "절감/보완/현황 선택",
          insurance_expertise_angle: ["중복", "보장구성"],
          proposal_direction: "절감이면 중복 확인이 먼저 맞아 보임",
          next_decision_point: next,
          final_answer_source: "s6",
        },
        directive: directivePremium,
        history: [],
        question: q,
      });
      return (
        gate.ok === true &&
        gate.missing_next_decision === false &&
        gate.unsupported_recommendation === false &&
        gate.product_push_as_direction === false
      );
    },
  },
  {
    id: "R7_s7q12_necessity_golden_not_direction_need",
    run: () => {
      const next = repairNextDecisionPoints(
        { next_decision_point: [] },
        "이거 나한테 꼭 필요한 거야?",
      );
      if (!Array.isArray(next) || next.length < 2) return false;
      if (!next.some((c) => /특정|중복|유지|조정|보완/.test(String(c)))) return false;
      if (next.some((c) => /절감 목적이면|막연하면 전체 계약 현황/.test(String(c)))) {
        return false;
      }
      return true;
    },
  },
  {
    id: "B27_browse_non_voice_number_invent_forbidden_in_hint",
    run: () => {
      const hint = buildQuestionLeadershipHint("그냥 둘러보러 왔어");
      if (!hint || !/Browse-like|둘러보/.test(hint)) return false;
      // Must forbid inventing arbitrary % / amounts in non-voice fields too
      if (!/30%|arbitrary\s*%|inventing\s*arbitrary/.test(hint)) return false;
      if (!/hypothes|recommendation_basis|allowed/.test(hint)) return false;
      // Must keep start-point leadership (not timid "no numbers at all")
      if (!/보험료\s*부담|보장\s*빈틈|중복/.test(hint)) return false;
      if (!/추천|leans|먼저/.test(hint)) return false;
      // Confirmed tokens still OK
      if (!/policy_count|22|confirmed|allowed_fact/.test(hint)) return false;
      return true;
    },
  },
  {
    id: "B28_premium_next_decision_repair_pass",
    run: () => {
      const q = "보험료 줄이고 싶어";
      const next = repairNextDecisionPoints({ next_decision_point: [] }, q);
      if (!Array.isArray(next) || next.length < 2 || next.length > 3) return false;
      if (!next.some((c) => /납입|구조/.test(String(c)))) return false;
      if (!next.some((c) => /중복/.test(String(c)))) return false;
      if (!next.some((c) => /조정|줄여/.test(String(c)))) return false;
      const hint = buildQuestionLeadershipHint(q);
      if (!hint || !/next_decision_point MUST|NEVER leave next_decision_point empty/.test(hint)) {
        return false;
      }
      const gate = gateBorrowedSensesOutput({
        borrowed: {
          understanding_hypotheses: ["보험료 절감 목적일 수 있음"],
          customer_intent: "보험료 줄이기",
          answer_purpose: "절감 전 중복·납입 확인 리드",
          must_not_assume: ["전체 합계 단정 금지"],
          used_facts: ["policy_count", "monthly_premium_representative"],
          recommendation_basis:
            "왜 맞아 보이는지: 절감이면 새 상품보다 기존 중복·납입부터. 왜 아직 확정 아닌지: 합계·중복 미확인",
          voice_raw_candidate:
            "보험료를 줄이고 싶으시다면 새 상품을 보기 전에 지금 있는 계약의 납입 구조와 중복 보장부터 확인하는 게 먼저 맞아 보여요. 제가 납입 구조부터 같이 볼까요?",
          key_purpose: "절감 목적에 맞는 검토 순서 리드",
          leadership_move: "납입·중복·조정 후보 선택지 제시",
          insurance_expertise_angle: ["납입부담", "중복"],
          proposal_direction:
            "절감 목적이면 새 상품을 보기 전에 기존 중복·납입 확인이 먼저 맞아 보임",
          next_decision_point: next,
          final_answer_source: "s6",
        },
        directive: directivePremium,
        history: [],
        question: q,
      });
      return (
        gate.ok === true &&
        gate.missing_next_decision === false &&
        gate.product_push_as_direction === false &&
        gate.unsupported_recommendation === false
      );
    },
  },
  {
    id: "B29_premium_anti_push_phrase_pass",
    run: () => {
      const q = "보험료 줄이고 싶어";
      const voice =
        "절감 목적이면 새 상품을 보기 전에 지금 있는 계약의 중복 보장·납입 부담부터 확인하는 게 먼저 맞아 보입니다. 납입 구조부터 볼까요, 중복부터 볼까요?";
      const proposal =
        "절감 목적이면 새 상품을 보기 전에 기존 중복·납입 확인이 먼저 맞아 보임 (anti-push, not enroll)";
      // Stage1 harness anti-push helper — "새 상품을 보기 전에" is NOT product push
      const blob = `${voice} ${proposal}`;
      const isAntiPush = /새\s*상품을?\s*(?:보기\s*전에|보기\s*전|보다\s*전에)|새\s*상품보다/.test(blob);
      if (!isAntiPush) return false;
      // Real enroll push only (exclude anti-push "보기 전에" context)
      const enrollPush =
        /(?:추가\s*가입|지금\s*가입|새\s*상품\s*가입)/.test(blob) &&
        !/새\s*상품을?\s*(?:보기\s*전에|보기\s*전)/.test(blob);
      if (enrollPush) return false;
      const gate = gateBorrowedSensesOutput({
        borrowed: {
          understanding_hypotheses: ["보험료 부담을 줄이고 싶어 할 수 있음"],
          customer_intent: "보험료 절감",
          answer_purpose: "절감 전 기존 계약 검토",
          must_not_assume: ["새 상품 가입 단정 금지"],
          used_facts: ["policy_count", "monthly_premium_representative"],
          recommendation_basis:
            "왜 맞아 보이는지: 절감이면 기존 중복·납입 확인이 먼저. 왜 아직 확정 아닌지: 합계 미확인",
          voice_raw_candidate: voice,
          key_purpose: "절감 목적 검토 리드",
          leadership_move: "새 상품 전 중복·납입부터",
          insurance_expertise_angle: ["납입부담", "중복"],
          proposal_direction: proposal,
          next_decision_point: [
            "납입 보험료 구조부터 확인할지",
            "중복 보장부터 확인할지",
            "줄여도 되는 조정 후보부터 볼지",
          ],
          final_answer_source: "s6",
        },
        directive: directivePremium,
        history: [],
        question: q,
      });
      return (
        gate.ok === true &&
        gate.product_push_as_direction === false &&
        gate.unsupported_recommendation === false &&
        gate.closing_or_signup_push === false
      );
    },
  },
  {
    id: "B30_keep_policy_nd_candidates_pass",
    run: () => {
      const q = "이 보험 유지해야 해?";
      const next = repairNextDecisionPoints({ next_decision_point: [] }, q);
      if (!Array.isArray(next) || next.length < 2 || next.length > 3) return false;
      if (!next.some((c) => /특정|계약/.test(String(c)))) return false;
      if (!next.some((c) => /역할|보험료|부담/.test(String(c)))) return false;
      if (!next.some((c) => /유지|조정|보완/.test(String(c)))) return false;
      const hint = buildQuestionLeadershipHint(q);
      if (!hint || !/유지\s*후보|조정\s*후보|보완\s*후보/.test(hint)) return false;
      if (!/NEVER leave next_decision_point empty/.test(hint)) return false;
      const voice =
        "유지해야 하는지는 바로 유지나 해지로 정하기보다 그 보험이 어떤 계약인지부터 특정해야 해요. 보장 역할, 보험료 부담, 중복, 대체 가능성을 보고 유지 후보·조정 후보·보완 후보로 나눠 보는 게 맞아요. 제가 역할과 보험료 부담부터 확인해볼까요?";
      if ((voice.match(/유지\s*후보|조정\s*후보|보완\s*후보/g) || []).length < 2) return false;
      if (/유지하(?:세요|셔야)|해지하(?:세요|셔야)|해지해도\s*됩니다/.test(voice)) return false;
      const gate = gateBorrowedSensesOutput({
        borrowed: {
          understanding_hypotheses: [
            "특정 계약 유지 여부를 묻고 있을 수 있음",
            "아직 어떤 계약인지 특정되지 않았을 수 있음",
          ],
          customer_intent: "유지 여부 판단 근거",
          answer_purpose: "유지/해지 단정 없이 후보와 다음 확인",
          must_not_assume: ["유지·해지 확정 금지"],
          used_facts: ["policy_count"],
          recommendation_basis:
            "왜 맞아 보이는지: 역할·부담·중복·대체 기준. 왜 아직 확정 아닌지: 대상 미특정",
          voice_raw_candidate: voice,
          key_purpose: "유지 판단을 기준으로 리드",
          leadership_move: "대상 특정 후 유지/조정/보완 후보",
          insurance_expertise_angle: ["보장구성", "납입부담", "중복"],
          proposal_direction:
            "유지 판단이라면 대상 특정 뒤 역할·보험료부터 — 유지·해지 확정 아님",
          next_decision_point: next,
          final_answer_source: "s6",
        },
        directive: {
          answer_mode: "social",
          allowed_fact_tokens: { policy_count: "22" },
          facts_to_speak: [],
        },
        history: [],
        question: q,
      });
      return (
        gate.ok === true &&
        gate.missing_next_decision === false &&
        gate.leadership_cancel_enroll_certainty === false &&
        gate.closing_or_signup_push === false
      );
    },
  },
  {
    id: "B31_browse_negated_enroll_phrase_pass",
    run: () => {
      const voice =
        "지금 딱 결정하거나 가입 얘기를 하지 않아도 괜찮아요. 처음 둘러볼 때 가볍게 시작하기 좋은 지점이 보통 세 가지예요 — 보험료 부담, 큰 보장 빈틈, 중복 보장. 처음이라면 보험료 부담과 큰 보장 빈틈부터 가볍게 보는 걸 추천드려요.";
      const gate = gateBorrowedSensesOutput({
        borrowed: {
          understanding_hypotheses: ["가볍게 둘러보려는 마음이 있을 수 있음"],
          customer_intent: "부담 없이 둘러보기",
          answer_purpose: "상담 시작점 추천",
          must_not_assume: ["가입 의사 단정 금지"],
          used_facts: ["policy_count"],
          recommendation_basis:
            "왜 맞아 보이는지: 둘러보기에서는 가입보다 시작점 확인. 왜 아직 확정 아닌지: 목적 미확인",
          voice_raw_candidate: voice,
          key_purpose: "둘러보기 시작점 리드",
          leadership_move: "보험료·빈틈·중복 선택지",
          insurance_expertise_angle: ["납입부담", "보장구성", "중복"],
          proposal_direction:
            "둘러보기면 가입·해지보다 보험료 부담과 큰 보장 빈틈부터",
          next_decision_point: [
            "보험료 부담부터 볼지",
            "큰 보장 빈틈부터 볼지",
            "중복 보장부터 볼지",
          ],
          final_answer_source: "s6",
        },
        directive: {
          answer_mode: "social",
          allowed_fact_tokens: { policy_count: "22" },
          facts_to_speak: [],
        },
        history: [],
        question: "그냥 둘러보러 왔어",
      });
      return (
        gate.ok === true &&
        gate.unsupported_recommendation === false &&
        gate.product_push_as_direction === false
      );
    },
  },
  {
    id: "B32_recommend_meta_phrase_pass",
    run: () => {
      const voice =
        "지금 보험 추천을 원하시는 경우, 먼저 목적과 보장 기준을 보겠습니다. 절감이면 중복부터, 보완이면 보장 구성부터가 맞아 보여요. 어느 쪽이 더 가까우세요?";
      const gate = gateBorrowedSensesOutput({
        borrowed: {
          understanding_hypotheses: ["추천을 원하지만 목적이 아직 열릴 수 있음"],
          customer_intent: "보험 추천 요청",
          answer_purpose: "추천 전 목적·기준 분기",
          must_not_assume: ["특정 상품 가입 단정 금지"],
          used_facts: ["policy_count"],
          recommendation_basis:
            "왜 맞아 보이는지: 추천은 목적 분기 후. 왜 아직 확정 아닌지: 목적 미확인",
          voice_raw_candidate: voice,
          key_purpose: "추천 요청을 목적 분기로 리드",
          leadership_move: "절감/보완/현황 선택",
          insurance_expertise_angle: ["중복", "보장구성"],
          proposal_direction:
            "보험 추천을 원하시면 먼저 목적과 보장 기준부터 보는 방향이 맞아 보임",
          next_decision_point: [
            "보험료 절감 목적이면 기존 중복 보장부터 확인하기",
            "보장 보완 목적이면 부족한 보장 구성부터 확인하기",
            "목적이 아직 막연하면 전체 계약 현황부터 정리하기",
          ],
          final_answer_source: "s6",
        },
        directive: directivePremium,
        history: [],
        question: "보험 추천해줘",
      });
      return (
        gate.ok === true &&
        gate.unsupported_recommendation === false &&
        gate.product_push_as_direction === false
      );
    },
  },
  {
    id: "B33_real_enroll_push_fail",
    run: () => {
      const gate = gateBorrowedSensesOutput({
        borrowed: {
          understanding_hypotheses: ["가입 유도"],
          customer_intent: "추천",
          answer_purpose: "가입 권유",
          must_not_assume: [],
          used_facts: ["policy_count"],
          voice_raw_candidate: "이 상품 가입하세요. 지금 가입하는 게 좋습니다.",
          key_purpose: "가입",
          leadership_move: "즉시 가입",
          insurance_expertise_angle: ["보장구성"],
          proposal_direction: "이 상품 가입을 추천합니다",
          next_decision_point: ["지금 가입하기", "나중에 가입하기"],
          final_answer_source: "s6",
        },
        directive: directivePremium,
        history: [],
        question: "보험 추천해줘",
      });
      return gate.ok === false && gate.unsupported_recommendation === true;
    },
  },
  {
    id: "B34_real_cancel_push_fail",
    run: () => {
      const gate = gateBorrowedSensesOutput({
        borrowed: {
          understanding_hypotheses: ["해지 권고"],
          customer_intent: "유지 여부",
          answer_purpose: "해지 단정",
          must_not_assume: [],
          used_facts: ["policy_count"],
          voice_raw_candidate: "이건 해지해도 됩니다. 지금 해지하세요.",
          key_purpose: "해지",
          leadership_move: "즉시 해지",
          insurance_expertise_angle: ["계약정리"],
          proposal_direction: "해지해도 됩니다",
          next_decision_point: ["지금 해지하기", "나중에 해지하기"],
          final_answer_source: "s6",
        },
        directive: {
          answer_mode: "social",
          allowed_fact_tokens: { policy_count: "22" },
          facts_to_speak: [],
        },
        history: [],
        question: "이 보험 유지해야 해?",
      });
      return (
        gate.ok === false &&
        (gate.unsupported_recommendation === true ||
          gate.closing_or_signup_push === true ||
          gate.leadership_cancel_enroll_certainty === true)
      );
    },
  },
  {
    id: "B35_anti_push_premium_phrase_pass",
    run: () => {
      const voice =
        "절감 목적이면 새 상품을 보기 전에 기존 중복 보장부터 보겠습니다. 납입 구조와 조정 후보도 같이 열어둘게요.";
      const gate = gateBorrowedSensesOutput({
        borrowed: {
          understanding_hypotheses: ["보험료 절감 목적일 수 있음"],
          customer_intent: "보험료 줄이기",
          answer_purpose: "절감 전 기존 계약 검토",
          must_not_assume: ["새 상품 가입 단정 금지"],
          used_facts: ["policy_count", "monthly_premium_representative"],
          recommendation_basis:
            "왜 맞아 보이는지: 절감이면 기존 중복·납입 확인이 먼저. 왜 아직 확정 아닌지: 합계 미확인",
          voice_raw_candidate: voice,
          key_purpose: "절감 목적 검토 리드",
          leadership_move: "새 상품 전 중복·납입부터",
          insurance_expertise_angle: ["납입부담", "중복"],
          proposal_direction:
            "절감 목적이면 새 상품을 보기 전에 기존 중복·납입 확인이 먼저 맞아 보임",
          next_decision_point: [
            "납입 보험료 구조부터 확인할지",
            "중복 보장부터 확인할지",
            "줄여도 되는 조정 후보부터 볼지",
          ],
          final_answer_source: "s6",
        },
        directive: directivePremium,
        history: [],
        question: "보험료 줄이고 싶어",
      });
      return (
        gate.ok === true &&
        gate.unsupported_recommendation === false &&
        gate.product_push_as_direction === false
      );
    },
  },
  {
    id: "B36_qualitative_word_not_number_scope_pass",
    run: () => {
      const voice =
        "처음이면 보험료 부담과 큰 보장 빈틈부터 가볍게 보는 걸 추천드려요. 대부분의 점검에서 이 두 가지가 먼저 윤곽이 잡히는 영역이에요. 중복 보장도 같이 열어둘게요.";
      const gate = gateBorrowedSensesOutput({
        borrowed: {
          understanding_hypotheses: ["가볍게 둘러보려는 마음이 있을 수 있음"],
          customer_intent: "부담 없이 둘러보기",
          answer_purpose: "상담 시작점 추천",
          must_not_assume: ["가입 의사 단정 금지"],
          used_facts: ["policy_count"],
          recommendation_basis:
            "왜 맞아 보이는지: 둘러보기에서는 보험료·빈틈·중복이 안전한 시작점. 왜 아직 확정 아닌지: 목적 미확인",
          voice_raw_candidate: voice,
          key_purpose: "둘러보기 시작점 리드",
          leadership_move: "보험료·빈틈·중복 선택지",
          insurance_expertise_angle: ["납입부담", "보장구성", "중복"],
          proposal_direction: "처음이면 보험료 부담과 큰 보장 빈틈부터",
          next_decision_point: [
            "보험료 부담부터 볼지",
            "큰 보장 빈틈부터 볼지",
            "중복 보장부터 볼지",
          ],
          final_answer_source: "s6",
        },
        directive: {
          answer_mode: "social",
          allowed_fact_tokens: { policy_count: "22" },
          facts_to_speak: [],
        },
        history: [],
        question: "그냥 둘러보러 왔어",
      });
      const hint = buildQuestionLeadershipHint("그냥 둘러보러 왔어");
      if (!hint || !/처음이면|보험료\s*부담|보장\s*빈틈/.test(hint)) return false;
      return gate.ok === true && gate.number_scope_violation === false;
    },
  },
  {
    id: "B37_real_numeric_invent_fail",
    run: () => {
      const gatePct = gateBorrowedSensesOutput({
        borrowed: {
          understanding_hypotheses: ["절감"],
          customer_intent: "보험료 줄이기",
          answer_purpose: "절감 안내",
          must_not_assume: [],
          used_facts: ["policy_count"],
          voice_raw_candidate: "보통 30%는 줄일 수 있습니다. 월 5만 원 줄일 수 있습니다.",
          key_purpose: "절감 수치",
          leadership_move: "수치 제시",
          insurance_expertise_angle: ["납입부담"],
          proposal_direction: "30% 절감 가능",
          next_decision_point: ["30% 줄이기", "월 5만 원 줄이기"],
          final_answer_source: "s6",
        },
        directive: directivePremium,
        history: [],
        question: "보험료 줄이고 싶어",
      });
      const gateHalf = gateBorrowedSensesOutput({
        borrowed: {
          understanding_hypotheses: ["중복"],
          customer_intent: "중복 확인",
          answer_purpose: "중복 안내",
          must_not_assume: [],
          used_facts: ["policy_count"],
          voice_raw_candidate: "대부분을 줄일 수 있고 절반이 중복입니다.",
          key_purpose: "중복 비율",
          leadership_move: "비율 제시",
          insurance_expertise_angle: ["중복"],
          proposal_direction: "절반 중복",
          next_decision_point: ["중복부터", "납입부터"],
          final_answer_source: "s6",
        },
        directive: directivePremium,
        history: [],
        question: "보험료 줄이고 싶어",
      });
      return (
        gatePct.ok === false &&
        gatePct.number_scope_violation === true &&
        gateHalf.ok === false &&
        gateHalf.number_scope_violation === true
      );
    },
  },
  {
    id: "B38_premium_anti_push_harness_pass",
    run: () => {
      // Mirror Stage1 harness scoreNoNewProductPush / anti-push rules (local, no Preview)
      const isAntiPush = (text = "") =>
        /새\s*상품을?\s*(?:보기\s*전에|보기\s*전|보다\s*전에)|새\s*상품보다/.test(String(text));
      const hasRealPush = (text = "") => {
        const t = String(text ?? "");
        if (/(?:이\s*상품|이\s*보험).{0,20}(?:가입하(?:세요|십시오)|가입을\s*(?:추천|권유)|무조건\s*가입)/.test(t)) {
          return true;
        }
        if (/(?:지금|바로)\s*가입(?:하(?:세요|십시오|는\s*게)|을\s*(?:추천|권유))/.test(t)) return true;
        if (/가입하세요|해지하(?:세요|셔야)|해지해도\s*됩니다|갈아타세요/.test(t)) return true;
        const assertive =
          /(?:추가\s*가입|새\s*상품\s*가입하|지금\s*가입하(?:세요|십시오|는\s*게)|바로\s*가입하|갈아타세요)/.test(
            t,
          ) || /새\s*상품\s*가입(?:을\s*)?(?:추천|권유)/.test(t);
        if (!assertive) return false;
        if (isAntiPush(t)) return false;
        return true;
      };
      const scoreNoNew = (blob = "") => {
        if (hasRealPush(blob)) return false;
        if (/새\s*상품/.test(blob) && !isAntiPush(blob)) return false;
        return true;
      };
      const blob =
        "절감 목적이라면 새 상품을 보기 전에 지금 있는 22건의 납입 구조와 중복 보장을 먼저 확인하는 게 맞아 보입니다. 새 상품 가입보다 기존 중복부터. 납입 구조 / 중복 보장 / 조정 후보";
      if (!isAntiPush(blob)) return false;
      if (scoreNoNew(blob) !== true) return false;
      // Old buggy partial match must NOT decide FAIL when anti-push present
      if (/(?:추가\s*가입|지금\s*가입|새\s*상품\s*가입)/.test(blob) && !isAntiPush(blob)) {
        return false;
      }
      const gate = gateBorrowedSensesOutput({
        borrowed: {
          understanding_hypotheses: ["보험료 절감 목적일 수 있음"],
          customer_intent: "보험료 줄이기",
          answer_purpose: "절감 전 기존 계약 검토",
          must_not_assume: ["새 상품 가입 단정 금지"],
          used_facts: ["policy_count", "monthly_premium_representative"],
          recommendation_basis:
            "왜 맞아 보이는지: 절감이면 새 상품 가입보다 기존 중복·납입 확인이 먼저. 왜 아직 확정 아닌지: 합계 미확인",
          voice_raw_candidate:
            "새 상품을 보기 전에 기존 중복 보장부터 보겠습니다. 납입 구조와 조정 후보도 같이 열어둘게요.",
          key_purpose: "절감 목적 검토 리드",
          leadership_move: "새 상품 전 중복·납입부터",
          insurance_expertise_angle: ["납입부담", "중복"],
          proposal_direction:
            "절감 목적이면 새 상품을 보기 전에 기존 중복·납입 확인이 먼저 맞아 보임",
          next_decision_point: [
            "납입 보험료 구조부터 확인할지",
            "중복 보장부터 확인할지",
            "줄여도 되는 조정 후보부터 볼지",
          ],
          final_answer_source: "s6",
        },
        directive: directivePremium,
        history: [],
        question: "보험료 줄이고 싶어",
      });
      return (
        gate.ok === true &&
        gate.unsupported_recommendation === false &&
        gate.product_push_as_direction === false &&
        scoreNoNew(blob) === true
      );
    },
  },
  {
    id: "B39_real_enroll_push_still_fail",
    run: () => {
      const gate = gateBorrowedSensesOutput({
        borrowed: {
          understanding_hypotheses: ["가입 유도"],
          customer_intent: "추천",
          answer_purpose: "가입 권유",
          must_not_assume: [],
          used_facts: ["policy_count"],
          voice_raw_candidate: "지금 이 상품 가입하세요. 바로 가입하는 게 좋습니다.",
          key_purpose: "가입",
          leadership_move: "즉시 가입",
          insurance_expertise_angle: ["보장구성"],
          proposal_direction: "이 상품 가입을 추천합니다",
          next_decision_point: ["지금 가입하기", "나중에 가입하기"],
          final_answer_source: "s6",
        },
        directive: directivePremium,
        history: [],
        question: "보험 추천해줘",
      });
      return (
        gate.ok === false &&
        (gate.unsupported_recommendation === true || gate.product_push_as_direction === true)
      );
    },
  },
];

let failed = 0;
for (const c of cases) {
  const gate = gateBorrowedSensesOutput({
    borrowed: c.borrowed,
    directive: c.directive,
    history: c.history,
    question: c.question,
    visualBlocks: c.visualBlocks ?? [],
  });
  const okMatch = gate.ok === c.expectOk;
  let gatesMatch = true;
  if (c.expectGates) {
    for (const [k, v] of Object.entries(c.expectGates)) {
      if (gate[k] !== v) gatesMatch = false;
    }
  }
  if (!okMatch || !gatesMatch) {
    failed += 1;
    console.error("FAIL", c.id, { expectOk: c.expectOk, gate });
  } else {
    console.log("PASS", c.id);
  }
}

for (const c of repairCases) {
  const ok = Boolean(c.run());
  if (!ok) {
    failed += 1;
    console.error("FAIL", c.id);
  } else {
    console.log("PASS", c.id);
  }
}

if (failed) {
  console.error(`${failed} gate test(s) failed`);
  process.exit(1);
}
console.log(`PASS all ${cases.length + repairCases.length} S7-a + S7-b gate tests`);
