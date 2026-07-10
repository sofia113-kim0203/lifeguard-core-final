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
