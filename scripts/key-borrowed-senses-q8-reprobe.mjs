/**
 * S7Q8 단독 reprobe — 529 발생 시 shadow 1회 재시도 · fixture merge.
 */
import fs from "node:fs";
import { join } from "node:path";
import { classifyConsultationIntent } from "../server/intentGateLayer.js";
import { buildKeyFirstJudgment } from "../server/keyBrain/documentFirstJudgment.js";
import { buildRuntimeS5TurnBundle } from "../server/keyCore/keyRuntimeS5.js";
import { buildKeyVoiceComposeResult } from "../server/keyCore/keyVoiceCompose.js";
import { inferRouteLabel } from "../server/keyCore/keyBorrowedSensesGate.js";
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
    for (const name of fs
      .readdirSync(ROOT)
      .filter((n) => n.startsWith(".env.local.backup"))
      .sort()
      .reverse()) {
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
  const fails = [
    gate?.understanding_pollution,
    gate?.unsupported_recommendation,
    gate?.closing_or_signup_push,
    gate?.number_scope_violation,
    gate?.context_hallucination,
    gate?.facts_not_in_allowed_set,
  ].filter(Boolean).length;
  if (fails === 0 && borrowed.voice_raw_candidate) return 3;
  if (fails === 0) return 2;
  if (fails === 1) return 1;
  return 0;
}

function humanGateMemo(gate, s7Error, s6Preserved) {
  const notes = [];
  if (!s6Preserved) notes.push("S6_FINAL_NOT_PRESERVED");
  if (s7Error) notes.push(`S7_ERROR:${s7Error}`);
  if (gate?.understanding_pollution) notes.push("UNDERSTANDING_POLLUTION");
  if (gate?.unsupported_recommendation) notes.push("UNSUPPORTED_RECOMMENDATION");
  if (gate?.closing_or_signup_push) notes.push("CLOSING_OR_SIGNUP_PUSH");
  if (gate?.number_scope_violation) notes.push("NUMBER_SCOPE_VIOLATION");
  if (gate?.context_hallucination) notes.push("CONTEXT_HALLUCINATION");
  if (gate?.facts_not_in_allowed_set) notes.push("FACTS_NOT_IN_ALLOWED_SET");
  notes.push("HIGH_RISK_QUESTION");
  if (!s7Error && gate?.ok && s6Preserved) {
    return "shadow_ok — Tom/진woo naturalness 판정; HIGH_RISK_QUESTION";
  }
  return notes.join("; ");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function is529(error) {
  return String(error ?? "").includes("529");
}

async function runQ8Turn(item, { retry529 = false } = {}) {
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
    { question, history, previousAnswerSummary, env: process.env },
  );

  let trace = voice?.key_voice_trace ?? {};
  let s7 = trace.borrowed_senses_shadow ?? {};

  if (is529(s7.error) && retry529) {
    await sleep(2500);
    const shadowRetry = await runBorrowedSensesShadowProbe({
      question,
      directive: trace.directive,
      decision: bundle?.decision ?? null,
      history,
      previousAnswerSummary,
      s6FinalAnswer: voice?.text ?? "",
      visualBlocks: voice?.visual_blocks ?? [],
      env: process.env,
      timeoutMs: 45000,
    });
    trace = { ...trace, borrowed_senses_shadow: shadowRetry };
    s7 = shadowRetry;
  }

  const borrowed = s7.borrowed ?? null;
  const gate = s7.gate ?? null;
  const finalAnswer = voice?.text ?? null;
  const s6Preserved =
    Boolean(finalAnswer) &&
    s7.s6_final_answer === finalAnswer &&
    s7.customer_text_changed === false &&
    (borrowed?.final_answer_source ?? s7.final_answer_source) === "s6";

  const routeInfo = inferRouteLabel(question, trace.directive);

  return {
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
    final_answer: finalAnswer,
    final_answer_source: "s6",
    s6_final_answer_preserved: s6Preserved,
    done_visual_blocks_length: (voice?.visual_blocks ?? []).length,
    done_visual_blocks_types: (voice?.visual_blocks ?? []).map((b) => b.type),
    shadow_visual_blocks_injected: false,
    understanding_pollution: gate?.understanding_pollution ?? null,
    unsupported_recommendation: gate?.unsupported_recommendation ?? null,
    closing_or_signup_push: gate?.closing_or_signup_push ?? null,
    number_scope_violation: gate?.number_scope_violation ?? null,
    context_hallucination: gate?.context_hallucination ?? null,
    facts_not_in_allowed_set: gate?.facts_not_in_allowed_set ?? null,
    s7_gate_ok: gate?.ok ?? null,
    s7_error: s7.error ?? null,
    s7_shadow_attempts: s7.attempts ?? null,
    s7_q8_reprobe_529_retry: retry529 && is529(null) ? false : retry529,
    naturalness_score: naturalnessScore(borrowed, gate, s7.error),
    jinwoo_human_gate_memo: humanGateMemo(gate, s7.error, s6Preserved),
  };
}

const spec = JSON.parse(fs.readFileSync(SPEC, "utf8"));
const item = spec.experiment_questions.find((q) => q.id === "S7Q8");
if (!item) {
  console.error("S7Q8 not found in spec");
  process.exit(1);
}

let q8Row = await runQ8Turn(item, { retry529: false });
let used529Retry = false;

if (is529(q8Row.s7_error)) {
  used529Retry = true;
  q8Row = await runQ8Turn(item, { retry529: true });
  q8Row.s7_q8_reprobe_529_retry = true;
}

const report = JSON.parse(fs.readFileSync(OUT, "utf8"));
const idx = report.rows.findIndex((r) => r.id === "S7Q8");
if (idx >= 0) report.rows[idx] = q8Row;
else report.rows.push(q8Row);

report.generated_at = new Date().toISOString();
report.q8_reprobe = {
  at: new Date().toISOString(),
  used_529_retry: used529Retry,
  s7_error: q8Row.s7_error,
  s7_gate_ok: q8Row.s7_gate_ok,
};

report.s6_final_answer_preserved_count = report.rows.filter((r) => r.s6_final_answer_preserved).length;
report.s6_final_answer_preserved_all = report.s6_final_answer_preserved_count === report.rows.length;

report.blocked_or_high_risk = report.rows.filter(
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

const fillOk = report.rows.every((r) => !r.s7_error);
report.claude_fill_all = fillOk;
report.claude_fill_count = report.rows.filter((r) => !r.s7_error).length;

fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(
  JSON.stringify(
    {
      ok: true,
      q8: {
        s7_error: q8Row.s7_error,
        s7_gate_ok: q8Row.s7_gate_ok,
        s6_final_answer_preserved: q8Row.s6_final_answer_preserved,
        used_529_retry: used529Retry,
        naturalness_score: q8Row.naturalness_score,
      },
      claude_fill_count: report.claude_fill_count,
      claude_fill_all: report.claude_fill_all,
      out: OUT,
    },
    null,
    2,
  ),
);
