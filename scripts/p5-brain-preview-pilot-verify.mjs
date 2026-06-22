/**
 * P5-BRAIN FIX — preview/live API verification (reads credentials from env only; no stdout secrets).
 *
 * Usage:
 *   PREVIEW_BASE=https://... QA_TEST_EMAIL=... QA_TEST_PASSWORD=... node scripts/p5-brain-preview-pilot-verify.mjs
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const PREVIEW_BASE = String(process.env.PREVIEW_BASE ?? "").replace(/\/$/, "");
const QA_EMAIL = String(process.env.QA_TEST_EMAIL ?? process.env.CUSTOMER_QA_EMAIL ?? "").trim();
const QA_PASSWORD = String(process.env.QA_TEST_PASSWORD ?? process.env.CUSTOMER_QA_PASSWORD ?? "").trim();

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

loadEnvFile(".env.local");

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
const supabaseAnon = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
const previewBase = PREVIEW_BASE || String(process.env.PREVIEW_URL ?? "").replace(/\/$/, "");
const email = QA_EMAIL || String(process.env.QA_TEST_EMAIL ?? "").trim();
const password = QA_PASSWORD || String(process.env.QA_TEST_PASSWORD ?? "").trim();

if (!previewBase || !supabaseUrl || !supabaseAnon || !email || !password) {
  console.log("SKIP preview pilot verify — missing PREVIEW_BASE, Supabase env, or QA credentials");
  process.exit(0);
}

const supabase = createClient(supabaseUrl, supabaseAnon, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PILOTS = [
  {
    label: "premium_burden",
    question: "보험료 비싼가",
    history: [],
    allowedSources: ["p5_brain_customer_state", "p5_brain_state_guarded"],
    forbidden: /얼마 내시|318,683|4건/,
  },
  {
    label: "document_cancer",
    question: "내 문서에 암 관련 내용 있어?",
    history: [],
    allowedSources: ["p5_brain_customer_state", "p5_brain_state_guarded"],
    forbidden: /318,683|4건|\d+\s*건/,
  },
  {
    label: "continue_conversation",
    question: "지난번 대화 이어서 하자",
    history: [
      { role: "user", content: "보험료 너무 비싼가?" },
      { role: "assistant", content: "총 보험료는 검증이 필요해요." },
    ],
    allowedSources: ["p5_brain_customer_state", "p5_brain_state_guarded"],
    forbidden: /기억하지 못|무슨 이야기|얼마 내시/,
  },
  {
    label: "insurance_analysis",
    question: "내 보험 분석해줘",
    history: [],
    allowedSources: ["p5_brain_customer_state", "p5_brain_state_guarded"],
    forbidden: /318,683|4건|\d+\s*건/,
  },
];

async function signIn() {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session?.access_token) {
    throw new Error(`sign_in_failed: ${error?.message ?? "no session"}`);
  }
  return data.session.access_token;
}

async function callPilot(token, pilot) {
  const response = await fetch(`${previewBase}/api/customer-home-brain-fact`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      question: pilot.question,
      history: pilot.history,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

async function loadUnifiedFlags(token) {
  const response = await fetch(`${previewBase}/api/customer-unified-state`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({}),
  });
  const payload = await response.json().catch(() => ({}));
  const unified = payload?.unified_state ?? {};
  return {
    ok: payload?.ok === true,
    policyCount: unified?.policy_count ?? unified?.policies?.length ?? 0,
    documentCount: unified?.document_count ?? unified?.documents?.length ?? 0,
  };
}

async function main() {
  console.log(`p5-brain-preview-pilot-verify base=${previewBase}`);
  const token = await signIn();
  const unifiedFlags = await loadUnifiedFlags(token);
  console.log(
    `unified JWT sidebar flags policies=${unifiedFlags.policyCount} documents=${unifiedFlags.documentCount}`,
  );

  let failed = 0;
  for (const pilot of PILOTS) {
    const { status, payload } = await callPilot(token, pilot);
    const source = payload?.response_source ?? "missing";
    const text = String(payload?.answerText ?? "");
    const ok =
      status === 200 &&
      payload?.ok === true &&
      pilot.allowedSources.includes(source) &&
      !pilot.forbidden.test(text);

    if (ok) {
      console.log(`PASS ${pilot.label} source=${source}`);
    } else {
      failed += 1;
      console.log(
        `FAIL ${pilot.label} status=${status} source=${source} reason=${payload?.reason ?? payload?.error_message ?? "unknown"}`,
      );
    }
  }

  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
