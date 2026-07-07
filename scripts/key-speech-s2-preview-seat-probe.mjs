/**
 * KEY Speech Slice 2 — Preview seat probe (14 turn-type sentences · no PASS).
 *
 * Usage:
 *   node scripts/key-speech-s2-preview-seat-probe.mjs https://preview-url
 *   node scripts/key-speech-s2-preview-seat-probe.mjs --local-runtime
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { handleHomeBrainFactRequest } from "../server/homeBrainFactCore.js";
import { ONE_KEY_CORE_S1_BLOCKED_PATHS, resolveOneKeyCoreS1Env } from "../server/keyCore/oneKeyCoreFlags.js";
import { KEY_GENERIC_FILLER_RE } from "../server/keyCompanionGuidance.js";
import {
  SPEECH_TURN_TYPE_TEST_SET,
  classifySpeechTurnType,
  scanSpeechForbiddenPatterns,
} from "../server/keyBrain/keySpeechTurnType.js";
import { fetchBypassSse, parseSse, resolveBypassSecret } from "./p10-5-preview-curl-helper.mjs";

const ROOT = join(import.meta.dirname, "..");
const OUT_DIR = join(ROOT, "fixtures/key-judgment-validation-v1");
const OUT_JSON = join(OUT_DIR, "key-speech-s2-preview-seat-evidence.json");
const OUT_HUMAN_PREP = join(OUT_DIR, "key-speech-s2-human-gate-prep-evidence.json");

const QUESTIONS = SPEECH_TURN_TYPE_TEST_SET.map((row) => row.question);

const HUMAN_GATE_QUESTIONS = [
  "오늘 너무 힘들어",
  "분당 맛집 추천해줘",
  "내 보험 괜찮아?",
  "암보험 부족해?",
  "그냥 추천해줘",
  "내가 가입한 보험 뭐야?",
];

const CORE_STEPS = ["interpret", "thinking", "judgment", "planner", "work_order", "evidence", "speak", "persona"];

const CONTRAST_PAIRS = [
  ["보험료 부담돼", "보험료 얼마야"],
  ["추천해줘", "추천해줘야 하나 싶어서요"],
  ["내 보험 괜찮아?", "암보험 부족해?"],
  ["지난번 얘기 이어서 봐줘", "아까 말한 거 다시 알려줘"],
];

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function resolveEnv(previewBaseArg = "") {
  return {
    previewBase: String(previewBaseArg || process.env.PREVIEW_BASE || "").replace(/\/$/, ""),
    bypass: resolveBypassSecret(),
    supabaseUrl: process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "",
    supabaseAnon: process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "",
    email: process.env.QA_EMAIL ?? process.env.QA_TEST_EMAIL ?? "",
    password: process.env.QA_PASSWORD ?? process.env.QA_TEST_PASSWORD ?? "",
  };
}

function assessOneKeyTrace(trace = null) {
  const steps = trace?.steps ?? [];
  const stepNames = steps.map((row) => row.step);
  return {
    trace_present: Boolean(trace),
    steps_complete: CORE_STEPS.every((name) => stepNames.includes(name)),
    step_names: stepNames,
    factory_explain_invoked: steps.find((row) => row.step === "evidence")?.payload?.factory_explain_invoked ?? null,
    legacy_paths_blocked_count: trace?.legacy_paths_blocked?.length ?? 0,
    customer_text_path: trace?.customer_text_path ?? [],
  };
}

function assessLegacySpeakBypass(payload = {}) {
  const hits = [];
  if (payload.tom_voice_trace) hits.push("tom_voice_trace");
  if (payload.tom_gap_light_path) hits.push("tom_gap_light_path");
  return {
    legacy_bypass_confirmed: hits.length === 0 && (payload.response_source ?? payload.agent) === "one_key_core_s1",
    legacy_speak_hits: hits,
  };
}

function assessAnswerQuality({ answerText = "", question = "" } = {}) {
  const text = String(answerText ?? "").replace(/\s+/g, " ").trim();
  return {
    answer_length: text.length,
    generic_filler: KEY_GENERIC_FILLER_RE.test(text),
    too_short: text.length < 24,
    key_meets_first_tone: text.length >= 24 && !KEY_GENERIC_FILLER_RE.test(text),
    answer_preview: text.slice(0, 280),
    question,
  };
}

function buildQuestionVerdict(row = {}) {
  if (!row.probe_ok) return "probe_failed";
  if (row.response_source !== "one_key_core_s1") return "legacy_or_non_s1_route";
  if (!row.legacy_bypass_confirmed) return "legacy_speak_signal";
  if (!row.one_key_trace?.steps_complete) return "incomplete_core_trace";
  if (row.forbidden_hits?.length) return "speech_forbidden_pattern";
  if (row.turn_type_match === false) return "turn_type_mismatch";
  if (row.answer_quality?.too_short || row.answer_quality?.generic_filler) return "weak_answer";
  return "observe_ok";
}

async function mintToken(resolved) {
  const { data: auth, error } = await createClient(resolved.supabaseUrl, resolved.supabaseAnon, {
    auth: { persistSession: false },
  }).auth.signInWithPassword({ email: resolved.email, password: resolved.password });
  if (error || !auth.session?.access_token) throw new Error(`auth: ${error?.message ?? "no token"}`);
  return auth.session.access_token;
}

async function resolveCustomerProfileId(resolved, token) {
  const userSupabase = createClient(resolved.supabaseUrl, resolved.supabaseAnon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: authData } = await userSupabase.auth.getUser();
  if (!authData?.user?.id) return null;
  const { data: profile } = await userSupabase
    .from("customer_profiles")
    .select("id")
    .eq("user_id", authData.user.id)
    .maybeSingle();
  return profile?.id ?? null;
}

function isLocalBase(base = "") {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(base);
}

async function fetchHomeBrainFactSse({ previewBase, token, question, bypass }) {
  const url = `${previewBase}/api/customer-home-brain-fact`;
  return fetchBypassSse({ url, token, question, bypass });
}

function enrichRow(baseRow, question, testRow = null) {
  const expectedTurnType = testRow?.expected ?? classifySpeechTurnType(question);
  const actualTurnType = baseRow.speech_turn_type ?? classifySpeechTurnType(question);
  const forbiddenHits = scanSpeechForbiddenPatterns(baseRow.answer_quality?.answer_preview ?? "", {
    turnType: actualTurnType,
  });
  return {
    ...baseRow,
    test_id: testRow?.id ?? null,
    expected_turn_type: expectedTurnType,
    speech_turn_type: actualTurnType,
    turn_type_match: actualTurnType === expectedTurnType,
    forbidden_hits: forbiddenHits,
    fallback_signal:
      baseRow.completeness_guard_applied === true && baseRow.completeness_guard_reason === "empty_customer_text",
  };
}

async function probePreviewQuestion({ previewBase, token, bypass, question, testRow = null }) {
  const probe = await fetchHomeBrainFactSse({ previewBase, token, question, bypass });
  if (!probe.ok) {
    return enrichRow(
      { mode: "preview_sse", question, probe_ok: false, probe_error: probe.probe_error ?? "sse_failed" },
      question,
      testRow,
    );
  }
  const done = parseSse(probe.stdout).find((e) => e.type === "done")?.data ?? {};
  const answerText = String(done.answerText ?? "").replace(/\s+/g, " ").trim();
  const trace = done.one_key_core_trace ?? null;
  const speakStep = trace?.steps?.find((row) => row.step === "speak");
  const personaStep = trace?.steps?.find((row) => row.step === "persona");
  const legacyAudit = assessLegacySpeakBypass(done);
  const row = enrichRow(
    {
      mode: "preview_sse",
      question,
      probe_ok: true,
      probe_error: null,
      response_source: done.response_source ?? done.agent ?? null,
      agent: done.agent ?? null,
      one_key_trace: assessOneKeyTrace(trace),
      legacy_bypass_confirmed: legacyAudit.legacy_bypass_confirmed,
      legacy_speak_hits: legacyAudit.legacy_speak_hits,
      answer_quality: assessAnswerQuality({ answerText, question }),
      speak_draft_preview: speakStep?.payload?.draft_preview ?? null,
      key_speak_master: speakStep?.payload?.key_speak_master === true,
      speech_turn_type: speakStep?.payload?.speech_turn_type ?? speakStep?.payload?.key_compose_trace?.speech_turn_type ?? null,
      completeness_guard_applied: personaStep?.payload?.completeness_guard?.applied ?? null,
      completeness_guard_reason: personaStep?.payload?.completeness_guard?.reason ?? null,
      rewrite_count: done.sse_trace?.replace_count ?? 0,
    },
    question,
    testRow,
  );
  row.verdict = buildQuestionVerdict(row);
  return row;
}

async function probeLocalRuntimeQuestion({ userSupabase, customerId, question, env, testRow = null }) {
  const s1Env = { ...resolveOneKeyCoreS1Env(env), SALES_DIRECTOR_KEY_CUSTOMER_ALLOWLIST: customerId };
  const result = await handleHomeBrainFactRequest({
    userSupabase,
    customerId,
    question,
    history: [],
    env: s1Env,
    fetchImpl: async () => new Response("", { status: 503 }),
  });
  if (!result.ok) {
    return enrichRow(
      { mode: "local_runtime", question, probe_ok: false, probe_error: result.reason ?? "request_failed" },
      question,
      testRow,
    );
  }
  const answerText = String(result.answerText ?? "").replace(/\s+/g, " ").trim();
  const trace = result.one_key_core_trace ?? null;
  const speakStep = trace?.steps?.find((row) => row.step === "speak");
  const personaStep = trace?.steps?.find((row) => row.step === "persona");
  const legacyAudit = assessLegacySpeakBypass(result);
  const row = enrichRow(
    {
      mode: "local_runtime",
      question,
      probe_ok: true,
      probe_error: null,
      response_source: result.response_source ?? null,
      agent: result.agent ?? null,
      one_key_trace: assessOneKeyTrace(trace),
      legacy_bypass_confirmed: legacyAudit.legacy_bypass_confirmed,
      legacy_speak_hits: legacyAudit.legacy_speak_hits,
      answer_quality: assessAnswerQuality({ answerText, question }),
      speak_draft_preview: speakStep?.payload?.draft_preview ?? null,
      key_speak_master: speakStep?.payload?.key_speak_master === true,
      speech_turn_type: speakStep?.payload?.speech_turn_type ?? speakStep?.payload?.key_compose_trace?.speech_turn_type ?? null,
      completeness_guard_applied: personaStep?.payload?.completeness_guard?.applied ?? null,
      completeness_guard_reason: personaStep?.payload?.completeness_guard?.reason ?? null,
      rewrite_count: 0,
    },
    question,
    testRow,
  );
  row.verdict = buildQuestionVerdict(row);
  return row;
}

function buildContrastRows(rowsByQuestion) {
  return CONTRAST_PAIRS.map(([a, b]) => {
    const textA = rowsByQuestion.get(a)?.answer_quality?.answer_preview ?? "";
    const textB = rowsByQuestion.get(b)?.answer_quality?.answer_preview ?? "";
    return {
      pair: [a, b],
      same_answer: textA.length > 0 && textA === textB,
      pass: textA.length > 0 && textB.length > 0 && textA !== textB,
    };
  });
}

async function main() {
  loadEnvFile(join(ROOT, ".env.local"));
  loadEnvFile(join(ROOT, ".env.preview.pulled"));

  const args = process.argv.slice(2);
  const localRuntime = args.includes("--local-runtime");
  const previewBaseArg = args.find((a) => a.startsWith("http"))?.trim().replace(/\/$/, "") ?? "";
  const resolved = resolveEnv(previewBaseArg);

  const report = {
    schema_version: "key-speech-s2-preview-seat-evidence-v1",
    slice: "KEY_GROWTH_S2",
    pass_declaration: "none",
    observed_at: new Date().toISOString(),
    mode: localRuntime ? "local_runtime" : "preview_sse",
    preview_base: localRuntime ? null : resolved.previewBase || null,
    questions: QUESTIONS,
    human_gate_questions: HUMAN_GATE_QUESTIONS,
    rows: [],
    human_gate_prep_rows: [],
    blockers: [],
  };

  let customerId = null;
  let userSupabase = null;
  let token = null;

  if (localRuntime) {
    if (!resolved.supabaseUrl || !resolved.supabaseAnon || !resolved.email || !resolved.password) {
      report.blockers.push("missing_supabase_or_qa_creds");
      writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      process.exit(2);
    }
    token = await mintToken(resolved);
    userSupabase = createClient(resolved.supabaseUrl, resolved.supabaseAnon, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    customerId = (await resolveCustomerProfileId(resolved, token)) ?? null;
    if (!customerId) {
      report.blockers.push("qa_customer_profile_id_unresolved");
      writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      process.exit(2);
    }
    report.qa_customer_profile_id = customerId;
  } else {
    if (!resolved.previewBase || !resolved.supabaseUrl || !resolved.email || !resolved.password) {
      report.blockers.push("missing_preview_env");
      writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      process.exit(2);
    }
    if (!isLocalBase(resolved.previewBase) && !resolved.bypass) {
      report.blockers.push("missing_preview_bypass");
      writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      process.exit(2);
    }
    token = await mintToken(resolved);
  }

  const probeOne = async (question, testRow = null) => {
    if (localRuntime) {
      return probeLocalRuntimeQuestion({ userSupabase, customerId, question, env: process.env, testRow });
    }
    return probePreviewQuestion({ previewBase: resolved.previewBase, token, bypass: resolved.bypass, question, testRow });
  };

  for (const testRow of SPEECH_TURN_TYPE_TEST_SET) {
    report.rows.push(await probeOne(testRow.question, testRow));
  }

  for (const question of HUMAN_GATE_QUESTIONS) {
    if (!QUESTIONS.includes(question)) {
      report.human_gate_prep_rows.push(await probeOne(question));
    }
  }

  const rowsByQuestion = new Map(report.rows.map((row) => [row.question, row]));
  for (const row of report.human_gate_prep_rows) rowsByQuestion.set(row.question, row);

  const okRows = [...report.rows, ...report.human_gate_prep_rows].filter((r) => r.probe_ok);
  const contrastRows = buildContrastRows(rowsByQuestion);

  report.mechanical_gate = {
    a0_turn_type: {
      pass: report.rows.every((r) => r.turn_type_match === true),
      matched: report.rows.filter((r) => r.turn_type_match).length,
      total: report.rows.length,
    },
    a1_forbidden: {
      pass: report.rows.every((r) => (r.forbidden_hits ?? []).length === 0),
      rows_with_hits: report.rows.filter((r) => (r.forbidden_hits ?? []).length > 0).map((r) => r.question),
    },
    a2_infra: {
      pass:
        okRows.every((r) => r.response_source === "one_key_core_s1") &&
        okRows.every((r) => r.key_speak_master === true) &&
        okRows.every((r) => (r.rewrite_count ?? 0) === 0) &&
        okRows.every((r) => (r.legacy_speak_hits ?? []).length === 0),
      response_source_one_key_core_s1: okRows.every((r) => r.response_source === "one_key_core_s1"),
      key_speak_master: okRows.every((r) => r.key_speak_master === true),
      rewrite_zero: okRows.every((r) => (r.rewrite_count ?? 0) === 0),
      legacy_zero: okRows.every((r) => (r.legacy_speak_hits ?? []).length === 0),
    },
    boundary_contrast: { pass: contrastRows.every((r) => r.pass), rows: contrastRows },
    mechanical_pass: false,
  };
  report.mechanical_gate.mechanical_pass =
    report.mechanical_gate.a0_turn_type.pass &&
    report.mechanical_gate.a1_forbidden.pass &&
    report.mechanical_gate.a2_infra.pass &&
    report.mechanical_gate.boundary_contrast.pass;

  report.summary = {
    probe_ok_count: report.rows.filter((r) => r.probe_ok).length,
    observe_ok_count: report.rows.filter((r) => r.verdict === "observe_ok").length,
    mechanical_pass: report.mechanical_gate.mechanical_pass,
    human_gate_prep: "pending_jinwoo",
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const humanPrep = {
    schema_version: "key-speech-s2-human-gate-prep-evidence-v1",
    slice: "KEY_GROWTH_S2",
    pass_declaration: "none",
    observed_at: report.observed_at,
    preview_base: report.preview_base,
    scorecard_template_ref: "fixtures/key-judgment-validation-v1/key-speech-s2-human-gate-scorecard-template-v1.json",
    required_questions: HUMAN_GATE_QUESTIONS,
    jinwoo_free_questions: ["(진우 즉석 질문 1)", "(진우 즉석 질문 2)"],
    pass_threshold: { average_min: 4.0, dimension_min: 3 },
    rows: [...HUMAN_GATE_QUESTIONS.map((q) => rowsByQuestion.get(q)).filter(Boolean)],
    fallback_watch: {
      question: "내가 가입한 보험 뭐야?",
      purpose: "judgment-only fallback — why not telling enrolled policies?",
      row: rowsByQuestion.get("내가 가입한 보험 뭐야?") ?? null,
    },
  };
  writeFileSync(OUT_HUMAN_PREP, `${JSON.stringify(humanPrep, null, 2)}\n`, "utf8");

  console.log(`key-speech-s2-preview-seat-probe: mechanical_pass=${report.mechanical_gate.mechanical_pass}`);
  console.log(`Wrote ${OUT_JSON}`);
  console.log(`Wrote ${OUT_HUMAN_PREP}`);
  process.exit(report.mechanical_gate.mechanical_pass ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
