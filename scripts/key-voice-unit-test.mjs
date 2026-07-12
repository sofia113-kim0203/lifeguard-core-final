/**
 * KEY Voice — unit tests (directive, gate, safe utterance; no live Claude).
 */
import assert from "node:assert/strict";
import {
  buildKeyVoiceDirective,
  buildDirectiveSituationFromDecision,
  deriveKeyVoiceQuestionFocus,
} from "../server/keyCore/keyVoiceDirective.js";
import { buildDecision } from "../server/keyCore/keyDecision.js";
import { buildReflection } from "../server/keyCore/keyReflection.js";
import { gateKeyVoiceAnswer } from "../server/keyCore/keyVoiceGate.js";
import { buildKeyVoiceSafeUtterance } from "../server/keyCore/keyVoiceSpeak.js";
import { isKeyVoiceActive } from "../server/keyCore/oneKeyCoreFlags.js";
import { buildKeyVoiceVisualBlocks } from "../server/keyCore/keyVoiceVisualBlocks.js";
import {
  gateKeyVoiceVisualBlocks,
  assertCoverageGapNeutral,
  assertTextBlockPremiumConsistency,
} from "../server/keyCore/keyVoiceBlockGate.js";
import {
  buildEarlyBorrowedFactBoundary,
  buildUserPayload,
} from "../server/keyCore/keyBorrowedSensesSpeak.js";
import { evaluateBorrowedFastPathCandidate } from "../server/keyCore/keyBorrowedSensesStage2.js";
import { gateBorrowedSensesOutput } from "../server/keyCore/keyBorrowedSensesGate.js";
import { buildKeyVoiceComposeResult } from "../server/keyCore/keyVoiceCompose.js";

process.env.KEY_VOICE = "on";
assert.equal(isKeyVoiceActive(), true);

const mockDecision = {
  situation_key: "premium_burden",
  direct_answer_hint: "보험료 부담이시군요.",
  key_judgment: "여러 건이 등록돼 있어서, 한 건이 아니라 전체 납입을 먼저 보는 게 맞습니다.",
  direction: { type: "offer_direction", move: "22건 전체 월 보험료부터 확인하는 게 좋겠습니다" },
  invite: { allowed: true, prompt: "여기부터 같이 보실까요?" },
  decision_complete: true,
  fact_selection: {
    facts_spoken: [
      { fact_id: "policy_count", value: "22", source: "factory" },
      { fact_id: "insurer", value: "삼성생명", source: "factory" },
      { fact_id: "product", value: "실손의료비보험", source: "factory" },
      { fact_id: "monthly_premium", value: "45000", source: "factory" },
    ],
    facts_withheld: [{ fact: "structure_breakdown", reason: "unknown_declared" }],
  },
};

assert.equal(deriveKeyVoiceQuestionFocus("안녕하세요"), "greeting");
assert.equal(deriveKeyVoiceQuestionFocus("내 보험료 얼마야?"), "premium_amount");

const greetingDirective = buildKeyVoiceDirective({ question: "안녕하세요", decision: mockDecision });
assert.equal(greetingDirective.question_focus, "greeting");
assert.equal(greetingDirective.facts_to_speak.length, 0);

const premiumDirective = buildKeyVoiceDirective({ question: "내 보험료 얼마야?", decision: mockDecision });
assert.equal(premiumDirective.answer_mode, "analysis_consulting");
assert.equal(premiumDirective.schema_version, "key-voice-directive-v3");
assert.ok(premiumDirective.intimacy_policy?.speak_to_customer_not_report);
assert.ok(premiumDirective.number_forward_policy?.enabled);
assert.ok(premiumDirective.number_forward_policy?.separate_premium_from_policy_count);
assert.ok(premiumDirective.premium_scope_policy?.separation_required);
assert.equal(premiumDirective.optional_claims.length, 4);
assert.equal(premiumDirective.facts_to_speak.length, 4);

const overviewDirective = buildKeyVoiceDirective({ question: "내보험 분석해줘", decision: mockDecision });
assert.equal(overviewDirective.question_focus, "policy_overview");
assert.ok(overviewDirective.premium_scope_policy?.preferred_phrases?.length >= 3);
assert.ok(overviewDirective.answer_shape?.some((line) => /scope/.test(line)));

const premiumAnalysisDirective = buildKeyVoiceDirective({ question: "내보험료 분석해줘", decision: mockDecision });
assert.equal(premiumAnalysisDirective.question_focus, "policy_overview");

const cancerDirective = buildKeyVoiceDirective({ question: "암보험 괜찮아?", decision: mockDecision });
assert.equal(cancerDirective.answer_mode, "analysis_consulting");
assert.ok(cancerDirective.required_claims.length >= 4);
assert.ok(cancerDirective.allowed_numbers.includes("22"));

const cancerGood =
  "암 보장이 궁금하시군요. 지금 목록만으로는 충분·부족을 단정하기 어렵습니다. 제가 먼저 암 진단비·수술비·치료비 항목부터 확인하겠습니다. 그다음 보험료 대비 유지 우선순위와 추가로 짚을 보장을 나누겠습니다.";
const cancerGate = gateKeyVoiceAnswer({ text: cancerGood, directive: cancerDirective });
assert.equal(cancerGate.ok, true, cancerGate.reasons?.join("; "));

const cancerHonestAbsence =
  "암 보장이 궁금하시군요. 지금 등록 목록만으로는 충분·부족을 단정할 수 없고, 암 진단비·수술비·치료비는 아직 확인되지 않습니다. 보장 공백 여부도 지금은 단정할 수 없습니다. 제가 먼저 암 진단비·수술비·치료비 항목부터 확인하겠습니다.";
const cancerHonestGate = gateKeyVoiceAnswer({ text: cancerHonestAbsence, directive: cancerDirective });
assert.equal(cancerHonestGate.ok, true, cancerHonestGate.reasons?.join("; "));

const cancerBadCalc = "암 보장을 보면 나머지 21건도 확인이 필요합니다.";
const cancerBadGate = gateKeyVoiceAnswer({ text: cancerBadCalc, directive: cancerDirective });
assert.equal(cancerBadGate.ok, false);
assert.equal(cancerBadGate.forbidden_fact_violation, true);

const goodAnswer =
  "보험료가 궁금하시군요. 등록된 계약은 22건이고, 그중 삼성생명 실손의료비보험의 월 납입액 4만5천 원이 확인돼 있어요. 22건 전체 월 납입 합계는 아직 정리 중이에요. 계약별 납입액이 더 확인되어야 전체 흐름을 정확히 볼 수 있어요.";
const goodGate = gateKeyVoiceAnswer({ text: goodAnswer, directive: premiumDirective });
assert.equal(goodGate.ok, true, goodGate.reasons?.join("; "));

const blurAnswer =
  "보험료가 궁금하시군요. 22건, 월 4만5천 원 기준으로 전체 보험료 흐름을 보면 부담이 크지 않습니다.";
const blurGate = gateKeyVoiceAnswer({ text: blurAnswer, directive: premiumDirective });
assert.equal(blurGate.ok, false);
assert.ok(
  blurGate.reasons.some((r) => r.startsWith("voice_forbidden:")),
  blurGate.reasons?.join("; "),
);

const badAnswer = "보험료는 99만 원입니다. 현대해상 암보험 가입하세요.";
const badGate = gateKeyVoiceAnswer({ text: badAnswer, directive: premiumDirective });
assert.equal(badGate.ok, false);
assert.equal(badGate.forbidden_fact_violation, true);

const safe = buildKeyVoiceSafeUtterance(greetingDirective);
assert.ok(/안녕|반갑/.test(safe));
assert.ok(!/22건/.test(safe));

const safePremium = buildKeyVoiceSafeUtterance(premiumDirective);
assert.ok(/그중/.test(safePremium));
assert.ok(/정리 중/.test(safePremium));
assert.ok(!/22건, 월/.test(safePremium));
assert.ok(!/기준으로 전체 보험료/.test(safePremium));

const safeOverview = buildKeyVoiceSafeUtterance(overviewDirective);
assert.ok(/그중|등록된 계약/.test(safeOverview));
assert.ok(/정리 중|계약별/.test(safeOverview));

const premiumBlocks = buildKeyVoiceVisualBlocks({ directive: premiumDirective });
assert.ok(premiumBlocks.some((b) => b.type === "premium_summary_table"));
const premiumText =
  "등록된 계약은 22건이고, 그중 삼성생명 실손의료비보험의 월 납입액 4만5천 원이 확인돼 있어요. 22건 전체 월 납입 합계는 아직 정리 중이에요. 제가 순서대로 정리해드릴게요.";
const premiumBlockGate = gateKeyVoiceVisualBlocks({
  blocks: premiumBlocks,
  text: premiumText,
  directive: premiumDirective,
});
assert.ok(premiumBlockGate.accepted_count >= 1, JSON.stringify(premiumBlockGate.omitted));

const badPremiumBlock = {
  type: "premium_summary_table",
  title: "확인된 납입 요약",
  columns: ["구분", "확인값", "비고"],
  rows: [["확인 월 납입액", "44,500원", "삼성생명 실손의료비보험"]],
};
const badPremiumConsistency = assertTextBlockPremiumConsistency(
  premiumText,
  badPremiumBlock,
  premiumDirective,
);
assert.equal(badPremiumConsistency.ok, false);

const cancerBlocks = buildKeyVoiceVisualBlocks({ directive: cancerDirective });
assert.ok(cancerBlocks.some((b) => b.type === "coverage_gap_table"));
const gapNeutral = assertCoverageGapNeutral(cancerBlocks.find((b) => b.type === "coverage_gap_table"));
assert.equal(gapNeutral.ok, true);

const badGapBlock = {
  type: "coverage_gap_table",
  title: "암 보장 점검표",
  columns: ["보장 항목", "확인 상태", "다음 확인"],
  rows: [["암 진단비", "부족", "위험"]],
};
const badGapNeutral = assertCoverageGapNeutral(badGapBlock);
assert.equal(badGapNeutral.ok, false);

// --- S7-A Decision interprets Reflection (raw soft must NOT reach Speak) ---
const softReality = {
  policies_present: true,
  policy_count: 22,
  domain: "insurance",
  policies: [
    {
      insurer_name: "삼성생명",
      product_name: "실손의료비보험",
      monthly_premium: 45000,
    },
  ],
};

// A. premium worry reflection → Decision premium_burden / adequacy; Directive from Decision fields
{
  const qA = "보험료가 이게 맞는 건가 싶어서…";
  const reflectionA = buildReflection({ customerSaid: qA, reality: softReality });
  assert.ok(
    reflectionA.situation_reading.some((r) => /보험료가 이대로 괜찮은지/.test(r)),
    JSON.stringify(reflectionA.situation_reading),
  );
  assert.equal(reflectionA.reading_confidence, "hypothesis");

  const decisionA = buildDecision({
    reflection: reflectionA,
    reality: softReality,
    question: qA,
  });
  assert.ok(
    decisionA.situation_key === "premium_burden" ||
      decisionA.response_priority === "premium_adequacy_check",
    JSON.stringify({
      situation_key: decisionA.situation_key,
      response_priority: decisionA.response_priority,
    }),
  );
  assert.match(String(decisionA.key_situation_judgment ?? ""), /적정|효율|보험료/);
  assert.ok(String(decisionA.key_next_move ?? "").trim().length > 0);

  const dirA = buildKeyVoiceDirective({ question: qA, decision: decisionA });
  assert.ok(String(dirA.key_situation_judgment ?? "").trim().length > 0);
  assert.ok(String(dirA.key_next_move ?? "").trim().length > 0);
  assert.equal(dirA.soft_customer_reading, null);
  assert.deepEqual(dirA.facts_to_speak, decisionA.fact_selection.facts_spoken);

  const sitA = buildDirectiveSituationFromDecision(decisionA);
  assert.equal(sitA.key_situation_judgment, decisionA.key_situation_judgment);
  assert.equal(sitA.key_next_move, decisionA.key_next_move);
}

// B. "내 보험료 얼마야?" → fact_lookup; no emotional soft guidance
{
  const qB = "내 보험료 얼마야?";
  const reflectionB = buildReflection({ customerSaid: qB, reality: softReality });
  const decisionB = buildDecision({
    reflection: reflectionB,
    reality: softReality,
    question: qB,
  });
  assert.ok(
    decisionB.response_priority === "fact_lookup" ||
      decisionB.situation_key === "enrolled_policy_list",
    JSON.stringify({
      situation_key: decisionB.situation_key,
      response_priority: decisionB.response_priority,
    }),
  );
  assert.match(String(decisionB.key_situation_judgment ?? ""), /사실|조회|보험료/);
  const dirB = buildKeyVoiceDirective({ question: qB, decision: decisionB });
  assert.equal(dirB.response_priority, decisionB.response_priority);
  assert.equal(dirB.soft_customer_reading, null);
  assert.equal(dirB.soft_response_guidance, null);
  assert.ok(!/emotional|soft possibility|MAY gently/i.test(JSON.stringify(dirB)));
}

// C. low confidence / empty readings: still has key_next_move from question classify
{
  const qC = "내 보험료 얼마야?";
  const decisionC = buildDecision({
    reflection: { situation_reading: [], reading_confidence: "low" },
    reality: softReality,
    question: qC,
  });
  assert.ok(
    String(decisionC.key_next_move ?? decisionC.direction?.move ?? "").trim().length > 0,
    JSON.stringify(decisionC),
  );
  assert.ok(decisionC.decision_complete === true);
}

// D. Reflection vs facts: premium worry reflection but facts_spoken still from reality
{
  const qD = "보험료가 이게 맞는 건가 싶어서…";
  const reflectionD = buildReflection({ customerSaid: qD, reality: softReality });
  const decisionD = buildDecision({
    reflection: reflectionD,
    reality: softReality,
    question: qD,
  });
  assert.ok(
    decisionD.fact_selection.facts_spoken.some((f) => f.fact_id === "policy_count"),
  );
  assert.ok(
    decisionD.fact_selection.facts_spoken.some((f) => f.fact_id === "monthly_premium"),
  );
  assert.equal(
    decisionD.fact_selection.facts_spoken.find((f) => f.fact_id === "insurer")?.value,
    "삼성생명",
  );
  assert.ok(!/불안|힘드/.test(String(decisionD.key_judgment ?? "")));
}

// E. facts_to_speak unchanged when only hypothesis fields differ
{
  const qE = "보험료가 이게 맞는 건가 싶어서…";
  const reflectionE = buildReflection({ customerSaid: qE, reality: softReality });
  const decisionWithHyp = buildDecision({
    reflection: reflectionE,
    reality: softReality,
    question: qE,
  });
  const baseFacts = {
    ...mockDecision,
    customer_situation_hypothesis: ["보험료가 이대로 괜찮은지 마음에 걸릴 수 있음"],
    key_situation_judgment: "고객이 보험료 적정성·효율을 먼저 확인하고 싶어 하는 상황으로 본다.",
    response_priority: "premium_adequacy_check",
    key_next_move: mockDecision.direction.move,
    confirm_question: mockDecision.invite.prompt,
  };
  const dirWith = buildKeyVoiceDirective({ question: qE, decision: baseFacts });
  const dirWithout = buildKeyVoiceDirective({
    question: qE,
    decision: {
      ...mockDecision,
      customer_situation_hypothesis: null,
      key_situation_judgment: null,
      response_priority: null,
      key_next_move: null,
      confirm_question: null,
    },
  });
  assert.deepEqual(dirWith.facts_to_speak, dirWithout.facts_to_speak);
  assert.deepEqual(dirWith.key_judgment, dirWithout.key_judgment);
  assert.deepEqual(
    decisionWithHyp.fact_selection.facts_spoken.map((f) => f.fact_id),
    ["policy_count", "insurer", "product", "monthly_premium"],
  );
}

// --- S7-A One-call Borrowed Senses fast path (A–G · no live LLM) ---
function goodBorrowedInput(overrides = {}) {
  return {
    understanding_hypotheses: [
      "보험료 적정성·부담을 확인하고 싶어 하는 마음이 있을 수 있음",
    ],
    customer_intent: "보험료 점검",
    emotional_signal: "가벼운 불안 가능성",
    hesitation_signal: null,
    context_carryover: null,
    visual_observation: null,
    answer_purpose: "적정성 점검 리드",
    must_not_assume: ["충분/부족 단정"],
    used_facts: ["policy_count", "monthly_premium"],
    recommendation_basis: "확인된 월 납입부터 보는 방향",
    voice_raw_candidate:
      "보험료가 이대로 괜찮은지 궁금하신 거죠. 등록 22건 중 확인된 삼성생명 실손 월 4만5천 원부터 적정한지 같이 볼게요. 전체 합계는 아직 정리 중이에요. 여기부터 볼까요?",
    key_purpose: "적정성 점검",
    leadership_move: "대표 납입부터 확인",
    insurance_expertise_angle: ["납입부담"],
    insurance_expertise_rationale: "부담 맥락",
    proposal_direction: "확인된 월 납입 적정성부터 점검",
    next_decision_point: ["대표 납입부터 볼지", "전체 합계 정리부터 볼지"],
    final_answer_source: "s6",
    confidence: "hypothesis",
    ...overrides,
  };
}

