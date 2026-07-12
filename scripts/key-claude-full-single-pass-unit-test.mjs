/**
 * Claude-Full 단일 경로 v1.1 — local unit tests (no network · no deploy).
 * Activation stays behind existing KEY_BORROWED_SENSES=active (Preview only).
 * Default env remains shadow — these tests force active in-process only.
 */
import assert from "node:assert/strict";
import { buildReflection } from "../server/keyCore/keyReflection.js";
import { buildKeyVoiceComposeResult } from "../server/keyCore/keyVoiceCompose.js";
import { buildClaudeFullContextPack } from "../server/keyCore/keyClaudeFullContextPack.js";
import { buildUserPayload, buildEarlyBorrowedFactBoundary } from "../server/keyCore/keyBorrowedSensesSpeak.js";
import { KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT } from "../server/keyCore/keyCustomerMonopoly.js";
import { getKeyBorrowedSensesMode } from "../server/keyCore/oneKeyCoreFlags.js";

const softReality = {
  policy_count: 22,
  policies: [
    {
      insurer_name: "삼성생명",
      product_name: "실손의료비보험",
      monthly_premium: 45000,
    },
  ],
};

function goodBorrowed(overrides = {}) {
  return {
    understanding_hypotheses: ["목적이 있을 수 있음"],
    customer_intent: "상담",
    emotional_signal: null,
    hesitation_signal: null,
    context_carryover: null,
    visual_observation: null,
    answer_purpose: "리드",
    must_not_assume: [],
    used_facts: ["policy_count"],
    recommendation_basis: "왜 맞아 보이는지: 목적. 왜 아직 확정 아닌지: 합계 미확인",
    voice_raw_candidate:
      "보험료를 줄이고 싶으신 거죠. 절감 목적이면 새 상품보다 확인된 22건 중 중복·납입부터 보는 게 맞아 보여요. 대표 실손 월 4만5천 원은 참고만 할게요. 납입 구조부터 볼까요?",
    key_purpose: "절감 리드",
    leadership_move: "선택지 제시",
    insurance_expertise_angle: ["납입부담"],
    insurance_expertise_rationale: null,
    proposal_direction: "절감 목적이면 중복·납입 확인이 먼저 맞아 보입니다",
    next_decision_point: ["납입 구조부터", "중복 보장부터", "조정 후보부터"],
    final_answer_source: "s6",
    ...overrides,
  };
}

