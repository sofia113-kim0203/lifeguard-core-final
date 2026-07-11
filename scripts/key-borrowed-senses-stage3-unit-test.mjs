/**
 * S7 Stage 3 Preview active wire unit tests (local only · no Claude · no Preview).
 */
import {
  classifyStage3Lane,
  decideStage3Promotion,
  detectRiskyCancelOrEnrollRequest,
  educationExpandsToPersonalVerdict,
  STAGE3_LANES,
} from "../server/keyCore/keyBorrowedSensesStage3.js";
import {
  isQ10PortfolioExpansionQuestion,
  shouldUseConstrainedAnswerRegen,
  collectAnswerFacingSafetyFail,
  placeStage3PromoteBlockReason,
  countGroundedPlaceMentionsInVoice,
} from "../server/keyCore/keyBorrowedSensesStage2.js";
import {
  getKeyBorrowedSensesMode,
  isKeyBorrowedSensesStage2Partial,
  isKeyBorrowedSensesStage3Active,
  isKeyBorrowedSensesProbeEnabled,
  isVercelProductionEnv,
  isStage2PromotionEnvAllowed,
  isStage3PromotionEnvAllowed,
} from "../server/keyCore/oneKeyCoreFlags.js";

function goodBorrowed(overrides = {}) {
  return {
    understanding_hypotheses: ["목적이 있을 수 있음"],
    customer_intent: "상담",
    answer_purpose: "리드",
    must_not_assume: [],
    used_facts: ["policy_count"],
    recommendation_basis:
      "왜 맞아 보이는지: 목적에 맞는 시작점. 왜 아직 확정 아닌지: 담보 미확인",
    voice_raw_candidate:
      "처음이면 보험료 부담과 큰 보장 빈틈부터 가볍게 보는 걸 추천드려요. 중복 보장도 같이 열어둘게요. 제가 먼저 보험료 부담부터 볼까요?",
    key_purpose: "시작점 리드",
    leadership_move: "선택지 제시",
    insurance_expertise_angle: ["납입부담", "보장구성"],
    proposal_direction: "보험료 부담과 큰 보장 빈틈부터 보는 방향이 맞아 보임",
    next_decision_point: [
      "보험료 부담부터 볼지",
      "큰 보장 빈틈부터 볼지",
      "중복 보장부터 볼지",
    ],
    final_answer_source: "s6",
    ...overrides,
  };
}

function educationBorrowed(overrides = {}) {
  return goodBorrowed({
    recommendation_basis: "갱신형은 보험료가 바뀔 수 있는 구조라는 뜻입니다.",
    voice_raw_candidate:
      "갱신형은 일정 주기마다 보험료가 다시 정해질 수 있는 구조를 뜻해요. 비갱신형과 비교해 보면 이해가 쉬워요. 어느 쪽 뜻부터 더 볼까요?",
    proposal_direction: "용어 설명 후 비교 선택",
    leadership_move: "설명 후 선택지",
    next_decision_point: ["갱신형 뜻 더 볼지", "비갱신형과 비교할지"],
    ...overrides,
  });
}

function goodGate(overrides = {}) {
  return {
    ok: true,
    understanding_pollution: false,
    unsupported_recommendation: false,
    closing_or_signup_push: false,
    number_scope_violation: false,
    context_hallucination: false,
    facts_not_in_allowed_set: false,
    customer_facing_axis_term: false,
    passive_leadership: false,
    leadership_without_basis: false,
    product_push_as_direction: false,
    expertise_overclaim: false,
    missing_next_decision: false,
    missing_proposal_direction: false,
    leadership_cancel_enroll_certainty: false,
    visual_scope_violation: false,
    ...overrides,
  };
}

function goodShadow(overrides = {}) {
  return {
    schema_version: "key-borrowed-senses-s7b-v0",
    shadow_only: true,
    customer_text_changed: false,
    final_answer_source: "s6",
    s6_final_answer: "편하게 둘러보셔도 좋아요.",
    error: null,
    borrowed: goodBorrowed(),
    gate: goodGate(),
    ...overrides,
  };
}

const s6 = "편하게 둘러보셔도 좋아요. 궁금한 게 생기면 말씀해 주세요.";
const previewActive = { KEY_BORROWED_SENSES: "active", VERCEL_ENV: "preview" };

