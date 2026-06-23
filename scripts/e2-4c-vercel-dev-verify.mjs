/**
 * E-2-4C — vercel dev Supabase gate verification (no secret output).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = String(process.env.PREVIEW_BASE ?? "http://localhost:3000").replace(/\/$/, "");

function parseEnvFile(envPath) {
  const out = {};
  if (!fs.existsSync(envPath)) return out;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    out[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return out;
}

function pickReason(body) {
  if (!body || typeof body !== "object") return null;
  return body.reason ?? body.error_message ?? null;
}

function deepHasReason(obj, target, seen = new Set()) {
  if (!obj || typeof obj !== "object" || seen.has(obj)) return false;
  seen.add(obj);
  if (obj.reason === target) return true;
  for (const value of Object.values(obj)) {
    if (typeof value === "string" && value === target) return true;
    if (value && typeof value === "object" && deepHasReason(value, target, seen)) return true;
  }
  return false;
}

async function waitForDev(maxMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(BASE, { method: "GET", redirect: "manual" });
      if (res.status >= 200 && res.status < 500) return true;
    } catch {
      // not ready
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

async function postApi(token, apiPath, body = {}) {
  const res = await fetch(`${BASE}${apiPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  return { status: res.status, payload };
}

async function main() {
  const env = parseEnvFile(path.join(ROOT, ".env.local"));
  const url = env.VITE_SUPABASE_URL ?? env.SUPABASE_URL ?? "";
  const anon = env.VITE_SUPABASE_ANON_KEY ?? env.SUPABASE_ANON_KEY ?? "";
  const email = String(env.QA_EMAIL ?? "").trim();
  const password = String(env.QA_PASSWORD ?? "").trim();

  if (!url || !anon || !email || !password) {
    throw new Error("setup_missing:supabase_or_qa_creds");
  }

  const ready = await waitForDev();
  if (!ready) throw new Error("vercel_dev_not_ready");

  const authClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await authClient.auth.signInWithPassword({ email, password });
  if (signIn.error || !signIn.data.session?.access_token) {
    throw new Error(`auth_failed:${signIn.error?.message ?? "no_session"}`);
  }
  const token = signIn.data.session.access_token;

  const unified = await postApi(token, "/api/customer-unified-state", {});
  const brain = await postApi(token, "/api/customer-home-brain-fact", {
    question: "보험료 너무 비싼가?",
    history: [],
  });

  const unifiedReason = pickReason(unified.payload);
  const brainReason = pickReason(brain.payload);
  const customerId =
    unified.payload?.unified?.customer_id ??
    unified.payload?.customer_id ??
    brain.payload?.customer_id ??
    null;

  const supabaseNotConfigured =
    unifiedReason === "SUPABASE_NOT_CONFIGURED" ||
    brainReason === "SUPABASE_NOT_CONFIGURED" ||
    deepHasReason(unified.payload, "SUPABASE_NOT_CONFIGURED") ||
    deepHasReason(brain.payload, "SUPABASE_NOT_CONFIGURED");

  const profileNotFound =
    unifiedReason === "CUSTOMER_PROFILE_NOT_FOUND" ||
    brainReason === "CUSTOMER_PROFILE_NOT_FOUND" ||
    deepHasReason(unified.payload, "CUSTOMER_PROFILE_NOT_FOUND") ||
    deepHasReason(brain.payload, "CUSTOMER_PROFILE_NOT_FOUND");

  const anthropicNotConfigured =
    unifiedReason === "ANTHROPIC_NOT_CONFIGURED" ||
    brainReason === "ANTHROPIC_NOT_CONFIGURED" ||
    deepHasReason(unified.payload, "ANTHROPIC_NOT_CONFIGURED") ||
    deepHasReason(brain.payload, "ANTHROPIC_NOT_CONFIGURED");

  console.log(`E2-4C_BASE=${BASE}`);
  console.log(`E2-4C_UNIFIED status=${unified.status} ok=${Boolean(unified.payload?.ok)} reason=${unifiedReason ?? "null"} error_message=${unified.payload?.error_message ?? "null"}`);
  console.log(`E2-4C_BRAIN status=${brain.status} ok=${Boolean(brain.payload?.ok)} reason=${brainReason ?? "null"} error_message=${brain.payload?.error_message ?? "null"}`);
  console.log(`E2-4C_SUPABASE_NOT_CONFIGURED=${supabaseNotConfigured}`);
  console.log(`E2-4C_CUSTOMER_PROFILE_NOT_FOUND=${profileNotFound}`);
  console.log(`E2-4C_ANTHROPIC_NOT_CONFIGURED=${anthropicNotConfigured}`);
  console.log(`E2-4C_CUSTOMER_ID=${customerId ?? "null"}`);
  console.log("E2-4C_SECRET_POLICY no_jwt_no_password_logged=true");

  const gateOk =
    !supabaseNotConfigured &&
    !profileNotFound &&
    unified.status === 200 &&
    brain.status === 200 &&
    unified.payload?.ok === true &&
    brain.payload?.ok === true;

  console.log(`E2-4C_STATUS=${gateOk ? "ok" : "failed"}`);
  if (!gateOk) process.exit(1);
}

main().catch((error) => {
  console.error("E2-4C_FATAL", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