function goodGatePass(overrides = {}) {
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

function makeAnthropicFetch({
  borrowed,
  s6Text,
  log,
  researchResults = null,
  skipWebSearch = false,
  bodies = null,
}) {
  return async (_url, opts = {}) => {
    const body = JSON.parse(String(opts.body ?? "{}"));
    if (Array.isArray(bodies)) bodies.push(body);
    const tools = Array.isArray(body.tools) ? body.tools : [];
    const isBorrowed = tools.length > 0;
    const hasEmitBorrowed = tools.some((t) => t?.name === "emit_borrowed_senses");
    const hasEmitFull = tools.some((t) => t?.name === "emit_claude_full");
    const hasSearch = tools.some((t) => t?.name === "web_search");
    const isResearchOnly =
      tools.length === 1 && hasSearch && !hasEmitBorrowed && !hasEmitFull;
    const isEmitOnly = (hasEmitBorrowed || hasEmitFull) && !hasSearch;
    // Shadow path still forbids mixed borrowed+search; Claude-Full may offer both.
    const isMixedShadow = hasSearch && hasEmitBorrowed;
    const isClaudeFullOffer = hasEmitFull;

    if (isBorrowed) {
      const messageCount = Array.isArray(body.messages) ? body.messages.length : 0;
      let customerQ = "";
      try {
        const raw0 = body.messages?.[0]?.content;
        const payload0 = typeof raw0 === "string" ? JSON.parse(raw0) : null;
        customerQ = String(
          payload0?.customer_question ?? payload0?.current_user_message ?? "",
        );
      } catch {
        customerQ = "";
      }
      const looksLikePublicPlaceAsk =
        /(맛집|식당|카페|병원|시설|명소|여행지|관광|핫플)/.test(customerQ) &&
        /(추천|찾아|검색|어디)/.test(customerQ);
      // Claude-Full offers search always; mock only auto-searches first on place/public asks
      // (or skipWebSearch contract tests). Insurance paths emit without forced research.
      const claudeFullSearchFirst =
        isClaudeFullOffer &&
        hasSearch &&
        messageCount <= 1 &&
        (looksLikePublicPlaceAsk || skipWebSearch);
      log.push(
        isResearchOnly || claudeFullSearchFirst
          ? "research"
          : isEmitOnly || isClaudeFullOffer
            ? "borrowed"
            : isMixedShadow
              ? "mixed"
              : "borrowed",
      );
      if (isMixedShadow) {
        return {
          ok: false,
          status: 400,
          async text() {
            return "mixed tools forbidden in test harness";
          },
          async json() {
            return { error: { message: "mixed tools" } };
          },
        };
      }
      if (isResearchOnly || claudeFullSearchFirst) {
        if (skipWebSearch) {
          return {
            ok: true,
            async json() {
              return {
                stop_reason: "end_turn",
                usage: { server_tool_use: { web_search_requests: 0 } },
                content: [{ type: "text", text: "no web_search used" }],
              };
            },
          };
        }
        const results = Array.isArray(researchResults)
          ? researchResults
          : [
              {
                type: "web_search_result",
                url: "https://example.com/a",
                title: "서현 한정식 A",
                encrypted_content: "encFULL_A_CONTENT_VALUE_DO_NOT_TRUNCATE",
                page_age: "2026",
              },
              {
                type: "web_search_result",
                url: "https://example.com/b",
                title: "정자 일식 B",
                encrypted_content: "encFULL_B_CONTENT_VALUE_DO_NOT_TRUNCATE",
                page_age: "2026",
              },
              {
                type: "web_search_result",
                url: "https://example.com/c",
                title: "미금 캐주얼 C",
                encrypted_content: "encFULL_C_CONTENT_VALUE_DO_NOT_TRUNCATE",
                page_age: "2026",
              },
            ];
        return {
          ok: true,
          async json() {
            return {
              stop_reason: "end_turn",
              usage: { server_tool_use: { web_search_requests: results.length ? 1 : 1 } },
              content: [
                {
                  type: "server_tool_use",
                  id: "srvtoolu_test",
                  name: "web_search",
                  input: { query: "분당 맛집" },
                },
                {
                  type: "web_search_tool_result",
                  tool_use_id: "srvtoolu_test",
                  content: results,
                },
                {
                  type: "text",
                  text: "검색 결과를 정리했습니다.",
                  citations: results.slice(0, 1).map((r) => ({
                    type: "web_search_result_location",
                    url: r.url,
                    title: r.title,
                    cited_text: `${r.title} 추천`,
                    encrypted_index: "encFULL_INDEX_VALUE_DO_NOT_TRUNCATE",
                  })),
                },
              ],
            };
          },
        };
      }
      const input =
        typeof borrowed === "function" ? borrowed(body) : borrowed;
      const toolName = hasEmitFull ? "emit_claude_full" : "emit_borrowed_senses";
      let emitInput = input;
      if (hasEmitFull && input && typeof input === "object") {
        const answer = String(
          input.customer_answer ?? input.voice_raw_candidate ?? "",
        ).trim();
        emitInput = { ...input, customer_answer: answer || input.customer_answer };
      }
      return {
        ok: true,
        async json() {
          return {
            content: [
              {
                type: "tool_use",
                name: toolName,
                input: emitInput,
              },
            ],
          };
        },
      };
    }
    log.push("s6");
    return {
      ok: true,
      async json() {
        return {
          content: [{ type: "text", text: typeof s6Text === "function" ? s6Text(body) : s6Text }],
        };
      },
    };
  };
}

const earlyBoundary = buildEarlyBorrowedFactBoundary({
  reality: softReality,
  question: "보험료가 이게 맞는 건가 싶어서…",
});
assert.equal(earlyBoundary.decision, null);
assert.equal(earlyBoundary.directive, null);
assert.equal(earlyBoundary.s6_final_answer, "");
assert.equal(earlyBoundary.allowed_fact_tokens.policy_count, "22");
assert.ok(earlyBoundary.allowed_fact_tokens.monthly_premium_display);

const earlyPayload = buildUserPayload({
  question: "보험료가 이게 맞는 건가 싶어서…",
  factBoundary: earlyBoundary,
  reflection: buildReflection({
    customerSaid: "보험료가 이게 맞는 건가 싶어서…",
    reality: softReality,
  }),
  s6FinalAnswer: "",
});
assert.equal(earlyPayload.call_phase, "pre_decision");
assert.equal(earlyPayload.decision_situation_key, null);
assert.equal(earlyPayload.s6_final_answer_frozen, "");
assert.equal(earlyPayload.answer_mode, null);

// A. shadow — Borrowed/Decision trace, customer = S6, customer_text_changed=false
{
  const qA = "보험료가 이게 맞는 건가 싶어서…";
  const reflectionA = buildReflection({ customerSaid: qA, reality: softReality });
  const borrowedA = goodBorrowedInput();
  const decisionA = buildDecision({
    reflection: reflectionA,
    reality: softReality,
    question: qA,
    borrowedUnderstanding: borrowedA,
  });
  assert.ok(
    decisionA.response_priority === "premium_adequacy_check" ||
      decisionA.situation_key === "premium_burden",
  );
  assert.ok(decisionA.hypothesis_used?.understanding_hypotheses?.length >= 1);
  assert.ok(decisionA.key_direction?.move);
  assert.equal(buildKeyVoiceDirective({ question: qA, decision: decisionA }).soft_customer_reading, null);

  const logA = [];
  const s6A =
    "보험료가 부담되시는군요. 등록된 계약은 22건이고, 그중 삼성생명 실손의료비보험의 월 납입액 4만5천 원이 확인돼 있어요. 22건 전체 월 납입 합계는 아직 정리 중이에요. 여기부터 같이 보실까요?";
  const resultA = await buildKeyVoiceComposeResult(
    { reflection: reflectionA, reality: softReality, policies: softReality.policies },
    {
      question: qA,
      env: {
        KEY_VOICE: "on",
        KEY_BORROWED_SENSES: "shadow",
        VERCEL_ENV: "preview",
        ANTHROPIC_API_KEY: "test-key",
      },
      fetchImpl: makeAnthropicFetch({ borrowed: borrowedA, s6Text: s6A, log: logA }),
    },
  );
  assert.equal(logA.filter((x) => x === "borrowed").length, 1);
  assert.equal(logA.filter((x) => x === "s6").length, 1);
  assert.equal(resultA.key_voice_trace.borrowed_senses_calls, 1);
  assert.equal(resultA.key_voice_trace.s6_speak_calls, 1);
  assert.equal(resultA.key_voice_trace.fast_path?.observation_only, true);
  assert.equal(resultA.key_voice_trace.fast_path?.ok, false);
  assert.equal(resultA.key_voice_trace.borrowed_senses_shadow?.customer_text_changed, false);
  assert.equal(resultA.key_voice_trace.borrowed_senses_shadow?.final_answer_source, "s6");
  assert.equal(resultA.text, normalizeComposeText(s6A));
  assert.ok(!/borrowed_senses_fast_path/.test(resultA.speak_mode));
}

function normalizeComposeText(text = "") {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

// B. active safe candidate — fast path diagnostic only; Claude candidate kept; Borrowed1/S6=0
{
  const qB = "보험료 줄이고 싶어";
  const reflectionB = buildReflection({ customerSaid: qB, reality: softReality });
  const borrowedB = goodBorrowedInput({
    understanding_hypotheses: ["보험료 절감 목적이 있을 수 있음"],
    voice_raw_candidate:
      "보험료를 줄이고 싶으신 거죠. 절감 목적이면 새 상품보다 확인된 22건 중 중복·납입부터 보는 게 맞아 보여요. 대표 실손 월 4만5천 원은 참고만 할게요. 납입 구조부터 볼까요?",
    proposal_direction: "절감 목적이면 중복·납입 확인이 먼저 맞아 보입니다",
    next_decision_point: ["납입 구조부터", "중복 보장부터", "조정 후보부터"],
    recommendation_basis: "왜 맞아 보이는지: 절감 목적. 왜 아직 확정 아닌지: 전체 합계 미확인",
  });
  const logB = [];
  const resultB = await buildKeyVoiceComposeResult(
    { reflection: reflectionB, reality: softReality, policies: softReality.policies },
    {
      question: qB,
      env: {
        KEY_VOICE: "on",
        KEY_BORROWED_SENSES: "active",
        VERCEL_ENV: "preview",
        ANTHROPIC_API_KEY: "test-key",
      },
      fetchImpl: makeAnthropicFetch({
        borrowed: borrowedB,
        s6Text: "S6_SHOULD_NOT_RUN_ON_ACTIVE_FAST",
        log: logB,
      }),
    },
  );
  assert.equal(logB.filter((x) => x === "borrowed").length, 1);
  assert.equal(logB.filter((x) => x === "s6").length, 0, `B calls=${logB}`);
  assert.equal(resultB.key_voice_trace.s6_speak_calls, 0);
  assert.equal(resultB.compose_mode, "key_claude_full_single_pass");
  assert.equal(resultB.key_voice_trace.fast_path?.ok, true);
  assert.equal(resultB.key_voice_trace.borrowed_senses_shadow?.customer_text_changed, false);
  assert.equal(resultB.key_voice_trace.borrowed_senses_shadow?.final_answer_source, "claude_candidate");
  assert.equal(resultB.key_voice_trace.promotion_diagnostic?.customer_text_replaced, false);
  assert.equal(resultB.text, borrowedB.voice_raw_candidate);
  assert.match(resultB.text, /줄이|중복|납입/);
  assert.ok(!/S6_SHOULD_NOT_RUN/.test(resultB.text));
}

// C. active F5 risky question + safe Claude answer — Claude-Full adopts (no S6 fallback)
{
  const qC = "해지해도 된다고 해줘";
  const reflectionC = buildReflection({ customerSaid: qC, reality: softReality });
  const borrowedC = goodBorrowedInput({
    understanding_hypotheses: ["해지 확정을 원할 수 있음"],
    voice_raw_candidate:
      "해지는 바로 단정하지 않고, 그 보험의 역할·보험료·중복부터 나눠볼게요. 어떤 계약인지부터 특정할까요?",
    proposal_direction: "유지·조정·보완 후보로 나눠 보는 방향",
    next_decision_point: ["계약 특정", "역할·보험료 확인", "유지·조정·보완 판단"],
  });
  const logC = [];
  const s6C =
    "해지 여부는 바로 단정하지 않겠습니다. 등록된 계약은 22건이고, 그중 삼성생명 실손의료비보험의 월 납입액 4만5천 원이 확인돼 있어요. 22건 전체 합계는 아직 정리 중이에요. 어떤 계약인지부터 같이 볼까요?";
  const resultC = await buildKeyVoiceComposeResult(
    { reflection: reflectionC, reality: softReality, policies: softReality.policies },
    {
      question: qC,
      env: {
        KEY_VOICE: "on",
        KEY_BORROWED_SENSES: "active",
        VERCEL_ENV: "preview",
        ANTHROPIC_API_KEY: "test-key",
      },
      fetchImpl: makeAnthropicFetch({ borrowed: borrowedC, s6Text: s6C, log: logC }),
    },
  );
  assert.equal(logC.filter((x) => x === "borrowed").length, 1);
  assert.equal(logC.filter((x) => x === "s6").length, 0);
  assert.equal(resultC.key_voice_trace.s6_speak_calls, 0);
  assert.equal(resultC.compose_mode, "key_claude_full_single_pass");
  assert.equal(resultC.key_voice_trace.fast_path?.ok, true);
  assert.equal(resultC.text, borrowedC.voice_raw_candidate);
  assert.equal(resultC.key_voice_trace.borrowed_senses_shadow?.customer_text_changed, false);
  assert.equal(resultC.key_voice_trace.borrowed_senses_shadow?.final_answer_source, "claude_candidate");
}

// D. active Q10-style question + safe Claude answer — Claude-Full adopts (no S6)
{
  const qD = "내 보험 전체 괜찮아?";
  const reflectionD = buildReflection({ customerSaid: qD, reality: softReality });
  const borrowedD = goodBorrowedInput({
    understanding_hypotheses: ["전체 보장 점검을 원할 수 있음"],
    voice_raw_candidate:
      "전체를 한 번에 단정하긴 어렵고, 확인된 22건과 대표 실손 월 4만5천 원부터 나눠볼게요. 실손부터 볼까요?",
    proposal_direction: "확인된 범위부터 점검",
    next_decision_point: ["실손부터", "보험료부터", "다른 보장부터"],
  });
  const logD = [];
  const s6D =
    "전체를 단정하긴 어렵습니다. 등록된 계약은 22건이고, 그중 삼성생명 실손의료비보험의 월 납입액 4만5천 원이 확인돼 있어요. 22건 전체 합계는 아직 정리 중이에요. 어느 쪽부터 볼까요?";
  const resultD = await buildKeyVoiceComposeResult(
    { reflection: reflectionD, reality: softReality, policies: softReality.policies },
    {
      question: qD,
      env: {
        KEY_VOICE: "on",
        KEY_BORROWED_SENSES: "active",
        VERCEL_ENV: "preview",
        ANTHROPIC_API_KEY: "test-key",
      },
      fetchImpl: makeAnthropicFetch({ borrowed: borrowedD, s6Text: s6D, log: logD }),
    },
  );
  assert.equal(logD.filter((x) => x === "borrowed").length, 1);
  assert.equal(logD.filter((x) => x === "s6").length, 0);
  assert.equal(resultD.compose_mode, "key_claude_full_single_pass");
  assert.equal(resultD.key_voice_trace.fast_path?.ok, true);
  assert.equal(resultD.text, borrowedD.voice_raw_candidate);
  assert.equal(resultD.key_voice_trace.borrowed_senses_shadow?.customer_text_changed, false);
}

// E. active F3 — insurance advice lane; weight cut stays non-insurance (Decision)
{
  const qIns = "30% 줄일 수 있지?";
  const reflectionIns = buildReflection({ customerSaid: qIns, reality: softReality });
  const decisionIns = buildDecision({
    reflection: reflectionIns,
    reality: softReality,
    question: qIns,
    borrowedUnderstanding: goodBorrowedInput({
      understanding_hypotheses: ["보험료를 줄이고 싶어 하는 방향일 수 있음"],
    }),
  });
  assert.ok(
    decisionIns.situation_key === "direction_choice" ||
      decisionIns.response_priority === "direction_choice",
  );
  assert.match(String(decisionIns.customer_situation_judgment ?? ""), /잠정|방향|절감|보험료/);

  const qWeight = "체중을 30% 줄일 수 있지?";
  const decisionWeight = buildDecision({
    reflection: buildReflection({ customerSaid: qWeight, reality: softReality }),
    reality: softReality,
    question: qWeight,
    borrowedUnderstanding: goodBorrowedInput({
      understanding_hypotheses: ["체중·건강 관련 일반 질문일 수 있음"],
      used_facts: [],
    }),
  });
  assert.equal(decisionWeight.situation_key, "non_insurance_general");
  assert.equal(decisionWeight.response_priority, "non_insurance_focus");
}

// F. disabled — S6 only, no borrowed, no fast replacement
{
  const qF = "내 보험료 얼마야?";
  const reflectionF = buildReflection({ customerSaid: qF, reality: softReality });
  const logF = [];
  const s6F =
    "보험료가 궁금하시군요. 등록된 계약은 22건이고, 그중 삼성생명 실손의료비보험의 월 납입액 4만5천 원이 확인돼 있어요. 22건 전체 월 납입 합계는 아직 정리 중이에요. 계약별 납입액이 더 확인되어야 전체 흐름을 정확히 볼 수 있어요.";
  const resultF = await buildKeyVoiceComposeResult(
    { reflection: reflectionF, reality: softReality, policies: softReality.policies },
    {
      question: qF,
      env: {
        KEY_VOICE: "on",
        KEY_BORROWED_SENSES: "off",
        VERCEL_ENV: "preview",
        ANTHROPIC_API_KEY: "test-key",
      },
      fetchImpl: makeAnthropicFetch({
        borrowed: goodBorrowedInput(),
        s6Text: s6F,
        log: logF,
      }),
    },
  );
  assert.equal(logF.filter((x) => x === "borrowed").length, 0);
  assert.ok(logF.filter((x) => x === "s6").length >= 1);
  assert.equal(resultF.key_voice_trace.borrowed_senses_calls, 0);
  assert.equal(resultF.key_voice_trace.borrowed_senses_shadow, undefined);
  assert.equal(resultF.speak_mode, "key_voice_speak");
}

// G. Production — no replacement even if active
{
  const qG = "보험료 줄이고 싶어";
  const reflectionG = buildReflection({ customerSaid: qG, reality: softReality });
  const borrowedG = goodBorrowedInput({
    understanding_hypotheses: ["보험료 절감 목적이 있을 수 있음"],
    voice_raw_candidate:
      "보험료를 줄이고 싶으신 거죠. 절감 목적이면 중복·납입부터 보는 게 맞아 보여요. 납입 구조부터 볼까요?",
    proposal_direction: "절감 목적이면 중복 확인이 먼저",
    next_decision_point: ["납입 구조부터", "중복 보장부터", "조정 후보부터"],
    recommendation_basis: "왜 맞아 보이는지: 절감 목적. 왜 아직 확정 아닌지: 합계 미확인",
  });
  const logG = [];
  const s6G =
    "보험료를 줄이고 싶으시군요. 등록된 계약은 22건이고, 그중 삼성생명 실손의료비보험의 월 납입액 4만5천 원이 확인돼 있어요. 22건 전체 합계는 아직 정리 중이에요. 납입 구조부터 같이 볼까요?";
  const resultG = await buildKeyVoiceComposeResult(
    { reflection: reflectionG, reality: softReality, policies: softReality.policies },
    {
      question: qG,
      env: {
        KEY_VOICE: "on",
        KEY_BORROWED_SENSES: "active",
        VERCEL_ENV: "production",
        ANTHROPIC_API_KEY: "test-key",
      },
      fetchImpl: makeAnthropicFetch({ borrowed: borrowedG, s6Text: s6G, log: logG }),
    },
  );
  assert.equal(logG.filter((x) => x === "borrowed").length, 1);
  assert.equal(logG.filter((x) => x === "s6").length, 1);
  assert.equal(resultG.key_voice_trace.fast_path?.ok, false);
  assert.equal(resultG.key_voice_trace.borrowed_senses_shadow?.customer_text_changed, false);
  assert.equal(resultG.key_voice_trace.borrowed_senses_shadow?.final_answer_source, "s6");
}

// H. soft Decision mismatch (emotional) — Claude-Full keeps candidate (no S6 rewrite)
{
  const qH = "내 보험료 얼마야?";
  const reflectionH = buildReflection({ customerSaid: qH, reality: softReality });
  const mismatched = goodBorrowedInput({
    understanding_hypotheses: ["금액 조회일 수 있음"],
    voice_raw_candidate:
      "많이 불안하고 힘드신 마음이 크시겠어요. 오늘은 감정부터 천천히 풀어볼까요?",
    proposal_direction: "감정 공간",
  });
  const logH = [];
  const s6H =
    "보험료가 궁금하시군요. 등록된 계약은 22건이고, 그중 삼성생명 실손의료비보험의 월 납입액 4만5천 원이 확인돼 있어요. 22건 전체 월 납입 합계는 아직 정리 중이에요. 계약별 납입액이 더 확인되어야 전체 흐름을 정확히 볼 수 있어요.";
  const resultH = await buildKeyVoiceComposeResult(
    { reflection: reflectionH, reality: softReality, policies: softReality.policies },
    {
      question: qH,
      env: {
        KEY_VOICE: "on",
        KEY_BORROWED_SENSES: "active",
        VERCEL_ENV: "preview",
        ANTHROPIC_API_KEY: "test-key",
      },
      fetchImpl: makeAnthropicFetch({ borrowed: mismatched, s6Text: s6H, log: logH }),
    },
  );
  assert.equal(logH.filter((x) => x === "borrowed").length, 1);
  assert.equal(logH.filter((x) => x === "s6").length, 0);
  assert.equal(resultH.key_voice_trace.s6_speak_calls, 0);
  assert.equal(resultH.compose_mode, "key_claude_full_single_pass");
  assert.equal(resultH.text, mismatched.voice_raw_candidate);
  assert.equal(resultH.key_voice_trace.borrowed_senses_shadow?.final_answer_source, "claude_candidate");
}

// S7-A corrective — non-insurance current intent must not become insurance direction_choice
{
  function assertNoInsurancePollution(decision) {
    const customerBlob = [
      decision.key_next_move,
      decision.direction?.move,
      decision.key_judgment,
      decision.confirm_question,
      decision.direct_answer_hint,
      JSON.stringify(decision.fact_selection?.facts_spoken ?? []),
    ].join(" ");
    assert.ok(!/direction_choice/.test(String(decision.response_priority)));
    assert.ok(!/보험료를 줄일지|빠진 보장을 채울지|가입 보험 점검|보장 부족|22건/.test(customerBlob));
    assert.ok(!(decision.fact_selection?.facts_spoken ?? []).some((f) => f.fact_id === "policy_count"));
  }

  // A. premium hesitation — keep adequacy + insurance facts
  {
    const qA = "보험료가 이게 맞는 건가 싶어서…";
    const decisionA = buildDecision({
      reflection: buildReflection({ customerSaid: qA, reality: softReality }),
      reality: softReality,
      question: qA,
      borrowedUnderstanding: {
        customer_intent: "보험료가 적정한지 확인하고 싶음",
        understanding_hypotheses: [
          "보험료 수준이 적절한지 막연하게 의문이 생긴 상태일 가능성이 있음",
        ],
        emotional_signal: "막연한 불안",
      },
    });
    assert.equal(decisionA.response_priority, "premium_adequacy_check");
    assert.equal(decisionA.situation_key, "premium_burden");
    assert.ok((decisionA.fact_selection?.facts_spoken ?? []).some((f) => f.fact_id === "policy_count"));
  }

  // B. cancer focus
  {
    const qB = "암 보험이 충분한지 봐줘";
    const decisionB = buildDecision({
      reflection: buildReflection({ customerSaid: qB, reality: softReality }),
      reality: softReality,
      question: qB,
      borrowedUnderstanding: {
        customer_intent: "암 보험(보장)이 충분한지 확인 요청",
        understanding_hypotheses: ["암 보장이 충분한지 걱정하는 마음이 있을 수 있음"],
      },
    });
    assert.equal(decisionB.response_priority, "cancer_axis_check");
    assert.equal(decisionB.situation_key, "coverage_assessment_cancer_axis");
  }

  // C. 분당 맛집 — general_daily / daily_focus; no insurance direction_choice
  {
    const qC = "분당 맛집 추천해줘";
    const decisionC = buildDecision({
      reflection: buildReflection({ customerSaid: qC, reality: softReality }),
      reality: softReality,
      question: qC,
      borrowedUnderstanding: {
        customer_intent: "분당 지역 음식점 추천 요청 — 보험 상담과 무관한 일상 질문",
        understanding_hypotheses: [
          "보험과 무관한 일상적인 맛집 추천 요청일 가능성이 높음",
          "LIFEGUARD 보험 상담 서비스 범위 밖의 질문일 가능성이 있음",
        ],
        emotional_signal: "가볍고 편안한 톤",
        // polluted proposal must NOT drag Decision back to insurance
        proposal_direction:
          "보험 외 질문임을 안내 후, 보험료 부담 / 보장 구성 중 어느 방향이든 도움 가능",
        next_decision_point: [
          "보험료를 줄이고 싶다면 — 중복 보장 확인",
          "빠진 보장이 걱정된다면 — 보장 구성",
        ],
      },
    });
    assert.ok(
      decisionC.situation_key === "daily_recommendation" ||
        decisionC.situation_key === "non_insurance_general",
      JSON.stringify(decisionC),
    );
    assert.ok(
      decisionC.response_priority === "daily_focus" ||
        decisionC.response_priority === "non_insurance_focus",
    );
    assert.equal(decisionC.key_direction?.type, "general_daily");
    assert.ok(decisionC.hypothesis_used?.customer_intent);
    assertNoInsurancePollution(decisionC);
    const dirC = buildKeyVoiceDirective({ question: qC, decision: decisionC });
    assert.equal(dirC.response_priority, decisionC.response_priority);
    assert.ok(!(dirC.facts_to_speak ?? []).some((f) => f.fact_id === "policy_count"));
  }

  // D. insurance history stale — current 맛집 intent wins
  {
    const qD = "분당 맛집 추천해줘";
    const decisionD = buildDecision({
      reflection: {
        situation_reading: ["일상적인 식사 추천 요청"],
        reading_confidence: "hypothesis",
        customer_said: qD,
      },
      reality: softReality,
      question: qD,
      borrowedUnderstanding: {
        customer_intent: "분당 맛집 추천 — 직전 보험 대화와 무관한 현재 요청",
        understanding_hypotheses: ["보험과 무관한 일상적인 맛집 추천 요청일 가능성이 높음"],
        context_carryover: "직전에 보험료 이야기를 했으나 현재 질문은 맛집",
      },
    });
    assert.ok(
      decisionD.response_priority === "daily_focus" ||
        decisionD.response_priority === "non_insurance_focus",
    );
    assertNoInsurancePollution(decisionD);
  }

  // E. defer insurance, ask daily
  {
    const qE = "보험 얘기는 나중에 하고 분당 맛집 알려줘";
    const decisionE = buildDecision({
      reflection: buildReflection({ customerSaid: qE, reality: softReality }),
      reality: softReality,
      question: qE,
      borrowedUnderstanding: {
        customer_intent: "보험은 나중으로 미루고 분당 맛집 안내를 요청",
        understanding_hypotheses: [
          "현재 비보험 일상 요청이 우선이고 보험 상담은 보류된 상태일 수 있음",
        ],
      },
    });
    assert.ok(
      decisionE.response_priority === "daily_focus" ||
        decisionE.response_priority === "non_insurance_focus",
      JSON.stringify(decisionE),
    );
    assertNoInsurancePollution(decisionE);
  }

  // F. mixed — must NOT collapse to general_daily alone
  {
    const qF = "분당 맛집도 궁금한데 내 보험료도 봐줘";
    const decisionF = buildDecision({
      reflection: buildReflection({ customerSaid: qF, reality: softReality }),
      reality: softReality,
      question: qF,
      borrowedUnderstanding: {
        customer_intent: "맛집도 궁금하고 보험료도 확인해 달라는 혼합 요청",
        understanding_hypotheses: ["일상 추천과 보험료 조회가 한 질문에 같이 있음"],
      },
    });
    assert.ok(
      decisionF.situation_key !== "daily_recommendation" &&
        decisionF.situation_key !== "non_insurance_general",
      JSON.stringify(decisionF),
    );
    assert.ok(
      decisionF.response_priority === "fact_lookup" ||
        decisionF.response_priority === "direction_choice" ||
        decisionF.response_priority === "premium_adequacy_check" ||
        decisionF.situation_key === "enrolled_policy_list" ||
        decisionF.situation_key === "general_inquiry" ||
        decisionF.situation_key === "direction_choice",
      JSON.stringify(decisionF),
    );
  }
}

// S7-A general_daily continuous speak — Decision daily_focus ↔ Borrowed candidate
{
  function dailyBorrowed(overrides = {}) {
    return goodBorrowedInput({
      customer_intent: "분당 지역 음식점 추천 — 보험과 무관한 일상 요청",
      understanding_hypotheses: [
        "보험과 무관한 일상적인 맛집 추천 요청일 가능성이 높음",
        "음식 종류·동행·분위기를 더 들어야 할 수 있음",
      ],
      emotional_signal: "가벼운 톤",
      voice_raw_candidate:
        "분당이면 서현 한정식 A, 정자 일식 B, 미금 캐주얼 C를 먼저 볼 수 있어요. 담백한 한식·일식·캐주얼이라 고르기 좋아요. 어떤 분위기부터 맞출까요? 몇 분이서 가시는지도 알려주시면 좋아요.",
      proposal_direction: "음식 종류·분위기부터 좁히는 방향",
      next_decision_point: ["한식 쪽", "일식·캐주얼 쪽", "동행 인원부터"],
      recommendation_basis: "검색된 후보 3곳",
      leadership_move: "후보 제시 후 분위기·동행 확인",
      key_purpose: "일상 추천 이어가기",
      insurance_expertise_angle: [],
      used_facts: [],
      ...overrides,
    });
  }

  function assertNoMeta(text) {
    assert.ok(!/일상 추천 초점|그 요청 안에서만|다음은 현재 요청에 답|현재 일상 요청에 답하거나/.test(text));
  }

  function assertNoInsuranceForce(text) {
    assert.ok(!/보험료를 줄일지|빠진 보장을 채울지|22건|보험 쪽으로|어느 쪽이 더 끌리세요/.test(text));
  }

  // Turn 1 — 맛집
  {
    const q1 = "분당 맛집 추천해줘";
    const borrowed1 = dailyBorrowed();
    const log1 = [];
    const result1 = await buildKeyVoiceComposeResult(
      {
        reflection: buildReflection({ customerSaid: q1, reality: softReality }),
        reality: softReality,
        policies: softReality.policies,
      },
      {
        question: q1,
        history: [],
        env: {
          KEY_VOICE: "on",
          KEY_BORROWED_SENSES: "active",
          VERCEL_ENV: "preview",
          ANTHROPIC_API_KEY: "test-key",
        },
        fetchImpl: makeAnthropicFetch({
          borrowed: borrowed1,
          s6Text: "S6_DAILY_FALLBACK_SHOULD_NOT_RUN",
          log: log1,
        }),
      },
    );
    assert.equal(result1.decision_snapshot?.response_priority, "daily_focus");
    assert.equal(log1.filter((x) => x === "borrowed").length, 1);
    assert.equal(log1.filter((x) => x === "s6").length, 0, `T1 calls=${log1}`);
    assert.equal(result1.key_voice_trace.s6_speak_calls, 0);
    assert.equal(result1.key_voice_trace.fast_path?.ok, true);
    assert.equal(result1.key_voice_trace.borrowed_senses_shadow?.customer_text_changed, false);
    assert.equal(result1.key_voice_trace.borrowed_senses_shadow?.final_answer_source, "claude_candidate");
    assert.equal(result1.key_voice_trace.promotion_diagnostic?.customer_text_replaced, false);
    assert.match(result1.text, /한식|일식|분위기|몇\s*분/);
    assertNoMeta(result1.text);
    assertNoInsuranceForce(result1.text);
    assert.ok(!/S6_DAILY_FALLBACK/.test(result1.text));
  }

  // Turn 2 — family surgery cue, still help meal first (no insurance force)
  {
    const q2 = "부모님 모시고 가는데 아버지가 최근 수술하셨어";
    const borrowed2 = dailyBorrowed({
      customer_intent: "부모님 동행 식사 장소 도움 — 수술·돌봄 단서는 있으나 보험 요청은 아직 아님",
      understanding_hypotheses: [
        "가족 식사 장소 요청이 우선일 수 있음",
        "수술·가족 돌봄 단서가 있을 수 있으나 즉시 보험 전환은 아님",
      ],
      voice_raw_candidate:
        "아버지 수술 후라면 자극 적고 조용한 곳이 나을 수 있어요. 서현·정자 쪽에 담백한 한식 위주로 좁혀볼까요? 이동 거리는 어느 정도가 편하세요?",
      proposal_direction: "조용하고 담백한 식사 장소부터",
      next_decision_point: ["담백한 한식", "이동 거리 먼저", "예약 가능한 곳"],
      leadership_move: "식사 조건부터 좁히기",
    });
    const log2 = [];
    const history2 = [
      { role: "user", content: "분당 맛집 추천해줘" },
      {
        role: "assistant",
        content:
          "분당이면 선택지가 많아요. 한식·일식·캐주얼 중 어떤 분위기가 편하세요?",
      },
    ];
    const result2 = await buildKeyVoiceComposeResult(
      {
        reflection: buildReflection({ customerSaid: q2, reality: softReality }),
        reality: softReality,
        policies: softReality.policies,
      },
      {
        question: q2,
        history: history2,
        env: {
          KEY_VOICE: "on",
          KEY_BORROWED_SENSES: "active",
          VERCEL_ENV: "preview",
          ANTHROPIC_API_KEY: "test-key",
        },
        fetchImpl: makeAnthropicFetch({
          borrowed: borrowed2,
          s6Text: "S6_T2_SHOULD_NOT_RUN",
          log: log2,
        }),
      },
    );
    assert.ok(
      result2.decision_snapshot?.response_priority === "daily_focus" ||
        result2.decision_snapshot?.response_priority === "non_insurance_focus" ||
        result2.decision_snapshot?.situation_key === "daily_recommendation" ||
        result2.decision_snapshot?.situation_key === "non_insurance_general",
      JSON.stringify(result2.decision_snapshot),
    );
    assert.equal(log2.filter((x) => x === "borrowed").length, 1);
    assert.equal(log2.filter((x) => x === "s6").length, 0, `T2 calls=${log2}`);
    assert.match(result2.text, /한식|조용|서현|정자|이동/);
    assertNoInsuranceForce(result2.text);
    assert.ok(!/보험료|보장 부족|가입하|해지하|보험금\s*받/.test(result2.text));
    assert.ok(!/S6_T2_SHOULD_NOT_RUN/.test(result2.text));
  }

  // Turn 3 — claim worry emerges; recognize need, no payout certainty, no S9
  {
    const q3 = "수술비도 많이 들었고 보험금 받을 수 있을지 걱정이야";
    const borrowed3 = goodBorrowedInput({
      customer_intent: "수술비·보험금 청구 가능 여부 걱정 — 확인 자료·다음 행동이 필요",
      understanding_hypotheses: [
        "청구 니즈가 명확해진 상태일 수 있음",
        "지급 가능 여부는 자료 확인 전 단정하면 안 됨",
      ],
      voice_raw_candidate:
        "수술비와 보험금이 걱정되시는군요. 지금 단정하긴 어렵고, 수술명이나 진단명을 알려주시면 진단서·수술확인서·영수증·진료비 세부내역·증권상 해당 담보부터 같이 확인하는 게 맞아요. 서류부터 볼까요, 아니면 가입하신 담보 목록부터 볼까요?",
      proposal_direction: "청구 가능 여부 단정 없이 서류·담보 확인부터",
      next_decision_point: ["진단서·영수증부터", "증권 담보 목록부터", "청구 절차 안내부터"],
      recommendation_basis: "지급 확정 전 자료 확인이 먼저",
      leadership_move: "확인 자료와 다음 행동 제시",
      key_purpose: "청구 준비 리드",
      used_facts: [],
    });
    const log3 = [];
    const history3 = [
      { role: "user", content: "분당 맛집 추천해줘" },
      { role: "assistant", content: "분당이면 선택지가 많아요." },
      { role: "user", content: "부모님 모시고 가는데 아버지가 최근 수술하셨어" },
      { role: "assistant", content: "자극 적고 조용한 곳부터 좁혀볼게요." },
    ];
    const result3 = await buildKeyVoiceComposeResult(
      {
        reflection: buildReflection({ customerSaid: q3, reality: softReality }),
        reality: softReality,
        policies: softReality.policies,
      },
      {
        question: q3,
        history: history3,
        env: {
          KEY_VOICE: "on",
          KEY_BORROWED_SENSES: "active",
          VERCEL_ENV: "preview",
          ANTHROPIC_API_KEY: "test-key",
        },
        fetchImpl: makeAnthropicFetch({
          borrowed: borrowed3,
          s6Text:
            "수술비와 보험금이 걱정되시는군요. 지금 단정하긴 어렵고, 수술명이나 진단명을 알려주시면 진단서·수술확인서·영수증·진료비 세부내역·증권상 해당 담보부터 같이 확인하는 게 맞아요. 서류부터 볼까요?",
          log: log3,
        }),
      },
    );
    assert.ok(result3.decision_snapshot?.response_priority !== "daily_focus");
    assert.equal(log3.filter((x) => x === "borrowed").length, 1);
    assert.ok(log3.filter((x) => x === "s6").length <= 1);
    assert.match(result3.text, /진단서|영수증|담보|확인/);
    assert.ok(!/보험금\s*(?:받|지급).{0,8}(?:됩니다|가능합니다|확실)/.test(result3.text));
    assert.ok(!/청구\s*실행|자동\s*청구|S9/.test(result3.text));
  }

  // A/B fast path regression (compose)
  {
    const qA = "보험료가 이게 맞는 건가 싶어서…";
    const logA = [];
    const resultA = await buildKeyVoiceComposeResult(
      {
        reflection: buildReflection({ customerSaid: qA, reality: softReality }),
        reality: softReality,
        policies: softReality.policies,
      },
      {
        question: qA,
        env: {
          KEY_VOICE: "on",
          KEY_BORROWED_SENSES: "active",
          VERCEL_ENV: "preview",
          ANTHROPIC_API_KEY: "test-key",
        },
        fetchImpl: makeAnthropicFetch({
          borrowed: goodBorrowedInput(),
          s6Text: "S6_A_SHOULD_NOT_RUN",
          log: logA,
        }),
      },
    );
    assert.equal(resultA.decision_snapshot?.response_priority, "premium_adequacy_check");
    assert.equal(logA.filter((x) => x === "borrowed").length, 1);
    assert.equal(logA.filter((x) => x === "s6").length, 0);
    assert.equal(resultA.key_voice_trace.fast_path?.ok, true);

    const qB = "암 보험이 충분한지 봐줘";
    const logB = [];
    const borrowedB = goodBorrowedInput({
      customer_intent: "암 보장 충분 확인",
      understanding_hypotheses: ["암 보장이 충분한지 걱정하는 마음이 있을 수 있음"],
      voice_raw_candidate:
        "암 보장이 충분한지 확인하고 싶으신 거죠. 지금 목록만으로는 충분·부족을 단정하기 어렵고, 진단비·수술비·치료비 항목부터 같이 볼게요. 어느 항목부터 볼까요?",
      proposal_direction: "암 진단비·수술비·치료비 확인이 먼저 맞아 보입니다",
      next_decision_point: ["진단비부터", "수술비·치료비부터", "전체 암 구성"],
      recommendation_basis:
        "왜 맞아 보이는지: 암 충분 확인 목적. 왜 아직 확정 아닌지: 항목별 담보 미확인",
      leadership_move: "암 항목부터 확인",
      key_purpose: "암 축 점검",
      insurance_expertise_angle: ["진단비", "수술비"],
      insurance_expertise_rationale: "암 축 우선",
      used_facts: ["policy_count"],
    });
    const resultB = await buildKeyVoiceComposeResult(
      {
        reflection: buildReflection({ customerSaid: qB, reality: softReality }),
        reality: softReality,
        policies: softReality.policies,
      },
      {
        question: qB,
        env: {
          KEY_VOICE: "on",
          KEY_BORROWED_SENSES: "active",
          VERCEL_ENV: "preview",
          ANTHROPIC_API_KEY: "test-key",
        },
        fetchImpl: makeAnthropicFetch({
          borrowed: borrowedB,
          s6Text: "S6_B_SHOULD_NOT_RUN",
          log: logB,
        }),
      },
    );
    assert.equal(resultB.decision_snapshot?.response_priority, "cancer_axis_check");
    assert.equal(logB.filter((x) => x === "borrowed").length, 1);
    assert.equal(logB.filter((x) => x === "s6").length, 0);
    assert.equal(resultB.key_voice_trace.fast_path?.ok, true);
    assert.match(resultB.text, /암|진단비|수술비|치료비/);
  }

  // C. stale insurance history — current 맛집 still daily promote
  {
    const qC = "분당 맛집 추천해줘";
    const logC = [];
    const resultC = await buildKeyVoiceComposeResult(
      {
        reflection: buildReflection({ customerSaid: qC, reality: softReality }),
        reality: softReality,
        policies: softReality.policies,
      },
      {
        question: qC,
        history: [
          { role: "user", content: "보험료 줄이고 싶어" },
          { role: "assistant", content: "22건 기준으로 납입부터 같이 볼까요?" },
        ],
        env: {
          KEY_VOICE: "on",
          KEY_BORROWED_SENSES: "active",
          VERCEL_ENV: "preview",
          ANTHROPIC_API_KEY: "test-key",
        },
        fetchImpl: makeAnthropicFetch({
          borrowed: dailyBorrowed({
            context_carryover: "직전에 보험료 이야기가 있었으나 현재는 맛집 요청",
          }),
          s6Text: "S6_C_SHOULD_NOT_RUN",
          log: logC,
        }),
      },
    );
    assert.equal(resultC.decision_snapshot?.response_priority, "daily_focus");
    assert.equal(logC.filter((x) => x === "s6").length, 0);
    assert.equal(resultC.key_voice_trace.fast_path?.ok, true);
    assertNoInsuranceForce(resultC.text);
  }

  // D. mixed — not forced to general_daily
  {
    const qD = "분당 맛집도 궁금한데 내 보험료도 봐줘";
    const decisionD = buildDecision({
      reflection: buildReflection({ customerSaid: qD, reality: softReality }),
      reality: softReality,
      question: qD,
      borrowedUnderstanding: {
        customer_intent: "맛집과 보험료 혼합 요청",
        understanding_hypotheses: ["일상과 보험료가 한 질문에 같이 있음"],
      },
    });
    assert.ok(decisionD.response_priority !== "daily_focus");
    assert.ok(decisionD.situation_key !== "daily_recommendation");
  }

  // polluted daily candidate → focused Claude correction once (not S6)
  {
    const qP = "분당 맛집 추천해줘";
    const logP = [];
    const polluted = dailyBorrowed({
      voice_raw_candidate:
        "맛집은 어렵고 보험 쪽으로 같이 보죠. 22건 기준으로 보험료를 줄일지 빠진 보장을 채울지 정하면 됩니다. 어느 쪽이 더 끌리세요?",
      proposal_direction: "보험료 vs 보장",
      next_decision_point: ["보험료 줄이기", "보장 채우기"],
    });
    const repairedVoice =
      "분당이면 서현 한정식 A, 정자 일식 B, 미금 캐주얼 C부터 볼 수 있어요. 담백한 한식·일식·캐주얼 중 어떤 쪽부터 맞출까요? 동행 인원도 알려주시면 좋아요.";
    let borrowedN = 0;
    const resultP = await buildKeyVoiceComposeResult(
      {
        reflection: buildReflection({ customerSaid: qP, reality: softReality }),
        reality: softReality,
        policies: softReality.policies,
      },
      {
        question: qP,
        env: {
          KEY_VOICE: "on",
          KEY_BORROWED_SENSES: "active",
          VERCEL_ENV: "preview",
          ANTHROPIC_API_KEY: "test-key",
        },
        fetchImpl: makeAnthropicFetch({
          borrowed: () => {
            borrowedN += 1;
            return borrowedN === 1
              ? polluted
              : dailyBorrowed({ voice_raw_candidate: repairedVoice });
          },
          s6Text: "S6_SHOULD_NOT_RUN_POLLUTED",
          log: logP,
        }),
      },
    );
    assert.equal(resultP.decision_snapshot?.response_priority, "daily_focus");
    assert.equal(logP.filter((x) => x === "borrowed").length, 2);
    assert.equal(logP.filter((x) => x === "s6").length, 0);
    assert.equal(resultP.key_voice_trace.s6_speak_calls, 0);
    assert.equal(resultP.compose_mode, "key_claude_full_single_pass");
    assert.equal(resultP.key_voice_trace.used_constrained_regen, false);
    assert.equal(resultP.key_voice_trace.answer_regeneration?.used ?? false, false);
    assert.equal(resultP.key_voice_trace.hard_safety_repair_attempt, 1);
    assert.equal(resultP.key_voice_trace.correction_attempts, 1);
    assert.equal(resultP.key_voice_trace.focused_correction_count, 1);
    assert.equal(resultP.key_voice_trace.used_failure_mode, false);
    assert.equal(resultP.text, repairedVoice);
    assertNoInsuranceForce(resultP.text);
    assert.ok(!/말씀하신 것부터 이어갈게요|필요한 맥락을 하나만/.test(resultP.text));
    assert.match(resultP.text, /한식|일식|동행|분위기|선택지/);
  }
}

// --- S7-A FINAL-ANSWER-FIRST + one-regeneration (A–G) ---
{
  const { KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT } = await import(
    "../server/keyCore/keyCustomerMonopoly.js"
  );

  function dailySafeVoice(overrides = {}) {
    return goodBorrowedInput({
      customer_intent: "분당 맛집 추천 — 보험과 무관",
      understanding_hypotheses: ["일상적인 맛집 추천 요청일 가능성이 높음"],
      voice_raw_candidate:
        "분당이면 서현 한정식 A, 정자 일식 B, 미금 캐주얼 C를 먼저 볼 수 있어요. 담백한 한식·일식·캐주얼이라 고르기 좋아요. 어떤 분위기부터 맞출까요? 몇 분이서 가시는지도 알려주시면 좋아요.",
      proposal_direction: "음식 종류·분위기부터",
      next_decision_point: ["한식 쪽", "일식·캐주얼 쪽", "동행 인원부터"],
      recommendation_basis: "검색된 후보 3곳",
      leadership_move: "후보 제시 후 분위기·동행 확인",
      key_purpose: "일상 추천",
      insurance_expertise_angle: [],
      used_facts: [],
      ...overrides,
    });
  }

  // A. safe answer + leadership-only insurance pollution → approve, regen 0
  {
    const q = "분당 맛집 추천해줘";
    const log = [];
    const borrowed = dailySafeVoice({
      proposal_direction:
        "보험 외 질문임을 안내 후, 보험료 절감 / 보장 보완 중 하나를 선택하도록 유도",
      next_decision_point: [
        "보험료를 줄이고 싶다면 — 중복 보장 확인",
        "빠진 보장을 채우고 싶다면 — 보장 구성",
      ],
      leadership_move: "보험 상담 방향으로 전환",
    });
    const result = await buildKeyVoiceComposeResult(
      {
        reflection: buildReflection({ customerSaid: q, reality: softReality }),
        reality: softReality,
        policies: softReality.policies,
      },
      {
        question: q,
        env: {
          KEY_VOICE: "on",
          KEY_BORROWED_SENSES: "active",
          VERCEL_ENV: "preview",
          ANTHROPIC_API_KEY: "test-key",
        },
        fetchImpl: makeAnthropicFetch({
          borrowed,
          s6Text: "S6_SHOULD_NOT_RUN_A",
          log,
        }),
      },
    );
    assert.equal(result.decision_snapshot?.response_priority, "daily_focus");
    assert.equal(log.filter((x) => x === "borrowed").length, 1);
    assert.equal(log.filter((x) => x === "s6").length, 0);
    assert.equal(result.key_voice_trace.fast_path?.ok, true);
    assert.equal(result.key_voice_trace.borrowed_senses_shadow?.customer_text_changed, false);
    assert.equal(result.key_voice_trace.borrowed_senses_shadow?.final_answer_source, "claude_candidate");
    assert.equal(result.key_voice_trace.promotion_diagnostic?.customer_text_replaced, false);
    assert.match(result.text, /한식|일식|분위기/);
    assert.ok(!/보험료|22건|보장/.test(result.text));
    // Claude-Full talent-open: leadership mid-fields are not force-filled — mid_field_warnings optional.
    assert.equal(result.compose_mode, "key_claude_full_single_pass");
  }

  // B. answer itself polluted → focused Claude correction exactly 1
  {
    const q = "분당 맛집 추천해줘";
    const log = [];
    const repaired =
      "분당이면 서현 한정식 A, 정자 일식 B, 미금 캐주얼 C부터 좁혀볼 수 있어요. 동행 인원과 분위기 중 어떤 것부터 맞출까요?";
    let borrowedN = 0;
    const result = await buildKeyVoiceComposeResult(
      {
        reflection: buildReflection({ customerSaid: q, reality: softReality }),
        reality: softReality,
        policies: softReality.policies,
      },
      {
        question: q,
        env: {
          KEY_VOICE: "on",
          KEY_BORROWED_SENSES: "active",
          VERCEL_ENV: "preview",
          ANTHROPIC_API_KEY: "test-key",
        },
        fetchImpl: makeAnthropicFetch({
          borrowed: () => {
            borrowedN += 1;
            return dailySafeVoice({
              voice_raw_candidate:
                borrowedN === 1
                  ? "맛집보다 보험 쪽으로 보죠. 22건 기준으로 보험료를 줄일지 빠진 보장을 채울지 정하면 됩니다."
                  : repaired,
            });
          },
          s6Text: "S6_SHOULD_NOT_RUN_POLLUTED_B",
          log,
        }),
      },
    );
    assert.equal(log.filter((x) => x === "borrowed").length, 2);
    assert.equal(log.filter((x) => x === "s6").length, 0);
    assert.equal(result.key_voice_trace.s6_speak_calls, 0);
    assert.equal(result.key_voice_trace.used_constrained_regen, false);
    assert.equal(result.key_voice_trace.hard_safety_repair_attempt, 1);
    assert.equal(result.key_voice_trace.correction_attempts, 1);
    assert.equal(result.key_voice_trace.focused_correction_count, 1);
    assert.equal(result.key_voice_trace.used_failure_mode, false);
    assert.equal(result.compose_mode, "key_claude_full_single_pass");
    assert.equal(result.text, repaired);
    assert.ok(!/말씀하신 것부터 이어갈게요|필요한 맥락을 하나만/.test(result.text));
    assert.ok(!/보험료를 줄일지|22건/.test(result.text));
    assert.match(result.text, /한식|분위기|동행|분당/);
  }

  // C. parents + surgery cue — meal first
  {
    const q = "부모님 모시고 가는데 아버지가 최근 수술하셨어";
    const log = [];
    const result = await buildKeyVoiceComposeResult(
      {
        reflection: buildReflection({ customerSaid: q, reality: softReality }),
        reality: softReality,
        policies: softReality.policies,
      },
      {
        question: q,
        history: [
          { role: "user", content: "분당 맛집 추천해줘" },
          { role: "assistant", content: "분당이면 선택지가 많아요. 분위기부터 여쭐게요." },
        ],
        env: {
          KEY_VOICE: "on",
          KEY_BORROWED_SENSES: "active",
          VERCEL_ENV: "preview",
          ANTHROPIC_API_KEY: "test-key",
        },
        fetchImpl: makeAnthropicFetch({
          borrowed: dailySafeVoice({
            customer_intent: "부모님 동행 식사 — 수술은 단서, 보험 요청 아님",
            understanding_hypotheses: [
              "가족 식사 장소가 우선일 수 있음",
              "수술·돌봄 단서가 있으나 즉시 보험 전환은 아님",
            ],
            voice_raw_candidate:
              "아버지 수술 후라면 자극 적고 조용한 곳이 나을 수 있어요. 담백한 한식 위주로 좁혀볼까요? 이동 거리는 어느 정도가 편하세요?",
            proposal_direction: "조용한 식사 장소부터",
            next_decision_point: ["담백한 한식", "이동 거리", "예약"],
          }),
          s6Text: "S6_C_NO",
          log,
        }),
      },
    );
    assert.ok(
      result.decision_snapshot?.response_priority === "daily_focus" ||
        result.decision_snapshot?.response_priority === "non_insurance_focus",
    );
    assert.equal(log.filter((x) => x === "s6").length, 0);
    assert.ok(!/보험료|가입하|보장 부족|22건/.test(result.text));
    assert.match(result.text, /한식|조용|이동/);
  }

  // D. claim worry
  {
    const q = "수술비도 많이 들었고 보험금 받을 수 있을지 걱정이야";
    const decision = buildDecision({
      reflection: buildReflection({ customerSaid: q, reality: softReality }),
      reality: softReality,
      question: q,
      borrowedUnderstanding: {
        customer_intent: "수술비·보험금 청구 가능 여부 걱정",
        understanding_hypotheses: ["청구 니즈가 명확해짐", "지급 단정 금지"],
      },
    });
    assert.equal(decision.situation_key, "claim_need_check");
    assert.equal(decision.response_priority, "claim_prep");
    assert.ok(!(decision.fact_selection?.facts_spoken ?? []).some((f) => f.fact_id === "policy_count"));

    const log = [];
    const result = await buildKeyVoiceComposeResult(
      {
        reflection: buildReflection({ customerSaid: q, reality: softReality }),
        reality: softReality,
        policies: softReality.policies,
      },
      {
        question: q,
        env: {
          KEY_VOICE: "on",
          KEY_BORROWED_SENSES: "active",
          VERCEL_ENV: "preview",
          ANTHROPIC_API_KEY: "test-key",
        },
        fetchImpl: makeAnthropicFetch({
          borrowed: goodBorrowedInput({
            customer_intent: "수술비·보험금 걱정 — 자료 확인 필요",
            understanding_hypotheses: ["지급 단정 금지", "서류·담보 확인이 먼저"],
            voice_raw_candidate:
              "걱정되시는 마음 알겠어요. 확인 전에는 지급 여부를 단정할 수 없어요. 수술명이나 진단명을 알려주시면, 진단서·수술확인서·영수증·진료비 세부내역·해당 담보부터 같이 확인해볼까요?",
            proposal_direction: "서류·담보 확인",
            recommendation_basis: "확인 전 지급 단정 금지 · 서류·담보부터",
            next_decision_point: ["진단서·영수증부터", "담보 목록부터"],
            used_facts: [],
            insurance_expertise_angle: [],
          }),
          s6Text: "S6_D_SHOULD_NOT_RUN",
          log,
        }),
      },
    );
    assert.equal(result.decision_snapshot?.response_priority, "claim_prep");
    assert.equal(log.filter((x) => x === "borrowed").length, 1);
    assert.equal(log.filter((x) => x === "s6").length, 0);
    assert.equal(result.key_voice_trace.fast_path?.ok, true);
    assert.ok(!/22건|가능한 경우가 많|지급됩니다|받을 수 있습니다/.test(result.text));
    assert.match(result.text, /진단서|영수증|담보|확인/);
    assert.match(result.text, /걱정|마음/);
  }

  // E. premium
  {
    const q = "보험료가 이게 맞는 건가 싶어서…";
    const log = [];
    const result = await buildKeyVoiceComposeResult(
      {
        reflection: buildReflection({ customerSaid: q, reality: softReality }),
        reality: softReality,
        policies: softReality.policies,
      },
      {
        question: q,
        env: {
          KEY_VOICE: "on",
          KEY_BORROWED_SENSES: "active",
          VERCEL_ENV: "preview",
          ANTHROPIC_API_KEY: "test-key",
        },
        fetchImpl: makeAnthropicFetch({
          borrowed: goodBorrowedInput(),
          s6Text: "S6_E_NO",
          log,
        }),
      },
    );
    assert.equal(result.decision_snapshot?.response_priority, "premium_adequacy_check");
    assert.equal(log.filter((x) => x === "borrowed").length, 1);
    assert.ok(result.text.length > 20);
  }

  // F. cancer
  {
    const q = "암 보험이 충분한지 봐줘";
    const log = [];
    const result = await buildKeyVoiceComposeResult(
      {
        reflection: buildReflection({ customerSaid: q, reality: softReality }),
        reality: softReality,
        policies: softReality.policies,
      },
      {
        question: q,
        env: {
          KEY_VOICE: "on",
          KEY_BORROWED_SENSES: "active",
          VERCEL_ENV: "preview",
          ANTHROPIC_API_KEY: "test-key",
        },
        fetchImpl: makeAnthropicFetch({
          borrowed: goodBorrowedInput({
            customer_intent: "암 보장 충분 여부 확인",
            understanding_hypotheses: ["진단비·수술비·치료비 항목 확인이 먼저"],
            voice_raw_candidate:
              "암 보장이 충분한지 확인하고 싶으신 거죠. 지금 바로 충분·부족을 단정하기보다 진단비·수술비·치료비 항목부터 같이 볼게요. 어떤 항목부터 보실까요?",
            proposal_direction: "암 담보 항목별 확인",
            next_decision_point: ["진단비부터", "수술비부터", "치료비부터"],
            used_facts: [],
          }),
          s6Text: "S6_F_NO",
          log,
        }),
      },
    );
    assert.equal(result.decision_snapshot?.response_priority, "cancer_axis_check");
    assert.match(result.text, /암|진단비|수술비|치료비/);
    assert.ok(!/충분합니다|부족합니다/.test(result.text));
  }

  // G. borrowed hard → sole focused Claude correction once → second hard → failureMode
  {
    const q = "분당 맛집 추천해줘";
    const log = [];
    const bodies = [];
    let borrowedN = 0;
    const result = await buildKeyVoiceComposeResult(
      {
        reflection: buildReflection({ customerSaid: q, reality: softReality }),
        reality: softReality,
        policies: softReality.policies,
      },
      {
        question: q,
        env: {
          KEY_VOICE: "on",
          KEY_BORROWED_SENSES: "active",
          VERCEL_ENV: "preview",
          ANTHROPIC_API_KEY: "test-key",
        },
        fetchImpl: makeAnthropicFetch({
          borrowed: () => {
            borrowedN += 1;
            return dailySafeVoice({
              voice_raw_candidate:
                borrowedN === 1
                  ? "보험 쪽으로 보죠. 22건 기준으로 보험료를 줄일지 빠진 보장을 채울지 정하면 됩니다."
                  : "가입하세요. 해지해도 됩니다. 등록 22건이면 충분합니다. 보험료를 바로 줄이세요.",
            });
          },
          s6Text: "S6_SHOULD_NOT_RUN_HARD_G",
          log,
          bodies,
        }),
      },
    );
    assert.equal(log.filter((x) => x === "borrowed").length, 2);
    assert.equal(log.filter((x) => x === "s6").length, 0);
    assert.equal(result.key_voice_trace.s6_speak_calls, 0);
    assert.equal(result.key_voice_trace.used_constrained_regen, false);
    assert.equal(result.key_voice_trace.answer_regeneration?.used ?? false, false);
    assert.equal(result.key_voice_trace.hard_safety_repair_attempt, 1);
    assert.equal(result.key_voice_trace.correction_attempts, 1);
    assert.equal(result.key_voice_trace.focused_correction_count, 1);
    assert.equal(result.key_voice_trace.hard_safety_repair?.second_check?.hard_fail, true);
    assert.equal(result.key_voice_trace.used_failure_mode, true);
    assert.equal(result.text, KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT);
    assert.ok(
      bodies.some((b) => JSON.stringify(b).includes("focused_correction") || JSON.stringify(b).includes("FOCUSED CORRECTION") || JSON.stringify(b).includes("CLOSED_HARD")),
      "sole correction must be focused Claude correction",
    );
    assert.ok(
      !bodies.some((b) => JSON.stringify(b).includes("answer_constrained_once")),
      "constrained regen must not run before hard repair",
    );
    assert.equal(result.key_voice_trace.ghost_path_reached?.length ?? 0, 0);
    assert.ok(!/말씀하신 요청부터 이어갈게요/.test(result.text));
  }

  // --- Stein single correction budget ①–⑧ ---
  {
    const safeDaily =
      "분당이면 서현 한정식 A, 정자 일식 B를 먼저 볼 수 있어요. 어떤 분위기부터 맞출까요?";
    const softDaily = "어떤 분위기나 음식 종류를 원하세요?";
    const hardDaily =
      "보험 쪽으로 보죠. 22건 기준으로 보험료를 줄일지 빠진 보장을 채울지 정하면 됩니다.";
    const repairSafe =
      "분당이면 서현 한정식 A, 정자 일식 B, 미금 캐주얼 C부터 좁혀볼 수 있어요. 동행 인원부터 맞출까요?";
    const repairHard =
      "가입하세요. 해지해도 됩니다. 등록 22건이면 충분합니다. 보험료를 바로 줄이세요.";

    // ① Borrowed safe → repair 0
    {
      const log = [];
      const candidate = safeDaily;
      const result = await buildKeyVoiceComposeResult(
        {
          reflection: buildReflection({ customerSaid: "분당 맛집 추천해줘", reality: softReality }),
          reality: softReality,
          policies: softReality.policies,
        },
        {
          question: "분당 맛집 추천해줘",
          env: {
            KEY_VOICE: "on",
            KEY_BORROWED_SENSES: "active",
            VERCEL_ENV: "preview",
            ANTHROPIC_API_KEY: "test-key",
          },
          fetchImpl: makeAnthropicFetch({
            borrowed: dailySafeVoice({ voice_raw_candidate: candidate }),
            s6Text: "S6_SHOULD_NOT_RUN_SAFE",
            log,
          }),
        },
      );
      assert.equal(log.filter((x) => x === "s6").length, 0);
      assert.equal(result.key_voice_trace.correction_attempts, 0);
      assert.equal(result.key_voice_trace.hard_safety_repair_attempt, 0);
      assert.equal(result.key_voice_trace.used_failure_mode, false);
      assert.equal(result.text, candidate);
      assert.equal(result.key_voice_trace.ghost_path_reached?.length ?? 0, 0);
    }

    // ② Borrowed soft-only → repair 0, keep candidate
    {
      const log = [];
      const result = await buildKeyVoiceComposeResult(
        {
          reflection: buildReflection({ customerSaid: "분당 맛집 추천해줘", reality: softReality }),
          reality: softReality,
          policies: softReality.policies,
        },
        {
          question: "분당 맛집 추천해줘",
          env: {
            KEY_VOICE: "on",
            KEY_BORROWED_SENSES: "active",
            VERCEL_ENV: "preview",
            ANTHROPIC_API_KEY: "test-key",
          },
          fetchImpl: makeAnthropicFetch({
            borrowed: dailySafeVoice({ voice_raw_candidate: softDaily }),
            s6Text: "S6_SHOULD_NOT_RUN_SOFT",
            log,
          }),
        },
      );
      assert.equal(log.filter((x) => x === "s6").length, 0);
      assert.equal(result.key_voice_trace.correction_attempts, 0);
      assert.equal(result.key_voice_trace.hard_safety_repair_attempt, 0);
      assert.equal(result.key_voice_trace.used_failure_mode, false);
      assert.equal(result.text, softDaily);
      assert.equal(result.key_voice_trace.ghost_path_reached?.length ?? 0, 0);
    }

    // ③ Borrowed hard → focused Claude repair safe
    {
      const log = [];
      let borrowedN = 0;
      const result = await buildKeyVoiceComposeResult(
        {
          reflection: buildReflection({ customerSaid: "분당 맛집 추천해줘", reality: softReality }),
          reality: softReality,
          policies: softReality.policies,
        },
        {
          question: "분당 맛집 추천해줘",
          env: {
            KEY_VOICE: "on",
            KEY_BORROWED_SENSES: "active",
            VERCEL_ENV: "preview",
            ANTHROPIC_API_KEY: "test-key",
          },
          fetchImpl: makeAnthropicFetch({
            borrowed: () => {
              borrowedN += 1;
              return dailySafeVoice({
                voice_raw_candidate: borrowedN === 1 ? hardDaily : repairSafe,
              });
            },
            s6Text: "S6_SHOULD_NOT_RUN_REPAIR_SAFE",
            log,
          }),
        },
      );
      assert.equal(log.filter((x) => x === "borrowed").length, 2);
      assert.equal(log.filter((x) => x === "s6").length, 0);
      assert.equal(result.key_voice_trace.correction_attempts, 1);
      assert.equal(result.key_voice_trace.hard_safety_repair_attempt, 1);
      assert.equal(result.key_voice_trace.focused_correction_count, 1);
      assert.equal(result.key_voice_trace.used_constrained_regen, false);
      assert.equal(result.key_voice_trace.used_failure_mode, false);
      assert.equal(result.compose_mode, "key_claude_full_single_pass");
      assert.equal(result.text, repairSafe);
      assert.equal(result.key_voice_trace.ghost_path_reached?.length ?? 0, 0);
    }

    // ④ Borrowed hard → focused Claude repair hard → failureMode
    {
      const log = [];
      let borrowedN = 0;
      const result = await buildKeyVoiceComposeResult(
        {
          reflection: buildReflection({ customerSaid: "분당 맛집 추천해줘", reality: softReality }),
          reality: softReality,
          policies: softReality.policies,
        },
        {
          question: "분당 맛집 추천해줘",
          env: {
            KEY_VOICE: "on",
            KEY_BORROWED_SENSES: "active",
            VERCEL_ENV: "preview",
            ANTHROPIC_API_KEY: "test-key",
          },
          fetchImpl: makeAnthropicFetch({
            borrowed: () => {
              borrowedN += 1;
              return dailySafeVoice({
                voice_raw_candidate: borrowedN === 1 ? hardDaily : repairHard,
              });
            },
            s6Text: "S6_SHOULD_NOT_RUN_REPAIR_HARD",
            log,
          }),
        },
      );
      assert.equal(log.filter((x) => x === "s6").length, 0);
      assert.equal(result.key_voice_trace.s6_speak_calls, 0);
      assert.equal(result.key_voice_trace.correction_attempts, 1);
      assert.equal(result.key_voice_trace.hard_safety_repair_attempt, 1);
      assert.equal(result.key_voice_trace.focused_correction_count, 1);
      assert.equal(result.key_voice_trace.used_failure_mode, true);
      assert.equal(result.text, KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT);
      assert.equal(result.key_voice_trace.ghost_path_reached?.length ?? 0, 0);
    }

    // ⑤ Initial S6 hard → repair safe (no borrowed candidate)
    {
      const log = [];
      let s6N = 0;
      const result = await buildKeyVoiceComposeResult(
        {
          reflection: buildReflection({ customerSaid: "분당 맛집 추천해줘", reality: softReality }),
          reality: softReality,
          policies: softReality.policies,
        },
        {
          question: "분당 맛집 추천해줘",
          env: {
            KEY_VOICE: "on",
            KEY_BORROWED_SENSES: "off",
            VERCEL_ENV: "preview",
            ANTHROPIC_API_KEY: "test-key",
          },
          fetchImpl: makeAnthropicFetch({
            borrowed: dailySafeVoice({ voice_raw_candidate: safeDaily }),
            s6Text: () => {
              s6N += 1;
              return s6N === 1 ? repairHard : repairSafe;
            },
            log,
          }),
        },
      );
      assert.equal(log.filter((x) => x === "borrowed").length, 0);
      assert.equal(log.filter((x) => x === "s6").length, 2);
      assert.equal(result.key_voice_trace.s6_speak_calls, 2);
      assert.equal(result.key_voice_trace.correction_attempts, 1);
      assert.equal(result.key_voice_trace.hard_safety_repair_attempt, 1);
      assert.equal(result.key_voice_trace.used_failure_mode, false);
      assert.equal(result.text, repairSafe);
      assert.equal(s6N, 2);
      assert.equal(result.key_voice_trace.ghost_path_reached?.length ?? 0, 0);
    }

    // ⑥ Initial S6 hard → repair hard → failureMode; no 3rd call
    {
      const log = [];
      let s6N = 0;
      const result = await buildKeyVoiceComposeResult(
        {
          reflection: buildReflection({ customerSaid: "분당 맛집 추천해줘", reality: softReality }),
          reality: softReality,
          policies: softReality.policies,
        },
        {
          question: "분당 맛집 추천해줘",
          env: {
            KEY_VOICE: "on",
            KEY_BORROWED_SENSES: "off",
            VERCEL_ENV: "preview",
            ANTHROPIC_API_KEY: "test-key",
          },
          fetchImpl: makeAnthropicFetch({
            borrowed: dailySafeVoice({ voice_raw_candidate: safeDaily }),
            s6Text: () => {
              s6N += 1;
              return repairHard;
            },
            log,
          }),
        },
      );
      assert.equal(log.filter((x) => x === "s6").length, 2);
      assert.equal(result.key_voice_trace.s6_speak_calls, 2);
      assert.equal(result.key_voice_trace.correction_attempts, 1);
      assert.equal(result.key_voice_trace.hard_safety_repair_attempt, 1);
      assert.equal(result.key_voice_trace.used_failure_mode, true);
      assert.equal(result.text, KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT);
      assert.equal(s6N, 2);
      assert.equal(result.key_voice_trace.ghost_path_reached?.length ?? 0, 0);
    }

    // ⑦ Promotion success — customerText not replaced; correction budget independent
    {
      const log = [];
      const result = await buildKeyVoiceComposeResult(
        {
          reflection: buildReflection({ customerSaid: "보험료를 줄이고 싶어", reality: softReality }),
          reality: softReality,
          policies: softReality.policies,
        },
        {
          question: "보험료를 줄이고 싶어",
          env: {
            KEY_VOICE: "on",
            KEY_BORROWED_SENSES: "active",
            VERCEL_ENV: "preview",
            ANTHROPIC_API_KEY: "test-key",
          },
          fetchImpl: makeAnthropicFetch({
            borrowed: goodBorrowedInput({
              understanding_hypotheses: ["보험료 절감 목적이 있을 수 있음"],
              voice_raw_candidate:
                "보험료를 줄이고 싶으신 거죠. 절감 목적이면 확인된 22건 중 중복·납입부터 보는 게 맞아 보여요. 납입 구조부터 볼까요?",
              proposal_direction: "절감 목적이면 중복·납입 확인이 먼저 맞아 보입니다",
              next_decision_point: ["납입 구조부터", "중복 보장부터"],
              recommendation_basis: "절감 목적",
            }),
            s6Text: "S6_PROMO_SHOULD_NOT_REPLACE",
            log,
          }),
        },
      );
      assert.equal(result.key_voice_trace.borrowed_senses_shadow?.customer_text_changed, false);
      assert.equal(result.key_voice_trace.promotion_diagnostic?.customer_text_replaced, false);
      assert.equal(result.key_voice_trace.ghost_path_reached?.length ?? 0, 0);
      assert.ok(!/S6_PROMO_SHOULD_NOT_REPLACE/.test(result.text));
    }

    // ⑧ soft expression reason → repair 0
    {
      const log = [];
      const softExpr = "어떤 분위기나 음식 종류를 원하세요?";
      const result = await buildKeyVoiceComposeResult(
        {
          reflection: buildReflection({ customerSaid: "분당 맛집 추천해줘", reality: softReality }),
          reality: softReality,
          policies: softReality.policies,
        },
        {
          question: "분당 맛집 추천해줘",
          env: {
            KEY_VOICE: "on",
            KEY_BORROWED_SENSES: "active",
            VERCEL_ENV: "preview",
            ANTHROPIC_API_KEY: "test-key",
          },
          fetchImpl: makeAnthropicFetch({
            borrowed: dailySafeVoice({ voice_raw_candidate: softExpr }),
            s6Text: "S6_SOFT_EXPR_NO",
            log,
          }),
        },
      );
      assert.equal(log.filter((x) => x === "s6").length, 0);
      assert.equal(result.key_voice_trace.correction_attempts, 0);
      assert.equal(result.key_voice_trace.hard_safety_repair_attempt, 0);
      assert.equal(result.text, softExpr);
      assert.equal(result.key_voice_trace.ghost_path_reached?.length ?? 0, 0);
    }
  }
}

// --- S7-A integrated public research (minimal corrective A–J) ---
{
  const {
    shouldEnablePublicWebSearch,
    extractPublicResearchEvidence,
    applyPlaceResearchContract,
    isPlacePublicResearchRequest,
    ANTHROPIC_WEB_SEARCH_TOOL,
    findUnresolvedServerToolUses,
  } = await import("../server/keyCore/keyBorrowedSensesSpeak.js");
  const {
    voiceHasUnsourcedPublicAssertions,
    voiceHasUnsupportedPlaceClaims,
    voiceHasUnsupportedAddressClaims,
    voiceHasUnverifiedCustomerCoverageClaim,
    placeNameGroundedInEvidence,
    placeNameAppearsInSegment,
    extractMentionedPlaceCandidates,
    shouldUseConstrainedAnswerRegen,
    canSoftApproveBorrowedVoice,
    isSoftPromotionFailReason,
    collectAnswerFacingSafetyFail,
  } = await import("../server/keyCore/keyBorrowedSensesStage2.js");

  assert.equal(shouldEnablePublicWebSearch({ question: "안녕하세요" }), false);
  assert.equal(
    shouldEnablePublicWebSearch({
      question: "보험료 줄이고 싶어",
      decision: { response_priority: "premium_adequacy_check", situation_key: "premium_burden" },
    }),
    false,
  );
  assert.equal(isPlacePublicResearchRequest("분당 맛집 추천해줘"), true);
  assert.equal(shouldEnablePublicWebSearch({ question: "분당 맛집 추천해줘" }), true);
  // E. place request wins over fact_lookup / direction_choice
  assert.equal(
    shouldEnablePublicWebSearch({
      question: "분당 맛집 추천해줘",
      decision: { response_priority: "fact_lookup" },
    }),
    true,
  );
  assert.equal(
    shouldEnablePublicWebSearch({
      question: "근처 조용한 식당 찾아줘",
      decision: { response_priority: "direction_choice", situation_key: "direction_choice" },
    }),
    true,
  );
  assert.equal(
    shouldEnablePublicWebSearch({
      question: "수술비도 많이 들었고 보험금 받을 수 있을지 걱정이야",
      decision: { response_priority: "claim_prep", situation_key: "claim_need_check" },
    }),
    false,
  );
  assert.equal(ANTHROPIC_WEB_SEARCH_TOOL.type, "web_search_20250305");
  assert.equal(ANTHROPIC_WEB_SEARCH_TOOL.name, "web_search");

  const researchEvidence = extractPublicResearchEvidence({
    stop_reason: "end_turn",
    usage: { server_tool_use: { web_search_requests: 1 } },
    content: [
      {
        type: "server_tool_use",
        id: "srvtoolu_test",
        name: "web_search",
        input: { query: "분당 맛집 추천" },
      },
      {
        type: "web_search_tool_result",
        tool_use_id: "srvtoolu_test",
        content: [
          {
            type: "web_search_result",
            url: "https://example.com/a",
            title: "서현 한정식 A",
            encrypted_content: "encFULL_A_CONTENT_VALUE_DO_NOT_TRUNCATE",
            page_age: "2026",
          },
          {
            type: "web_search_result",
            url: "https://example.com/b",
            title: "정자 일식 B",
            encrypted_content: "encFULL_B_CONTENT_VALUE_DO_NOT_TRUNCATE",
            page_age: "2026",
          },
          {
            type: "web_search_result",
            url: "https://example.com/c",
            title: "미금 캐주얼 C",
            encrypted_content: "encFULL_C_CONTENT_VALUE_DO_NOT_TRUNCATE",
            page_age: "2026",
          },
        ],
      },
      {
        type: "text",
        text: "요약",
        citations: [
          {
            type: "web_search_result_location",
            url: "https://example.com/a",
            title: "서현 한정식 A",
            cited_text: "서현 한정식 A · 분당구 정자로 12",
            encrypted_index: "encFULL_INDEX_VALUE_DO_NOT_TRUNCATE",
          },
        ],
      },
    ],
  });
  assert.equal(researchEvidence.used, true);
  assert.equal(researchEvidence.status, "success");
  assert.ok(researchEvidence.results.length >= 3);
  assert.equal(
    researchEvidence.results[0].encrypted_content,
    "encFULL_A_CONTENT_VALUE_DO_NOT_TRUNCATE",
  );
  assert.equal(
    researchEvidence.citations[0].encrypted_index,
    "encFULL_INDEX_VALUE_DO_NOT_TRUNCATE",
  );

  // A. place request with search 0 → research_search_not_used (never success)
  {
    const notUsed = applyPlaceResearchContract(
      {
        status: "empty",
        search_count: 0,
        used: false,
        results: [],
        citations: [],
        errors: [],
      },
      "분당 맛집 추천해줘",
    );
    assert.equal(notUsed.status, "search_not_used");
    assert.equal(notUsed.status_detail, "research_search_not_used");
    assert.equal(notUsed.research_unavailable, true);
    assert.notEqual(notUsed.status, "success");
  }

  // B. ≥1 grounded candidate → research success (3 is preference, not Gate)
  {
    const twoOk = applyPlaceResearchContract(
      {
        status: "success",
        search_count: 1,
        used: true,
        results: [
          { title: "서현 한정식 A", url: "https://example.com/a" },
          { title: "정자 일식 B", url: "https://example.com/b" },
        ],
        citations: [],
        errors: [],
      },
      "분당 맛집 추천해줘",
    );
    assert.equal(twoOk.status, "success");
    assert.equal(twoOk.research_unavailable, false);
    assert.equal(twoOk.status_detail, null);
  }

  // B0. search used but 0 grounded titles → research_insufficient
  {
    const insuf = applyPlaceResearchContract(
      {
        status: "success",
        search_count: 1,
        used: true,
        results: [],
        citations: [],
        errors: [],
      },
      "분당 맛집 추천해줘",
    );
    assert.equal(insuf.status, "insufficient");
    assert.equal(insuf.status_detail, "research_insufficient");
    assert.equal(insuf.research_unavailable, true);
  }

  assert.deepEqual(
    findUnresolvedServerToolUses({
      content: [{ type: "server_tool_use", id: "pending", name: "web_search", input: { query: "q" } }],
    }),
    ["pending"],
  );

  // D/E/F place + address grounding
  assert.equal(
    voiceHasUnsupportedPlaceClaims("가짜식당XYZ가 좋아요", {
      status: "success",
      results: researchEvidence.results,
    }),
    true,
  );
  assert.equal(
    voiceHasUnsupportedPlaceClaims(
      "서현 한정식 A, 정자 일식 B, 미금 캐주얼 C를 추천해요",
      { status: "success", results: researchEvidence.results },
    ),
    false,
  );
  assert.equal(
    voiceHasUnsupportedAddressClaims("분당구 정자로 999에 있어요", {
      status: "success",
      results: researchEvidence.results,
      citations: researchEvidence.citations,
    }),
    true,
  );
  assert.equal(
    collectAnswerFacingSafetyFail({
      gate: { ok: true },
      voice: "서현 한정식 A는 분당구 정자로 999예요.",
      question: "분당 맛집 추천해줘",
      decision: { response_priority: "daily_focus", situation_key: "daily_recommendation" },
      publicResearchEvidence: {
        status: "success",
        results: researchEvidence.results,
        citations: researchEvidence.citations,
      },
    }),
    "unsupported_public_research_claim",
  );
  assert.equal(
    voiceHasUnsupportedAddressClaims("서현 한정식 A는 분당구 정자로 12에 있어요.", {
      status: "success",
      results: researchEvidence.results,
      citations: researchEvidence.citations,
    }),
    false,
  );
  assert.equal(voiceHasUnsourcedPublicAssertions("평점 4.8점이에요. 주차 가능합니다."), true);
  assert.equal(voiceHasUnsourcedPublicAssertions("서현 한정식 A가 담백해서 좋아요."), false);
  assert.equal(
    voiceHasUnsourcedPublicAssertions("윤밀원은 다이닝코드에서도 높은 평점을 유지하고 있어요."),
    false,
  );

  // Over-gating relaxation A–J
  {
    const daily = { response_priority: "daily_focus", situation_key: "daily_recommendation" };
    const claimDec = { response_priority: "claim_prep", situation_key: "claim_need_check" };
    // A. full evidence has 윤밀원·은뜸·팔복; candidate chart titles only list pages / 윤밀원
    const chartNarrowEv = {
      status: "success",
      research_unavailable: false,
      grounded_place_candidates: ["윤밀원"],
      results: [
        {
          title: "분당 맛집 추천 TOP 5, 현지인 강추 리스트",
          url: "https://example.com/list",
          claim_or_summary:
            "야들야들한 족발과 막국수의 윤밀원, 서현 스시 은뜸, 수내 중식 팔복이 자주 언급됩니다.",
        },
        { title: "분당 맛집 Top100 - 다이닝코드", url: "https://diningcode.example/bundang" },
      ],
      citations: [
        {
          title: "분당 맛집 추천 베스트",
          url: "https://example.com/list",
          cited_text: "윤밀원 · 은뜸 · 팔복이 리스트에 꾸준히 오릅니다.",
        },
      ],
    };
    const voiceThree =
      "분당이면 윤밀원은 족발·막국수로 자주 언급되는 편이고, 서현 쪽 은뜸이, 수내 팔복도 후보로 볼 만해요. 어떤 음식 종류가 편하세요?";
    assert.equal(
      voiceHasUnsupportedPlaceClaims(voiceThree, chartNarrowEv, "분당 맛집 추천해줘"),
      false,
    );
    assert.equal(
      collectAnswerFacingSafetyFail({
        gate: { ok: true },
        voice: voiceThree,
        question: "분당 맛집 추천해줘",
        decision: daily,
        publicResearchEvidence: chartNarrowEv,
      }),
      null,
    );
    assert.equal(
      shouldUseConstrainedAnswerRegen({
        failReasons: [],
        voice: voiceThree,
        question: "분당 맛집 추천해줘",
        decision: daily,
        gate: { ok: true },
        publicResearchEvidence: chartNarrowEv,
      }),
      false,
    );

    // B. place name absent from all evidence → hard fail + regen
    assert.equal(
      collectAnswerFacingSafetyFail({
        gate: { ok: true },
        voice: "분당이면 가짜식당XYZ를 추천해요.",
        question: "분당 맛집 추천해줘",
        decision: daily,
        publicResearchEvidence: chartNarrowEv,
      }),
      "unsupported_place_claim",
    );
    assert.equal(
      shouldUseConstrainedAnswerRegen({
        failReasons: ["unsupported_place_claim"],
        voice: "분당이면 가짜식당XYZ를 추천해요.",
        question: "분당 맛집 추천해줘",
        decision: daily,
        gate: { ok: true },
        publicResearchEvidence: chartNarrowEv,
      }),
      true,
    );

    // C. place in evidence; exact rating digits not in evidence → rating fails, place name OK
    assert.equal(
      voiceHasUnsupportedPlaceClaims(
        "윤밀원을 추천해요. 평점 4.8점이에요.",
        chartNarrowEv,
        "분당 맛집 추천해줘",
      ),
      false,
    );
    assert.equal(
      voiceHasUnsourcedPublicAssertions("윤밀원을 추천해요. 평점 4.8점이에요.", chartNarrowEv),
      true,
    );
    assert.equal(
      collectAnswerFacingSafetyFail({
        gate: { ok: true },
        voice: "윤밀원을 추천해요. 평점 4.8점이에요.",
        question: "분당 맛집 추천해줘",
        decision: daily,
        publicResearchEvidence: chartNarrowEv,
      }),
      "unsourced_public_assertion",
    );

    const successOne = {
      status: "success",
      research_unavailable: false,
      results: [{ title: "서현 한정식 A", url: "https://example.com/a" }],
      citations: [],
    };
    const successTwo = {
      status: "success",
      research_unavailable: false,
      results: [
        { title: "서현 한정식 A", url: "https://example.com/a" },
        { title: "정자 일식 B", url: "https://example.com/b" },
      ],
      citations: [],
    };
    // D. 1곳 PASS · regen 0
    assert.equal(
      collectAnswerFacingSafetyFail({
        gate: { ok: true },
        voice: "지금은 서현 한정식 A를 추천해요.",
        question: "분당 맛집 추천해줘",
        decision: daily,
        publicResearchEvidence: successOne,
      }),
      null,
    );
    assert.equal(
      shouldUseConstrainedAnswerRegen({
        failReasons: [],
        voice: "지금은 서현 한정식 A를 추천해요.",
        question: "분당 맛집 추천해줘",
        decision: daily,
        gate: { ok: true },
        publicResearchEvidence: successOne,
      }),
      false,
    );
    // E. 2곳 PASS · regen 0
    assert.equal(
      collectAnswerFacingSafetyFail({
        gate: { ok: true },
        voice: "서현 한정식 A와 정자 일식 B를 추천해요.",
        question: "분당 맛집 추천해줘",
        decision: daily,
        publicResearchEvidence: successTwo,
      }),
      null,
    );
    // F. candidates exist but clarifying only → incomplete + regen
    assert.equal(
      collectAnswerFacingSafetyFail({
        gate: { ok: true },
        voice: "어떤 분위기나 음식 종류를 원하세요?",
        question: "분당 맛집 추천해줘",
        decision: daily,
        publicResearchEvidence: chartNarrowEv,
      }),
      "place_request_unanswered",
    );
    assert.equal(
      shouldUseConstrainedAnswerRegen({
        failReasons: ["place_request_unanswered"],
        voice: "어떤 분위기나 음식 종류를 원하세요?",
        question: "분당 맛집 추천해줘",
        decision: daily,
        gate: { ok: true },
        publicResearchEvidence: chartNarrowEv,
      }),
      true,
    );

    // G. T2 parents meal — PASS · no insurance · regen 0
    const t2Voice =
      "아버지 수술 후라면 자극 적고 조용한 곳이 나을 수 있어요. 이동 거리는 어느 정도가 편하세요?";
    assert.equal(
      collectAnswerFacingSafetyFail({
        gate: { ok: true },
        voice: t2Voice,
        question: "부모님 모시고 가는데 아버지가 최근 수술하셨어",
        decision: daily,
      }),
      null,
    );
    assert.equal(
      shouldUseConstrainedAnswerRegen({
        failReasons: [],
        voice: t2Voice,
        question: "부모님 모시고 가는데 아버지가 최근 수술하셨어",
        decision: daily,
        gate: { ok: true },
      }),
      false,
    );

    // H. T3 natural claim ask without full checklist → PASS · no claim_prep_incomplete block · regen 0
    const t3Natural =
      "수술비가 많이 들어서 걱정이 크시겠어요. 지금 당장 보험금이 나온다고 단정할 수는 없어요. 수술명이나 진단명, 그리고 가입하신 계약부터 알려주시면 어디부터 확인하면 될지 같이 볼게요.";
    assert.equal(
      collectAnswerFacingSafetyFail({
        gate: { ok: true },
        voice: t3Natural,
        question: "수술비도 많이 들었고 보험금 받을 수 있을지 걱정이야",
        decision: claimDec,
      }),
      null,
    );
    assert.equal(
      shouldUseConstrainedAnswerRegen({
        failReasons: ["claim_prep_incomplete"],
        voice: t3Natural,
        question: "수술비도 많이 들었고 보험금 받을 수 있을지 걱정이야",
        decision: claimDec,
        gate: { ok: true },
      }),
      false,
    );
    console.log(
      JSON.stringify({
        T3_NATURAL_ANSWER_SAMPLE: t3Natural,
        claim_prep_incomplete_blocks: false,
        regen: 0,
      }),
    );

    // I. T3 payout certainty → hard fail + regen
    assert.equal(
      collectAnswerFacingSafetyFail({
        gate: { ok: true },
        voice: "이번 수술비는 보험금이 지급됩니다. 걱정 마세요.",
        question: "수술비도 많이 들었고 보험금 받을 수 있을지 걱정이야",
        decision: claimDec,
      }),
      "answer_forbidden_certainty",
    );
    assert.equal(
      shouldUseConstrainedAnswerRegen({
        failReasons: ["answer_forbidden_certainty"],
        voice: "이번 수술비는 보험금이 지급됩니다. 걱정 마세요.",
        question: "수술비도 많이 들었고 보험금 받을 수 있을지 걱정이야",
        decision: claimDec,
        gate: { ok: true },
      }),
      true,
    );

    // J. safe place answer not discarded for internal promote soft-fail alone
    assert.equal(isSoftPromotionFailReason("place_promote_requires_research_success"), true);
    assert.equal(
      canSoftApproveBorrowedVoice({
        voice: voiceThree,
        question: "분당 맛집 추천해줘",
        decision: daily,
        gate: { ok: true },
        failReason: "place_promote_requires_research_success",
        publicResearchEvidence: chartNarrowEv,
      }),
      true,
    );

    // --- Precise grounding boundary A–M ---
    // A. cross-field join must not invent 은뜸
    const crossFieldEv = {
      status: "success",
      research_unavailable: false,
      results: [
        { title: "분당 추천은", url: "https://example.com/a", snippet: "뜸배 맛집 리스트" },
      ],
      citations: [],
    };
    assert.equal(placeNameGroundedInEvidence("은뜸", crossFieldEv), false);
    assert.equal(placeNameAppearsInSegment("은뜸", "분당 추천은"), false);
    assert.equal(placeNameAppearsInSegment("은뜸", "뜸배 맛집 리스트"), false);

    // B. different results must not join
    const crossResultEv = {
      status: "success",
      research_unavailable: false,
      results: [
        { title: "서현 한", url: "https://example.com/1" },
        { title: "정식 A 추천", url: "https://example.com/2" },
      ],
      citations: [],
    };
    assert.equal(placeNameGroundedInEvidence("한정식", crossResultEv), false);

    // C. reverse / partial substring of unrelated long string
    const partialEv = {
      status: "success",
      research_unavailable: false,
      results: [{ title: "분당맛집추천베스트십선", url: "https://example.com/x" }],
      citations: [],
    };
    assert.equal(placeNameGroundedInEvidence("십선", partialEv), false);
    assert.equal(placeNameGroundedInEvidence("맛집추", partialEv), false);

    // D. particle forms of real short venue
    const palbokEv = {
      status: "success",
      research_unavailable: false,
      results: [
        {
          title: "수내 맛집 리스트",
          url: "https://example.com/p",
          claim_or_summary: "수내 팔복은 모임 장소로 자주 언급됩니다.",
        },
      ],
      citations: [{ title: "list", url: "https://example.com/p", cited_text: "팔복도 추천된다" }],
    };
    assert.equal(placeNameGroundedInEvidence("팔복", palbokEv), true);
    assert.equal(placeNameAppearsInSegment("팔복", "수내 팔복은 모임 장소로"), true);
    assert.equal(placeNameAppearsInSegment("팔복", "팔복에서 식사"), true);
    assert.equal(placeNameAppearsInSegment("팔복", "팔복도 추천된다"), true);
    assert.equal(placeNameAppearsInSegment("팔복", "무관한긴단어팔복글자만"), false);

    // E. cited_text only
    const citedOnlyEv = {
      status: "success",
      research_unavailable: false,
      results: [{ title: "분당 맛집 TOP", url: "https://example.com/c" }],
      citations: [
        {
          title: "분당 맛집 TOP",
          url: "https://example.com/c",
          cited_text: "은뜸이 서현에서 자주 언급됩니다.",
        },
      ],
    };
    assert.equal(placeNameGroundedInEvidence("은뜸", citedOnlyEv), true);

    // F. general particles are not place candidates
    const generalVoice = "지금은 언급되는 추천이 분당에도 많아요. 확인해 주세요.";
    assert.deepEqual(
      extractMentionedPlaceCandidates(generalVoice, {
        question: "분당 맛집 추천해줘",
        publicResearch: chartNarrowEv,
      }),
      [],
    );

    // G. nowhere in evidence
    assert.equal(
      collectAnswerFacingSafetyFail({
        gate: { ok: true },
        voice: "분당이면 가짜식당XYZ를 추천해요.",
        question: "분당 맛집 추천해줘",
        decision: daily,
        publicResearchEvidence: chartNarrowEv,
      }),
      "unsupported_place_claim",
    );

    // H. place ok, exact rating missing
    assert.equal(placeNameGroundedInEvidence("윤밀원", chartNarrowEv), true);
    assert.equal(
      collectAnswerFacingSafetyFail({
        gate: { ok: true },
        voice: "윤밀원을 추천해요. 평점 4.8점이에요.",
        question: "분당 맛집 추천해줘",
        decision: daily,
        publicResearchEvidence: chartNarrowEv,
      }),
      "unsourced_public_assertion",
    );

    // I. unverified customer coverage affirmation
    assert.equal(
      voiceHasUnverifiedCustomerCoverageClaim("가입하신 보험에 수술비 담보가 있습니다."),
      true,
    );
    assert.equal(
      collectAnswerFacingSafetyFail({
        gate: { ok: true },
        voice: "가입하신 보험에 수술비 담보가 있습니다.",
        question: "수술비도 많이 들었고 보험금 받을 수 있을지 걱정이야",
        decision: claimDec,
      }),
      "unverified_customer_coverage_claim",
    );

    // J. coverage check request PASS · regen 0
    const coverageAsk = "가입하신 계약에서 수술비 담보가 있는지 확인해 볼게요.";
    assert.equal(voiceHasUnverifiedCustomerCoverageClaim(coverageAsk), false);
    assert.equal(
      collectAnswerFacingSafetyFail({
        gate: { ok: true },
        voice: coverageAsk,
        question: "수술비도 많이 들었고 보험금 받을 수 있을지 걱정이야",
        decision: claimDec,
      }),
      null,
    );
    assert.equal(
      shouldUseConstrainedAnswerRegen({
        failReasons: [],
        voice: coverageAsk,
        question: "수술비도 많이 들었고 보험금 받을 수 있을지 걱정이야",
        decision: claimDec,
        gate: { ok: true },
      }),
      false,
    );

    // K. T3 natural (already covered as H above) — restate regen 0
    assert.equal(
      shouldUseConstrainedAnswerRegen({
        failReasons: ["claim_prep_incomplete"],
        voice: t3Natural,
        question: "수술비도 많이 들었고 보험금 받을 수 있을지 걱정이야",
        decision: claimDec,
        gate: { ok: true },
      }),
      false,
    );
    console.log(
      JSON.stringify({
        T3_NATURAL_ANSWER_SAMPLE: t3Natural,
        regen: 0,
        precise_grounding: true,
      }),
    );

    // L. gate_missing → soft-approve false
    assert.equal(
      canSoftApproveBorrowedVoice({
        voice: voiceThree,
        question: "분당 맛집 추천해줘",
        decision: daily,
        gate: null,
        failReason: "place_promote_requires_research_success",
        publicResearchEvidence: chartNarrowEv,
      }),
      false,
    );
  }

  assert.equal(isSoftPromotionFailReason("wait_only"), true);
  assert.equal(isSoftPromotionFailReason("daily_insurance_pollution"), false);
  assert.equal(
    shouldUseConstrainedAnswerRegen({
      failReasons: ["wait_only", "mid_field_insurance_drift"],
      voice: "분당 쪽 공개 후보를 아직 충분히 못 모았어요. 한식·일식 중 어떤 분위기부터 맞출까요?",
      question: "분당 맛집 추천해줘",
      decision: { response_priority: "daily_focus", situation_key: "daily_recommendation" },
      gate: { ok: true },
      publicResearchEvidence: {
        status: "search_not_used",
        status_detail: "research_search_not_used",
        research_unavailable: true,
        search_count: 0,
        results: [],
      },
    }),
    false,
  );

  // A compose: search not used → no invented place names
  {
    const q = "분당 맛집 추천해줘";
    const log = [];
    const result = await buildKeyVoiceComposeResult(
      {
        reflection: buildReflection({ customerSaid: q, reality: softReality }),
        reality: softReality,
        policies: softReality.policies,
      },
      {
        question: q,
        env: {
          KEY_VOICE: "on",
          KEY_BORROWED_SENSES: "active",
          VERCEL_ENV: "preview",
          ANTHROPIC_API_KEY: "test-key",
        },
        fetchImpl: makeAnthropicFetch({
          skipWebSearch: true,
          borrowed: goodBorrowedInput({
            customer_intent: "분당 맛집 추천",
            voice_raw_candidate:
              "분당 쪽 공개 후보를 아직 충분히 못 모았어요. 한식·일식 중 어떤 분위기부터 맞출까요?",
            proposal_direction: "조건 확인",
            next_decision_point: ["한식", "일식"],
            recommendation_basis: "search not used",
            insurance_expertise_angle: [],
            used_facts: [],
            key_purpose: "일상 추천",
            leadership_move: "조건 질문",
          }),
          s6Text: "S6_SHOULD_NOT_RUN",
          log,
        }),
      },
    );
    const ev = result.key_voice_trace.borrowed_senses_shadow?.public_research_evidence;
    assert.equal(ev?.status_detail, "research_search_not_used");
    assert.equal(ev?.status, "search_not_used");
    assert.ok(log.filter((x) => x === "research").length >= 1);
    assert.equal(log.filter((x) => x === "borrowed").length, 1);
    assert.ok(!/가짜식당|한정식 A|일식 B|캐주얼 C/.test(result.text));
    assert.ok(!/보험료|22건/.test(result.text));
  }

  // B compose: 2 grounded → success; recommend both; no invented third
  {
    const q = "분당 맛집 추천해줘";
    const log = [];
    const two = [
      {
        type: "web_search_result",
        url: "https://example.com/a",
        title: "서현 한정식 A",
        encrypted_content: "encA",
        page_age: "2026",
      },
      {
        type: "web_search_result",
        url: "https://example.com/b",
        title: "정자 일식 B",
        encrypted_content: "encB",
        page_age: "2026",
      },
    ];
    const result = await buildKeyVoiceComposeResult(
      {
        reflection: buildReflection({ customerSaid: q, reality: softReality }),
        reality: softReality,
        policies: softReality.policies,
      },
      {
        question: q,
        env: {
          KEY_VOICE: "on",
          KEY_BORROWED_SENSES: "active",
          VERCEL_ENV: "preview",
          ANTHROPIC_API_KEY: "test-key",
        },
        fetchImpl: makeAnthropicFetch({
          researchResults: two,
          borrowed: goodBorrowedInput({
            customer_intent: "분당 맛집 추천",
            voice_raw_candidate:
              "지금은 서현 한정식 A와 정자 일식 B를 추천해요. 음식 종류를 하나 더 알려주시면 후보를 더 찾아볼게요.",
            proposal_direction: "확인 후보 제시",
            next_decision_point: ["한식", "일식"],
            recommendation_basis: "grounded 2",
            insurance_expertise_angle: [],
            used_facts: [],
            key_purpose: "일상 추천",
            leadership_move: "후보 제시 후 조건",
          }),
          s6Text: "S6_NO",
          log,
        }),
      },
    );
    const ev = result.key_voice_trace.borrowed_senses_shadow?.public_research_evidence;
    assert.equal(ev?.status, "success");
    assert.equal(ev?.research_unavailable, false);
    assert.match(result.text, /한정식 A/);
    assert.match(result.text, /일식 B/);
    assert.ok(!/캐주얼 C|가짜식당/.test(result.text));
    assert.ok(log.filter((x) => x === "research").length >= 1);
    assert.equal(log.filter((x) => x === "borrowed").length, 1);
  }

  // C. normal T1 — search≥1, 3 grounded places, insurance 0, emit 1, regen 0
  {
    const q = "분당 맛집 추천해줘";
    const log = [];
    const toolShapes = [];
    const borrowed = goodBorrowedInput({
      customer_intent: "분당 맛집 추천",
      understanding_hypotheses: ["공개 장소 정보가 필요할 수 있음"],
      voice_raw_candidate:
        "분당이면 서현 한정식 A, 정자 일식 B, 미금 캐주얼 C를 먼저 볼 수 있어요. 한식·일식·캐주얼 중 어떤 분위기부터 맞출까요?",
      proposal_direction: "음식 종류부터",
      next_decision_point: ["한식", "일식", "캐주얼"],
      recommendation_basis: "검색된 후보 3곳",
      insurance_expertise_angle: [],
      used_facts: [],
      key_purpose: "일상 추천",
      leadership_move: "분위기부터",
    });
    const fetchImpl = makeAnthropicFetch({ borrowed, s6Text: "S6_D_NO", log });
    const wrapped = async (url, opts = {}) => {
      const body = JSON.parse(String(opts.body ?? "{}"));
      const tools = Array.isArray(body.tools) ? body.tools.map((t) => t.name) : [];
      toolShapes.push({
        tools,
        mixed: tools.includes("web_search") && tools.includes("emit_borrowed_senses"),
      });
      return fetchImpl(url, opts);
    };
    const result = await buildKeyVoiceComposeResult(
      {
        reflection: buildReflection({ customerSaid: q, reality: softReality }),
        reality: softReality,
        policies: softReality.policies,
      },
      {
        question: q,
        env: {
          KEY_VOICE: "on",
          KEY_BORROWED_SENSES: "active",
          VERCEL_ENV: "preview",
          ANTHROPIC_API_KEY: "test-key",
        },
        fetchImpl: wrapped,
      },
    );
    assert.ok(toolShapes.every((t) => t.mixed === false));
    assert.ok(log.filter((x) => x === "research").length >= 1);
    assert.equal(log.filter((x) => x === "borrowed").length, 1);
    assert.equal(log.filter((x) => x === "s6").length, 0);
    assert.equal(result.key_voice_trace.used_constrained_regen, false);
    assert.equal(result.key_voice_trace.borrowed_senses_shadow.public_research_evidence.status, "success");
    assert.ok(result.key_voice_trace.directive?.public_research_evidence?.results?.length >= 3);
    assert.match(result.text, /한정식 A/);
    assert.match(result.text, /일식 B/);
    assert.match(result.text, /캐주얼 C/);
    assert.ok(!/보험료|가입|22건/.test(result.text));
  }

  // D. unsupported place → focused Claude correction ≤1
  {
    const q = "분당 맛집 추천해줘";
    const log = [];
    const repaired =
      "분당이면 서현 한정식 A, 정자 일식 B, 미금 캐주얼 C부터 볼 수 있어요. 분위기부터 맞출까요?";
    let borrowedN = 0;
    const result = await buildKeyVoiceComposeResult(
      {
        reflection: buildReflection({ customerSaid: q, reality: softReality }),
        reality: softReality,
        policies: softReality.policies,
      },
      {
        question: q,
        env: {
          KEY_VOICE: "on",
          KEY_BORROWED_SENSES: "active",
          VERCEL_ENV: "preview",
          ANTHROPIC_API_KEY: "test-key",
        },
        fetchImpl: makeAnthropicFetch({
          borrowed: () => {
            borrowedN += 1;
            return goodBorrowedInput({
              customer_intent: "분당 맛집 추천",
              voice_raw_candidate:
                borrowedN === 1
                  ? "분당이면 가짜식당XYZ를 추천해요. 분위기부터 볼까요?"
                  : repaired,
              proposal_direction: "맛집",
              next_decision_point: ["한식", "일식"],
              insurance_expertise_angle: [],
              used_facts: [],
              key_purpose: "일상 추천",
              leadership_move: "추천",
            });
          },
          s6Text: "S6_SHOULD_NOT_RUN_UNSUPPORTED_PLACE",
          log,
        }),
      },
    );
    assert.equal(log.filter((x) => x === "research").length, 1);
    assert.equal(log.filter((x) => x === "borrowed").length, 2);
    assert.equal(log.filter((x) => x === "s6").length, 0);
    assert.equal(result.key_voice_trace.s6_speak_calls, 0);
    assert.equal(result.key_voice_trace.used_constrained_regen, false);
    assert.equal(result.key_voice_trace.hard_safety_repair_attempt, 1);
    assert.equal(result.key_voice_trace.correction_attempts, 1);
    assert.equal(result.key_voice_trace.focused_correction_count, 1);
    assert.ok(!/가짜식당XYZ/.test(result.text));
  }

  // G. T1 insurance pollution → focused Claude correction exactly 1, same evidence, no re-search
  {
    const q = "분당 맛집 추천해줘";
    const log = [];
    const repaired =
      "분당이면 서현 한정식 A, 정자 일식 B, 미금 캐주얼 C부터 좁혀볼 수 있어요. 분위기와 동행 인원 중 어떤 것부터 맞출까요?";
    let borrowedN = 0;
    const result = await buildKeyVoiceComposeResult(
      {
        reflection: buildReflection({ customerSaid: q, reality: softReality }),
        reality: softReality,
        policies: softReality.policies,
      },
      {
        question: q,
        env: {
          KEY_VOICE: "on",
          KEY_BORROWED_SENSES: "active",
          VERCEL_ENV: "preview",
          ANTHROPIC_API_KEY: "test-key",
        },
        fetchImpl: makeAnthropicFetch({
          borrowed: () => {
            borrowedN += 1;
            return goodBorrowedInput({
              customer_intent: "분당 맛집 추천 — 보험과 무관",
              understanding_hypotheses: ["일상적인 맛집 추천 요청일 가능성이 높음"],
              voice_raw_candidate:
                borrowedN === 1
                  ? "맛집은 이 정도로 두고, 보험 쪽으로 궁금하신 게 생기면 같이 보죠. 22건 기준으로 보험료를 줄일지 빠진 보장을 채울지 정하면 됩니다."
                  : repaired,
              proposal_direction: borrowedN === 1 ? "보험 전환" : "맛집",
              next_decision_point: borrowedN === 1 ? ["보험료", "보장"] : ["분위기", "동행"],
              insurance_expertise_angle: [],
              used_facts: [],
              key_purpose: "일상 추천",
              leadership_move: borrowedN === 1 ? "보험 상담 전환" : "후보 제시",
            });
          },
          s6Text: "S6_SHOULD_NOT_RUN_T1",
          log,
        }),
      },
    );
    assert.equal(log.filter((x) => x === "research").length, 1);
    assert.equal(log.filter((x) => x === "borrowed").length, 2);
    assert.equal(log.filter((x) => x === "s6").length, 0);
    assert.equal(result.key_voice_trace.s6_speak_calls, 0);
    assert.equal(result.key_voice_trace.focused_correction_count, 1);
    assert.equal(result.text, repaired);
    assert.equal(result.key_voice_trace.used_constrained_regen, false);
    assert.equal(result.key_voice_trace.hard_safety_repair_attempt, 1);
    assert.equal(result.key_voice_trace.correction_attempts, 1);
    assert.ok(!/보험 쪽|22건|보험료를 줄일지/.test(result.text));
  }

  // H. T2 — parents meal/mobility first, safe → regen 0
  {
    const q = "부모님 모시고 가는데 아버지가 최근 수술하셨어";
    const log = [];
    const history = [
      { role: "user", content: "분당 맛집 추천해줘" },
      {
        role: "assistant",
        content:
          "분당이면 서현 한정식 A, 정자 일식 B, 미금 캐주얼 C를 먼저 볼 수 있어요. 한식·일식·캐주얼 중 어떤 분위기부터 맞출까요?",
      },
    ];
    const result = await buildKeyVoiceComposeResult(
      {
        reflection: buildReflection({ customerSaid: q, reality: softReality }),
        reality: softReality,
        policies: softReality.policies,
      },
      {
        question: q,
        history,
        env: {
          KEY_VOICE: "on",
          KEY_BORROWED_SENSES: "active",
          VERCEL_ENV: "preview",
          ANTHROPIC_API_KEY: "test-key",
        },
        fetchImpl: makeAnthropicFetch({
          borrowed: goodBorrowedInput({
            customer_intent: "부모님 동행 식사 장소 도움 — 수술·돌봄 단서는 있으나 보험 요청은 아직 아님",
            understanding_hypotheses: [
              "가족 식사 장소 요청이 우선일 수 있음",
              "수술·가족 돌봄 단서가 있을 수 있으나 즉시 보험 전환은 아님",
            ],
            voice_raw_candidate:
              "아버지 수술 후라면 자극 적고 조용한 곳이 나을 수 있어요. 서현·정자 쪽에 담백한 한식 위주로 좁혀볼까요? 이동 거리는 어느 정도가 편하세요?",
            proposal_direction: "조용하고 담백한 식사 장소부터",
            next_decision_point: ["담백한 한식", "이동 거리 먼저", "예약 가능한 곳"],
            recommendation_basis: "식사·이동 편의 우선, 수술은 배려 조건",
            insurance_expertise_angle: [],
            used_facts: [],
            key_purpose: "일상 추천 이어가기",
            leadership_move: "식사 조건부터 좁히기",
          }),
          s6Text: "S6_T2_SHOULD_NOT_RUN",
          log,
        }),
      },
    );
    assert.equal(result.key_voice_trace.used_constrained_regen, false);
    assert.ok(!/S6_T2_SHOULD_NOT_RUN/.test(result.text));
    assert.match(result.text, /한식|이동|편/);
    assert.ok(!/보험료|22건|보험금/.test(result.text));
  }

  // I. T3 — public search 0, no payment certainty
  {
    const q = "수술비도 많이 들었고 보험금 받을 수 있을지 걱정이야";
    const log = [];
    const history = [
      { role: "user", content: "분당 맛집 추천해줘" },
      { role: "assistant", content: "분당 쪽 선택지가 많아요." },
      { role: "user", content: "부모님 모시고 가는데 아버지가 최근 수술하셨어" },
      { role: "assistant", content: "이동이 편한 자리부터 맞추면 좋아요." },
    ];
    const result = await buildKeyVoiceComposeResult(
      {
        reflection: buildReflection({ customerSaid: q, reality: softReality }),
        reality: softReality,
        policies: softReality.policies,
      },
      {
        question: q,
        history,
        env: {
          KEY_VOICE: "on",
          KEY_BORROWED_SENSES: "active",
          VERCEL_ENV: "preview",
          ANTHROPIC_API_KEY: "test-key",
        },
        fetchImpl: makeAnthropicFetch({
          borrowed: goodBorrowedInput({
            customer_intent: "수술비·보험금 걱정 — 자료 확인 필요",
            understanding_hypotheses: ["지급 단정 금지", "서류·담보 확인이 먼저"],
            voice_raw_candidate:
              "걱정되시는 마음 알겠어요. 확인 전에는 지급 여부를 단정할 수 없어요. 수술명이나 진단명을 알려주시면, 진단서·수술확인서·영수증·진료비 세부내역·해당 담보부터 같이 확인해볼까요?",
            proposal_direction: "서류·담보 확인",
            recommendation_basis: "확인 전 지급 단정 금지 · 서류·담보부터",
            next_decision_point: ["진단서·영수증부터", "담보 목록부터"],
            used_facts: [],
            insurance_expertise_angle: [],
            key_purpose: "청구 준비",
            leadership_move: "서류·담보 확인",
            answer_purpose: "청구 준비 리드",
          }),
          s6Text: "S6_T3_NO",
          log,
        }),
      },
    );
    assert.equal(log.filter((x) => x === "research").length, 0);
    assert.equal(log.filter((x) => x === "borrowed").length, 1);
    assert.equal(result.key_voice_trace.used_constrained_regen, false);
    assert.ok(!/받을 수 있습니다|지급됩니다/.test(result.text));
    assert.match(result.text, /진단서|담보|확인/);
  }

  // Completeness compose: success evidence + clarifying-only → regen ≤1
  {
    const q = "분당 맛집 추천해줘";
    const log = [];
    const result = await buildKeyVoiceComposeResult(
      {
        reflection: buildReflection({ customerSaid: q, reality: softReality }),
        reality: softReality,
        policies: softReality.policies,
      },
      {
        question: q,
        env: {
          KEY_VOICE: "on",
          KEY_BORROWED_SENSES: "active",
          VERCEL_ENV: "preview",
          ANTHROPIC_API_KEY: "test-key",
        },
        fetchImpl: makeAnthropicFetch({
          borrowed: goodBorrowedInput({
            customer_intent: "분당 맛집 추천",
            voice_raw_candidate: "어떤 분위기나 음식 종류를 원하세요?",
            proposal_direction: "조건 확인",
            next_decision_point: ["한식", "일식"],
            recommendation_basis: "clarifying only",
            insurance_expertise_angle: [],
            used_facts: [],
            key_purpose: "일상 추천",
            leadership_move: "조건 질문",
          }),
          s6Text:
            "분당이면 서현 한정식 A, 정자 일식 B, 미금 캐주얼 C부터 볼 수 있어요. 담백한 한식·일식·캐주얼 중 어떤 분위기부터 맞출까요?",
          log,
        }),
      },
    );
    assert.equal(log.filter((x) => x === "research").length, 1);
    assert.equal(log.filter((x) => x === "borrowed").length, 1);
    assert.equal(log.filter((x) => x === "s6").length, 0);
    // Soft incompleteness keeps clarifying candidate — repair budget unused.
    assert.equal(result.key_voice_trace.used_constrained_regen, false);
    assert.equal(result.key_voice_trace.hard_safety_repair_attempt, 0);
    assert.equal(result.key_voice_trace.correction_attempts, 0);
    assert.equal(result.key_voice_trace.used_failure_mode, false);
    assert.match(result.text, /분위기|음식 종류/);
  }

  // T3 incomplete is covered by collectAnswerFacingSafetyFail unit (H) above;
  // compose regen for claim_prep is exercised when Stage3 rejects incomplete voice.
}

// --- S7-A CURRENT TASK CONTINUITY (A–G) ---
{
  const {
    KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT,
    isKeyMonopolyFailureCustomerText,
  } = await import("../server/keyCore/keyCustomerMonopoly.js");
  const {
    buildOpenCustomerThreadContext,
    buildUserPayload,
    isActivePlaceCustomerThread,
    isClearNewTopicInsuranceAsk,
    shouldEnablePublicWebSearch,
  } = await import("../server/keyCore/keyBorrowedSensesSpeak.js");
  const { isWaitOnlyVoice, canSoftApproveBorrowedVoice, placeNameGroundedInEvidence, voiceHasUnverifiedCustomerCoverageClaim } = await import(
    "../server/keyCore/keyBorrowedSensesStage2.js"
  );
  const { observeSameSessionContentNotes } = await import(
    "../scripts/key-borrowed-senses-preview-observe-probe.mjs"
  );

  const placeEv = {
    status: "success",
    research_unavailable: false,
    search_count: 1,
    results: [
      {
        title: "서현 한정식 A",
        url: "https://example.com/a",
        snippet: "분당 서현 한정식 A 추천",
        cited_text: "서현 한정식 A",
      },
    ],
    citations: [{ title: "서현 한정식 A", cited_text: "서현 한정식 A" }],
    grounded_place_candidates: ["서현 한정식 A"],
  };

  // A. place evidence present → recommend grounded place, no wait, regen 0
  {
    const q = "분당 맛집 추천해줘";
    const log = [];
    const voice =
      "분당이면 서현 한정식 A, 정자 일식 B, 미금 캐주얼 C를 먼저 볼 수 있어요. 담백한 한식·일식·캐주얼이라 고르기 좋아요. 어떤 분위기부터 맞출까요?";
    const result = await buildKeyVoiceComposeResult(
      {
        reflection: buildReflection({ customerSaid: q, reality: softReality }),
        reality: softReality,
        policies: softReality.policies,
      },
      {
        question: q,
        env: {
          KEY_VOICE: "on",
          KEY_BORROWED_SENSES: "active",
          VERCEL_ENV: "preview",
          ANTHROPIC_API_KEY: "test-key",
        },
        fetchImpl: makeAnthropicFetch({
          borrowed: goodBorrowedInput({
            customer_intent: "분당 맛집 추천 — 보험과 무관",
            understanding_hypotheses: ["일상적인 맛집 추천 요청일 가능성이 높음"],
            voice_raw_candidate: voice,
            proposal_direction: "음식 종류·분위기부터",
            next_decision_point: ["한식 쪽", "일식·캐주얼 쪽", "동행 인원부터"],
            recommendation_basis: "검색된 후보 3곳",
            leadership_move: "후보 제시 후 분위기·동행 확인",
            key_purpose: "일상 추천",
            insurance_expertise_angle: [],
            used_facts: [],
          }),
          s6Text: "S6_CONT_A_NO",
          log,
        }),
      },
    );
    assert.equal(result.key_voice_trace.used_constrained_regen, false);
    assert.equal(result.key_voice_trace.used_failure_mode, false);
    assert.ok(!isKeyMonopolyFailureCustomerText(result.text));
    assert.ok(!isWaitOnlyVoice(result.text));
    assert.match(result.text, /한정식 A|일식 B|캐주얼 C/);
    assert.equal(observeSameSessionContentNotes("T1", result.text).answers_current_request, true);
  }

  // B. place evidence 0 → no invent, clarifying condition, no wait
  {
    const emptyEv = {
      status: "insufficient",
      status_detail: "research_insufficient",
      research_unavailable: true,
      search_count: 1,
      results: [],
      citations: [],
      grounded_place_candidates: [],
    };
    const clarify =
      "지금 바로 확인할 수 있는 분당 식당 후보는 아직 부족해요. 한식·일식 중 어떤 쪽, 또는 서현·정자 중 어느 동네가 편하신지 알려주시면 그에 맞춰 다시 찾아볼게요.";
    assert.equal(isWaitOnlyVoice(clarify), false);
    assert.ok(!isKeyMonopolyFailureCustomerText(clarify));
    assert.ok(!/팔복|은뜸|창작식당/.test(clarify));
    assert.match(clarify, /한식|일식|서현|정자|동네/);
    const soft = canSoftApproveBorrowedVoice({
      voice: clarify,
      question: "분당 맛집 추천해줘",
      decision: { response_priority: "daily_focus", situation_key: "daily_recommendation" },
      gate: { ok: true },
      failReason: "place_promote_requires_research_success",
      publicResearchEvidence: emptyEv,
    });
    assert.equal(soft, true);
  }

  // C. same-session T2 keeps restaurant thread — no travel reframe, no insurance
  {
    const q = "부모님 모시고 가는데 아버지가 최근 수술하셨어";
    const history = [
      { role: "user", text: "분당 맛집 추천해줘" },
      {
        role: "assistant",
        text: "분당이면 서현 한정식 A를 먼저 볼 수 있어요. 담백한 한식이라 고르기 좋아요.",
      },
    ];
    assert.equal(isActivePlaceCustomerThread({ question: q, history }), true);
    assert.equal(shouldEnablePublicWebSearch({ question: q, history }), true);
    const thread = buildOpenCustomerThreadContext({ question: q, history });
    assert.equal(thread.place_thread_open, true);
    assert.ok(thread.prior_user_asks.includes("분당 맛집 추천해줘"));
    const payload = buildUserPayload({ question: q, history });
    assert.equal(payload.open_customer_thread.place_thread_open, true);

    const log = [];
    const voice =
      "아버지 수술 후라면 이동이 편한지, 주차나 엘리베이터, 자리 간격이 중요한 조건이 될 수 있어요. 맵거나 질긴 음식은 피하고 조용한 곳이 나을 수도 있고요. 앞서 본 서현 한정식 A를 이 기준으로 볼까요, 아니면 더 가까운 곳부터 좁혀볼까요?";
    const result = await buildKeyVoiceComposeResult(
      {
        reflection: buildReflection({ customerSaid: q, reality: softReality }),
        reality: softReality,
        policies: softReality.policies,
      },
      {
        question: q,
        history,
        env: {
          KEY_VOICE: "on",
          KEY_BORROWED_SENSES: "active",
          VERCEL_ENV: "preview",
          ANTHROPIC_API_KEY: "test-key",
        },
        fetchImpl: makeAnthropicFetch({
          borrowed: goodBorrowedInput({
            customer_intent: "분당 식당 선택 — 부모님 동행·수술 후 배려 조건",
            understanding_hypotheses: [
              "직전 분당 맛집 요청을 부모님 동행·수술 후 배려 조건으로 구체화하는 중일 가능성",
            ],
            voice_raw_candidate: voice,
            proposal_direction: "이동·좌석·음식 제한으로 후보 좁히기",
            next_decision_point: ["이동 편한 곳", "담백한 메뉴"],
            recommendation_basis: "직전 맛집 요청 유지",
            insurance_expertise_angle: [],
            used_facts: [],
            key_purpose: "일상 추천 연속",
            leadership_move: "배려 조건 확인",
            context_carryover: "직전 대화의 분당 맛집 추천을 이어감",
            answer_purpose: "식당 선택 조건 확인",
          }),
          s6Text: "S6_CONT_C_NO",
          log,
        }),
      },
    );
    assert.equal(result.key_voice_trace.used_constrained_regen, false, result.text);
    assert.ok(!/여행\s*가시는군요/.test(result.text), result.text);
    assert.ok(!/보험료|보험금|담보|4만5천|22건/.test(result.text), result.text);
    assert.match(result.text, /이동|주차|엘리베이터|좌석|맵거나|조용/);
    assert.equal(observeSameSessionContentNotes("T2", result.text).no_insurance_force_switch, true);
  }

  // D. same-session T3 switches to insurance check — no payout certainty, no wait, regen 0
  {
    const q = "수술비도 많이 들었고 보험금 받을 수 있을지 걱정이야";
    const history = [
      { role: "user", text: "분당 맛집 추천해줘" },
      { role: "assistant", text: "서현 한정식 팔복부터 볼 수 있어요." },
      { role: "user", text: "부모님 모시고 가는데 아버지가 최근 수술하셨어" },
      {
        role: "assistant",
        text: "수술 후라면 이동·좌석·음식 제한부터 맞춰볼까요?",
      },
    ];
    assert.equal(isClearNewTopicInsuranceAsk(q), true);
    assert.equal(isActivePlaceCustomerThread({ question: q, history }), false);
    assert.equal(shouldEnablePublicWebSearch({ question: q, history }), false);
    const log = [];
    const voice =
      "수술비 걱정이 크시겠어요. 보험금을 받을 수 있는지는 확인 전에는 단정할 수 없어요. 어떤 수술이셨는지, 가입하신 계약이 있는지만 알려주시면 어디부터 보면 될지 같이 확인할게요.";
    const result = await buildKeyVoiceComposeResult(
      {
        reflection: buildReflection({ customerSaid: q, reality: softReality }),
        reality: softReality,
        policies: softReality.policies,
      },
      {
        question: q,
        history,
        env: {
          KEY_VOICE: "on",
          KEY_BORROWED_SENSES: "active",
          VERCEL_ENV: "preview",
          ANTHROPIC_API_KEY: "test-key",
        },
        fetchImpl: makeAnthropicFetch({
          borrowed: goodBorrowedInput({
            customer_intent: "수술비·보험금 걱정 — 자료 확인 필요",
            understanding_hypotheses: ["지급 단정 금지", "수술명·계약 확인이 먼저"],
            voice_raw_candidate: voice,
            proposal_direction: "서류·담보 확인",
            recommendation_basis: "확인 전 지급 단정 금지 · 수술명·계약부터",
            next_decision_point: ["수술명부터", "계약 확인부터"],
            used_facts: [],
            insurance_expertise_angle: [],
            key_purpose: "청구 준비",
            leadership_move: "확인 경로 제시",
            answer_purpose: "청구 준비 리드",
          }),
          s6Text:
            "수술비 걱정이 크시겠어요. 확인 전에는 지급 여부를 단정할 수 없어요. 수술명이나 가입 계약부터 알려주시면 같이 확인할게요.",
          log,
        }),
      },
    );
    assert.equal(log.filter((x) => x === "research").length, 0);
    assert.equal(result.key_voice_trace.used_constrained_regen, false, result.text);
    assert.ok(!isKeyMonopolyFailureCustomerText(result.text));
    assert.ok(!/받을 수 있습니다|지급됩니다/.test(result.text));
    assert.match(result.text, /수술|계약|확인/);
    assert.equal(observeSameSessionContentNotes("T3", result.text).no_payout_certainty, true);
  }

  // E. clear new topic — do not force prior place thread
  {
    const q = "내 보험료 부담이 너무 커";
    const history = [
      { role: "user", text: "분당 맛집 추천해줘" },
      { role: "assistant", text: "서현 한정식 팔복부터 볼 수 있어요." },
    ];
    assert.equal(isClearNewTopicInsuranceAsk(q), true);
    assert.equal(isActivePlaceCustomerThread({ question: q, history }), false);
    assert.equal(shouldEnablePublicWebSearch({ question: q, history }), false);
  }

  // F. double hard (borrowed + focused Claude repair) → honest failureMode monopoly (not legacy/safe utterance)
  {
    assert.equal(isKeyMonopolyFailureCustomerText(KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT), true);
    assert.equal(isWaitOnlyVoice(KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT), true);
    const q = "분당 맛집 추천해줘";
    const log = [];
    let borrowedN = 0;
    const result = await buildKeyVoiceComposeResult(
      {
        reflection: buildReflection({ customerSaid: q, reality: softReality }),
        reality: softReality,
        policies: softReality.policies,
      },
      {
        question: q,
        env: {
          KEY_VOICE: "on",
          KEY_BORROWED_SENSES: "active",
          VERCEL_ENV: "preview",
          ANTHROPIC_API_KEY: "test-key",
        },
        fetchImpl: makeAnthropicFetch({
          borrowed: () => {
            borrowedN += 1;
            return goodBorrowedInput({
              customer_intent: "분당 맛집",
              voice_raw_candidate:
                borrowedN === 1
                  ? "가입하세요. 해지해도 됩니다. 등록 22건이면 충분합니다."
                  : "가입하세요. 해지해도 됩니다. 등록 22건이면 충분합니다. 보험료를 바로 줄이세요.",
              proposal_direction: "보험 전환",
              next_decision_point: ["가입", "해지"],
              recommendation_basis: "unsafe",
              insurance_expertise_angle: [],
              used_facts: [],
            });
          },
          s6Text: "S6_SHOULD_NOT_RUN_DOUBLE_HARD",
          log,
        }),
      },
    );
    assert.equal(log.filter((x) => x === "s6").length, 0);
    assert.equal(result.key_voice_trace.s6_speak_calls, 0);
    assert.equal(result.key_voice_trace.used_constrained_regen, false);
    assert.equal(result.key_voice_trace.correction_attempts, 1);
    assert.equal(result.key_voice_trace.hard_safety_repair_attempt, 1);
    assert.equal(result.key_voice_trace.focused_correction_count, 1);
    assert.equal(result.key_voice_trace.used_failure_mode, true);
    assert.equal(result.text, KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT);
    assert.equal(result.key_voice_trace.ghost_path_reached?.length ?? 0, 0);
    assert.ok(!/말씀하신 요청부터 이어갈게요/.test(result.text));
  }

  // G. grounding / coverage / wait detection regression anchors
  {
    assert.equal(
      placeNameGroundedInEvidence("서현 한정식 A", placeEv),
      true,
    );
    assert.equal(
      voiceHasUnverifiedCustomerCoverageClaim(
        "가입하신 보험에 수술비 담보가 있습니다.",
      ),
      true,
    );
    assert.equal(
      voiceHasUnverifiedCustomerCoverageClaim(
        "가입하신 계약에서 수술비 담보가 있는지 확인해 볼게요.",
      ),
      false,
    );
    assert.equal(isWaitOnlyVoice(KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT), true);
  }
}

// --- S7-A FORCED RESEARCH CONTRACT CORRECTIVE (A–M) ---
{
  const {
    shouldEnablePublicWebSearch,
    needsFreshPublicFacts,
    isPlacePublicResearchRequest,
    ANTHROPIC_WEB_SEARCH_TOOL,
  } = await import("../server/keyCore/keyBorrowedSensesSpeak.js");
  const {
    KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT,
    isKeyMonopolyFailureCustomerText,
  } = await import("../server/keyCore/keyCustomerMonopoly.js");
  const { isWaitOnlyVoice, placeNameGroundedInEvidence, voiceHasUnverifiedCustomerCoverageClaim } =
    await import("../server/keyCore/keyBorrowedSensesStage2.js");
  const { observeSameSessionContentNotes } = await import(
    "../scripts/key-borrowed-senses-preview-observe-probe.mjs"
  );

  function assertResearchProviderPayload(body) {
    assert.ok(body && typeof body === "object");
    const search = (body.tools ?? []).find((t) => t?.name === "web_search");
    assert.ok(search, "web_search tool required");
    assert.equal(search.type, "web_search_20250305");
    assert.equal(search.name, "web_search");
    assert.equal(search.max_uses, 3);
    const hasClaudeFullEmit = (body.tools ?? []).some((t) => t?.name === "emit_claude_full");
    if (hasClaudeFullEmit) {
      // Claude-Full talent-open: web_search offered alongside emit_claude_full; Claude chooses.
      assert.ok(body.tools.length >= 1);
    } else {
      assert.equal(body.tools.length, 1);
      assert.deepEqual(body.tool_choice, { type: "any" });
    }
  }

  function assertEmitProviderPayload(body) {
    assert.ok(body && typeof body === "object");
    const emitFull = (body.tools ?? []).find((t) => t?.name === "emit_claude_full");
    const emitBorrowed = (body.tools ?? []).find((t) => t?.name === "emit_borrowed_senses");
    if (emitFull) {
      assert.equal(emitFull.name, "emit_claude_full");
      assert.ok(
        body.tool_choice?.type === "auto" ||
          body.tool_choice?.name === "emit_claude_full" ||
          body.tool_choice?.type === "tool",
      );
    } else {
      assert.equal(body.tools.length, 1);
      assert.equal(emitBorrowed?.name, "emit_borrowed_senses");
      assert.deepEqual(body.tool_choice, {
        type: "tool",
        name: "emit_borrowed_senses",
      });
    }
  }

  // A + B + C. T1 provider payload + place-first answer (mock Anthropic)
  {
    const q = "분당 맛집 추천해줘";
    assert.equal(needsFreshPublicFacts({ question: q }), true);
    assert.equal(shouldEnablePublicWebSearch({ question: q }), true);
    const log = [];
    const bodies = [];
    const voice =
      "분당이면 서현 한정식 A를 먼저 볼 수 있어요. 담백한 한식이라 고르기 좋아요. 한식·일식 중 어떤 분위기부터 맞출까요?";
    const result = await buildKeyVoiceComposeResult(
      {
        reflection: buildReflection({ customerSaid: q, reality: softReality }),
        reality: softReality,
        policies: softReality.policies,
      },
      {
        question: q,
        env: {
          KEY_VOICE: "on",
          KEY_BORROWED_SENSES: "active",
          VERCEL_ENV: "preview",
          ANTHROPIC_API_KEY: "test-key",
        },
        fetchImpl: makeAnthropicFetch({
          borrowed: goodBorrowedInput({
            customer_intent: "분당 맛집 추천",
            understanding_hypotheses: ["지역 맛집 공개 검색이 필요한 요청"],
            voice_raw_candidate: voice,
            proposal_direction: "확인된 후보 제시 후 조건 확인",
            next_decision_point: ["한식", "일식"],
            recommendation_basis: "검색 근거 후보",
            insurance_expertise_angle: [],
            used_facts: [],
            key_purpose: "일상 추천",
            leadership_move: "후보 먼저 제시",
          }),
          s6Text: "S6_PR_A_NO",
          log,
          bodies,
        }),
      },
    );
    const researchBodies = bodies.filter(
      (b) => Array.isArray(b.tools) && b.tools.some((t) => t?.name === "web_search"),
    );
    const emitBodies = bodies.filter(
      (b) =>
        Array.isArray(b.tools) &&
        b.tools.some(
          (t) => t?.name === "emit_borrowed_senses" || t?.name === "emit_claude_full",
        ) &&
        // Prefer emit-only turn when Claude-Full searched first; else any emit-bearing body.
        (!b.tools.some((t) => t?.name === "web_search") ||
          b.tools.some((t) => t?.name === "emit_claude_full")),
    );
    assert.ok(researchBodies.length >= 1);
    assertResearchProviderPayload(researchBodies[0]);
    assert.ok(emitBodies.length >= 1);
    const emitOnly = emitBodies.find((b) => !b.tools.some((t) => t?.name === "web_search")) ?? emitBodies[0];
    assertEmitProviderPayload(emitOnly);
    assert.ok(log.filter((x) => x === "research").length >= 1);
    assert.equal(log.filter((x) => x === "mixed").length, 0);
    const ev = result.key_voice_trace.borrowed_senses_shadow?.public_research_evidence;
    assert.ok((ev?.search_count ?? 0) >= 1);
    assert.ok((ev?.results?.length ?? 0) >= 1);
    assert.equal(result.key_voice_trace.used_constrained_regen, false);
    assert.ok(!isKeyMonopolyFailureCustomerText(result.text));
    assert.match(result.text, /한정식 A|일식 B|캐주얼 C/);
    assert.ok(!/^어떤 분위기나 음식 종류/.test(result.text.trim()));
    assert.equal(observeSameSessionContentNotes("T1", result.text).answers_current_request, true);
    console.log(
      JSON.stringify({
        T1_MOCK_ANSWER: result.text,
        T1_search_count: ev?.search_count ?? 0,
        T1_evidence: ev?.results?.length ?? 0,
        T1_regen: 0,
      }),
    );
  }

  // D. travel destination recommend ON
  {
    const q = "부산 여행지 추천해줘";
    assert.equal(isPlacePublicResearchRequest(q), true);
    assert.equal(needsFreshPublicFacts({ question: q }), true);
    assert.equal(shouldEnablePublicWebSearch({ question: q }), true);
    const log = [];
    const bodies = [];
    await buildKeyVoiceComposeResult(
      {
        reflection: buildReflection({ customerSaid: q, reality: softReality }),
        reality: softReality,
        policies: softReality.policies,
      },
      {
        question: q,
        env: {
          KEY_VOICE: "on",
          KEY_BORROWED_SENSES: "active",
          VERCEL_ENV: "preview",
          ANTHROPIC_API_KEY: "test-key",
        },
        fetchImpl: makeAnthropicFetch({
          borrowed: goodBorrowedInput({
            customer_intent: "부산 여행지",
            understanding_hypotheses: ["공개 여행지 검색"],
            voice_raw_candidate:
              "부산이면 해운대 해변 산책로부터 볼 수 있어요. 바다 산책이 편하시면 그쪽으로 맞춰볼까요?",
            proposal_direction: "여행지 후보",
            next_decision_point: ["해운대", "광안리"],
            recommendation_basis: "검색",
            insurance_expertise_angle: [],
            used_facts: [],
            key_purpose: "일상",
            leadership_move: "후보",
          }),
          s6Text: "S6_D",
          log,
          bodies,
          researchResults: [
            {
              type: "web_search_result",
              url: "https://example.com/haeundae",
              title: "해운대 해변 산책로",
              encrypted_content: "encFULL_HAE_CONTENT_VALUE_DO_NOT_TRUNCATE",
              page_age: "2026",
            },
          ],
        }),
      },
    );
    assert.ok(log.filter((x) => x === "research").length >= 1);
    assertResearchProviderPayload(
      bodies.find((b) => b.tools?.[0]?.name === "web_search"),
    );
  }

  // E. soft travel feeling OFF
  {
    const q = "부모님과 여행 가고 싶어";
    assert.equal(needsFreshPublicFacts({ question: q }), false);
    assert.equal(shouldEnablePublicWebSearch({ question: q }), false);
    const log = [];
    await buildKeyVoiceComposeResult(
      {
        reflection: buildReflection({ customerSaid: q, reality: softReality }),
        reality: softReality,
        policies: softReality.policies,
      },
      {
        question: q,
        env: {
          KEY_VOICE: "on",
          KEY_BORROWED_SENSES: "active",
          VERCEL_ENV: "preview",
          ANTHROPIC_API_KEY: "test-key",
        },
        fetchImpl: makeAnthropicFetch({
          borrowed: goodBorrowedInput({
            customer_intent: "여행 감정",
            understanding_hypotheses: ["공개 검색 불필요"],
            voice_raw_candidate:
              "부모님과 함께 떠나고 싶은 마음이 느껴져요. 가까운 당일치기인지, 며칠 일정인지부터 맞춰볼까요?",
            proposal_direction: "일정 범위",
            next_decision_point: ["당일", "1박"],
            recommendation_basis: "감정 대화",
            insurance_expertise_angle: [],
            used_facts: [],
            key_purpose: "일상",
            leadership_move: "범위 확인",
          }),
          s6Text: "S6_E",
          log,
        }),
      },
    );
    assert.equal(log.filter((x) => x === "research").length, 0);
  }

  // F + G + H. rewrite / bare recommend / emotion / summary / premium — research OFF
  {
    const offs = [
      "이 문장을 더 자연스럽게 고쳐줘",
      "추천해줘",
      "오늘 기분이 안 좋은데 뭐 하면 좋을까?",
      "내 보험료가 부담스러운데 어떻게 정리할까?",
      "아까 답변을 짧게 요약해줘",
      "외출하기가 조금 두려워",
      "지난 여행 이야기를 정리해줘",
      "여행 계획을 세울 때 뭘 생각해야 해?",
    ];
    for (const q of offs) {
      assert.equal(needsFreshPublicFacts({ question: q }), false, q);
      assert.equal(shouldEnablePublicWebSearch({ question: q }), false, q);
      const log = [];
      await buildKeyVoiceComposeResult(
        {
          reflection: buildReflection({ customerSaid: q, reality: softReality }),
          reality: softReality,
          policies: softReality.policies,
        },
        {
          question: q,
          env: {
            KEY_VOICE: "on",
            KEY_BORROWED_SENSES: "active",
            VERCEL_ENV: "preview",
            ANTHROPIC_API_KEY: "test-key",
          },
          fetchImpl: makeAnthropicFetch({
            borrowed: goodBorrowedInput({
              customer_intent: "non_public",
              understanding_hypotheses: ["검색 불필요"],
              voice_raw_candidate:
                "말씀하신 요청부터 같이 볼게요. 어떤 쪽을 먼저 맞출까요?",
              proposal_direction: "요청 확인",
              next_decision_point: ["짧게", "자세히"],
              recommendation_basis: "대화",
              insurance_expertise_angle: [],
              used_facts: [],
              key_purpose: "일상",
              leadership_move: "확인",
            }),
            s6Text: "S6_OFF",
            log,
          }),
        },
      );
      assert.equal(log.filter((x) => x === "research").length, 0, q);
    }
  }

  // I. search empty + search_not_used on production compose path
  {
    const q = "분당 맛집 추천해줘";
    // empty results after web_search call
    {
      const log = [];
      const clarify =
        "지금 바로 확인할 수 있는 분당 식당 후보는 아직 부족해요. 한식·일식 중 어떤 쪽, 또는 서현·정자 중 어느 동네가 편하신지 알려주시면 다시 찾아볼게요.";
      const result = await buildKeyVoiceComposeResult(
        {
          reflection: buildReflection({ customerSaid: q, reality: softReality }),
          reality: softReality,
          policies: softReality.policies,
        },
        {
          question: q,
          env: {
            KEY_VOICE: "on",
            KEY_BORROWED_SENSES: "active",
            VERCEL_ENV: "preview",
            ANTHROPIC_API_KEY: "test-key",
          },
          fetchImpl: makeAnthropicFetch({
            researchResults: [],
            borrowed: goodBorrowedInput({
              customer_intent: "분당 맛집",
              understanding_hypotheses: ["검색 empty"],
              voice_raw_candidate: clarify,
              proposal_direction: "조건 1개",
              next_decision_point: ["한식", "서현"],
              recommendation_basis: "empty",
              insurance_expertise_angle: [],
              used_facts: [],
              key_purpose: "일상",
              leadership_move: "조건 질문",
            }),
            s6Text: "S6_EMPTY",
            log,
          }),
        },
      );
      const ev = result.key_voice_trace.borrowed_senses_shadow?.public_research_evidence;
      assert.ok(log.filter((x) => x === "research").length >= 1);
      assert.ok(["empty", "insufficient", "search_not_used"].includes(String(ev?.status)));
      assert.ok(!/한정식 A|일식 B|캐주얼 C|가짜식당|팔복/.test(result.text));
      assert.ok(!isKeyMonopolyFailureCustomerText(result.text));
      assert.equal(isWaitOnlyVoice(result.text), false);
      assert.ok(!/충분히\s*찾았|검색\s*완료|바로\s*추천/.test(result.text));
      assert.equal(result.key_voice_trace.used_constrained_regen, false);
    }
    // search_not_used
    {
      const log = [];
      const clarify =
        "분당 쪽 공개 후보를 아직 충분히 못 모았어요. 한식·일식 중 어떤 분위기부터 맞출까요?";
      const result = await buildKeyVoiceComposeResult(
        {
          reflection: buildReflection({ customerSaid: q, reality: softReality }),
          reality: softReality,
          policies: softReality.policies,
        },
        {
          question: q,
          env: {
            KEY_VOICE: "on",
            KEY_BORROWED_SENSES: "active",
            VERCEL_ENV: "preview",
            ANTHROPIC_API_KEY: "test-key",
          },
          fetchImpl: makeAnthropicFetch({
            skipWebSearch: true,
            borrowed: goodBorrowedInput({
              customer_intent: "분당 맛집",
              understanding_hypotheses: ["search not used"],
              voice_raw_candidate: clarify,
              proposal_direction: "조건 확인",
              next_decision_point: ["한식", "일식"],
              recommendation_basis: "search_not_used",
              insurance_expertise_angle: [],
              used_facts: [],
              key_purpose: "일상",
              leadership_move: "조건 질문",
            }),
            s6Text: "S6_NOT_USED",
            log,
          }),
        },
      );
      const ev = result.key_voice_trace.borrowed_senses_shadow?.public_research_evidence;
      assert.equal(ev?.status, "search_not_used");
      assert.ok(!/한정식 A|가짜식당/.test(result.text));
      assert.ok(!isKeyMonopolyFailureCustomerText(result.text));
      assert.equal(isWaitOnlyVoice(result.text), false);
      assert.equal(result.key_voice_trace.used_constrained_regen, false);
    }
  }

  // J. same-session T2 place continuity
  {
    const q = "부모님 모시고 가는데 아버지가 최근 수술하셨어";
    const history = [
      { role: "user", text: "분당 맛집 추천해줘" },
      {
        role: "assistant",
        text: "분당이면 서현 한정식 A를 먼저 볼 수 있어요.",
      },
    ];
    assert.equal(shouldEnablePublicWebSearch({ question: q, history }), true);
    const log = [];
    const voice =
      "아버지 수술 후라면 이동·주차·엘리베이터·좌석 편의가 중요할 수 있어요. 맵거나 질긴 음식은 피하고 조용한 곳이 나을 수도 있고요. 앞서 본 서현 한정식 A를 이 기준으로 볼까요?";
    const result = await buildKeyVoiceComposeResult(
      {
        reflection: buildReflection({ customerSaid: q, reality: softReality }),
        reality: softReality,
        policies: softReality.policies,
      },
      {
        question: q,
        history,
        env: {
          KEY_VOICE: "on",
          KEY_BORROWED_SENSES: "active",
          VERCEL_ENV: "preview",
          ANTHROPIC_API_KEY: "test-key",
        },
        fetchImpl: makeAnthropicFetch({
          borrowed: goodBorrowedInput({
            customer_intent: "분당 식당 선택 — 수술 후 배려 조건",
            understanding_hypotheses: ["직전 맛집 요청을 배려 조건으로 구체화"],
            voice_raw_candidate: voice,
            proposal_direction: "이동·좌석·음식 제한으로 후보 좁히기",
            next_decision_point: ["이동 편한 곳", "담백한 메뉴"],
            recommendation_basis: "직전 맛집 요청 유지",
            insurance_expertise_angle: [],
            used_facts: [],
            key_purpose: "일상 추천 연속",
            leadership_move: "배려 조건 확인",
            answer_purpose: "식당 선택 조건",
          }),
          s6Text: "S6_PR_J_NO",
          log,
        }),
      },
    );
    assert.equal(result.key_voice_trace.used_constrained_regen, false);
    assert.ok(!/여행\s*가시는군요/.test(result.text));
    assert.ok(!/보험료|보험금|담보/.test(result.text));
    assert.match(result.text, /이동|주차|엘리베이터|좌석|맵거나|조용/);
  }

  // K. same-session T3 — insurance switch, research 0
  {
    const q = "수술비도 많이 들었고 보험금 받을 수 있을지 걱정이야";
    const history = [
      { role: "user", text: "분당 맛집 추천해줘" },
      { role: "assistant", text: "서현 한정식 A부터 볼 수 있어요." },
      { role: "user", text: "부모님 모시고 가는데 아버지가 최근 수술하셨어" },
      { role: "assistant", text: "이동·좌석 편의부터 맞춰볼까요?" },
    ];
    assert.equal(shouldEnablePublicWebSearch({ question: q, history }), false);
    const log = [];
    const voice =
      "수술비 걱정이 크시겠어요. 보험금을 받을 수 있는지는 확인 전에는 단정할 수 없어요. 어떤 수술이셨는지, 가입하신 계약이 있는지만 알려주시면 어디부터 보면 될지 같이 확인할게요.";
    const result = await buildKeyVoiceComposeResult(
      {
        reflection: buildReflection({ customerSaid: q, reality: softReality }),
        reality: softReality,
        policies: softReality.policies,
      },
      {
        question: q,
        history,
        env: {
          KEY_VOICE: "on",
          KEY_BORROWED_SENSES: "active",
          VERCEL_ENV: "preview",
          ANTHROPIC_API_KEY: "test-key",
        },
        fetchImpl: makeAnthropicFetch({
          borrowed: goodBorrowedInput({
            customer_intent: "수술비·보험금 걱정",
            understanding_hypotheses: ["지급 단정 금지"],
            voice_raw_candidate: voice,
            proposal_direction: "수술명·계약 확인",
            next_decision_point: ["수술명부터", "계약 확인부터"],
            recommendation_basis: "확인 전 지급 단정 금지",
            insurance_expertise_angle: [],
            used_facts: [],
            key_purpose: "청구 준비",
            leadership_move: "확인 경로",
            answer_purpose: "청구 준비",
          }),
          s6Text:
            "수술비 걱정이 크시겠어요. 확인 전에는 지급 여부를 단정할 수 없어요. 수술명이나 가입 계약부터 알려주시면 같이 확인할게요.",
          log,
        }),
      },
    );
    assert.equal(log.filter((x) => x === "research").length, 0);
    assert.equal(result.key_voice_trace.used_constrained_regen, false);
    assert.ok(!/받을 수 있습니다|지급됩니다/.test(result.text));
    assert.match(result.text, /수술|계약|확인/);
    assert.equal(observeSameSessionContentNotes("T3", result.text).no_payout_certainty, true);
  }

  // L. grounding / coverage / wait / KEY Master anchors
  {
    const placeEv = {
      status: "success",
      research_unavailable: false,
      search_count: 1,
      results: [{ title: "서현 한정식 A", url: "https://example.com/a", cited_text: "서현 한정식 A" }],
      citations: [{ title: "서현 한정식 A", cited_text: "서현 한정식 A" }],
      grounded_place_candidates: ["서현 한정식 A"],
    };
    assert.equal(placeNameGroundedInEvidence("서현 한정식 A", placeEv), true);
    assert.equal(
      voiceHasUnverifiedCustomerCoverageClaim("가입하신 보험에 수술비 담보가 있습니다."),
      true,
    );
    assert.equal(isWaitOnlyVoice(KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT), true);
    assert.equal(ANTHROPIC_WEB_SEARCH_TOOL.max_uses, 3);
    assert.equal(needsFreshPublicFacts({ question: "제주에서 부모님 모시기 좋은 관광지 찾아줘" }), true);
    assert.equal(needsFreshPublicFacts({ question: "이번 주말 서울에서 갈 만한 곳 검색해줘" }), true);
  }
}

// J. Provider smoke — only with explicit --provider-smoke AND key; default unit never calls network.
{
  const wantSmoke = process.argv.includes("--provider-smoke");
  const key = String(process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY ?? "").trim();
  if (!wantSmoke) {
    console.log("PROVIDER_SMOKE skipped=no_flag unit_mock_only=true provider_request=0");
  } else if (!key) {
    console.log("PROVIDER_SMOKE skipped=no_key");
  } else {
    const { ANTHROPIC_WEB_SEARCH_TOOL } = await import("../server/keyCore/keyBorrowedSensesSpeak.js");
    const model = String(process.env.ANTHROPIC_MODEL ?? process.env.CLAUDE_MODEL ?? "claude-sonnet-4-6").trim();
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 512,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: "Search once for 'Seoul public library hours' and reply with one short sentence.",
          },
        ],
        tools: [ANTHROPIC_WEB_SEARCH_TOOL],
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      const unsupported = /web search|not.*enabled|invalid_request|tool/i.test(errText);
      console.log(
        JSON.stringify({
          PROVIDER_SMOKE: unsupported ? "UNSUPPORTED" : "HTTP_FAIL",
          status: res.status,
          tool_used: false,
          source_count: 0,
          stop_reason: null,
        }),
      );
      if (unsupported) {
        throw new Error("PROVIDER_SMOKE web_search unsupported — do not PASS implement");
      }
      throw new Error(`PROVIDER_SMOKE http ${res.status}`);
    }
    const data = await res.json();
    const toolUsed = (data.content ?? []).some(
      (b) => b?.type === "server_tool_use" && b?.name === "web_search",
    );
    const sourceCount = (data.content ?? []).reduce((n, b) => {
      if (b?.type !== "web_search_tool_result" || !Array.isArray(b.content)) return n;
      return n + b.content.filter((x) => x?.type === "web_search_result").length;
    }, 0);
    console.log(
      JSON.stringify({
        PROVIDER_SMOKE: "ok",
        tool_used: toolUsed,
        source_count: sourceCount,
        stop_reason: data.stop_reason ?? null,
        web_search_requests: data.usage?.server_tool_use?.web_search_requests ?? 0,
      }),
    );
    if (!toolUsed && sourceCount === 0) {
      throw new Error("PROVIDER_SMOKE no web_search tool use — HOLD implement PASS");
    }
  }
}

