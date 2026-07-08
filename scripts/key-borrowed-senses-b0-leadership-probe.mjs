/**
 * S7-b Leadership — B0 10-question shadow probe (local · no deploy).
 */
import fs from "node:fs";
import { join } from "node:path";
import { classifyConsultationIntent } from "../server/intentGateLayer.js";
import { buildKeyFirstJudgment } from "../server/keyBrain/documentFirstJudgment.js";
import { buildRuntimeS5TurnBundle } from "../server/keyCore/keyRuntimeS5.js";
import { buildKeyVoiceComposeResult } from "../server/keyCore/keyVoiceCompose.js";
import { inferRouteLabel } from "../server/keyCore/keyBorrowedSensesGate.js";
import { resolveAnthropicApiKey } from "../server/claudeGroundedExecutionCore.js";

const ROOT = join(import.meta.dirname, "..");
const SPEC = join(ROOT, "fixtures/key-judgment-validation-v1/s7b-leadership-schema-v0.json");
const OUT = join(ROOT, "fixtures/key-judgment-validation-v1/s7b-leadership-experiment-results-v0.json");
const S7A_SPEC = join(ROOT, "fixtures/key-judgment-validation-v1/s7-borrowed-senses-experiment-v0.json");

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
process.env.KEY_BORROWED_SENSES_TIMEOUT_MS = "40000";

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
      bundle: { policies, memoryFacts: [], recentConversation: { hasHistory: false, latestUserMessages: [], latestUserMessageExcerpt: null } },
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

const S7B_GATES = [
  "customer_facing_axis_term",
  "passive_leadership",
  "leadership_without_basis",
  "product_push_as_direction",
  "expertise_overclaim",
  "missing_next_decision",
  "leadership_cancel_enroll_certainty",
];

function hasS7bFiveFields(borrowed) {
  if (!borrowed) return false;
  return (
    Boolean(String(borrowed.key_purpose ?? "").trim()) &&
    Boolean(String(borrowed.leadership_move ?? "").trim()) &&
    Array.isArray(borrowed.insurance_expertise_angle) &&
    borrowed.insurance_expertise_angle.length >= 1 &&
    Boolean(String(borrowed.proposal_direction ?? "").trim()) &&
    Array.isArray(borrowed.next_decision_point) &&
    borrowed.next_decision_point.filter((c) => String(c).trim()).length >= 2
  );
}

function s7bGateFails(gate) {
  if (!gate) return S7B_GATES;
  return S7B_GATES.filter((id) => gate[id] === true);
}

function humanMemo(row) {
  const notes = [];
  if (!row.s6_final_answer_preserved) notes.push("S6_FINAL_NOT_PRESERVED");
  if (row.s7_error) notes.push(`S7_ERROR:${row.s7_error}`);
  if (!row.s7b_five_fields_complete) notes.push("S7B_FIELDS_INCOMPLETE");
  for (const g of row.s7b_gate_fails) notes.push(`S7B:${g}`);
  for (const g of [
    "understanding_pollution",
    "unsupported_recommendation",
    "closing_or_signup_push",
    "number_scope_violation",
    "context_hallucination",
    "facts_not_in_allowed_set",
  ]) {
    if (row[g]) notes.push(g.toUpperCase());
  }
  if (["B0Q4", "B0Q6"].includes(row.id)) notes.push("HIGH_RISK_QUESTION");
  if (row.id === "B0Q10") notes.push("VISUAL_BLOCKS_SCOPE_WATCH");
  return notes.length ? notes.join("; ") : "shadow_ok — Tom/진woo leadership 판정";
}

const spec = JSON.parse(fs.readFileSync(SPEC, "utf8"));
const s7aSpec = JSON.parse(fs.readFileSync(S7A_SPEC, "utf8"));
const s7q11 = s7aSpec.experiment_questions.find((q) => q.id === "S7Q11");

const rows = [];
let s6PreservedCount = 0;
let s7bFieldsCount = 0;

