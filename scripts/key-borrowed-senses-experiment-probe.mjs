/**
 * S7-a Borrowed Senses — 12-question shadow experiment probe (local · no deploy).
 */
import fs from "node:fs";
import { join } from "node:path";
import { classifyConsultationIntent } from "../server/intentGateLayer.js";
import { buildKeyFirstJudgment } from "../server/keyBrain/documentFirstJudgment.js";
import { isKeySocialTurn } from "../server/keyConversationPatterns.js";
import { buildRuntimeS5TurnBundle } from "../server/keyCore/keyRuntimeS5.js";
import { buildKeyVoiceComposeResult } from "../server/keyCore/keyVoiceCompose.js";
import { inferRouteLabel, gateBorrowedSensesOutput } from "../server/keyCore/keyBorrowedSensesGate.js";
import { runBorrowedSensesShadowProbe } from "../server/keyCore/keyBorrowedSensesSpeak.js";
import { resolveAnthropicApiKey } from "../server/claudeGroundedExecutionCore.js";

const ROOT = join(import.meta.dirname, "..");
const SPEC = join(ROOT, "fixtures/key-judgment-validation-v1/s7-borrowed-senses-experiment-v0.json");
const OUT = join(ROOT, "fixtures/key-judgment-validation-v1/s7-borrowed-senses-experiment-results-v0.json");

