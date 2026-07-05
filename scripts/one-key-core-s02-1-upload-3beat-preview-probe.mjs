/**
 * ONE KEY Core S02-1 — Upload 3-beat Preview observation (document Core · analysis/return legacy).
 *
 * Usage:
 *   node scripts/one-key-core-s02-1-upload-3beat-preview-probe.mjs [preview-url]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { resolveBypassSecret } from "./p10-5-preview-curl-helper.mjs";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "fixtures/key-judgment-validation-v1/one-key-core-s02-1-upload-3beat-preview-evidence.json");

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

async function mintToken(resolved) {
  const { data: auth, error } = await createClient(resolved.supabaseUrl, resolved.supabaseAnon, {
    auth: { persistSession: false },
  }).auth.signInWithPassword({ email: resolved.email, password: resolved.password });
  if (error || !auth.session?.access_token) throw new Error(`auth: ${error?.message ?? "no token"}`);
  return auth.session.access_token;
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
    body: { last_event: "s02_1_upload_3beat_probe" },
  });
  const documents = unified.payload?.unified_state?.documents ?? [];
  const sorted = [...documents].sort(
    (a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime(),
  );
  return sorted[0]?.id ?? null;
}

async function main() {
  loadEnvFile(join(ROOT, ".env.local"));
  loadEnvFile(join(ROOT, ".env.preview.pulled"));
  const previewBaseArg = process.argv[2]?.startsWith("http") ? process.argv[2].trim() : "";
  const env = resolveEnv(previewBaseArg);

  if (!env.previewBase || !env.bypass || !env.supabaseUrl || !env.email || !env.password) {
    console.log("BLOCKED — PREVIEW_BASE, bypass, Supabase, QA creds required");
    process.exit(2);
  }

  const token = await mintToken(env);
  const report = {
    schema_version: "one-key-core-s02-1-upload-3beat-preview-v1",
    pass_declaration: "none",
    observed_at: new Date().toISOString(),
    preview_base: env.previewBase,
    beats: [],
  };

  const documentId = await resolveLatestDocumentId({ previewBase: env.previewBase, token, bypass: env.bypass });

  if (documentId) {
    const docProbe = await postJson({
      previewBase: env.previewBase,
      token,
      bypass: env.bypass,
      path: "/api/key-document-intake",
      body: { document_id: documentId, upload_source: "s02_1_probe" },
    });
    const coreSteps = docProbe.payload?.intake_trace?.one_key_core_trace?.steps?.map((r) => r.step) ?? [];
    report.beats.push({
      beat: "document",
      path: "/api/key-document-intake",
      core_route: docProbe.payload?.response_source === "one_key_core_document" ? "one_key_core" : "legacy",
      response_source: docProbe.payload?.response_source ?? null,
      work_order_id: docProbe.payload?.work_order_id ?? null,
      customer_first_sentence_preview: String(docProbe.payload?.customer_first_sentence ?? "").slice(0, 240),
      core_steps: coreSteps,
      probe_ok: docProbe.ok,
    });
  } else {
    report.beats.push({
      beat: "document",
      probe_ok: false,
      probe_error: "no_document_id_for_probe",
      core_route: "unknown",
    });
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
    report.beats.push({
      beat: "analysis_complete",
      path: "/api/key-analysis-complete-intake",
      core_route: acProbe.payload?.response_source === "one_key_core_document" ? "one_key_core" : "legacy",
      response_source: acProbe.payload?.response_source ?? acProbe.payload?.intake_trace?.response_source ?? null,
      probe_ok: acProbe.ok,
      note: "S02-2 not started — expected legacy unless flag extended",
    });
  } else {
    report.beats.push({
      beat: "analysis_complete",
      probe_ok: false,
      probe_error: "no_completed_job",
      core_route: "legacy_expected",
    });
  }

  const returnProbe = await postJson({
    previewBase: env.previewBase,
    token,
    bypass: env.bypass,
    path: "/api/key-return-judgment-intake",
    body: { mode: "probe" },
  });
  report.beats.push({
    beat: "return_judgment",
    path: "/api/key-return-judgment-intake",
    core_route:
      returnProbe.payload?.response_source?.startsWith("one_key_core") ? "one_key_core" : "legacy",
    response_source: returnProbe.payload?.response_source ?? null,
    probe_ok: returnProbe.ok,
    probe_error: returnProbe.ok ? null : returnProbe.payload?.reason ?? `http_${returnProbe.status}`,
    note: "S02-4 not started — expected legacy",
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