for (const item of spec.golden_shapes) {
  const question = item.question;
  const history =
    item.id === "B0Q10" && s7q11?.history ? s7q11.history : (item.history ?? []);
  const previousAnswerSummary =
    item.id === "B0Q10" && s7q11?.previousAnswerSummary
      ? s7q11.previousAnswerSummary
      : (item.previousAnswerSummary ?? "");
  const shadowVisualBlocks =
    item.id === "B0Q10" && s7q11?.shadow_visual_blocks ? s7q11.shadow_visual_blocks : null;

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
      shadowVisualBlocksOverride: shadowVisualBlocks,
      env: process.env,
    },
  );

  const trace = voice?.key_voice_trace ?? {};
  const s7 = trace.borrowed_senses_shadow ?? {};
  const borrowed = s7.borrowed ?? null;
  const gate = s7.gate ?? null;
  const finalAnswer = voice?.text ?? null;
  const s6Preserved =
    Boolean(finalAnswer) &&
    s7.s6_final_answer === finalAnswer &&
    s7.customer_text_changed === false &&
    (borrowed?.final_answer_source ?? s7.final_answer_source) === "s6";
  if (s6Preserved) s6PreservedCount += 1;

  const s7bComplete = hasS7bFiveFields(borrowed);
  if (s7bComplete) s7bFieldsCount += 1;

  const routeInfo = inferRouteLabel(question, trace.directive);

  rows.push({
    id: item.id,
    question,
    route: routeInfo.route,
    fast_path_or_consult_path: routeInfo.fast_path_or_consult_path,
    key_purpose: borrowed?.key_purpose ?? null,
    leadership_move: borrowed?.leadership_move ?? null,
    insurance_expertise_angle: borrowed?.insurance_expertise_angle ?? [],
    insurance_expertise_rationale: borrowed?.insurance_expertise_rationale ?? null,
    proposal_direction: borrowed?.proposal_direction ?? null,
    next_decision_point: borrowed?.next_decision_point ?? [],
    customer_intent: borrowed?.customer_intent ?? null,
    used_facts: borrowed?.used_facts ?? [],
    final_answer: finalAnswer,
    final_answer_source: "s6",
    s6_final_answer_preserved: s6Preserved,
    s7b_five_fields_complete: s7bComplete,
    customer_facing_axis_term: gate?.customer_facing_axis_term ?? null,
    passive_leadership: gate?.passive_leadership ?? null,
    leadership_without_basis: gate?.leadership_without_basis ?? null,
    product_push_as_direction: gate?.product_push_as_direction ?? null,
    expertise_overclaim: gate?.expertise_overclaim ?? null,
    missing_next_decision: gate?.missing_next_decision ?? null,
    leadership_cancel_enroll_certainty: gate?.leadership_cancel_enroll_certainty ?? null,
    understanding_pollution: gate?.understanding_pollution ?? null,
    unsupported_recommendation: gate?.unsupported_recommendation ?? null,
    closing_or_signup_push: gate?.closing_or_signup_push ?? null,
    number_scope_violation: gate?.number_scope_violation ?? null,
    context_hallucination: gate?.context_hallucination ?? null,
    facts_not_in_allowed_set: gate?.facts_not_in_allowed_set ?? null,
    s7_gate_ok: gate?.ok ?? null,
    s7b_gate_fails: s7bGateFails(gate),
    s7_error: s7.error ?? null,
    s7_shadow_attempts: s7.attempts ?? null,
    shadow_visual_blocks_injected: Boolean(shadowVisualBlocks?.length),
    jinwoo_human_gate_memo: "",
  });
  rows[rows.length - 1].jinwoo_human_gate_memo = humanMemo(rows[rows.length - 1]);
}

const leadershipExamples = rows
  .filter((r) => r.s7b_five_fields_complete && !r.s7_error)
  .slice(0, 3)
  .map((r) => ({
    id: r.id,
    question: r.question,
    leadership: {
      key_purpose: r.key_purpose,
      leadership_move: r.leadership_move,
      insurance_expertise_angle: r.insurance_expertise_angle,
      proposal_direction: r.proposal_direction,
      next_decision_point: r.next_decision_point,
    },
    final_answer: r.final_answer,
    final_answer_source: "s6",
  }));

const gateFailRows = rows.filter((r) => r.s7b_gate_fails.length > 0 || !r.s7_gate_ok);

const report = {
  schema_version: "s7b-leadership-experiment-results-v0",
  generated_at: new Date().toISOString(),
  s7b_schema_version: spec.schema_version,
  extends: spec.extends,
  anthropic_configured: Boolean(resolveAnthropicApiKey(process.env)),
  env: {
    KEY_VOICE: process.env.KEY_VOICE,
    KEY_BORROWED_SENSES: process.env.KEY_BORROWED_SENSES,
    KEY_RUNTIME_S5: process.env.KEY_RUNTIME_S5,
  },
  pass_criteria: {
    s6_final_answer_preserved_all: s6PreservedCount === rows.length,
    s7b_five_fields_all: s7bFieldsCount === rows.length,
    s7b_gate_all_pass: rows.every((r) => r.s7b_gate_fails.length === 0 && r.s7_gate_ok),
  },
  s6_final_answer_preserved_count: s6PreservedCount,
  s6_final_answer_preserved_all: s6PreservedCount === rows.length,
  s7b_five_fields_count: s7bFieldsCount,
  s7b_five_fields_all: s7bFieldsCount === rows.length,
  rows,
  gate_fail_rows: gateFailRows.map((r) => ({
    id: r.id,
    question: r.question,
    s7b_gate_fails: r.s7b_gate_fails,
    s7_gate_ok: r.s7_gate_ok,
    memo: r.jinwoo_human_gate_memo,
  })),
  leadership_examples: leadershipExamples,
};

fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(
  JSON.stringify(
    {
      ok: true,
      out: OUT,
      anthropic_configured: report.anthropic_configured,
      s6_final_answer_preserved_all: report.s6_final_answer_preserved_all,
      s7b_five_fields_all: report.s7b_five_fields_all,
      s7b_gate_all_pass: report.pass_criteria.s7b_gate_all_pass,
      row_count: report.rows.length,
    },
    null,
    2,
  ),
);