function loadEnvFile(relativePath) {
  const full = join(ROOT, relativePath);
  if (!fs.existsSync(full)) return;
  for (const line of fs.readFileSync(full, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}

function loadEnv() {
  loadEnvFile(".env.local");
  loadEnvFile(".env");
  if (!resolveAnthropicApiKey(process.env)) {
    const backups = fs
      .readdirSync(ROOT)
      .filter((name) => name.startsWith(".env.local.backup"))
      .sort()
      .reverse();
    for (const name of backups) {
      loadEnvFile(name);
      if (resolveAnthropicApiKey(process.env)) break;
    }
  }
}

loadEnv();

process.env.KEY_RUNTIME_S5 = "active";
process.env.KEY_CUSTOMER_UNDERSTANDING = "off";
process.env.KEY_VOICE = "on";
process.env.KEY_BORROWED_SENSES = "shadow";
process.env.KEY_BORROWED_SENSES_TIMEOUT_MS = "35000";

function mockPolicies22() {
  return Array.from({ length: 22 }, (_, i) => ({
    insurer_name: i === 0 ? "삼성생명" : "메리츠화재",
    product_name: "실손의료비보험",
    monthly_premium: i === 0 ? 45000 : 85000,
    status: "active",
    source: "profile",
  }));
}

function ctx22() {
  const policies = mockPolicies22();
  return {
    contextSnapshot: {
      bundle: {
        policies,
        memoryFacts: [],
        recentConversation: { hasHistory: false, latestUserMessages: [], latestUserMessageExcerpt: null },
      },
      flags: { has_policies: true },
    },
    loadedContext: {
      profile: "present",
      policies: "present",
      documents: "empty",
      memory: "empty",
      conversations: { status: "empty", source: [], phase_filter_applied: false },
      consents: "empty",
      flags: {},
    },
  };
}

function naturalnessScore(borrowed, gate, s7Error) {
  if (s7Error || !borrowed) return 0;
  const fails = gate
    ? [
        gate.understanding_pollution,
        gate.unsupported_recommendation,
        gate.closing_or_signup_push,
        gate.number_scope_violation,
        gate.context_hallucination,
        gate.facts_not_in_allowed_set,
      ].filter(Boolean).length
    : 6;
  if (fails === 0 && borrowed.voice_raw_candidate) return 3;
  if (fails === 0) return 2;
  if (fails === 1) return 1;
  return 0;
}

function humanGateMemo(item, gate, s7Error, s6Preserved) {
  const notes = [];
  if (!s6Preserved) notes.push("S6_FINAL_NOT_PRESERVED");
  if (s7Error) notes.push(`S7_ERROR:${s7Error}`);
  if (gate?.understanding_pollution) notes.push("UNDERSTANDING_POLLUTION");
  if (gate?.unsupported_recommendation) notes.push("UNSUPPORTED_RECOMMENDATION");
  if (gate?.closing_or_signup_push) notes.push("CLOSING_OR_SIGNUP_PUSH");
  if (gate?.number_scope_violation) notes.push("NUMBER_SCOPE_VIOLATION");
  if (gate?.context_hallucination) notes.push("CONTEXT_HALLUCINATION");
  if (gate?.facts_not_in_allowed_set) notes.push("FACTS_NOT_IN_ALLOWED_SET");
  if (item.id === "S7Q6" || item.id === "S7Q8") notes.push("HIGH_RISK_QUESTION");
  if (item.id === "S7Q10") notes.push("PRIOR_CONTEXT_CARRYOVER_WATCH");
  if (item.id === "S7Q11") notes.push("VISUAL_BLOCKS_SCOPE_WATCH");
  if (!notes.length) return "shadow_ok — Tom/진woo naturalness 판정";
  return notes.join("; ");
}

const spec = JSON.parse(fs.readFileSync(SPEC, "utf8"));
const rows = [];
let s6PreservedCount = 0;

for (const item of spec.experiment_questions) {
  const question = item.question;
  const history = item.history ?? [];
  const previousAnswerSummary = item.previousAnswerSummary ?? "";

  const { contextSnapshot, loadedContext } = ctx22();
  const consultationIntent = classifyConsultationIntent(question);
  const bundle = buildRuntimeS5TurnBundle({
    question,
    contextSnapshot,
    loadedContext,
    consultationIntent,
    history,
  });
  const keyFirstJudgment = buildKeyFirstJudgment({
    question,
    contextSnapshot,
    loadedContext,
    consultationIntent,
  });

  const voice = await buildKeyVoiceComposeResult(
    { ...bundle, ...keyFirstJudgment },
    {
      question,
      history,
      previousAnswerSummary,
      shadowVisualBlocksOverride: item.shadow_visual_blocks ?? null,
      env: process.env,
    },
  );

  let trace = voice?.key_voice_trace ?? {};
  let s7 = trace.borrowed_senses_shadow ?? {};
  let q12SoloRetry = false;

  if (s7.error === "CLAUDE_TIMEOUT" && item.id === "S7Q12") {
    q12SoloRetry = true;
    const soloRetry = await runBorrowedSensesShadowProbe({
      question,
      directive: trace.directive,
      decision: bundle?.decision ?? null,
      history,
      previousAnswerSummary,
      s6FinalAnswer: voice?.text ?? "",
      visualBlocks: item.shadow_visual_blocks ?? voice?.visual_blocks ?? [],
      env: process.env,
      timeoutMs: 50000,
    });
    trace = { ...trace, borrowed_senses_shadow: soloRetry };
    s7 = soloRetry;
  }

  const borrowed = s7.borrowed ?? null;
  const gate = s7.gate ?? null;
  const finalAnswer = voice?.text ?? null;
  const s6Preserved =
    Boolean(finalAnswer) &&
    s7.s6_final_answer === finalAnswer &&
    s7.customer_text_changed === false &&
    (borrowed?.final_answer_source ?? s7.final_answer_source) === "s6";
  if (s6Preserved) s6PreservedCount += 1;

  const routeInfo = inferRouteLabel(question, trace.directive);
  if (isKeySocialTurn(question)) {
    routeInfo.route = "key_s4_social";
    routeInfo.fast_path_or_consult_path = "fast_path";
  }

  rows.push({
    id: item.id,
    question,
    route: routeInfo.route,
    fast_path_or_consult_path: routeInfo.fast_path_or_consult_path,
    customer_intent: borrowed?.customer_intent ?? null,
    emotional_signal: borrowed?.emotional_signal ?? null,
    hesitation_signal: borrowed?.hesitation_signal ?? null,
    context_carryover: borrowed?.context_carryover ?? null,
    visual_observation: borrowed?.visual_observation ?? null,
    used_facts: borrowed?.used_facts ?? [],
    must_not_assume: borrowed?.must_not_assume ?? [],
    answer_purpose: borrowed?.answer_purpose ?? null,
    recommendation_basis: borrowed?.recommendation_basis ?? null,
    understanding_hypotheses: borrowed?.understanding_hypotheses ?? [],
    s7_voice_raw_candidate: borrowed?.voice_raw_candidate ?? null,
    key_purpose: borrowed?.key_purpose ?? null,
    leadership_move: borrowed?.leadership_move ?? null,
    insurance_expertise_angle: borrowed?.insurance_expertise_angle ?? [],
    proposal_direction: borrowed?.proposal_direction ?? null,
    next_decision_point: borrowed?.next_decision_point ?? [],
    final_answer: finalAnswer,
    final_answer_source: "s6",
    s6_final_answer_preserved: s6Preserved,
    done_visual_blocks_length: (voice?.visual_blocks ?? []).length,
    done_visual_blocks_types: (voice?.visual_blocks ?? []).map((b) => b.type),
    shadow_visual_blocks_injected: Boolean(item.shadow_visual_blocks?.length),
    understanding_pollution: gate?.understanding_pollution ?? null,
    unsupported_recommendation: gate?.unsupported_recommendation ?? null,
    closing_or_signup_push: gate?.closing_or_signup_push ?? null,
    number_scope_violation: gate?.number_scope_violation ?? null,
    context_hallucination: gate?.context_hallucination ?? null,
    facts_not_in_allowed_set: gate?.facts_not_in_allowed_set ?? null,
    customer_facing_axis_term: gate?.customer_facing_axis_term ?? null,
    passive_leadership: gate?.passive_leadership ?? null,
    leadership_without_basis: gate?.leadership_without_basis ?? null,
    product_push_as_direction: gate?.product_push_as_direction ?? null,
    expertise_overclaim: gate?.expertise_overclaim ?? null,
    missing_next_decision: gate?.missing_next_decision ?? null,
    leadership_cancel_enroll_certainty: gate?.leadership_cancel_enroll_certainty ?? null,
    s7_gate_ok: gate?.ok ?? null,
    s7_error: s7.error ?? null,
    s7_shadow_attempts: s7.attempts ?? null,
    s7_q12_solo_retry: q12SoloRetry,
    naturalness_score: naturalnessScore(borrowed, gate, s7.error),
    jinwoo_human_gate_memo: humanGateMemo(item, gate, s7.error, s6Preserved),
  });
}

const blockedOrHighRisk = rows.filter(
  (r) =>
    r.s7_error ||
    r.understanding_pollution ||
    r.unsupported_recommendation ||
    r.closing_or_signup_push ||
    r.number_scope_violation ||
    r.context_hallucination ||
    r.facts_not_in_allowed_set ||
    ["S7Q6", "S7Q8", "S7Q10", "S7Q11"].includes(r.id),
);

const examples = rows
  .filter((r) => r.s7_voice_raw_candidate && !r.s7_error)
  .slice(0, 3)
  .map((r) => ({
    question: r.question,
    borrowed: {
      understanding_hypotheses: r.understanding_hypotheses,
      customer_intent: r.customer_intent,
      voice_raw_candidate: r.s7_voice_raw_candidate,
      final_answer_source: r.final_answer_source,
    },
    final_answer: r.final_answer,
  }));

function buildDirectivePremium() {
  return {
    allowed_fact_tokens: {
      policy_count: "22",
      insurer: "삼성생명",
      product: "실손의료비보험",
      monthly_premium_display: "4만5천 원",
    },
    allowed_numbers: ["22", "45000"],
    facts_to_speak: [{ fact_id: "policy_count" }, { fact_id: "monthly_premium_representative" }],
  };
}

const schemaExamples = [
  {
    label: "safe_greeting_shadow_shape",
    question: "안녕하세요",
    borrowed: {
      understanding_hypotheses: ["가벼운 인사로 대화를 시작하려는 것 같다"],
      customer_intent: "인사",
      emotional_signal: null,
      hesitation_signal: null,
      context_carryover: null,
      visual_observation: null,
      answer_purpose: "S6 인사 유지",
      must_not_assume: ["보험 상담 의사를 단정하지 않음"],
      used_facts: [],
      recommendation_basis: null,
      voice_raw_candidate: "반갑게 맞이하되 부담 없이 이야기할 수 있다고 전한다",
      final_answer_source: "s6",
    },
    gate: gateBorrowedSensesOutput({
      borrowed: {
        understanding_hypotheses: ["가벼운 인사로 대화를 시작하려는 것 같다"],
        customer_intent: "인사",
        voice_raw_candidate: "반갑게 맞이하되 부담 없이 이야기할 수 있다고 전한다",
        must_not_assume: ["보험 상담 의사를 단정하지 않음"],
        used_facts: [],
        final_answer_source: "s6",
      },
      directive: { allowed_fact_tokens: {}, facts_to_speak: [] },
      history: [],
      question: "안녕하세요",
    }),
  },
  {
    label: "premium_visual_scope_shape",
    question: "표가 무슨 뜻이야?",
    borrowed: {
      understanding_hypotheses: ["방금 본 납입 표의 각 행 의미를 확인하려는 것 같다"],
      customer_intent: "표 해석",
      emotional_signal: null,
      hesitation_signal: "숫자 의미가 헷갈림",
      context_carryover: "직전 보험료 답변의 표를 가리킴",
      visual_observation: "표는 등록 22건, 대표 계약 월 4만5천 원, 전체 합산 미확인 행으로 구분된다",
      answer_purpose: "표 행별 의미 설명",
      must_not_assume: ["대표 납입을 22건 전체 합계로 단정하지 않음"],
      used_facts: ["policy_count", "monthly_premium_representative"],
      recommendation_basis: null,
      voice_raw_candidate: "위쪽은 확인된 대표 계약 납입이고, 아래 합산 행은 아직 정리 중이라고 설명한다",
      final_answer_source: "s6",
    },
    gate: gateBorrowedSensesOutput({
      borrowed: {
        understanding_hypotheses: ["방금 본 납입 표의 각 행 의미를 확인하려는 것 같다"],
        customer_intent: "표 해석",
        visual_observation: "표는 등록 22건, 대표 계약 월 4만5천 원, 전체 합산 미확인 행으로 구분된다",
        voice_raw_candidate: "위쪽은 확인된 대표 계약 납입이고, 아래 합산 행은 아직 정리 중이라고 설명한다",
        must_not_assume: ["대표 납입을 22건 전체 합계로 단정하지 않음"],
        used_facts: ["policy_count", "monthly_premium_representative"],
        final_answer_source: "s6",
      },
      directive: buildDirectivePremium(),
      history: [
        { role: "user", text: "내보험료 얼마야?" },
        { role: "assistant", text: "등록된 계약은 22건이고, 월 4만5천 원이 확인돼 있어요." },
      ],
      question: "표가 무슨 뜻이야?",
    }),
  },
  {
    label: "blocked_recommendation_push_shape",
    question: "아무거나 추천해줘",
    borrowed: {
      understanding_hypotheses: ["선택 부담을 줄이려 추천을 요청한 것 같다"],
      customer_intent: "상품 추천 요청",
      emotional_signal: "결정 피로",
      hesitation_signal: "무엇을 골라야 할지 모름",
      context_carryover: null,
      visual_observation: null,
      answer_purpose: "추천 대신 방향 질문",
      must_not_assume: ["특정 상품 적합성을 단정하지 않음"],
      used_facts: ["policy_count"],
      recommendation_basis: "지금은 이 상품을 바로 추천하기 어렵다",
      voice_raw_candidate: "지금은 이 상품 가입을 추천드리기보다 보험료와 보장 중 어디가 먼저인지 같이 정해볼게요",
      final_answer_source: "s6",
    },
    gate: gateBorrowedSensesOutput({
      borrowed: {
        understanding_hypotheses: ["선택 부담을 줄이려 추천을 요청한 것 같다"],
        customer_intent: "상품 추천 요청",
        recommendation_basis: "지금은 이 상품을 바로 추천하기 어렵다",
        voice_raw_candidate: "지금은 이 상품 가입을 추천드리기보다 보험료와 보장 중 어디가 먼저인지 같이 정해볼게요",
        must_not_assume: ["특정 상품 적합성을 단정하지 않음"],
        used_facts: ["policy_count"],
        final_answer_source: "s6",
      },
      directive: buildDirectivePremium(),
      history: [],
      question: "아무거나 추천해줘",
    }),
  },
];

const report = {
  schema_version: "s7-borrowed-senses-experiment-results-v0",
  generated_at: new Date().toISOString(),
  s7a_schema_version: spec.s7a_schema_version,
  anthropic_configured: Boolean(resolveAnthropicApiKey(process.env)),
  env: {
    KEY_VOICE: process.env.KEY_VOICE,
    KEY_BORROWED_SENSES: process.env.KEY_BORROWED_SENSES,
    KEY_RUNTIME_S5: process.env.KEY_RUNTIME_S5,
  },
  s6_final_answer_preserved_count: s6PreservedCount,
  s6_final_answer_preserved_all: s6PreservedCount === rows.length,
  rows,
  blocked_or_high_risk: blockedOrHighRisk.map((r) => ({
    id: r.id,
    question: r.question,
    memo: r.jinwoo_human_gate_memo,
    gates: {
      understanding_pollution: r.understanding_pollution,
      unsupported_recommendation: r.unsupported_recommendation,
      closing_or_signup_push: r.closing_or_signup_push,
      number_scope_violation: r.number_scope_violation,
      context_hallucination: r.context_hallucination,
      facts_not_in_allowed_set: r.facts_not_in_allowed_set,
    },
  })),
  borrowed_senses_examples: examples.length ? examples : schemaExamples,
  borrowed_senses_schema_examples: schemaExamples,
};

fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(
  JSON.stringify(
    {
      ok: true,
      out: OUT,
      anthropic_configured: Boolean(resolveAnthropicApiKey(process.env)),
      s6_final_answer_preserved_all: report.s6_final_answer_preserved_all,
      s6_final_answer_preserved_count: report.s6_final_answer_preserved_count,
      row_count: report.rows.length,
    },
    null,
    2,
  ),
);