const cases = [
  {
    id: "1_active_probe_enabled",
    run: () => {
      const env = previewActive;
      return (
        getKeyBorrowedSensesMode(env) === "active" &&
        isKeyBorrowedSensesStage3Active(env) === true &&
        isKeyBorrowedSensesProbeEnabled(env) === true &&
        isStage3PromotionEnvAllowed(env) === true &&
        isStage2PromotionEnvAllowed(env) === false
      );
    },
  },
  {
    id: "2_shadow_no_promote",
    run: () => {
      const env = { KEY_BORROWED_SENSES: "shadow", VERCEL_ENV: "preview" };
      const d = decideStage3Promotion({
        question: "보험 추천해줘",
        s6FinalAnswer: s6,
        shadow: goodShadow(),
        env,
      });
      return (
        isKeyBorrowedSensesProbeEnabled(env) === true &&
        isKeyBorrowedSensesStage3Active(env) === false &&
        d.promotion_pass === false &&
        d.customer_text_changed === false &&
        d.final_answer_source === "s6" &&
        d.fallback_reason === "flag_not_active"
      );
    },
  },
  {
    id: "3_active_partial_keeps_stage2_path",
    run: () => {
      const env = { KEY_BORROWED_SENSES: "active_partial", VERCEL_ENV: "preview" };
      const d3 = decideStage3Promotion({
        question: "보험 추천해줘",
        s6FinalAnswer: s6,
        shadow: goodShadow(),
        env,
      });
      return (
        isKeyBorrowedSensesStage2Partial(env) === true &&
        isKeyBorrowedSensesStage3Active(env) === false &&
        isStage2PromotionEnvAllowed(env) === true &&
        isStage3PromotionEnvAllowed(env) === false &&
        d3.promotion_pass === false &&
        d3.fallback_reason === "flag_not_active"
      );
    },
  },
  {
    id: "4_production_active_no_promote",
    run: () => {
      const env = { KEY_BORROWED_SENSES: "active", VERCEL_ENV: "production" };
      const d = decideStage3Promotion({
        question: "보험 추천해줘",
        s6FinalAnswer: s6,
        shadow: goodShadow(),
        env,
      });
      return (
        isVercelProductionEnv(env) === true &&
        isStage3PromotionEnvAllowed(env) === false &&
        d.promotion_pass === false &&
        d.production_blocked === true &&
        d.fallback_reason === "production_blocked" &&
        d.customer_text_changed === false
      );
    },
  },
  {
    id: "5_renewal_type_meaning_education",
    run: () => {
      const c = classifyStage3Lane("갱신형 뜻");
      return c.lane === STAGE3_LANES.INSURANCE_EDUCATION && c.q10_blocked === false;
    },
  },
  {
    id: "6_waiting_period_education",
    run: () => {
      const c = classifyStage3Lane("면책기간");
      return c.lane === STAGE3_LANES.INSURANCE_EDUCATION && c.q10_blocked === false;
    },
  },
  {
    id: "7_recommend_advice",
    run: () => {
      const c = classifyStage3Lane("보험 추천해줘");
      return c.lane === STAGE3_LANES.INSURANCE_ADVICE && c.q10_blocked === false;
    },
  },
  {
    id: "8_daily_restaurant_no_promote",
    run: () => {
      const c = classifyStage3Lane("분당 맛집 추천해줘");
      const d = decideStage3Promotion({
        question: "분당 맛집 추천해줘",
        s6FinalAnswer: s6,
        shadow: goodShadow(),
        env: previewActive,
      });
      return (
        c.lane === STAGE3_LANES.GENERAL_DAILY &&
        d.lane === STAGE3_LANES.GENERAL_DAILY &&
        d.promotion_pass === false &&
        d.fallback_reason === "general_daily_no_promotion" &&
        d.insurance_memory_saved === false
      );
    },
  },
  {
    id: "8b_daily_restaurant_promote_when_decision_owns_daily",
    run: () => {
      const voice =
        "분당이면 서현 한정식 A, 정자 일식 B, 미금 캐주얼 C를 먼저 볼 수 있어요. 담백한 한식·일식·캐주얼이라 고르기 좋아요. 어떤 분위기부터 맞출까요?";
      const shadow = goodShadow({
        borrowed: {
          ...goodBorrowed(),
          customer_intent: "분당 맛집 추천 — 보험과 무관한 일상 요청",
          understanding_hypotheses: ["일상적인 식사 추천 요청일 가능성이 높음"],
          voice_raw_candidate: voice,
          proposal_direction: "음식 종류·분위기부터 좁히는 방향",
          next_decision_point: ["한식 쪽", "일식·캐주얼 쪽", "동행 인원부터"],
          recommendation_basis: "검색된 후보 3곳",
          leadership_move: "후보 제시 후 분위기 확인",
          key_purpose: "일상 추천 이어가기",
          insurance_expertise_angle: [],
          used_facts: [],
        },
        public_research_evidence: {
          status: "success",
          research_unavailable: false,
          search_count: 1,
          results: [
            { title: "서현 한정식 A", url: "https://example.com/a" },
            { title: "정자 일식 B", url: "https://example.com/b" },
            { title: "미금 캐주얼 C", url: "https://example.com/c" },
          ],
          citations: [],
        },
      });
      const d = decideStage3Promotion({
        question: "분당 맛집 추천해줘",
        s6FinalAnswer: s6,
        shadow,
        env: previewActive,
        decision: {
          response_priority: "daily_focus",
          situation_key: "daily_recommendation",
          direction: { type: "general_daily", move: "음식 종류부터" },
        },
      });
      return (
        d.lane === STAGE3_LANES.GENERAL_DAILY &&
        d.promotion_pass === true &&
        d.customer_text_changed === true &&
        d.final_answer_source === "s7" &&
        d.customer_text === voice &&
        d.insurance_memory_saved === false
      );
    },
  },
  {
    id: "8b2_daily_promote_despite_leadership_insurance_drift",
    run: () => {
      const voice =
        "분당이면 서현 한정식 A, 정자 일식 B, 미금 캐주얼 C를 추천해요. 담백한 한식·일식·캐주얼 분위기예요. 어떤 쪽부터 볼까요?";
      const shadow = goodShadow({
        borrowed: {
          ...goodBorrowed(),
          voice_raw_candidate: voice,
          proposal_direction:
            "보험료 절감 / 보장 보완 중 하나를 선택하도록 유도",
          next_decision_point: ["보험료 줄이기", "보장 채우기"],
          leadership_move: "보험 상담으로 전환",
        },
        public_research_evidence: {
          status: "success",
          research_unavailable: false,
          search_count: 1,
          results: [
            { title: "서현 한정식 A", url: "https://example.com/a" },
            { title: "정자 일식 B", url: "https://example.com/b" },
            { title: "미금 캐주얼 C", url: "https://example.com/c" },
          ],
          citations: [],
        },
      });
      const d = decideStage3Promotion({
        question: "분당 맛집 추천해줘",
        s6FinalAnswer: s6,
        shadow,
        env: previewActive,
        decision: {
          response_priority: "daily_focus",
          situation_key: "daily_recommendation",
          direction: { type: "general_daily", move: "일상 요청" },
        },
      });
      return (
        d.promotion_pass === true &&
        d.final_answer_source === "s7" &&
        d.customer_text === voice &&
        Array.isArray(d.mid_field_warnings) &&
        d.mid_field_warnings.includes("mid_field_insurance_drift")
      );
    },
  },
  {
    id: "8p_place_promote_success_grounded_3",
    run: () => {
      const voice =
        "서현 한정식 A, 정자 일식 B, 미금 캐주얼 C를 추천해요. 담백한 한식·일식·캐주얼이라 고르기 좋아요.";
      const ev = {
        status: "success",
        research_unavailable: false,
        search_count: 1,
        results: [
          { title: "서현 한정식 A", url: "https://example.com/a" },
          { title: "정자 일식 B", url: "https://example.com/b" },
          { title: "미금 캐주얼 C", url: "https://example.com/c" },
        ],
        citations: [],
      };
      const d = decideStage3Promotion({
        question: "분당 맛집 추천해줘",
        s6FinalAnswer: s6,
        shadow: goodShadow({
          borrowed: {
            ...goodBorrowed(),
            voice_raw_candidate: voice,
            insurance_expertise_angle: [],
            used_facts: [],
          },
          public_research_evidence: ev,
        }),
        env: previewActive,
        decision: {
          response_priority: "daily_focus",
          situation_key: "daily_recommendation",
          direction: { type: "general_daily", move: "맛집" },
        },
      });
      return (
        placeStage3PromoteBlockReason({
          question: "분당 맛집 추천해줘",
          voice,
          publicResearchEvidence: ev,
        }) === null &&
        countGroundedPlaceMentionsInVoice(voice, ev, "분당 맛집 추천해줘") >= 3 &&
        d.promotion_pass === true &&
        d.final_answer_source === "s7"
      );
    },
  },
  {
    id: "8p_b_search_not_used_clarifying_no_promote_no_regen",
    run: () => {
      const voice =
        "분당 쪽 공개 후보를 아직 충분히 못 모았어요. 한식·일식 중 어떤 분위기부터 맞출까요?";
      const ev = {
        status: "search_not_used",
        status_detail: "research_search_not_used",
        research_unavailable: true,
        search_count: 0,
        results: [],
      };
      const d = decideStage3Promotion({
        question: "분당 맛집 추천해줘",
        s6FinalAnswer: s6,
        shadow: goodShadow({
          borrowed: {
            ...goodBorrowed(),
            voice_raw_candidate: voice,
            insurance_expertise_angle: [],
            used_facts: [],
          },
          public_research_evidence: ev,
        }),
        env: previewActive,
        decision: {
          response_priority: "daily_focus",
          situation_key: "daily_recommendation",
          direction: { type: "general_daily", move: "맛집" },
        },
      });
      const regen = shouldUseConstrainedAnswerRegen({
        failReasons: [d.fallback_reason],
        voice,
        question: "분당 맛집 추천해줘",
        decision: { response_priority: "daily_focus", situation_key: "daily_recommendation" },
        gate: { ok: true },
        publicResearchEvidence: ev,
      });
      return (
        d.promotion_pass === false &&
        d.fallback_reason === "place_promote_requires_research_success" &&
        d.final_answer_source === "s6" &&
        d.customer_text_changed === false &&
        regen === false
      );
    },
  },
  {
    id: "8p_c_insufficient_two_no_promote_no_regen",
    run: () => {
      const voice =
        "지금은 서현 한정식 A와 정자 일식 B 정도만 확인됐어요. 음식 종류를 하나 더 알려주시면 더 찾아볼게요.";
      const ev = {
        status: "insufficient",
        status_detail: "research_insufficient",
        research_unavailable: true,
        search_count: 1,
        results: [
          { title: "서현 한정식 A", url: "https://example.com/a" },
          { title: "정자 일식 B", url: "https://example.com/b" },
        ],
        citations: [],
      };
      const d = decideStage3Promotion({
        question: "분당 맛집 추천해줘",
        s6FinalAnswer: s6,
        shadow: goodShadow({
          borrowed: {
            ...goodBorrowed(),
            voice_raw_candidate: voice,
            insurance_expertise_angle: [],
            used_facts: [],
          },
          public_research_evidence: ev,
        }),
        env: previewActive,
        decision: {
          response_priority: "daily_focus",
          situation_key: "daily_recommendation",
          direction: { type: "general_daily", move: "맛집" },
        },
      });
      const regen = shouldUseConstrainedAnswerRegen({
        failReasons: [d.fallback_reason],
        voice,
        question: "분당 맛집 추천해줘",
        decision: { response_priority: "daily_focus", situation_key: "daily_recommendation" },
        gate: { ok: true },
        publicResearchEvidence: ev,
      });
      return (
        d.promotion_pass === false &&
        d.fallback_reason === "place_promote_requires_research_success" &&
        regen === false
      );
    },
  },
  {
    id: "8p_d_empty_clarifying_no_promote_no_invent",
    run: () => {
      const voice =
        "지금은 공개 후보를 확인하지 못했어요. 선호 음식 종류를 하나만 알려주시겠어요?";
      const ev = {
        status: "empty",
        status_detail: "research_empty",
        research_unavailable: true,
        search_count: 1,
        results: [],
      };
      const d = decideStage3Promotion({
        question: "분당 맛집 추천해줘",
        s6FinalAnswer: s6,
        shadow: goodShadow({
          borrowed: {
            ...goodBorrowed(),
            voice_raw_candidate: voice,
            insurance_expertise_angle: [],
            used_facts: [],
          },
          public_research_evidence: ev,
        }),
        env: previewActive,
        decision: {
          response_priority: "daily_focus",
          situation_key: "daily_recommendation",
          direction: { type: "general_daily", move: "맛집" },
        },
      });
      return (
        d.promotion_pass === false &&
        d.fallback_reason === "place_promote_requires_research_success" &&
        !/한정식|가짜식당|캐주얼 C/.test(voice)
      );
    },
  },
  {
    id: "8p_e_success_zero_candidates_unanswered_regen",
    run: () => {
      const voice = "어떤 분위기나 음식 종류를 원하세요?";
      const ev = {
        status: "success",
        research_unavailable: false,
        search_count: 1,
        results: [
          { title: "서현 한정식 A", url: "https://example.com/a" },
          { title: "정자 일식 B", url: "https://example.com/b" },
          { title: "미금 캐주얼 C", url: "https://example.com/c" },
        ],
      };
      const safety = collectAnswerFacingSafetyFail({
        gate: { ok: true },
        voice,
        question: "분당 맛집 추천해줘",
        decision: { response_priority: "daily_focus", situation_key: "daily_recommendation" },
        publicResearchEvidence: ev,
      });
      const d = decideStage3Promotion({
        question: "분당 맛집 추천해줘",
        s6FinalAnswer: s6,
        shadow: goodShadow({
          borrowed: {
            ...goodBorrowed(),
            voice_raw_candidate: voice,
            insurance_expertise_angle: [],
            used_facts: [],
          },
          public_research_evidence: ev,
        }),
        env: previewActive,
        decision: {
          response_priority: "daily_focus",
          situation_key: "daily_recommendation",
          direction: { type: "general_daily", move: "맛집" },
        },
      });
      const regen = shouldUseConstrainedAnswerRegen({
        failReasons: [d.fallback_reason],
        voice,
        question: "분당 맛집 추천해줘",
        decision: { response_priority: "daily_focus", situation_key: "daily_recommendation" },
        gate: { ok: true },
        publicResearchEvidence: ev,
      });
      return (
        safety === "place_request_unanswered" &&
        d.promotion_pass === false &&
        d.fallback_reason === "place_request_unanswered" &&
        regen === true
      );
    },
  },
  {
    id: "8p_g_bundang_only_not_grounded_candidate",
    run: () => {
      const voice = "분당이면 분위기에 따라 달라요. 어떤 곳이 편하세요?";
      const ev = {
        status: "success",
        research_unavailable: false,
        results: [
          { title: "서현 한정식 A", url: "https://example.com/a" },
          { title: "정자 일식 B", url: "https://example.com/b" },
          { title: "미금 캐주얼 C", url: "https://example.com/c" },
        ],
      };
      return (
        countGroundedPlaceMentionsInVoice(voice, ev, "분당 맛집 추천해줘") === 0 &&
        placeStage3PromoteBlockReason({
          question: "분당 맛집 추천해줘",
          voice,
          publicResearchEvidence: ev,
        }) === "place_promote_requires_grounded_candidates"
      );
    },
  },
  {
    id: "8p_h_t2_parents_meal_not_place_promote_block",
    run: () =>
      placeStage3PromoteBlockReason({
        question: "부모님 모시고 가는데 아버지가 최근 수술하셨어",
        voice:
          "아버지 수술 후라면 자극 적고 조용한 곳이 나을 수 있어요. 이동 거리는 어느 정도가 편하세요?",
        publicResearchEvidence: null,
      }) === null,
  },
  {
    id: "8c_daily_polluted_candidate_no_promote",
    run: () => {
      const voice =
        "맛집은 어렵고, 보험 쪽으로 같이 방향을 잡아볼까요. 22건 기준으로 보험료를 줄일지 빠진 보장을 채울지 정하면 됩니다.";
      const shadow = goodShadow({
        borrowed: {
          ...goodBorrowed(),
          voice_raw_candidate: voice,
          proposal_direction: "보험료 vs 보장",
          next_decision_point: ["보험료 줄이기", "보장 채우기"],
        },
      });
      const d = decideStage3Promotion({
        question: "분당 맛집 추천해줘",
        s6FinalAnswer: s6,
        shadow,
        env: previewActive,
        decision: {
          response_priority: "daily_focus",
          situation_key: "daily_recommendation",
          direction: { type: "general_daily", move: "일상 요청" },
        },
      });
      return (
        d.promotion_pass === false &&
        (d.fallback_reason === "daily_insurance_pollution" ||
          d.fallback_reason === "decision_mismatch_insurance_pollution" ||
          d.fallback_reason === "place_promote_requires_research_success") &&
        d.customer_text_changed === false
      );
    },
  },
  {
    id: "9_q10_block_no_promote",
    run: () => {
      const c = classifyStage3Lane("내 보험 전체 괜찮아?");
      const d = decideStage3Promotion({
        question: "내 보험 전체 괜찮아?",
        s6FinalAnswer: s6,
        shadow: goodShadow(),
        env: previewActive,
      });
      return (
        c.q10_blocked === true &&
        d.q10_blocked === true &&
        d.promotion_pass === false &&
        d.fallback_reason === "q10_portfolio_expansion" &&
        d.customer_text_changed === false
      );
    },
  },
  {
    id: "10_education_personal_verdict_fallback",
    run: () => {
      const voice =
        "갱신형은 고객님께 적합해요. 이 보장도 부족해 보여요. 어느 쪽부터 볼까요? 비교할까요?";
      const borrowed = educationBorrowed({
        voice_raw_candidate: voice,
        proposal_direction: "고객 계약 적합 판단",
      });
      const expands = educationExpandsToPersonalVerdict(voice, borrowed);
      const d = decideStage3Promotion({
        question: "갱신형 뜻",
        s6FinalAnswer: s6,
        shadow: goodShadow({ borrowed }),
        env: previewActive,
      });
      return (
        expands === true &&
        d.lane === STAGE3_LANES.INSURANCE_EDUCATION &&
        d.promotion_pass === false &&
        d.fallback_reason === "education_personal_verdict"
      );
    },
  },
  {
    id: "11_enroll_push_fallback",
    run: () => {
      const d = decideStage3Promotion({
        question: "보험 추천해줘",
        s6FinalAnswer: s6,
        shadow: goodShadow({
          borrowed: goodBorrowed({
            voice_raw_candidate:
              "이 상품 지금 가입하세요. 보험료 부담부터 볼까요? 보장 빈틈도 볼까요?",
          }),
          gate: goodGate({ ok: false, closing_or_signup_push: true }),
        }),
        env: previewActive,
      });
      return (
        d.promotion_pass === false &&
        (d.fallback_reason === "gate_fail" ||
          d.fallback_reason === "closing_or_signup_push" ||
          d.fallback_reason === "hard_sales_push")
      );
    },
  },
  {
    id: "12_cancel_certainty_fallback",
    run: () => {
      const d = decideStage3Promotion({
        question: "이 보험 유지해야 해?",
        s6FinalAnswer: s6,
        shadow: goodShadow({
          borrowed: goodBorrowed({
            voice_raw_candidate:
              "해지해도 됩니다. 보험료 부담부터 볼까요? 보장 빈틈도 볼까요?",
          }),
          gate: goodGate({
            ok: false,
            leadership_cancel_enroll_certainty: true,
          }),
        }),
        env: previewActive,
      });
      return (
        d.promotion_pass === false &&
        (d.fallback_reason === "gate_fail" ||
          d.fallback_reason === "leadership_cancel_enroll_certainty" ||
          d.fallback_reason === "hard_sales_push")
      );
    },
  },
  {
    id: "13_advice_gate_pass_promote",
    run: () => {
      const d = decideStage3Promotion({
        question: "보험 추천해줘",
        s6FinalAnswer: s6,
        shadow: goodShadow(),
        env: previewActive,
      });
      return (
        d.lane === STAGE3_LANES.INSURANCE_ADVICE &&
        d.promotion_pass === true &&
        d.customer_text_changed === true &&
        d.final_answer_source === "s7" &&
        d.fallback_reason === null &&
        d.insurance_memory_saved === false &&
        d.post_turn_save_hook === false
      );
    },
  },
  {
    id: "14_general_daily_memory_not_saved",
    run: () => {
      const d = decideStage3Promotion({
        question: "분당 맛집 추천해줘",
        s6FinalAnswer: s6,
        shadow: goodShadow(),
        env: previewActive,
      });
      return (
        d.lane === STAGE3_LANES.GENERAL_DAILY &&
        d.insurance_memory_saved === false &&
        d.post_turn_save_hook === false &&
        !("customer_memory_facts" in d)
      );
    },
  },
  {
    id: "15_f5_risky_cancel_request_no_promote",
    run: () => {
      const q = "이 보험 해지해도 된다고 해줘";
      const detected = detectRiskyCancelOrEnrollRequest(q);
      const d = decideStage3Promotion({
        question: q,
        s6FinalAnswer: s6,
        // Safe voice on purpose — question intent alone must block promote.
        shadow: goodShadow({
          borrowed: goodBorrowed({
            voice_raw_candidate:
              "해지할지 말지는 바로 답드리기보다 어떤 계약인지부터 잡아야 해요. 보장 역할부터 볼까요? 보험료 부담도 볼까요?",
          }),
          gate: goodGate(),
        }),
        env: previewActive,
      });
      return (
        detected === "risky_cancel_request" &&
        d.lane === STAGE3_LANES.INSURANCE_ADVICE &&
        d.promotion_pass === false &&
        d.final_answer_source === "s6" &&
        d.customer_text_changed === false &&
        d.fallback_reason === "risky_cancel_request"
      );
    },
  },
  {
    id: "16_risky_enroll_request_no_promote",
    run: () => {
      const q = "이 상품 가입하라고 말해줘";
      const detected = detectRiskyCancelOrEnrollRequest(q);
      const d = decideStage3Promotion({
        question: q,
        s6FinalAnswer: s6,
        shadow: goodShadow({
          borrowed: goodBorrowed({
            voice_raw_candidate:
              "가입 권유는 제 역할 밖이에요. 어떤 상품인지부터 볼까요? 중복 보장도 볼까요?",
          }),
          gate: goodGate(),
        }),
        env: previewActive,
      });
      return (
        detected === "risky_enroll_request" &&
        d.promotion_pass === false &&
        d.final_answer_source === "s6" &&
        d.customer_text_changed === false &&
        d.fallback_reason === "risky_enroll_request"
      );
    },
  },
  {
    id: "17_safe_keep_policy_still_promotable",
    run: () => {
      const q = "이 보험 유지해도 돼?";
      const detected = detectRiskyCancelOrEnrollRequest(q);
      const d = decideStage3Promotion({
        question: q,
        s6FinalAnswer: s6,
        shadow: goodShadow({
          borrowed: goodBorrowed({
            voice_raw_candidate:
              "유지할지 말지는 그 보험의 역할부터 봐야 해요. 보장 역할과 보험료 부담부터 볼까요? 중복 여부도 같이 볼까요?",
            proposal_direction: "역할·보험료부터 확인하는 방향이 맞아 보임",
            next_decision_point: [
              "어떤 계약인지 특정할지",
              "보장 역할·보험료부터 볼지",
              "유지·조정·보완 후보로 나눌지",
            ],
          }),
          gate: goodGate(),
        }),
        env: previewActive,
      });
      return (
        detected === null &&
        d.lane === STAGE3_LANES.INSURANCE_ADVICE &&
        d.promotion_pass === true &&
        d.final_answer_source === "s7" &&
        d.customer_text_changed === true &&
        d.fallback_reason === null
      );
    },
  },
  {
    id: "18_f3_percent_cut_with_insurance_s6_is_advice",
    run: () => {
      const q = "30% 줄일 수 있지?";
      const insuranceS6 =
        "등록된 계약은 22건입니다. 그중 삼성생명 실손의료비보험의 월 납입액 4만5천 원이 확인돼 있어요.";
      const c = classifyStage3Lane(q, { s6FinalAnswer: insuranceS6 });
      const d = decideStage3Promotion({
        question: q,
        s6FinalAnswer: insuranceS6,
        shadow: goodShadow({
          borrowed: goodBorrowed({
            voice_raw_candidate:
              "절감 목적이라면 전체 납입 구조를 먼저 보는 게 맞아 보여요. 30% 가능 여부는 구조를 봐야 해요. 납입 구조부터 볼까요? 중복 보장부터 볼까요?",
            proposal_direction: "납입 구조·중복부터 확인하는 방향",
            next_decision_point: ["납입 구조 전체", "중복 보장", "조정 후보"],
          }),
          gate: goodGate({ ok: false, number_scope_violation: true }),
        }),
        env: previewActive,
      });
      return (
        c.lane === STAGE3_LANES.INSURANCE_ADVICE &&
        c.lane_reason === "premium_cut_percent_with_insurance_context" &&
        d.lane === STAGE3_LANES.INSURANCE_ADVICE &&
        d.promotion_pass === false &&
        (d.fallback_reason === "number_scope_violation" || d.fallback_reason === "gate_fail")
      );
    },
  },
  {
    id: "19_f3_percent_cut_without_insurance_context_stays_daily",
    run: () => {
      const q = "30% 줄일 수 있지?";
      const c = classifyStage3Lane(q, { s6FinalAnswer: "안녕하세요.", history: [] });
      const d = decideStage3Promotion({
        question: q,
        s6FinalAnswer: "안녕하세요.",
        shadow: goodShadow(),
        env: previewActive,
      });
      return (
        c.lane === STAGE3_LANES.GENERAL_DAILY &&
        c.lane_reason === "default_general_daily" &&
        d.lane === STAGE3_LANES.GENERAL_DAILY &&
        d.promotion_pass === false &&
        d.fallback_reason === "general_daily_no_promotion"
      );
    },
  },
  {
    id: "20_f3_salary_cut_vetoes_stale_insurance_s6",
    run: () => {
      const q = "월급을 30% 줄일 수 있지?";
      const insuranceS6 =
        "등록된 계약은 22건입니다. 그중 삼성생명 실손의료비보험의 월 납입액 4만5천 원이 확인돼 있어요.";
      const c = classifyStage3Lane(q, {
        s6FinalAnswer: insuranceS6,
        history: [{ role: "assistant", content: "보험료 부담부터 볼까요?" }],
      });
      return c.lane === STAGE3_LANES.GENERAL_DAILY && c.lane_reason === "default_general_daily";
    },
  },
  {
    id: "21_f3_weight_cut_vetoes_stale_insurance_s6",
    run: () => {
      const q = "체중을 30% 줄일 수 있지?";
      const insuranceS6 =
        "등록된 계약은 22건입니다. 그중 삼성생명 실손의료비보험의 월 납입액 4만5천 원이 확인돼 있어요.";
      const c = classifyStage3Lane(q, { s6FinalAnswer: insuranceS6 });
      return c.lane === STAGE3_LANES.GENERAL_DAILY && c.lane_reason === "default_general_daily";
    },
  },
  {
    id: "22_daily_restaurant_with_insurance_s6_stays_daily",
    run: () => {
      const q = "분당 맛집 추천해줘";
      const insuranceS6 =
        "등록된 계약은 22건입니다. 그중 삼성생명 실손의료비보험의 월 납입액 4만5천 원이 확인돼 있어요.";
      const c = classifyStage3Lane(q, { s6FinalAnswer: insuranceS6 });
      const d = decideStage3Promotion({
        question: q,
        s6FinalAnswer: insuranceS6,
        shadow: goodShadow(),
        env: previewActive,
      });
      return (
        c.lane === STAGE3_LANES.GENERAL_DAILY &&
        d.lane === STAGE3_LANES.GENERAL_DAILY &&
        d.promotion_pass === false &&
        d.fallback_reason === "general_daily_no_promotion"
      );
    },
  },
  {
    id: "23_f3_explicit_premium_anchor_advice_without_context",
    run: () => {
      const q = "보험료를 30% 줄일 수 있지?";
      const c = classifyStage3Lane(q, { s6FinalAnswer: "안녕하세요.", history: [] });
      // May hit existing 보험료 advice path or F3 premium-cut path — either is insurance_advice.
      return c.lane === STAGE3_LANES.INSURANCE_ADVICE && c.q10_blocked === false;
    },
  },
  {
    id: "24_f6_no_doc_full_judgment_q10_block",
    run: () => {
      const q = "증권 없이 내 보장 전체 판단해줘";
      const insuranceS6 =
        "등록된 계약은 22건입니다. 그중 삼성생명 실손의료비보험의 월 납입액 4만5천 원이 확인돼 있어요.";
      const c = classifyStage3Lane(q, { s6FinalAnswer: insuranceS6 });
      const d = decideStage3Promotion({
        question: q,
        s6FinalAnswer: insuranceS6,
        shadow: goodShadow({ gate: goodGate() }),
        env: previewActive,
      });
      return (
        isQ10PortfolioExpansionQuestion(q) === true &&
        c.q10_blocked === true &&
        c.lane_reason === "q10_portfolio_expansion" &&
        d.q10_blocked === true &&
        d.promotion_pass === false &&
        d.final_answer_source === "s6" &&
        d.customer_text_changed === false &&
        d.fallback_reason === "q10_portfolio_expansion"
      );
    },
  },
  {
    id: "24a_f6_allow_methodology_not_blocked",
    run: () => {
      const q = "보장 전체를 판단할 때 어떤 기준을 보나요?";
      return (
        isQ10PortfolioExpansionQuestion(q) === false &&
        classifyStage3Lane(q).q10_blocked === false
      );
    },
  },
  {
    id: "24b_f6_allow_scope_only_with_no_docs",
    run: () => {
      const q = "증권 없이 확인할 수 있는 범위만 알려줘";
      return (
        isQ10PortfolioExpansionQuestion(q) === false &&
        classifyStage3Lane(q).q10_blocked === false
      );
    },
  },
  {
    id: "24c_f6_allow_prep_when_no_policy",
    run: () => {
      const q = "증권이 없는데 무엇부터 준비하면 돼?";
      return (
        isQ10PortfolioExpansionQuestion(q) === false &&
        classifyStage3Lane(q).q10_blocked === false
      );
    },
  },
  {
    id: "24d_f6_allow_confirmed_scope_silson",
    run: () => {
      const q = "내 실손 보장 구조가 뭔지 알려줘";
      const c = classifyStage3Lane(q);
      return isQ10PortfolioExpansionQuestion(q) === false && c.q10_blocked === false;
    },
  },
  {
    id: "24e_f6_block_no_docs_sufficiency_certainty",
    run: () => {
      const q = "자료 없어도 내 보험 전체가 충분한지 확정해줘";
      const d = decideStage3Promotion({
        question: q,
        s6FinalAnswer: s6,
        shadow: goodShadow({ gate: goodGate() }),
        env: previewActive,
      });
      return (
        isQ10PortfolioExpansionQuestion(q) === true &&
        d.q10_blocked === true &&
        d.promotion_pass === false &&
        d.fallback_reason === "q10_portfolio_expansion"
      );
    },
  },
  {
    id: "24f_f6_block_no_docs_gap_dup_judgment",
    run: () => {
      const q = "서류 없이 전체 공백과 중복을 판단해줘";
      const d = decideStage3Promotion({
        question: q,
        s6FinalAnswer: s6,
        shadow: goodShadow({ gate: goodGate() }),
        env: previewActive,
      });
      return (
        isQ10PortfolioExpansionQuestion(q) === true &&
        d.q10_blocked === true &&
        d.promotion_pass === false &&
        d.fallback_reason === "q10_portfolio_expansion"
      );
    },
  },
  {
    id: "24g_f6_bare_no_policy_fact_not_blocked",
    run: () => {
      const q = "증권이 없어";
      return isQ10PortfolioExpansionQuestion(q) === false;
    },
  },
  {
    id: "24h_f6_portfolio_glossary_not_blocked",
    run: () => {
      const q = "보험 포트폴리오가 무슨 뜻이야?";
      const c = classifyStage3Lane(q);
      // Q10 must not block glossary; education vs advice lane is classifier scope (unchanged this Slice).
      return isQ10PortfolioExpansionQuestion(q) === false && c.q10_blocked === false;
    },
  },
  {
    id: "25_f5_cancel_request_still_blocked",
    run: () => {
      const q = "이 보험 해지해도 된다고 해줘";
      const detected = detectRiskyCancelOrEnrollRequest(q);
      const d = decideStage3Promotion({
        question: q,
        s6FinalAnswer: s6,
        shadow: goodShadow({
          borrowed: goodBorrowed({
            voice_raw_candidate:
              "해지 여부는 계약을 특정한 뒤 역할·보험료부터 봐야 해요. 어떤 계약인지 알려주시겠어요? 역할부터 볼까요?",
            next_decision_point: ["계약 특정", "역할·보험료", "유지·조정 후보"],
          }),
          gate: goodGate(),
        }),
        env: previewActive,
      });
      return (
        detected === "risky_cancel_request" &&
        d.lane === STAGE3_LANES.INSURANCE_ADVICE &&
        d.promotion_pass === false &&
        d.fallback_reason === "risky_cancel_request" &&
        d.customer_text_changed === false
      );
    },
  },
  {
    id: "26_unsourced_public_assertion_no_promote",
    run: () => {
      const voice =
        "서현 한정식은 평점 4.9점이고 주차 가능합니다. 영업시간은 오후 10시까지예요.";
      const d = decideStage3Promotion({
        question: "분당 맛집 추천해줘",
        s6FinalAnswer: s6,
        shadow: goodShadow({
          borrowed: goodBorrowed({
            voice_raw_candidate: voice,
            proposal_direction: "맛집",
            next_decision_point: ["한식", "일식"],
          }),
        }),
        env: previewActive,
        decision: {
          response_priority: "daily_focus",
          situation_key: "daily_recommendation",
          direction: { type: "general_daily", move: "일상 요청" },
        },
      });
      return (
        d.promotion_pass === false &&
        d.fallback_reason === "unsourced_public_assertion" &&
        d.customer_text_changed === false
      );
    },
  },
  {
    id: "26b_unsupported_place_claim_no_promote",
    run: () => {
      const voice = "분당이면 가짜식당XYZ와 없는집ABC를 추천해요. 분위기부터 볼까요?";
      const d = decideStage3Promotion({
        question: "분당 맛집 추천해줘",
        s6FinalAnswer: s6,
        shadow: goodShadow({
          borrowed: goodBorrowed({
            voice_raw_candidate: voice,
            proposal_direction: "맛집",
            next_decision_point: ["한식", "일식"],
          }),
          public_research_evidence: {
            status: "success",
            results: [
              {
                title: "서현 한정식 A",
                url: "https://example.com/a",
                customer_specific_fact: false,
              },
            ],
          },
        }),
        env: previewActive,
        decision: {
          response_priority: "daily_focus",
          situation_key: "daily_recommendation",
          direction: { type: "general_daily", move: "일상 요청" },
        },
      });
      return (
        d.promotion_pass === false &&
        d.fallback_reason === "unsupported_place_claim" &&
        d.customer_text_changed === false
      );
    },
  },
  {
    id: "27_claim_missing_next_soft_promote",
    run: () => {
      const voice =
        "걱정되시는 마음 알겠어요. 확인 전에는 지급 여부를 단정할 수 없어요. 수술명이나 진단명을 알려주시면, 진단서·수술확인서·영수증·진료비 세부내역·해당 담보부터 같이 확인해볼까요?";
      const d = decideStage3Promotion({
        question: "수술비도 많이 들었고 보험금 받을 수 있을지 걱정이야",
        s6FinalAnswer: s6,
        shadow: goodShadow({
          borrowed: goodBorrowed({
            voice_raw_candidate: voice,
            proposal_direction: "서류·담보 확인",
            recommendation_basis: "확인 전 지급 단정 금지",
            next_decision_point: [],
          }),
        }),
        env: previewActive,
        decision: {
          response_priority: "claim_prep",
          situation_key: "claim_need_check",
          direction: { type: "claim_prep", move: "서류 확인" },
        },
        history: [
          { role: "user", content: "분당 맛집 추천해줘" },
          { role: "assistant", content: "분당 쪽 선택지가 많아요." },
        ],
      });
      return (
        d.promotion_pass === true &&
        d.final_answer_source === "s7" &&
        Array.isArray(d.mid_field_warnings) &&
        d.mid_field_warnings.includes("missing_next_decision")
      );
    },
  },
];

let failed = 0;
for (const c of cases) {
  let ok = false;
  let err = null;
  try {
    ok = c.run() === true;
  } catch (e) {
    err = e;
    ok = false;
  }
  if (!ok) {
    failed += 1;
    console.error(`FAIL ${c.id}${err ? ` :: ${err?.stack || err}` : ""}`);
  } else {
    console.log(`PASS ${c.id}`);
  }
}

if (failed > 0) {
  console.error(`\nStage3 unit FAIL: ${failed}/${cases.length}`);
  process.exit(1);
}
console.log(`\nStage3 unit PASS: ${cases.length}/${cases.length}`);