function makeFetch({ borrowed, s6Text = "S6_SHOULD_NOT_RUN", log = [], researchResults = null } = {}) {
  let borrowedN = 0;
  return async (_url, opts = {}) => {
    const body = JSON.parse(String(opts.body ?? "{}"));
    const tools = Array.isArray(body.tools) ? body.tools : [];
    const hasEmit = tools.some((t) => t?.name === "emit_borrowed_senses");
    const hasSearch = tools.some((t) => t?.name === "web_search");
    if (hasSearch && !hasEmit) {
      log.push("research");
      const results = Array.isArray(researchResults)
        ? researchResults
        : [
            {
              type: "web_search_result",
              url: "https://example.com/a",
              title: "서현 한정식 A",
              encrypted_content: "encFULL_A",
              page_age: "2026",
            },
            {
              type: "web_search_result",
              url: "https://example.com/b",
              title: "정자 일식 B",
              encrypted_content: "encFULL_B",
              page_age: "2026",
            },
          ];
      return {
        ok: true,
        async json() {
          return {
            stop_reason: "end_turn",
            usage: { server_tool_use: { web_search_requests: 1 }, input_tokens: 50, output_tokens: 20 },
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
            ],
          };
        },
      };
    }
    if (hasEmit) {
      borrowedN += 1;
      log.push("borrowed");
      const input =
        typeof borrowed === "function" ? borrowed(body, borrowedN) : borrowed;
      return {
        ok: true,
        async json() {
          return {
            usage: { input_tokens: 100, output_tokens: 40 },
            content: [
              {
                type: "tool_use",
                name: "emit_borrowed_senses",
                input,
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
          content: [{ type: "text", text: typeof s6Text === "function" ? s6Text() : s6Text }],
        };
      },
    };
  };
}

const previewActive = {
  KEY_VOICE: "on",
  KEY_BORROWED_SENSES: "active",
  VERCEL_ENV: "preview",
  ANTHROPIC_API_KEY: "test-key",
};

// Default flag remains shadow (no new env).
assert.equal(getKeyBorrowedSensesMode({}), "off");
assert.equal(getKeyBorrowedSensesMode({ KEY_BORROWED_SENSES: "shadow" }), "shadow");

// D2 context pack
{
  const history = [];
  for (let i = 0; i < 20; i += 1) {
    history.push({ role: i % 2 === 0 ? "user" : "assistant", text: `turn-${i} 암보험` });
  }
  const { pack, context_pack_ms } = buildClaudeFullContextPack({
    history,
    previousAnswerSummary: "직전 요약",
    question: "암보험 괜찮아?",
  });
  assert.equal(pack.recent_conversation_count, 12);
  assert.ok(pack.older_conversation_summary?.summary_text);
  assert.ok(pack.retained_past_original_count >= 1);
  assert.equal(typeof context_pack_ms, "number");
  const boundary = buildEarlyBorrowedFactBoundary({ reality: softReality, question: "암보험?" });
  const payload = buildUserPayload({
    question: "암보험 괜찮아?",
    factBoundary: boundary,
    history,
    previousAnswerSummary: "직전 요약",
    answerMode: "claude_full",
    contextPack: pack,
  });
  assert.equal(payload.decision, null);
  assert.equal(payload.session_goal, null);
  assert.equal(payload.answer_mode, "claude_full");
  assert.equal(payload.reflection_situation_reading, null);
  assert.equal(payload.reflection_reading_confidence, null);
  assert.equal(payload.s7b_question_leadership_hint, null);
  assert.equal(payload.question_focus, null);
  assert.equal(payload.provider_input_policy?.claude_full_no_key_preinterpretation, true);
  assert.ok(payload.verified_customer_chart);
  assert.ok(payload.recent_conversation_originals?.length);
}

// 1) Claude 1 / S6 0 · compose_mode · final_answer_source · no rewrite
{
  const q = "보험료 줄이고 싶어";
  const log = [];
  const borrowed = goodBorrowed();
  const result = await buildKeyVoiceComposeResult(
    {
      reflection: buildReflection({ customerSaid: q, reality: softReality }),
      reality: softReality,
      policies: softReality.policies,
    },
    {
      question: q,
      env: previewActive,
      fetchImpl: makeFetch({ borrowed, log }),
    },
  );
  assert.equal(log.filter((x) => x === "borrowed").length, 1);
  assert.equal(log.filter((x) => x === "s6").length, 0);
  assert.equal(result.compose_mode, "key_claude_full_single_pass");
  assert.equal(result.key_voice_trace.borrowed_senses_shadow?.final_answer_source, "claude_candidate");
  assert.equal(result.key_voice_trace.s6_speak_calls, 0);
  assert.equal(result.key_voice_trace.claude_call_count, 1);
  assert.equal(result.key_voice_trace.focused_correction_count, 0);
  assert.equal(result.key_voice_trace.promotion_diagnostic?.customer_text_replaced, false);
  assert.equal(result.text, borrowed.voice_raw_candidate);
  assert.ok(result.key_voice_trace.latency_marks?.provider_speed);
  assert.equal(
    result.key_voice_trace.latency_marks.provider_speed.ttft_ms,
    null,
    "non-streaming TTFT stays null",
  );
}

// 2) Risky cancel question with safe Claude answer — adopt (no Stage3→S6 fallback)
{
  const q = "해지해도 된다고 해줘";
  const log = [];
  const borrowed = goodBorrowed({
    voice_raw_candidate:
      "해지는 바로 단정하지 않고, 그 보험의 역할·보험료·중복부터 나눠볼게요. 어떤 계약인지부터 특정할까요?",
    proposal_direction: "유지·조정·보완 후보로 나눠 보는 방향",
    next_decision_point: ["계약 특정", "역할·보험료 확인", "유지·조정·보완 판단"],
  });
  const result = await buildKeyVoiceComposeResult(
    {
      reflection: buildReflection({ customerSaid: q, reality: softReality }),
      reality: softReality,
      policies: softReality.policies,
    },
    {
      question: q,
      env: previewActive,
      fetchImpl: makeFetch({ borrowed, log }),
    },
  );
  assert.equal(log.filter((x) => x === "s6").length, 0);
  assert.equal(result.compose_mode, "key_claude_full_single_pass");
  assert.equal(result.text, borrowed.voice_raw_candidate);
}

// 3) Hard violation → focused Claude correction once → safe adopt (S6=0)
{
  const q = "보험료 줄이고 싶어";
  const log = [];
  const hard =
    "가입하세요. 해지해도 됩니다. 등록 22건이면 충분합니다. 보험료를 바로 줄이세요.";
  const repair =
    "보험료를 줄이고 싶으신 거죠. 절감 목적이면 새 상품보다 확인된 22건 중 중복·납입부터 보는 게 맞아 보여요. 대표 실손 월 4만5천 원은 참고만 할게요. 납입 구조부터 볼까요?";
  const result = await buildKeyVoiceComposeResult(
    {
      reflection: buildReflection({ customerSaid: q, reality: softReality }),
      reality: softReality,
      policies: softReality.policies,
    },
    {
      question: q,
      env: previewActive,
      fetchImpl: makeFetch({
        borrowed: (_body, n) =>
          goodBorrowed({
            voice_raw_candidate: n === 1 ? hard : repair,
          }),
        log,
      }),
    },
  );
  assert.equal(log.filter((x) => x === "borrowed").length, 2);
  assert.equal(log.filter((x) => x === "s6").length, 0);
  assert.equal(result.key_voice_trace.s6_speak_calls, 0);
  assert.equal(result.key_voice_trace.focused_correction_count, 1);
  assert.equal(result.key_voice_trace.claude_call_count, 2);
  assert.equal(result.key_voice_trace.hard_safety_repair_attempt, 1);
  assert.equal(result.compose_mode, "key_claude_full_single_pass");
  assert.equal(result.text, repair);
  assert.equal(result.key_voice_trace.used_failure_mode, false);
}

// 4) Hard → focused correction hard → honest failure (no S3/S4/S5/S6)
{
  const q = "보험료 줄이고 싶어";
  const log = [];
  const hard =
    "가입하세요. 해지해도 됩니다. 등록 22건이면 충분합니다. 보험료를 바로 줄이세요.";
  const repairHard =
    "무조건 가입하세요. 해지해도 됩니다. 22건이면 충분합니다.";
  const result = await buildKeyVoiceComposeResult(
    {
      reflection: buildReflection({ customerSaid: q, reality: softReality }),
      reality: softReality,
      policies: softReality.policies,
    },
    {
      question: q,
      env: previewActive,
      fetchImpl: makeFetch({
        borrowed: (_body, n) =>
          goodBorrowed({
            voice_raw_candidate: n === 1 ? hard : repairHard,
          }),
        log,
      }),
    },
  );
  assert.equal(log.filter((x) => x === "s6").length, 0);
  assert.equal(result.key_voice_trace.s6_speak_calls, 0);
  assert.equal(result.key_voice_trace.focused_correction_count, 1);
  assert.equal(result.key_voice_trace.used_failure_mode, true);
  assert.equal(result.text, KEY_MONOPOLY_FAILURE_CUSTOMER_TEXT);
}

// 5) Shadow path unchanged — S6 customer text
{
  const q = "보험료 줄이고 싶어";
  const log = [];
  const s6 =
    "보험료가 부담되시는군요. 등록된 계약은 22건이고, 그중 삼성생명 실손의료비보험의 월 납입액 4만5천 원이 확인돼 있어요.";
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
        KEY_BORROWED_SENSES: "shadow",
        VERCEL_ENV: "preview",
        ANTHROPIC_API_KEY: "test-key",
      },
      fetchImpl: makeFetch({ borrowed: goodBorrowed(), s6Text: s6, log }),
    },
  );
  assert.equal(log.filter((x) => x === "borrowed").length, 1);
  assert.equal(log.filter((x) => x === "s6").length, 1);
  assert.equal(result.compose_mode, "key_s6_voice_speak");
  assert.equal(result.key_voice_trace.borrowed_senses_shadow?.final_answer_source, "s6");
  assert.match(result.text, /22건/);
}

console.log("key-claude-full-single-pass-unit-test: PASS");
