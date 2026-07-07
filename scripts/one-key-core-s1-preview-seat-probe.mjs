/**
 * ONE KEY Core S1 — Preview / local-runtime customer seat trace (Tom 5 checks · no PASS).
 *
 * Questions: 내 보험 괜찮아? / 암보험 부족해? / 그냥 추천해줘
 *
 * Usage:
 *   node scripts/one-key-core-s1-preview-seat-probe.mjs [preview-url]
 *   node scripts/one-key-core-s1-preview-seat-probe.mjs --local-runtime
 *   node scripts/one-key-core-s1-preview-seat-probe.mjs http://localhost:3000
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { handleHomeBrainFactRequest } from "../server/homeBrainFactCore.js";
import { ONE_KEY_CORE_S1_BLOCKED_PATHS, resolveOneKeyCoreS1Env } from "../server/keyCore/oneKeyCoreFlags.js";
import { KEY_GENERIC_FILLER_RE } from "../server/keyCompanionGuidance.js";
import { fetchBypassSse, parseSse, resolveBypassSecret } from "./p10-5-preview-curl-helper.mjs";

const ROOT = join(import.meta.dirname, "..");
const OUT_DIR = join(ROOT, "fixtures/key-judgment-validation-v1");
const OUT_JSON = join(OUT_DIR, "one-key-core-s1-preview-seat-evidence.json");
const OUT_JSON_REMOTE = join(OUT_DIR, "one-key-core-s1-remote-preview-seat-evidence.json");
const OUT_JSON_LOCAL_DEV = join(OUT_DIR, "one-key-core-s1-local-dev-seat-evidence.json");

const QUESTIONS = ["내 보험 괜찮아?", "암보험 부족해?", "그냥 추천해줘"];
const CORE_STEPS = ["interpret", "thinking", "judgment", "planner", "work_order", "evidence", "speak", "persona"];

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
    serviceRole: process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY ?? "",
    email: process.env.QA_EMAIL ?? process.env.QA_TEST_EMAIL ?? "",
    password: process.env.QA_PASSWORD ?? process.env.QA_TEST_PASSWORD ?? "",
  };
}

function assessLegacySpeakBypass(payload = {}) {
  const oneKeyTrace = payload.one_key_core_trace ?? null;
  const trace = payload.sales_director_trace ?? payload.salesDirectorTrace ?? {};
  const traceAudit = assessOneKeyTrace(oneKeyTrace);
  const hits = [];

  const topSource = payload.response_source ?? payload.agent ?? null;
  if (payload.tom_voice_trace) hits.push("tom_voice_trace");
  if (payload.tom_gap_light_path) hits.push("tom_gap_light_path");
  if (trace.delegate_general_knowledge === true) hits.push("delegate_general_knowledge");
  if (trace.general_knowledge_delegation === true) hits.push("general_knowledge_delegation");
  if (trace.sales_director_loop_legacy_chain === true) hits.push("sales_director_loop_legacy_chain");

  const legacySource = trace.legacy_response_source ?? null;
  if (legacySource && legacySource !== "one_key_core_s1" && topSource !== "one_key_core_s1") {
    hits.push(`legacy_response_source:${legacySource}`);
  }

  const hulCompose =
    trace.finalize_trace?.hul_compose_trace?.compose_mode ??
    trace.hul_compose_mode ??
    trace.finalize_trace?.compose_mode ??
    null;
  if (hulCompose === "hul_parallel_full_compose" || hulCompose === "hul_full_compose") {
    hits.push("hul_full_compose_invoked");
  }

  const bypassConfirmed =
    (payload.response_source === "one_key_core_s1" || payload.agent === "one_key_core_s1") &&
    traceAudit.trace_present &&
    traceAudit.steps_complete &&
    traceAudit.factory_explain_invoked === false &&
    (trace.p10_4_key_path_trace?.one_key_core_s1 === true || traceAudit.legacy_paths_blocked_count >= 10);

  return {
    legacy_bypass_confirmed: bypassConfirmed && hits.length === 0,
    legacy_speak_hits: hits,
  };
}

function assessOneKeyTrace(oneKeyTrace = null) {
  const steps = (oneKeyTrace?.steps ?? []).map((row) => row.step);
  const evidenceStep = (oneKeyTrace?.steps ?? []).find((row) => row.step === "evidence");
  return {
    trace_present: Boolean(oneKeyTrace),
    steps_complete: CORE_STEPS.every((step) => steps.includes(step)),
    step_names: steps,
    factory_explain_invoked: evidenceStep?.payload?.factory_explain_invoked ?? null,
    legacy_paths_blocked_count: oneKeyTrace?.legacy_paths_blocked?.length ?? 0,
    customer_text_path: oneKeyTrace?.customer_text_path ?? [],
  };
}

function assessAnswerQuality({ answerText = "", question = "" } = {}) {
  const text = String(answerText ?? "").replace(/\s+/g, " ").trim();
  const genericFiller = KEY_GENERIC_FILLER_RE.test(text);
  const tooShort = text.length < 24;
  const insuranceDeferOk =
    /확인|말씀|함께|구조|부족|등록|정리|우선|맥락/.test(text) || text.length >= 48;
  return {
    answer_length: text.length,
    generic_filler: genericFiller,
    too_short: tooShort,
    key_meets_first_tone: insuranceDeferOk && !genericFiller,
    answer_preview: text.slice(0, 280),
    question,
  };
}

function buildQuestionVerdict(row = {}) {
  if (!row.probe_ok) return "probe_failed";
  if (row.response_source !== "one_key_core_s1") return "legacy_or_non_s1_route";
  if (!row.legacy_bypass_confirmed) return "legacy_speak_signal";
  if (!row.one_key_trace.steps_complete) return "incomplete_core_trace";
  if (row.answer_quality.too_short || row.answer_quality.generic_filler) return "weak_answer";
  return "observe_ok";
}

async function mintToken(resolved) {
  const { data: auth, error } = await createClient(resolved.supabaseUrl, resolved.supabaseAnon, {
    auth: { persistSession: false },
  }).auth.signInWithPassword({ email: resolved.email, password: resolved.password });
  if (error || !auth.session?.access_token) {
    throw new Error(`auth: ${error?.message ?? "no token"}`);
  }
  return auth.session.access_token;
}

async function resolveCustomerProfileId(resolved, token) {
  const userSupabase = createClient(resolved.supabaseUrl, resolved.supabaseAnon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: authData, error: authError } = await userSupabase.auth.getUser();
  if (authError || !authData?.user?.id) return null;
  const { data: profile } = await userSupabase
    .from("customer_profiles")
    .select("id")
    .eq("user_id", authData.user.id)
    .maybeSingle();
  return profile?.id ?? null;
}

function isLocalBase(previewBase = "") {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(String(previewBase));
}

async function fetchHomeBrainFactSse({ previewBase, token, question, bypass }) {
  if (isLocalBase(previewBase)) {
    const url = `${String(previewBase).replace(/\/$/, "")}/api/customer-home-brain-fact`;
    let httpStatus = null;
    let stdout = "";
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ question, history: [], stream: true }),
      });
      httpStatus = res.status;
      stdout = await res.text();
    } catch (err) {
      return {
        ok: false,
        probe_error: err instanceof Error ? err.message : String(err),
        http_status: null,
      };
    }
    const ok = httpStatus === 200 && stdout.includes("event:");
    return { ok, stdout, http_status: httpStatus, unauthorized: httpStatus === 401 };
  }
  const probe = await fetchBypassSse({
    previewBase,
    token,
    question,
    history: [],
    bypassSecret: bypass,
  });
  return {
    ok: probe.ok,
    stdout: probe.stdout,
    http_status: probe.http_status,
    unauthorized: probe.unauthorized,
    probe_error: probe.unauthorized ? "UNAUTHORIZED" : probe.stderr_preview || `http_${probe.http_status ?? "unknown"}`,
  };
}

async function probePreviewQuestion({ previewBase, token, bypass, question }) {
  const probe = await fetchHomeBrainFactSse({ previewBase, token, question, bypass });
  if (!probe.ok) {
    return {
      probe_ok: false,
      probe_error: probe.probe_error ?? (probe.unauthorized ? "UNAUTHORIZED" : `http_${probe.http_status ?? "unknown"}`),
      question,
    };
  }
  const done = parseSse(probe.stdout).find((e) => e.type === "done")?.data ?? {};
  const answerText = String(done.answerText ?? "").replace(/\s+/g, " ").trim();
  const responseSource = done.response_source ?? done.agent ?? null;
  const oneKeyTrace = done.one_key_core_trace ?? null;
  const legacyAudit = assessLegacySpeakBypass(done);
  const traceAudit = assessOneKeyTrace(oneKeyTrace);
  const answerQuality = assessAnswerQuality({ answerText, question });
  const row = {
    mode: "preview_sse",
    question,
    probe_ok: true,
    probe_error: null,
    response_source: responseSource,
    agent: done.agent ?? null,
    one_key_trace: traceAudit,
    legacy_bypass_confirmed: legacyAudit.legacy_bypass_confirmed,
    legacy_speak_hits: legacyAudit.legacy_speak_hits,
    answer_quality: answerQuality,
    sales_director_mode: done.sales_director_mode ?? null,
    compose_mode:
      done.sales_director_trace?.finalize_trace?.key_compose_trace?.compose_mode ??
      done.sales_director_trace?.p10_4_key_path_trace?.build_key_structured_response?.compose_mode ??
      null,
  };
  row.verdict = buildQuestionVerdict(row);
  return row;
}

async function probeLocalRuntimeQuestion({ userSupabase, customerId, question, env }) {
  const s1Env = {
    ...resolveOneKeyCoreS1Env(env),
    SALES_DIRECTOR_KEY_CUSTOMER_ALLOWLIST: customerId,
  };
  const result = await handleHomeBrainFactRequest({
    userSupabase,
    customerId,
    question,
    history: [],
    env: s1Env,
    fetchImpl: async () => new Response("", { status: 503 }),
  });
  if (!result.ok) {
    return {
      mode: "local_runtime",
      question,
      probe_ok: false,
      probe_error: result.reason ?? result.error_message ?? "request_failed",
    };
  }
  const answerText = String(result.answerText ?? "").replace(/\s+/g, " ").trim();
  const legacyAudit = assessLegacySpeakBypass(result);
  const traceAudit = assessOneKeyTrace(result.one_key_core_trace);
  const answerQuality = assessAnswerQuality({ answerText, question });
  const speakStep = result.one_key_core_trace?.steps?.find((row) => row.step === "speak");
  const personaStep = result.one_key_core_trace?.steps?.find((row) => row.step === "persona");
  const row = {
    mode: "local_runtime",
    question,
    probe_ok: true,
    probe_error: null,
    response_source: result.response_source ?? null,
    agent: result.agent ?? null,
    one_key_trace: traceAudit,
    legacy_bypass_confirmed: legacyAudit.legacy_bypass_confirmed,
    legacy_speak_hits: legacyAudit.legacy_speak_hits,
    answer_quality: answerQuality,
    sales_director_mode: result.sales_director_mode ?? null,
    speak_draft_preview: speakStep?.payload?.draft_preview ?? null,
    speech_turn_type: speakStep?.payload?.key_compose_trace?.speech_turn_type ?? null,
    completeness_guard_applied: personaStep?.payload?.completeness_guard?.applied ?? null,
    completeness_guard_reason: personaStep?.payload?.completeness_guard?.reason ?? null,
    compose_mode:
      result.sales_director_trace?.finalize_trace?.key_compose_trace?.compose_mode ??
      result.sales_director_trace?.p10_4_key_path_trace?.build_key_structured_response?.compose_mode ??
      null,
  };
  row.verdict = buildQuestionVerdict(row);
  return row;
}

async function main() {
  loadEnvFile(join(ROOT, ".env.local"));
  loadEnvFile(join(ROOT, ".env.preview.pulled"));

  const args = process.argv.slice(2);
  const localRuntime = args.includes("--local-runtime");
  const previewBaseArg = args.find((a) => a.startsWith("http"))?.trim().replace(/\/$/, "") ?? "";
  const resolved = resolveEnv(previewBaseArg);

  const report = {
    audit: "one_key_core_s1_preview_seat_probe",
    schema_version: "one-key-core-s1-preview-seat-v1",
    pass_declaration: "none — Tom observation only",
    observed_at: new Date().toISOString(),
    mode: localRuntime ? "local_runtime" : "preview_sse",
    preview_base: localRuntime ? null : resolved.previewBase || null,
    questions: QUESTIONS,
    blocked_paths_expected: ONE_KEY_CORE_S1_BLOCKED_PATHS.length,
    tom_checks: {
      one_key_answers_on_screen: "visual_seat_script_required",
      response_source_one_key_core_s1: null,
      legacy_61_76_not_hit: null,
      answer_not_too_weak: null,
      key_meets_customer_first: null,
    },
    rows: [],
    blockers: [],
  };

  if (localRuntime) {
    if (!resolved.supabaseUrl || !resolved.supabaseAnon || !resolved.email || !resolved.password) {
      report.blockers.push("missing_supabase_or_qa_creds_for_local_runtime");
      mkdirSync(OUT_DIR, { recursive: true });
      writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      console.log("BLOCKED — local-runtime needs Supabase + QA creds");
      process.exit(2);
    }
    const token = await mintToken(resolved);
    const userSupabase = createClient(resolved.supabaseUrl, resolved.supabaseAnon, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const customerId = (await resolveCustomerProfileId(resolved, token)) ?? null;
    if (!customerId) {
      report.blockers.push("qa_customer_profile_id_unresolved");
      mkdirSync(OUT_DIR, { recursive: true });
      writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      console.log("BLOCKED — could not resolve QA customer_profiles.id from JWT");
      process.exit(2);
    }
    report.qa_customer_profile_id = customerId;
    for (const question of QUESTIONS) {
      report.rows.push(await probeLocalRuntimeQuestion({ userSupabase, customerId, question, env: process.env }));
    }
  } else {
    if (!resolved.previewBase || !resolved.supabaseUrl || !resolved.email || !resolved.password) {
      report.blockers.push("missing_preview_env");
      mkdirSync(OUT_DIR, { recursive: true });
      writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      console.log("BLOCKED — preview base, Supabase, QA creds required (or use --local-runtime)");
      process.exit(2);
    }
    if (!isLocalBase(resolved.previewBase) && !resolved.bypass) {
      report.blockers.push("missing_preview_bypass");
      mkdirSync(OUT_DIR, { recursive: true });
      writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      console.log("BLOCKED — VERCEL_AUTOMATION_BYPASS_SECRET required for remote Preview");
      process.exit(2);
    }
    const token = await mintToken(resolved);
    for (const question of QUESTIONS) {
      report.rows.push(await probePreviewQuestion({ previewBase: resolved.previewBase, token, bypass: resolved.bypass, question }));
    }
  }

  const okRows = report.rows.filter((r) => r.probe_ok);
  report.tom_checks.response_source_one_key_core_s1 = okRows.every((r) => r.response_source === "one_key_core_s1");
  report.tom_checks.legacy_61_76_not_hit = okRows.every((r) => r.legacy_bypass_confirmed === true);
  report.tom_checks.answer_not_too_weak = okRows.every(
    (r) => !r.answer_quality?.too_short && !r.answer_quality?.generic_filler,
  );
  report.tom_checks.key_meets_customer_first = okRows.every((r) => r.answer_quality?.key_meets_first_tone === true);

  const allObserveOk = report.rows.length === QUESTIONS.length && report.rows.every((r) => r.verdict === "observe_ok");
  report.summary = {
    probe_ok_count: report.rows.filter((r) => r.probe_ok).length,
    observe_ok_count: report.rows.filter((r) => r.verdict === "observe_ok").length,
    legacy_route_count: report.rows.filter((r) => r.verdict === "legacy_or_non_s1_route").length,
    overall: allObserveOk ? "observe_ok_pending_visual" : "observe_incomplete",
    note: localRuntime
      ? "local-runtime validates S1 code path; customer screen still needs visual seat capture"
      : report.rows.some((r) => r.verdict === "legacy_or_non_s1_route")
        ? "remote Preview likely lacks ONE_KEY_CORE_S1=1 deploy — use local-runtime or Preview redeploy with S1 flags"
        : null,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  for (const row of report.rows) {
    const tag = row.verdict === "observe_ok" ? "OBSERVE_OK" : "OBSERVE_FAIL";
    console.log(`${tag} [${row.mode}] Q="${row.question}" verdict=${row.verdict}`);
    if (row.probe_ok) {
      console.log(`  response_source=${row.response_source} compose=${row.compose_mode ?? "null"}`);
      console.log(`  trace_steps=${(row.one_key_trace?.step_names ?? []).join("→")}`);
      console.log(`  legacy_hits=${row.legacy_speak_hits.length ? row.legacy_speak_hits.join(",") : "none"}`);
      console.log(`  answer: ${row.answer_quality.answer_preview}`);
    } else {
      console.log(`  error: ${row.probe_error}`);
    }
  }

  console.log(`\nWrote ${OUT_JSON}`);
  console.log(`summary=${report.summary.overall} observe_ok=${report.summary.observe_ok_count}/${QUESTIONS.length}`);
  process.exit(allObserveOk ? 0 : 1);
}

await main();