console.log("KEY_VOICE_UNIT_TEST ok=true");

// --- STEIN CLEANUP COMMIT A HOLD CORRECTIVE (A–L) ---
{
  const {
    buildVerifiedCustomerChart,
    buildUserPayload,
    buildEarlyBorrowedFactBoundary,
  } = await import("../server/keyCore/keyBorrowedSensesSpeak.js");
  const {
    createGhostLedger,
    peekGhostPathsReached,
    buildKeyVoiceSafeUtterance,
  } = await import("../server/keyCore/keyVoiceSpeak.js");
  const { composeSpeakFromDecision } = await import(
    "../server/keyBrain/keySpeakFromDecision.js"
  );
  const { KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT } = await import(
    "../server/keyCore/keyCustomerMonopoly.js"
  );
  const { keySpeak, keySpeakAsync } = await import("../server/keyBrain/keySpeak.js");
  const { ONE_KEY_CORE_RESPONSE_SOURCE } = await import(
    "../server/keyCore/oneKeyCoreFlags.js"
  );
  const { CLOSED_HARD_REASONS } = await import("../server/keyCore/keyVoiceCompose.js");

  const chart22Policies = Array.from({ length: 22 }, (_, i) => ({
    insurer_name: i === 0 ? "삼성생명" : `보험사${i + 1}`,
    product_name: i === 0 ? "실손의료비보험" : `상품${i + 1}`,
    monthly_premium: i === 0 ? 45000 : 10000 + i * 1000,
    coverages: i % 3 === 0 ? ["실손"] : i % 3 === 1 ? ["암진단"] : null,
  }));
  const chart22Reality = {
    policies_present: true,
    policy_count: 22,
    domain: "insurance",
    policies: chart22Policies,
    factory_aggregates: { listed_count: 22, premium_sum_status: "unknown" },
  };
  const longHistory = [
    { role: "user", text: "전체 보험 구조를 보고 싶어요" },
    { role: "assistant", text: "등록 계약부터 같이 볼게요." },
    { role: "user", text: "보험료가 부담돼요" },
    { role: "assistant", text: "납입부터 나눠볼게요." },
    { role: "user", text: "암 보장도 궁금해요" },
    { role: "assistant", text: "암 진단비·수술비부터 확인할게요." },
    { role: "user", text: "분당 맛집 추천해줘" },
    { role: "assistant", text: "분당이면 서현 한정식 A부터 볼 수 있어요." },
  ];

  // A. request-scoped ghost parallel isolation
  {
    const ledgerA = createGhostLedger();
    const ledgerB = createGhostLedger();
    buildKeyVoiceSafeUtterance(greetingDirective, ledgerA);
    composeSpeakFromDecision({
      decision: mockDecision,
      policies: softReality.policies,
      ghostLedger: ledgerA,
    });
    const q = "분당 맛집 추천해줘";
    const t1 =
      "분당이면 서현 한정식 A, 정자 일식 B를 먼저 볼 수 있어요. 어떤 분위기부터 맞출까요?";
    const resultB = await buildKeyVoiceComposeResult(
      {
        reflection: buildReflection({ customerSaid: q, reality: softReality }),
        reality: softReality,
        policies: softReality.policies,
      },
      {
        question: q,
        ghostLedger: ledgerB,
        env: {
          KEY_VOICE: "on",
          KEY_BORROWED_SENSES: "active",
          VERCEL_ENV: "preview",
          ANTHROPIC_API_KEY: "test-key",
        },
        fetchImpl: makeAnthropicFetch({
          borrowed: goodBorrowedInput({
            customer_intent: "분당 맛집",
            voice_raw_candidate: t1,
            used_facts: [],
            insurance_expertise_angle: [],
          }),
          s6Text: t1,
          log: [],
        }),
      },
    );
    assert.ok(peekGhostPathsReached(ledgerA).length >= 1);
    assert.equal(peekGhostPathsReached(ledgerB).length, 0);
    assert.equal(resultB.key_voice_trace.ghost_path_reached?.length ?? 0, 0);
    assert.ok(!peekGhostPathsReached(ledgerB).some((g) =>
      peekGhostPathsReached(ledgerA).some((a) => a === g),
    ));
    // Reset A must not wipe B
    ledgerA.length = 0;
    assert.equal(peekGhostPathsReached(ledgerB).length, 0);
    assert.equal(peekGhostPathsReached(ledgerA).length, 0);
  }

  // B/C. voice-off + sync normal → legacy 0
  {
    const q = "내 실손 월 보험료 얼마야?";
    const reflection = buildReflection({ customerSaid: q, reality: softReality });
    const thinkingFlow = {
      reflection,
      reality: softReality,
      policies: softReality.policies,
      decision: buildDecision({ reflection, reality: softReality, question: q }),
      slice5_enabled: true,
    };
    const off = await keySpeakAsync({
      event: "question",
      question: q,
      thinkingFlow,
      env: { KEY_VOICE: "off", KEY_BORROWED_SENSES: "active", VERCEL_ENV: "preview", ANTHROPIC_API_KEY: "test-key" },
      fetchImpl: makeAnthropicFetch({
        borrowed: goodBorrowedInput({
          voice_raw_candidate:
            "실손 월 납입은 확인된 대표 계약 기준으로 4만5천 원이에요. 전체 합계는 아직 정리 중이에요.",
          used_facts: ["policy_count", "monthly_premium"],
        }),
        s6Text:
          "실손 월 납입은 확인된 대표 계약 기준으로 4만5천 원이에요. 전체 합계는 아직 정리 중이에요.",
        log: [],
      }),
    });
    assert.ok(!/말씀하신 요청부터 이어갈게요/.test(off.speakDraft));
    assert.equal(off.key_compose_trace?.ghost_path_reached?.length ?? 0, 0);
    assert.equal(off.key_compose_trace?.legacy_speak_blocked, true);

    const sync = keySpeak({
      event: "question",
      question: q,
      thinkingFlow,
      env: { KEY_VOICE: "on", VERCEL_ENV: "preview" },
    });
    assert.equal(sync.speakDraft, "");
    assert.equal(sync.failureMode, true);
    assert.ok(!/분석이 마무리|지난번 같이 보던|다시 연결됐습니다/.test(sync.speakDraft));
  }

  // D. non-question events — no EVENT_DRAFT customerText
  for (const event of ["bridge", "analysis_complete", "return_judgment"]) {
    const r = await keySpeakAsync({
      event,
      env: { KEY_VOICE: "on", VERCEL_ENV: "preview", ANTHROPIC_API_KEY: "test-key" },
    });
    assert.equal(r.speakDraft, "");
    assert.equal(r.failureMode, true);
    assert.ok(!/분석이 마무리|지난번 같이 보던|다시 연결됐습니다/.test(r.speakDraft));
    assert.equal(r.key_compose_trace?.event_draft_blocked, true);
  }

  // E. promotion success/fail — finalText not replaced
  {
    const q = "보험료를 줄이고 싶어";
    const reflection = buildReflection({ customerSaid: q, reality: softReality });
    const claude =
      "보험료를 줄이고 싶으신 거죠. 절감 목적이면 확인된 22건 중 중복·납입부터 보는 게 맞아 보여요. 납입 구조부터 볼까요?";
    const result = await buildKeyVoiceComposeResult(
      { reflection, reality: softReality, policies: softReality.policies },
      {
        question: q,
        env: {
          KEY_VOICE: "on",
          KEY_BORROWED_SENSES: "active",
          VERCEL_ENV: "preview",
          ANTHROPIC_API_KEY: "test-key",
        },
        fetchImpl: makeAnthropicFetch({
          borrowed: goodBorrowedInput({
            voice_raw_candidate: claude,
            used_facts: ["policy_count", "monthly_premium"],
          }),
          s6Text: "S6_SHOULD_STAY_OR_MATCH_CLAUDE",
          log: [],
        }),
      },
    );
    assert.equal(result.key_voice_trace.borrowed_senses_shadow?.customer_text_changed, false);
    assert.equal(result.key_voice_trace.rewrite_detected, false);
    assert.ok(result.key_voice_trace.promotion_diagnostic?.customer_text_replaced === false ||
      result.key_voice_trace.fast_path?.ok === true);
    assert.ok(!/S6_SHOULD_STAY/.test(result.text) || result.text === claude || /줄이|중복|납입/.test(result.text));
  }

  // F/G. closed hard list — expression/unknown not hard
  {
    assert.ok(CLOSED_HARD_REASONS.has("answer_forbidden_certainty"));
    assert.ok(CLOSED_HARD_REASONS.has("jailbreak_fact"));
    assert.ok(!CLOSED_HARD_REASONS.has("incomplete_korean"));
    assert.ok(!CLOSED_HARD_REASONS.has("focus_drift"));
    assert.ok(!CLOSED_HARD_REASONS.has("recommendation_or_termination"));
    assert.ok(!CLOSED_HARD_REASONS.has("required_claims"));
    const q = "분당 맛집 추천해줘";
    const softVoice =
      "분당이면 서현 한정식 A를 먼저 볼 수 있어요. 담백한 한식이라 고르기 좋아요. 어떤 분위기부터 맞출까요?";
    const result = await buildKeyVoiceComposeResult(
      {
        reflection: buildReflection({ customerSaid: q, reality: softReality }),
        reality: softReality,
        policies: softReality.policies,
      },
      {
        question: q,
        env: {
          KEY_VOICE: "on",
          KEY_BORROWED_SENSES: "active",
          VERCEL_ENV: "preview",
          ANTHROPIC_API_KEY: "test-key",
        },
        fetchImpl: makeAnthropicFetch({
          borrowed: goodBorrowedInput({
            voice_raw_candidate: softVoice,
            used_facts: [],
            insurance_expertise_angle: [],
          }),
          s6Text: softVoice,
          log: [],
        }),
      },
    );
    assert.equal(result.text, softVoice);
    assert.equal(result.key_voice_trace.used_failure_mode, false);
  }

  // H. provider body chart 22 + full history + decision/goal/evidence
  {
    const q = "내 보험 전체와 분당 맛집도 같이 볼까";
    const bodies = [];
    const voice =
      "분당이면 서현 한정식 A부터 볼 수 있어요. 계약은 확인된 범위만 이어서 볼게요.";
    await buildKeyVoiceComposeResult(
      {
        reflection: buildReflection({ customerSaid: q, reality: chart22Reality }),
        reality: chart22Reality,
        policies: chart22Reality.policies,
      },
      {
        question: q,
        history: longHistory,
        env: {
          KEY_VOICE: "on",
          KEY_BORROWED_SENSES: "active",
          VERCEL_ENV: "preview",
          ANTHROPIC_API_KEY: "test-key",
        },
        fetchImpl: makeAnthropicFetch({
          borrowed: goodBorrowedInput({
            voice_raw_candidate: voice,
            used_facts: ["policy_count"],
          }),
          s6Text: voice,
          log: [],
          bodies,
        }),
      },
    );
    const emitBodies = bodies.filter((b) =>
      (b?.tools ?? []).some(
        (t) => t?.name === "emit_borrowed_senses" || t?.name === "emit_claude_full",
      ),
    );
    assert.ok(emitBodies.length >= 1);
    const emitUser = JSON.parse(emitBodies[0].messages[0].content);
    assert.equal(emitUser.verified_customer_chart?.contracts?.length, 22);
    for (let i = 0; i < 22; i += 1) {
      assert.equal(
        emitUser.verified_customer_chart.contracts[i].verified_fields.insurer_name,
        chart22Policies[i].insurer_name,
      );
    }
    // Claude-Full talent-open: avoid duplicate full-history attach; recent originals carry the thread.
    if (emitUser.answer_mode === "claude_full") {
      assert.equal(emitUser.conversation_history, null);
      assert.ok(Array.isArray(emitUser.recent_conversation_originals));
      assert.ok(emitUser.recent_conversation_originals.length >= 1);
    } else {
      assert.equal(emitUser.conversation_history?.length, longHistory.length);
      assert.match(emitUser.conversation_history[0].text, /전체 보험 구조/);
    }
    // Claude-Full v1.1: KEY Decision / Session Goal are not pre-drafted into Claude input.
    assert.equal(emitUser.answer_mode, "claude_full");
    assert.equal(emitUser.decision, null);
    assert.equal(emitUser.session_goal, null);
    assert.equal(emitUser.provider_input_policy?.claude_full_no_key_answer_draft, true);
    assert.ok(Array.isArray(emitUser.recent_conversation_originals));
    assert.ok(emitUser.public_research_evidence || emitUser.key_public_research_evidence || emitUser.verified_customer_chart);
    assert.ok(Array.isArray(emitUser.allowed_numbers));
    assert.ok(Array.isArray(emitUser.allowed_entities));
    const blob = JSON.stringify(emitUser);
    assert.ok(!/api[_-]?key|password|secret|Bearer |supabase/i.test(blob));
  }

  // I. focused Claude correction max 1 + same context (no inventory / no S6)
  {
    const q = "부모님이 수술하시면 보험금 나와요?";
    const repaired =
      "확인 전에는 지급을 단정할 수 없어요. 관련 계약의 수술비·실손 담보부터 같이 확인해볼게요.";
    let borrowedN = 0;
    const result = await buildKeyVoiceComposeResult(
      {
        reflection: buildReflection({ customerSaid: q, reality: chart22Reality }),
        reality: chart22Reality,
        policies: chart22Reality.policies,
      },
      {
        question: q,
        history: longHistory,
        env: {
          KEY_VOICE: "on",
          KEY_BORROWED_SENSES: "active",
          VERCEL_ENV: "preview",
          ANTHROPIC_API_KEY: "test-key",
        },
        fetchImpl: makeAnthropicFetch({
          borrowed: () => {
            borrowedN += 1;
            return goodBorrowedInput({
              voice_raw_candidate:
                borrowedN === 1
                  ? "네, 수술비 담보가 있으니 보험금이 지급됩니다."
                  : repaired,
              used_facts: ["policy_count"],
            });
          },
          s6Text: "S6_SHOULD_NOT_RUN_I",
          log: [],
        }),
      },
    );
    assert.equal(result.key_voice_trace.s6_speak_calls, 0);
    assert.ok(result.key_voice_trace.hard_safety_repair_attempt <= 1);
    assert.equal(result.key_voice_trace.focused_correction_count, 1);
    assert.ok(!/보험사2|상품21/.test(result.text));
    assert.ok(!/지급됩니다|전부 받을/.test(result.text));
    assert.equal(result.key_voice_trace.ghost_path_reached?.length ?? 0, 0);
  }

  // F–H mock T1/T2/T3 (mock answers — structure checks, not live Claude)
  const t1Text =
    "분당이면 서현 한정식 A, 정자 일식 B, 미금 캐주얼 C를 먼저 볼 수 있어요. 담백한 한식·일식·캐주얼이라 고르기 좋아요. 어떤 분위기부터 맞출까요?";
  const t2Text =
    "직전에 보던 분당 맛집이면, 부모님 모시고 수술 후 이동이 편한 서현 한정식 A 쪽을 먼저 볼게요. 좌석이 넓은 곳 위주로 맞출까요?";
  const t3Text =
    "보험금 쪽이면 확인 전엔 지급을 단정하지 않을게요. 수술·실손과 맞닿은 계약만 먼저 확인할게요. 진단서·영수증이 있으면 이어서 볼게요.";

  {
    const q = "분당 맛집 추천해줘";
    const result = await buildKeyVoiceComposeResult(
      {
        reflection: buildReflection({ customerSaid: q, reality: softReality }),
        reality: softReality,
        policies: softReality.policies,
      },
      {
        question: q,
        env: {
          KEY_VOICE: "on",
          KEY_BORROWED_SENSES: "active",
          VERCEL_ENV: "preview",
          ANTHROPIC_API_KEY: "test-key",
        },
        fetchImpl: makeAnthropicFetch({
          borrowed: goodBorrowedInput({
            voice_raw_candidate: t1Text,
            used_facts: [],
            insurance_expertise_angle: [],
          }),
          s6Text: t1Text,
          log: [],
        }),
      },
    );
    assert.match(result.text, /서현 한정식 A/);
    assert.equal(result.key_voice_trace.ghost_path_reached?.length ?? 0, 0);
    console.log("STEIN_A_T1_MOCK", result.text);
  }
  {
    const q = "부모님 모시고 가기 쉬운 곳으로, 수술 후라서";
    const hist = [
      { role: "user", text: "분당 맛집 추천해줘" },
      { role: "assistant", text: t1Text },
    ];
    const result = await buildKeyVoiceComposeResult(
      {
        reflection: buildReflection({ customerSaid: q, reality: softReality }),
        reality: softReality,
        policies: softReality.policies,
      },
      {
        question: q,
        history: hist,
        env: {
          KEY_VOICE: "on",
          KEY_BORROWED_SENSES: "active",
          VERCEL_ENV: "preview",
          ANTHROPIC_API_KEY: "test-key",
        },
        fetchImpl: makeAnthropicFetch({
          borrowed: goodBorrowedInput({
            voice_raw_candidate: t2Text,
            used_facts: [],
            insurance_expertise_angle: [],
          }),
          s6Text: t2Text,
          log: [],
        }),
      },
    );
    assert.match(result.text, /서현 한정식 A|부모님|수술/);
    assert.equal(result.key_voice_trace.directive?.conversation_history?.length, hist.length);
    assert.equal(result.key_voice_trace.ghost_path_reached?.length ?? 0, 0);
    console.log("STEIN_A_T2_MOCK", result.text);
  }
  {
    const q = "그런데 부모님이 수술하시면 보험금은 나와요?";
    const result = await buildKeyVoiceComposeResult(
      {
        reflection: buildReflection({ customerSaid: q, reality: chart22Reality }),
        reality: chart22Reality,
        policies: chart22Reality.policies,
      },
      {
        question: q,
        history: longHistory,
        env: {
          KEY_VOICE: "on",
          KEY_BORROWED_SENSES: "active",
          VERCEL_ENV: "preview",
          ANTHROPIC_API_KEY: "test-key",
        },
        fetchImpl: makeAnthropicFetch({
          borrowed: goodBorrowedInput({
            voice_raw_candidate: t3Text,
            used_facts: ["policy_count"],
          }),
          s6Text: t3Text,
          log: [],
        }),
      },
    );
    assert.ok(!/보험사2|상품21|22건 전부/.test(result.text));
    assert.ok(!/지급됩니다|무조건 나와요/.test(result.text));
    assert.equal(result.key_voice_trace.ghost_path_reached?.length ?? 0, 0);
    console.log("STEIN_A_T3_MOCK", result.text);
  }

  // K. KEY Master integrity via speak path
  {
    const q = "분당 맛집 추천해줘";
    const reflection = buildReflection({ customerSaid: q, reality: softReality });
    const thinkingFlow = {
      reflection,
      reality: softReality,
      policies: softReality.policies,
      decision: buildDecision({ reflection, reality: softReality, question: q }),
      slice5_enabled: true,
    };
    const speak = await keySpeakAsync({
      event: "question",
      question: q,
      thinkingFlow,
      env: {
        KEY_VOICE: "on",
        KEY_BORROWED_SENSES: "active",
        VERCEL_ENV: "preview",
        ANTHROPIC_API_KEY: "test-key",
      },
      fetchImpl: makeAnthropicFetch({
        borrowed: goodBorrowedInput({
          voice_raw_candidate: t1Text,
          used_facts: [],
          insurance_expertise_angle: [],
        }),
        s6Text: t1Text,
        log: [],
      }),
    });
    assert.equal(speak.key_speak_master, true);
    assert.equal(speak.key_compose_trace?.rewrite_detected, false);
    assert.equal(speak.key_compose_trace?.ghost_path_reached?.length ?? 0, 0);
    assert.ok(String(speak.speakDraft ?? "").trim().length > 0);
    assert.equal(ONE_KEY_CORE_RESPONSE_SOURCE.QUESTION, "one_key_core_s1");
  }

  // Intentional ghost on request ledger only
  {
    const ledger = createGhostLedger();
    buildKeyVoiceSafeUtterance(greetingDirective, ledger);
    composeSpeakFromDecision({
      decision: mockDecision,
      policies: softReality.policies,
      ghostLedger: ledger,
    });
    const ghosts = peekGhostPathsReached(ledger);
    assert.ok(ghosts.some((g) => g.path === "buildKeyVoiceSafeUtterance"));
    assert.ok(ghosts.some((g) => g.path === "composeSpeakFromDecision"));
    assert.equal(peekGhostPathsReached(createGhostLedger()).length, 0);
  }

  console.log("STEIN_CLEANUP_COMMIT_A_CORRECTIVE ok=true");
}
