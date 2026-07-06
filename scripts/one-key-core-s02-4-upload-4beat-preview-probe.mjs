/**
 * ONE KEY Core S02-4 — 4-beat matrix (question + document + analysis_complete + return_judgment).
 *
 * Usage:
 *   node scripts/one-key-core-s02-4-upload-4beat-preview-probe.mjs [preview-url]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { jobHasPanelResults } from "../server/keyBrain/returnJudgmentFirstSpeak.js";
import {
  fetchLatestCompletedJob,
  patchAnalysisJobForConn002,
  resolveServiceRoleClient,
} from "./lib/conn-002-qa-gap-seed-payload.mjs";
import { fetchBypassSse, parseSse, resolveBypassSecret } from "./p10-5-preview-curl-helper.mjs";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "fixtures/key-judgment-validation-v1/one-key-core-s02-4-upload-4beat-preview-evidence.json");
const GAP_SIMULATION_HOURS = 73;

function loadEnvFile(path, { forceKeys = [] } = {}) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key] || forceKeys.includes(key)) process.env[key] = value;
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

async function mintToken(resolved) {
  const { data: auth, error } = await createClient(resolved.supabaseUrl, resolved.supabaseAnon, {
    auth: { persistSession: false },
  }).auth.signInWithPassword({ email: resolved.email, password: resolved.password });
  if (error || !auth.session?.access_token) throw new Error(`auth: ${error?.message ?? "no token"}`);
  return { token: auth.session.access_token, userId: auth.user?.id ?? null };
}

async function resolveCustomerId(supabaseUrl, supabaseAnon, token, userId) {
  const client = createClient(supabaseUrl, supabaseAnon, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: profile } = await client
    .from("customer_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  return profile?.id ?? null;
}

async function postJson({ previewBase, token, bypass, path, body }) {
  const res = await fetch(`${previewBase}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-vercel-protection-bypass": bypass,
    },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok && payload?.ok !== false, payload };
}

async function resolveLatestDocumentId({ previewBase, token, bypass }) {
  const unified = await postJson({
    previewBase,
    token,
    bypass,
    path: "/api/customer-unified-state",
    body: { last_event: "s02_4_upload_4beat_probe" },
  });
  const documents = unified.payload?.unified_state?.documents ?? [];
  const sorted = [...documents].sort(
    (a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime(),
  );
  return sorted[0]?.id ?? null;
}

function isCoreSource(source, event) {
  if (event === "question") return source === "one_key_core_s1";
  if (event === "document") return source === "one_key_core_document";
  if (event === "analysis_complete") return source === "one_key_core_analysis_complete";
  if (event === "return_judgment") return source === "one_key_core_return_judgment";
  return source?.startsWith("one_key_core") ?? false;
}

function futureTransitionObservedAt(lastActivityIso, hoursAhead = GAP_SIMULATION_HOURS) {
  const baseMs = new Date(lastActivityIso).getTime();
  return new Date(baseMs + hoursAhead * 60 * 60 * 1000).toISOString();
}

async function seedReturnJudgmentProbeSession({ dbClient, customerId, anchorJobId }) {
  const sessionId = `s024-rj-probe-${Date.now()}`;
  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  const nineDaysAgo = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString();
  const rows = [
    {
      customer_id: customerId,
      role: "assistant",
      message: "S02-4 probe prior key presence",
      metadata_json: {
        session_id: sessionId,
        key_presence: true,
        key_presence_source: "analysis_complete",
        anchor_job_id: anchorJobId,
        phase: "lifeguard-home-chat",
        source: "lifeguard_home_chat",
      },
      created_at: tenDaysAgo,
    },
    {
      customer_id: customerId,
      role: "assistant",
      message: "지난번 같이 보던 기준이에요.",
      metadata_json: {
        session_id: sessionId,
        key_presence: true,
        key_presence_source: "key_bridge",
        anchor_job_id: anchorJobId,
        phase: "lifeguard-home-chat",
        source: "lifeguard_home_chat",
      },
      created_at: nineDaysAgo,
    },
  ];

  const { error } = await dbClient.from("customer_conversations").insert(rows);
  if (error) throw new Error(error.message ?? "seed_insert_failed");

  const transitionObservedAt = futureTransitionObservedAt(nineDaysAgo, GAP_SIMULATION_HOURS);
  return { sessionId, transitionObservedAt, lastActivityAt: nineDaysAgo, gapHours: GAP_SIMULATION_HOURS };
}

function buildQaDbClient(supabaseUrl, supabaseAnon, token) {
  return createClient(supabaseUrl, supabaseAnon, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

async function main() {
  loadEnvFile(join(ROOT, ".env.local"), {
    forceKeys: ["SUPABASE_SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY", "VERCEL_AUTOMATION_BYPASS_SECRET"],
  });
  loadEnvFile(join(ROOT, ".env.preview.pulled"));
  const previewBaseArg = process.argv[2]?.startsWith("http") ? process.argv[2].trim() : "";
  const env = resolveEnv(previewBaseArg);

  if (!env.previewBase || !env.bypass || !env.supabaseUrl || !env.email || !env.password) {
    console.log("BLOCKED — PREVIEW_BASE, bypass, Supabase, QA creds required");
    process.exit(2);
  }

  const { token, userId } = await mintToken(env);
  const customerId = await resolveCustomerId(env.supabaseUrl, env.supabaseAnon, token, userId);
  if (!customerId) {
    console.log("BLOCKED — customer profile missing");
    process.exit(2);
  }

  const report = {
    schema_version: "one-key-core-s02-4-upload-4beat-preview-v1",
    pass_declaration: "none",
    observed_at: new Date().toISOString(),
    preview_base: env.previewBase,
    beats: [],
  };

  const questionSse = await fetchBypassSse({
    previewBase: env.previewBase,
    token,
    question: "S02-4 4-beat probe — 내 보험 괜찮아?",
    history: [],
    bypassSecret: env.bypass,
  });
  const done = parseSse(questionSse.stdout).find((e) => e.type === "done")?.data ?? {};
  const qSource = done.response_source ?? done.agent ?? null;
  report.beats.push({
    beat: "question",
    core_route: isCoreSource(qSource, "question") ? "one_key_core" : "legacy",
    response_source: qSource,
    probe_ok: questionSse.ok && isCoreSource(qSource, "question"),
  });

  const documentId = await resolveLatestDocumentId({ previewBase: env.previewBase, token, bypass: env.bypass });
  if (documentId) {
    const docProbe = await postJson({
      previewBase: env.previewBase,
      token,
      bypass: env.bypass,
      path: "/api/key-document-intake",
      body: { document_id: documentId, upload_source: "s02_4_probe" },
    });
    const source = docProbe.payload?.response_source ?? null;
    report.beats.push({
      beat: "document",
      core_route: isCoreSource(source, "document") ? "one_key_core" : "legacy",
      response_source: source,
      work_order_id: docProbe.payload?.work_order_id ?? null,
      probe_ok: docProbe.ok && isCoreSource(source, "document"),
    });
  } else {
    report.beats.push({ beat: "document", probe_ok: false, core_route: "unknown" });
  }

  const latestJob = await postJson({
    previewBase: env.previewBase,
    token,
    bypass: env.bypass,
    path: "/api/customer-analysis-job",
    body: { mode: "latest" },
  });
  const jobId = latestJob.payload?.analysis_job?.id ?? null;

  if (jobId) {
    const acProbe = await postJson({
      previewBase: env.previewBase,
      token,
      bypass: env.bypass,
      path: "/api/key-analysis-complete-intake",
      body: { job_id: jobId },
    });
    const source = acProbe.payload?.response_source ?? acProbe.payload?.intake_trace?.response_source ?? null;
    report.beats.push({
      beat: "analysis_complete",
      core_route: isCoreSource(source, "analysis_complete") ? "one_key_core" : "legacy",
      response_source: source,
      work_order_id: acProbe.payload?.work_order_id ?? null,
      probe_ok: acProbe.ok && isCoreSource(source, "analysis_complete"),
    });
  } else {
    report.beats.push({ beat: "analysis_complete", probe_ok: false, core_route: "unknown" });
  }

  const gateSkipProbe = await postJson({
    previewBase: env.previewBase,
    token,
    bypass: env.bypass,
    path: "/api/key-return-judgment-intake",
    body: { mode: "probe" },
  });
  const gateSkipCoreEntered = Boolean(gateSkipProbe.payload?.response_source);
  report.beats.push({
    beat: "return_judgment_gate_skip",
    core_route: gateSkipCoreEntered ? "unexpected_core" : "core_not_entered",
    response_source: gateSkipProbe.payload?.response_source ?? null,
    http_status: gateSkipProbe.status,
    return_judgment_skipped: gateSkipProbe.payload?.return_judgment_skipped === true,
    skip_reasons: gateSkipProbe.payload?.skip_reasons ?? [],
    probe_ok: !gateSkipCoreEntered && gateSkipProbe.status === 422,
    note: "no session_id — Core not entered",
  });

  let returnSeed = null;
  let returnCoreProbe = null;
  let returnProbeError = null;
  try {
    const qaDbClient = buildQaDbClient(env.supabaseUrl, env.supabaseAnon, token);
    let anchorJob = null;
    try {
      const serviceClient = resolveServiceRoleClient(createClient, {
        loadEnvFileFn: loadEnvFile,
        root: ROOT,
      });
      anchorJob = await fetchLatestCompletedJob(serviceClient, customerId);
      if (anchorJob?.id && !jobHasPanelResults(anchorJob)) {
        await patchAnalysisJobForConn002(serviceClient, { jobId: anchorJob.id, customerId });
        anchorJob = await fetchLatestCompletedJob(serviceClient, customerId);
      }
    } catch {
      const latestJobProbe = await postJson({
        previewBase: env.previewBase,
        token,
        bypass: env.bypass,
        path: "/api/customer-analysis-job",
        body: { mode: "latest" },
      });
      anchorJob = latestJobProbe.payload?.analysis_job ?? null;
    }
    if (!anchorJob?.id) throw new Error("anchor_job_missing");
    if (!jobHasPanelResults(anchorJob)) throw new Error("anchor_job_no_panels");

    returnSeed = await seedReturnJudgmentProbeSession({
      dbClient: qaDbClient,
      customerId,
      anchorJobId: anchorJob.id,
    });
    returnCoreProbe = await postJson({
      previewBase: env.previewBase,
      token,
      bypass: env.bypass,
      path: "/api/key-return-judgment-intake",
      body: {
        session_id: returnSeed.sessionId,
        anchor_job_id: anchorJob.id,
        transition_observed_at: returnSeed.transitionObservedAt,
      },
    });
  } catch (error) {
    returnProbeError = error instanceof Error ? error.message : String(error);
    returnCoreProbe = {
      ok: false,
      status: null,
      payload: { ok: false, reason: returnProbeError },
    };
  }

  const rSource = returnCoreProbe?.payload?.response_source ?? null;
  const woStep = returnCoreProbe?.payload?.intake_trace?.one_key_core_trace?.steps?.find(
    (r) => r.step === "work_order",
  );
  const sentence = returnCoreProbe?.payload?.return_judgment_sentence ?? null;
  const intakeSentence = returnCoreProbe?.payload?.intake_trace?.return_judgment_sentence ?? null;
  report.beats.push({
    beat: "return_judgment",
    core_route: isCoreSource(rSource, "return_judgment")
      ? "one_key_core"
      : returnCoreProbe?.payload?.return_judgment_skipped
        ? "gate_skipped"
        : "legacy_or_error",
    response_source: rSource,
    work_order_id: returnCoreProbe?.payload?.work_order_id ?? null,
    work_order_shadow_only: woStep?.payload?.shadow_only ?? null,
    return_judgment_skipped: returnCoreProbe?.payload?.return_judgment_skipped === true,
    skip_reasons: returnCoreProbe?.payload?.skip_reasons ?? [],
    return_judgment_sentence_preview: String(sentence ?? "").slice(0, 240),
    intake_sentence_matches_api:
      sentence && intakeSentence ? sentence === intakeSentence : sentence === intakeSentence,
    conn_002_panel_wired: returnCoreProbe?.payload?.intake_trace?.conn_002_panel_wired === true,
    conn_003_panel_wired: returnCoreProbe?.payload?.intake_trace?.conn_003_panel_wired === true,
    conn_004_weave_wired: returnCoreProbe?.payload?.intake_trace?.conn_004_weave_wired === true,
    conn_005_continuity_weave_wired:
      returnCoreProbe?.payload?.intake_trace?.conn_005_continuity_weave_wired === true,
    core_steps:
      returnCoreProbe?.payload?.intake_trace?.one_key_core_trace?.steps?.map((r) => r.step) ?? [],
    gap_simulation: returnSeed,
    probe_error: returnProbeError,
    probe_ok:
      returnCoreProbe?.ok === true &&
      isCoreSource(rSource, "return_judgment") &&
      returnCoreProbe?.payload?.work_order_id == null,
  });

  mkdirSync(join(ROOT, "fixtures/key-judgment-validation-v1"), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);

  for (const beat of report.beats) {
    console.log(
      `${beat.probe_ok ? "OBSERVE" : "SKIP"} beat=${beat.beat} core_route=${beat.core_route ?? "unknown"} source=${beat.response_source ?? "null"}`,
    );
  }
  console.log(`Wrote ${OUT}`);
  process.exit(0);
}

await main();
