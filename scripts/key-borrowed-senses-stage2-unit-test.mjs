/**
 * S7 Stage 2 partial promotion unit tests (local only · no Claude · no Preview).
 */
import {
  decideStage2Promotion,
  matchStage2Allowlist,
  isQ10PortfolioExpansionQuestion,
  STAGE2_TIER_A_ALLOWLIST,
} from "../server/keyCore/keyBorrowedSensesStage2.js";
import {
  getKeyBorrowedSensesMode,
  isKeyBorrowedSensesStage2Partial,
  isKeyBorrowedSensesProbeEnabled,
  isVercelProductionEnv,
  isStage2PromotionEnvAllowed,
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
const qBrowse = "그냥 둘러보러 왔어";

const cases = [
  {
    id: "F1_flags_shadow_mode",
    run: () => {
      const env = { KEY_BORROWED_SENSES: "shadow", VERCEL_ENV: "preview" };
      return (
        getKeyBorrowedSensesMode(env) === "shadow" &&
        isKeyBorrowedSensesStage2Partial(env) === false &&
        isKeyBorrowedSensesProbeEnabled(env) === true &&
        isStage2PromotionEnvAllowed(env) === false
      );
    },
  },
  {
    id: "F2_flags_active_partial_preview",
    run: () => {
      const env = { KEY_BORROWED_SENSES: "active_partial", VERCEL_ENV: "preview" };
      return (
        getKeyBorrowedSensesMode(env) === "active_partial" &&
        isKeyBorrowedSensesStage2Partial(env) === true &&
        isKeyBorrowedSensesProbeEnabled(env) === true &&
        isVercelProductionEnv(env) === false &&
        isStage2PromotionEnvAllowed(env) === true
      );
    },
  },
  {
    id: "F3_flags_production_hard_block",
    run: () => {
      const env = { KEY_BORROWED_SENSES: "active_partial", VERCEL_ENV: "production" };
      return (
        isVercelProductionEnv(env) === true &&
        isStage2PromotionEnvAllowed(env) === false
      );
    },
  },
  {
    id: "A1_allowlist_five",
    run: () => {
      if (STAGE2_TIER_A_ALLOWLIST.length !== 5) return false;
      for (const item of STAGE2_TIER_A_ALLOWLIST) {
        if (!matchStage2Allowlist(item.question)) return false;
      }
      return matchStage2Allowlist("아무거나 물어봐") === null;
    },
  },
  {
    id: "S1_shadow_mode_keeps_s6",
    run: () => {
      const d = decideStage2Promotion({
        question: qBrowse,
        s6FinalAnswer: s6,
        shadow: goodShadow(),
        env: { KEY_BORROWED_SENSES: "shadow", VERCEL_ENV: "preview" },
      });
      return (
        d.promotion_pass === false &&
        d.final_answer_source === "s6" &&
        d.customer_text_changed === false &&
        d.customer_text === s6 &&
        d.fallback_reason === "flag_not_active_partial"
      );
    },
  },
  {
    id: "S2_active_partial_preview_allowlist_pass",
    run: () => {
      const d = decideStage2Promotion({
        question: qBrowse,
        s6FinalAnswer: s6,
        shadow: goodShadow(),
        env: { KEY_BORROWED_SENSES: "active_partial", VERCEL_ENV: "preview" },
      });
      return (
        d.promotion_pass === true &&
        d.final_answer_source === "s7" &&
        d.customer_text_changed === true &&
        d.allowlist_hit === true &&
        d.allowlist_id === "FULLVOICE_Q7_BROWSE" &&
        d.production_blocked === false &&
        d.customer_text === goodBorrowed().voice_raw_candidate
      );
    },
  },
  {
    id: "S3_active_partial_production_blocked",
    run: () => {
      const d = decideStage2Promotion({
        question: qBrowse,
        s6FinalAnswer: s6,
        shadow: goodShadow(),
        env: { KEY_BORROWED_SENSES: "active_partial", VERCEL_ENV: "production" },
      });
      return (
        d.promotion_pass === false &&
        d.final_answer_source === "s6" &&
        d.customer_text_changed === false &&
        d.production_blocked === true &&
        d.fallback_reason === "production_blocked" &&
        d.customer_text === s6
      );
    },
  },
  {
    id: "S4_allowlist_miss",
    run: () => {
      const d = decideStage2Promotion({
        question: "오늘 날씨 어때?",
        s6FinalAnswer: s6,
        shadow: goodShadow(),
        env: { KEY_BORROWED_SENSES: "active_partial", VERCEL_ENV: "preview" },
      });
      return (
        d.promotion_pass === false &&
        d.final_answer_source === "s6" &&
        d.customer_text_changed === false &&
        d.fallback_reason === "allowlist_miss"
      );
    },
  },
  {
    id: "S5_gate_fail",
    run: () => {
      const d = decideStage2Promotion({
        question: qBrowse,
        s6FinalAnswer: s6,
        shadow: goodShadow({ gate: goodGate({ ok: false, unsupported_recommendation: true }) }),
        env: { KEY_BORROWED_SENSES: "active_partial", VERCEL_ENV: "preview" },
      });
      return (
        d.promotion_pass === false &&
        d.final_answer_source === "s6" &&
        d.customer_text_changed === false &&
        d.fallback_reason === "gate_fail"
      );
    },
  },
  {
    id: "S6_product_push",
    run: () => {
      const d = decideStage2Promotion({
        question: qBrowse,
        s6FinalAnswer: s6,
        shadow: goodShadow({
          borrowed: goodBorrowed({
            voice_raw_candidate: "이 상품 가입하세요. 지금 가입하는 게 좋습니다.",
            next_decision_point: ["지금 가입", "나중에"],
          }),
          gate: goodGate({
            ok: false,
            unsupported_recommendation: true,
            product_push_as_direction: true,
          }),
        }),
        env: { KEY_BORROWED_SENSES: "active_partial", VERCEL_ENV: "preview" },
      });
      return (
        d.promotion_pass === false &&
        d.final_answer_source === "s6" &&
        d.customer_text_changed === false
      );
    },
  },
  {
    id: "S7_invent_number",
    run: () => {
      const d = decideStage2Promotion({
        question: "보험료 줄이고 싶어",
        s6FinalAnswer: s6,
        shadow: goodShadow({
          borrowed: goodBorrowed({
            voice_raw_candidate:
              "보통 30%는 줄일 수 있습니다. 월 5만 원 줄일 수 있습니다. 납입부터 볼까요?",
            next_decision_point: ["납입부터", "중복부터", "조정부터"],
          }),
          gate: goodGate({ ok: false, number_scope_violation: true }),
        }),
        env: { KEY_BORROWED_SENSES: "active_partial", VERCEL_ENV: "preview" },
      });
      return (
        d.promotion_pass === false &&
        d.final_answer_source === "s6" &&
        d.customer_text_changed === false &&
        (d.fallback_reason === "gate_fail" || d.fallback_reason === "number_scope_violation")
      );
    },
  },
  {
    id: "S8_empty_voice",
    run: () => {
      const d = decideStage2Promotion({
        question: qBrowse,
        s6FinalAnswer: s6,
        shadow: goodShadow({
          borrowed: goodBorrowed({ voice_raw_candidate: "" }),
        }),
        env: { KEY_BORROWED_SENSES: "active_partial", VERCEL_ENV: "preview" },
      });
      return (
        d.promotion_pass === false &&
        d.final_answer_source === "s6" &&
        d.fallback_reason === "empty_voice"
      );
    },
  },
  {
    id: "S9_wait_only",
    run: () => {
      const d = decideStage2Promotion({
        question: qBrowse,
        s6FinalAnswer: s6,
        shadow: goodShadow({
          borrowed: goodBorrowed({
            voice_raw_candidate: "궁금한 게 생기면 말씀해 주세요.",
            recommendation_basis: null,
            next_decision_point: ["a", "b"],
          }),
        }),
        env: { KEY_BORROWED_SENSES: "active_partial", VERCEL_ENV: "preview" },
      });
      return (
        d.promotion_pass === false &&
        d.final_answer_source === "s6" &&
        d.fallback_reason === "wait_only"
      );
    },
  },
  {
    id: "S10_q10_portfolio_expansion",
    run: () => {
      if (!isQ10PortfolioExpansionQuestion("내 보험 전체 괜찮아?")) return false;
      const d = decideStage2Promotion({
        question: "내 보험 전체 괜찮아?",
        s6FinalAnswer: s6,
        shadow: goodShadow(),
        env: { KEY_BORROWED_SENSES: "active_partial", VERCEL_ENV: "preview" },
      });
      return (
        d.promotion_pass === false &&
        d.final_answer_source === "s6" &&
        d.customer_text_changed === false &&
        d.fallback_reason === "q10_portfolio_expansion"
      );
    },
  },
  {
    id: "S11_shadow_error",
    run: () => {
      const d = decideStage2Promotion({
        question: qBrowse,
        s6FinalAnswer: s6,
        shadow: goodShadow({ error: "CLAUDE_TIMEOUT", borrowed: null, gate: null }),
        env: { KEY_BORROWED_SENSES: "active_partial", VERCEL_ENV: "preview" },
      });
      return (
        d.promotion_pass === false &&
        d.final_answer_source === "s6" &&
        d.fallback_reason === "CLAUDE_TIMEOUT"
      );
    },
  },
];

let failed = 0;
for (const c of cases) {
  let ok = false;
  try {
    ok = Boolean(c.run());
  } catch (err) {
    ok = false;
    console.error("FAIL", c.id, err);
  }
  if (!ok) {
    failed += 1;
    console.error("FAIL", c.id);
  } else {
    console.log("PASS", c.id);
  }
}

if (failed) {
  console.error(`${failed} stage2 unit(s) failed`);
  process.exit(1);
}
console.log(`PASS all ${cases.length} S7 Stage2 partial units`);
