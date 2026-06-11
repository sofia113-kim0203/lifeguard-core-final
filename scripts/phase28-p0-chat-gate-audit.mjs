/**
 * Phase 28 P0 — AI chat gate audit (sandbox customer by default).
 *
 * Server-side pre-check for P0 before real Preview UI sign-off.
 * Does NOT replace Preview real-screen PASS — validates backend chat path.
 *
 * Usage:
 *   SERVICE_ROLE_KEY=... node scripts/phase28-p0-chat-gate-audit.mjs
 *   SUPABASE_ACCESS_TOKEN=... node scripts/phase28-p0-chat-gate-audit.mjs
 *
 * Optional env:
 *   AUDIT_CUSTOMER_ID (default: sandbox test customer)
 *   PHASE28_PREVIEW_BASE (default: PR #72 preview URL)
 *   EXPECTED_POLICY_COUNT (default: 8)
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { handleConversationalQuestionRequest } from "../server/conversationalBackgroundAnalysisCore.js";
import { buildDirectFactualAnswer } from "../server/customerConversationalTone.js";
import { ensureCustomerMemoryContext } from "../server/customerMemoryContextSync.js";
import {
  resolveSandboxCustomerId,
  safeAdminUpdateUserPassword,
} from "./lib/sandboxAuthGuard.js";

const ENV_LOCAL = ".env.local";

function loadEnvLocal() {
  if (!existsSync(ENV_LOCAL)) return;
  for (const line of readFileSync(ENV_LOCAL, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvLocal();

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
let serviceRoleKey = process.env.SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
const CUSTOMER_ID = resolveSandboxCustomerId(process.env.AUDIT_CUSTOMER_ID);
const EXPECTED_POLICY_COUNT = Number(process.env.AUDIT_EXPECTED_POLICY_COUNT ?? "8");
const PREVIEW_BASE =
  process.env.PHASE28_PREVIEW_BASE ??
  "https://lifeguard-core-final-git-curso-721267-70sofia113-1918s-projects.vercel.app";
const QUESTION = "나의 보험 총 건수는?";

async function resolveServiceRoleKey() {
  if (serviceRoleKey) return serviceRoleKey;
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  if (!accessToken) return null;

  const keysRes = await fetch("https://api.supabase.com/v1/projects/fhvlxcguvjvtftttfrix/api-keys", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!keysRes.ok) {
    throw new Error(`supabase_api_keys_failed: ${keysRes.status}`);
  }
  const keys = await keysRes.json();
  return keys.find((k) => k.name === "service_role")?.api_key ?? null;
}

async function probePreviewProtection() {
  try {
    const res = await fetch(PREVIEW_BASE, { method: "GET", redirect: "manual" });
    return { status: res.status, protected: res.status === 401 || res.status === 403 };
  } catch (error) {
    return { status: 0, protected: true, error: error.message };
  }
}

async function tryPreviewApiWithTempLogin(adminSupabase) {
  if (!anonKey) return { skipped: true, reason: "ANON_KEY_MISSING" };
  if (!process.env.SUPABASE_ACCESS_TOKEN) {
    return { skipped: true, reason: "SUPABASE_ACCESS_TOKEN_MISSING" };
  }

  const { data: profile, error: profileError } = await adminSupabase
    .from("customer_profiles")
    .select("user_id, display_name")
    .eq("id", CUSTOMER_ID)
    .maybeSingle();

  if (profileError || !profile?.user_id) {
    return { skipped: true, reason: "PROFILE_LOOKUP_FAILED", detail: profileError?.message };
  }

  const { data: userRow } = await adminSupabase
    .from("users")
    .select("email")
    .eq("id", profile.user_id)
    .maybeSingle();

  if (!userRow?.email) {
    return { skipped: true, reason: "USER_EMAIL_MISSING" };
  }

  const tempPassword = `Phase28P0!${Date.now()}`;
  try {
    await safeAdminUpdateUserPassword(adminSupabase, {
      userId: profile.user_id,
      email: userRow.email,
      customerId: CUSTOMER_ID,
      password: tempPassword,
    });
  } catch (updateError) {
    return {
      skipped: true,
      reason: "PASSWORD_RESET_FAILED",
      detail: updateError instanceof Error ? updateError.message : String(updateError),
    };
  }

  const userClient = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data: signIn, error: signInError } = await userClient.auth.signInWithPassword({
    email: userRow.email,
    password: tempPassword,
  });
  if (signInError || !signIn?.session?.access_token) {
    return { skipped: true, reason: "SIGN_IN_FAILED", detail: signInError?.message };
  }

  const startedAt = Date.now();
  const res = await fetch(`${PREVIEW_BASE}/api/customer-conversational-qa`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${signIn.session.access_token}`,
    },
    body: JSON.stringify({ question: QUESTION, auto_process: false }),
  });
  const body = await res.json().catch(() => ({}));

  return {
    skipped: false,
    status: res.status,
    ok: body.ok === true,
    protected: res.status === 401 || res.status === 403,
    roundtrip_ms: Date.now() - startedAt,
    initial_response_time_ms: body.initial_response_time_ms ?? null,
    fast_response_preview: String(body.fast_response ?? "").slice(0, 220),
    analysis_job_id: body.analysis_job_id ?? null,
    error_message: body.error_message ?? null,
  };
}

serviceRoleKey = await resolveServiceRoleKey();

const report = {
  phase: "28-P0",
  customer_id: CUSTOMER_ID,
  question: QUESTION,
  expected_policy_count: EXPECTED_POLICY_COUNT,
  preview_base: PREVIEW_BASE,
  env: {
    supabase_url: Boolean(url),
    service_role: Boolean(serviceRoleKey),
    anon_key: Boolean(anonKey),
    supabase_access_token: Boolean(process.env.SUPABASE_ACCESS_TOKEN),
  },
  preview_protection: await probePreviewProtection(),
  server_chat: null,
  conversation_rows: null,
  preview_api: null,
  ui_pass: false,
  pass: false,
};

if (!url || !serviceRoleKey) {
  console.log(JSON.stringify(report, null, 2));
  console.error(
    "\nMissing SUPABASE_URL or SERVICE_ROLE_KEY (or SUPABASE_ACCESS_TOKEN to fetch service role).",
  );
  console.error("Add SERVICE_ROLE_KEY to .env.local for local P0 server audit.\n");
  process.exit(1);
}

const adminSupabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

const { data: profileRow } = await adminSupabase
  .from("customer_profiles")
  .select("id, display_name, user_id")
  .eq("id", CUSTOMER_ID)
  .maybeSingle();

assert.ok(profileRow, `customer profile not found: ${CUSTOMER_ID}`);
console.log(`Customer: ${profileRow.display_name ?? "(unknown)"} (${CUSTOMER_ID})`);

const memoryContext = await ensureCustomerMemoryContext({ supabase: adminSupabase, customerId: CUSTOMER_ID });
const directAnswer = buildDirectFactualAnswer(QUESTION, {
  snapshot: memoryContext.snapshot,
  sourceContext: memoryContext.sourceContext,
  sourceSummary: memoryContext.sourceSummary,
});

assert.match(
  directAnswer ?? "",
  new RegExp(`총\\s*${EXPECTED_POLICY_COUNT}\\s*건`),
  `direct factual answer mismatch: ${directAnswer}`,
);

const conversationalResult = await handleConversationalQuestionRequest({
  question: QUESTION,
  testCustomerId: CUSTOMER_ID,
  adminSupabase,
  autoProcess: false,
});

assert.equal(conversationalResult.ok, true, JSON.stringify(conversationalResult));
assert.ok(
  String(conversationalResult.fast_response ?? "").includes(String(EXPECTED_POLICY_COUNT)),
  `fast_response missing ${EXPECTED_POLICY_COUNT}: ${conversationalResult.fast_response}`,
);
assert.ok(
  (conversationalResult.initial_response_time_ms ?? 0) < 8000,
  `initial response too slow: ${conversationalResult.initial_response_time_ms}ms`,
);

const { data: conversationRows, error: conversationError } = await adminSupabase
  .from("customer_conversations")
  .select("id, role, message, created_at")
  .eq("customer_id", CUSTOMER_ID)
  .order("created_at", { ascending: false })
  .limit(4);

if (conversationError) {
  throw new Error(`conversation_lookup_failed: ${conversationError.message}`);
}

const latestUser = (conversationRows ?? []).find((row) => row.role === "user");
assert.ok(latestUser?.message?.includes("보험 총 건수"), "latest user conversation row missing");

report.server_chat = {
  pass: true,
  direct_answer: directAnswer,
  initial_response_time_ms: conversationalResult.initial_response_time_ms,
  fast_response_preview: String(conversationalResult.fast_response ?? "").slice(0, 220),
  analysis_job_id: conversationalResult.analysis_job_id,
};
report.conversation_rows = {
  pass: true,
  latest_count: conversationRows?.length ?? 0,
  latest_user_message: latestUser?.message ?? null,
};

report.preview_api = await tryPreviewApiWithTempLogin(adminSupabase);

report.ui_pass = false;
report.pass = report.server_chat.pass && report.conversation_rows.pass;

console.log(JSON.stringify(report, null, 2));

if (!report.pass) {
  process.exit(1);
}

console.log(
  "\n✅ Phase 28 P0 server chat gate PASSED (backend path).\n" +
    "⚠️  Real-screen Preview PASS still required for P0 sign-off.\n",
);
