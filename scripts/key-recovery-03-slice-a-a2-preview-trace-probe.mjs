/**
 * KEY-RECOVERY-03 Slice A A2 — Preview active preload trace probe (observation only).
 *
 * Usage:
 *   node scripts/key-recovery-03-slice-a-a2-preview-trace-probe.mjs [preview-url]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { fetchBypassSse, parseSse, resolveBypassSecret } from "./p10-5-preview-curl-helper.mjs";

const ROOT = join(import.meta.dirname, "..");
const OUT_DIR = join(ROOT, "fixtures/key-judgment-validation-v1");
const OUT_JSON = join(OUT_DIR, "key-recovery-03-slice-a-a2-preview-trace-evidence.json");
const OUT_MD = join(OUT_DIR, "key-recovery-03-slice-a-a2-preview-trace-evidence.md");

const TOM_THREE_QUESTIONS = [
  { id: "Q1", question: "추천해줘", expectedPreloads: ["recommendation"] },
  { id: "Q2", question: "내 보험 괜찮아", expectedPreloads: ["coverage_gap"] },
  { id: "Q3", question: "나를 기억해?", expectedPreloads: [] },
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
  const previewBase = String(previewBaseArg || process.env.PREVIEW_BASE || "").replace(/\/$/, "");
  return {
    previewBase,
    bypass: resolveBypassSecret(),
    supabaseUrl: process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "",
    supabaseAnon: process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "",
    email: process.env.QA_EMAIL ?? process.env.QA_TEST_EMAIL ?? "",
    password: process.env.QA_PASSWORD ?? process.env.QA_TEST_PASSWORD ?? "",
  };
}

function extractTrace(done = {}) {
  const trace = done.sales_director_trace ?? done.salesDirectorTrace ?? {};
  const p10 = trace.p10_4_key_path_trace ?? {};
  const preload = trace.key_preload_control ?? p10.key_preload_control ?? null;
  const keyLoop = trace.key_loop_trace ?? p10.key_loop_trace ?? null;
  return { trace, preload, keyLoop };
}

function buildRow({ id, question, expectedPreloads, probe, done }) {
  const answerText = String(done.answerText ?? "").replace(/\s+/g, " ").trim();
  const { preload, keyLoop, trace } = extractTrace(done);
  const f8 =
    preload?.f8_legacy_fallback_backfill ?? keyLoop?.f8_legacy_backfill ?? null;

  const row = {
    id,
    question,
    probe_ok: probe.probe_ok === true,
    probe_error: probe.probe_error ?? null,
    response_source: done.response_source ?? trace.legacy_response_source ?? null,
    answer_preview: answerText.slice(0, 220),
    answer_length: answerText.length,
    expected_preloads_executed: expectedPreloads,
    key_preload_control: preload
      ? {
          mode: preload.mode ?? null,
          gate: preload.gate ?? null,
          executed_selective_preload: preload.executed_selective_preload ?? null,
          legacy_preload_executed: preload.legacy_preload_executed ?? null,
          preloads_executed: preload.preloads_executed ?? null,
          preloads_skipped: preload.preloads_skipped ?? null,
          fallback_reason: preload.fallback_reason ?? null,
          f8_legacy_fallback_backfill: f8,
        }
      : null,
    key_loop_trace: keyLoop
      ? {
          entered: keyLoop.entered ?? null,
          handled: keyLoop.handled ?? null,
          legacy_fallback: keyLoop.legacy_fallback ?? null,
          failed_reason: keyLoop.failed_reason ?? null,
          f8_legacy_backfill: keyLoop.f8_legacy_backfill ?? null,
        }
      : null,
    trace_present: preload != null,
    active_trace_match:
      preload?.mode === "active" &&
      preload?.executed_selective_preload === true &&
      JSON.stringify(preload?.preloads_executed ?? []) === JSON.stringify(expectedPreloads),
  };

  if (!probe.probe_ok) row.verdict = "probe_failed";
  else if (!preload) row.verdict = "missing_key_preload_control";
  else if (preload.mode !== "active") row.verdict = `mode_${preload.mode ?? "unknown"}_not_active`;
  else if (preload.executed_selective_preload !== true) row.verdict = "selective_not_executed";
  else if (JSON.stringify(preload.preloads_executed ?? []) !== JSON.stringify(expectedPreloads))
    row.verdict = "preload_mismatch";
  else row.verdict = "observe_ok";

  return row;
}

async function probeQuestion({ previewBase, token, bypass, question }) {
  const probe = await fetchBypassSse({
    previewBase,
    token,
    question,
    history: [],
    bypassSecret: bypass,
  });

  if (!probe.ok) {
    return {
      probe_ok: false,
      probe_error: probe.unauthorized ? "UNAUTHORIZED" : probe.stderr_preview || `http_${probe.http_status ?? "unknown"}`,
      done: {},
    };
  }

  const events = parseSse(probe.stdout);
  const done = events.find((e) => e.type === "done")?.data ?? {};
  return { probe_ok: true, done };
}

async function main() {
  loadEnvFile(join(ROOT, ".env.local"));
  loadEnvFile(join(ROOT, ".env.preview.pulled"));

  const previewBaseArg = process.argv[2]?.startsWith("http") ? process.argv[2].trim() : "";
  const env = resolveEnv(previewBaseArg);

  if (!env.previewBase || !env.bypass || !env.supabaseUrl || !env.supabaseAnon || !env.email || !env.password) {
    console.log("SKIP — missing PREVIEW_BASE, bypass, Supabase, or QA credentials");
    process.exit(2);
  }

  const { data: auth, error: authError } = await createClient(env.supabaseUrl, env.supabaseAnon, {
    auth: { persistSession: false },
  }).auth.signInWithPassword({ email: env.email, password: env.password });

  if (authError || !auth.session?.access_token) {
    console.log(`SKIP — auth failed: ${authError?.message ?? "no token"}`);
    process.exit(2);
  }

  const token = auth.session.access_token;
  const rows = [];

  for (const item of TOM_THREE_QUESTIONS) {
    const probe = await probeQuestion({
      previewBase: env.previewBase,
      token,
      bypass: env.bypass,
      question: item.question,
    });
    const row = buildRow({ ...item, probe, done: probe.done });
    rows.push(row);
    console.log(
      `${row.verdict === "observe_ok" ? "OBSERVE_OK" : "OBSERVE_FAIL"} ${item.id} ${item.question} verdict=${row.verdict}`,
    );
  }

  const observeOk = rows.filter((r) => r.verdict === "observe_ok").length;
  const report = {
    audit: "key_recovery_03_slice_a_a2_preview_active_trace",
    schema_version: "key-recovery-03-slice-a-a2-preview-trace-v1",
    mode: "preview_observation_only",
    note: "Jerry does not declare PASS. Requires Preview with A2 code + KEY_CHAT_PRELOAD_CONTROL=active.",
    observed_at: new Date().toISOString(),
    preview_base: env.previewBase,
    tom_three_questions: rows,
    summary: {
      observe_ok: observeOk,
      total: rows.length,
      all_active_trace_match: observeOk === rows.length,
      f8_observed: rows.some(
        (r) =>
          r.key_preload_control?.f8_legacy_fallback_backfill?.executed === true ||
          r.key_loop_trace?.f8_legacy_backfill?.executed === true,
      ),
    },
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const md = [
    "# A2 Preview Active Trace — Observation",
    "",
    `Preview: ${env.previewBase}`,
    `Observed: ${report.observed_at}`,
    `Observe OK: ${observeOk}/${rows.length}`,
    "",
    ...rows.map(
      (r) =>
        `## ${r.id} ${r.question}\n- Verdict: ${r.verdict}\n- response_source: ${r.response_source}\n- preload: ${JSON.stringify(r.key_preload_control)}\n- answer: ${r.answer_preview}\n`,
    ),
  ].join("\n");
  writeFileSync(OUT_MD, md, "utf8");

  console.log(`\nWrote ${OUT_JSON}`);
  console.log(`observe_ok=${observeOk}/${rows.length}`);
  process.exit(observeOk === rows.length ? 0 : 1);
}

await main();
