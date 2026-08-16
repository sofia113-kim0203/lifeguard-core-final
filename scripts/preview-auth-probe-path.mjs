/**
 * INFRA-PREVIEW-AUTH-PATH-v1 — SSOT Preview probe auth path.
 * Extracted from key-customer-validation-v1-preview-verify.mjs (Tom SSOT).
 *
 * Forbidden: PRODUCTION_PROBE_*, Management API anon fetch, plain fetch without bypass.
 */
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { fetchBypassSse, parseSse, resolveBypassSecret } from "./p10-5-preview-curl-helper.mjs";
import { refFromSupabaseUrl } from "../server/supabaseKeyFingerprint.js";

export const PREVIEW_AUTH_SSOT = "key-customer-validation-v1-preview-verify.mjs";

export function loadPreviewProbeEnvFile(envPath) {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

export function resolvePreviewProbeEnv({
  previewBase = "",
  env = process.env,
} = {}) {
  const base = String(previewBase || env.PREVIEW_BASE || "").replace(/\/$/, "");
  const bypass = resolveBypassSecret(env);
  const supabaseUrl = String(env.VITE_SUPABASE_URL ?? env.SUPABASE_URL ?? "").trim();
  const supabaseAnon = String(env.VITE_SUPABASE_ANON_KEY ?? env.SUPABASE_ANON_KEY ?? "").trim();
  const email = String(env.QA_EMAIL ?? env.QA_TEST_EMAIL ?? "").trim();
  const password = String(env.QA_PASSWORD ?? env.QA_TEST_PASSWORD ?? "").trim();

  return {
    previewBase: base,
    bypass,
    supabaseUrl,
    supabaseAnon,
    email,
    password,
  };
}

export function assertPreviewProbeEnvReady(resolved) {
  const missing = [];
  if (!resolved.previewBase) missing.push("previewBase");
  if (!resolved.bypass) missing.push("VERCEL_AUTOMATION_BYPASS_SECRET");
  if (!resolved.supabaseUrl) missing.push("VITE_SUPABASE_URL|SUPABASE_URL");
  if (!resolved.supabaseAnon) missing.push("VITE_SUPABASE_ANON_KEY|SUPABASE_ANON_KEY");
  if (!resolved.email) missing.push("QA_EMAIL|QA_TEST_EMAIL");
  if (!resolved.password) missing.push("QA_PASSWORD|QA_TEST_PASSWORD");
  if (missing.length) {
    const err = new Error(`BLOCKED — missing Preview probe env: ${missing.join(", ")}`);
    err.code = "PREVIEW_PROBE_ENV_BLOCKED";
    throw err;
  }
}

export function previewAuthPathFingerprint(resolved) {
  const email = resolved.email ?? "";
  const at = email.indexOf("@");
  return {
    ssot: PREVIEW_AUTH_SSOT,
    method: "fetch + x-vercel-protection-bypass + QA JWT",
    supabase_url_ref: refFromSupabaseUrl(resolved.supabaseUrl ?? ""),
    supabase_url_source: process.env.VITE_SUPABASE_URL ? "VITE_SUPABASE_URL" : "SUPABASE_URL",
    anon_key_len: (resolved.supabaseAnon ?? "").length,
    bypass_set: Boolean(resolved.bypass),
    qa_email_domain: at > 0 ? email.slice(at + 1) : null,
    forbidden_paths: {
      production_probe_creds: false,
      management_api_anon: false,
      plain_fetch_no_bypass: false,
    },
  };
}

export async function mintPreviewProbeJwt(resolved) {
  assertPreviewProbeEnvReady(resolved);
  const { data: auth, error: authError } = await createClient(
    resolved.supabaseUrl,
    resolved.supabaseAnon,
    { auth: { persistSession: false } },
  ).auth.signInWithPassword({
    email: resolved.email,
    password: resolved.password,
  });
  if (authError || !auth.session?.access_token) {
    const err = new Error(`BLOCKED — auth failed: ${authError?.message ?? "no token"}`);
    err.code = "PREVIEW_PROBE_AUTH_FAILED";
    throw err;
  }
  return auth.session.access_token;
}

/** SSOT — compose trace: finalize_trace primary, p10_4 fallback. */
export function resolveJudgmentComposeMode(done = {}) {
  const trace = done.sales_director_trace ?? done.salesDirectorTrace ?? {};
  const keyPath = trace.p10_4_key_path_trace ?? {};
  return (
    trace.finalize_trace?.key_compose_trace?.compose_mode ??
    keyPath.build_key_structured_response?.compose_mode ??
    trace.tool_brain_absorbed?.compose_mode ??
    null
  );
}

export function resolveKeyComposeConversationPatternId(done = {}) {
  const trace = done.sales_director_trace ?? done.salesDirectorTrace ?? {};
  const keyPath = trace.p10_4_key_path_trace ?? {};
  return (
    trace.finalize_trace?.key_compose_trace?.conversation_pattern_id ??
    keyPath.build_key_structured_response?.conversation_pattern_id ??
    null
  );
}

export async function probePreviewSse({
  previewBase,
  question,
  history = [],
  threadPublicCitations = null,
  threadVerifiedFactRefs = null,
  threadHandoffMemo = null,
  sessionId = null,
  presence = false,
  token,
  bypassSecret = null,
  env = process.env,
}) {
  const bypass = bypassSecret ?? resolveBypassSecret(env);
  const probe = await fetchBypassSse({
    previewBase,
    token,
    question,
    history,
    threadPublicCitations,
    threadVerifiedFactRefs,
    threadHandoffMemo,
    sessionId,
    presence,
    bypassSecret: bypass,
    env,
  });

  if (!probe.ok) {
    return {
      probe_ok: false,
      probe_error: probe.unauthorized ? "UNAUTHORIZED" : probe.stderr_preview || `http_${probe.http_status ?? "unknown"}`,
      http_status: probe.http_status,
      unauthorized: probe.unauthorized === true,
      raw_snippet: (probe.stdout ?? "").slice(0, 240),
      method: probe.method,
    };
  }

  const events = parseSse(probe.stdout);
  const done = events.find((e) => e.type === "done")?.data ?? {};
  return {
    probe_ok: true,
    http_status: 200,
    method: probe.method,
    events,
    done,
  };
}
