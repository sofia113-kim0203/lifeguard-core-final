/**
 * P5-BRAIN JWT-path QA — same server handlers as Preview, without Vercel protection.
 * Uses customer JWT only (no service role reads).
 */
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

import { handleHomeBrainFactRequest } from "../server/homeBrainFactCore.js";
import { loadUnifiedCustomerState } from "../server/unifiedCustomerState.js";
import { createUserSupabaseClient } from "../server/requireCustomerAuth.js";

const FORBIDDEN = [
  /얼마 내세요/i,
  /가입 내역에 접근할 수 없어요/i,
  /이전 대화를 기억하지 못해요/i,
  /말씀드리기 어려워요/i,
  /318,683|4건|\d+\s*건/,
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

loadEnvFile(".env.local");

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
const supabaseAnon = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
const email = String(
  process.env.QA_EMAIL ?? process.env.QA_TEST_EMAIL ?? "sofia113@naver.com",
).trim();
const password = String(process.env.QA_PASSWORD ?? process.env.QA_TEST_PASSWORD ?? "").trim();

async function main() {
  console.log("p5-brain-jwt-path-qa (Preview-equivalent server path)");

  if (!supabaseUrl || !supabaseAnon || !password) {
    console.log("FAIL setup — missing Supabase env or QA_PASSWORD");
    process.exit(2);
  }

  const authClient = createClient(supabaseUrl, supabaseAnon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await authClient.auth.signInWithPassword({
    email,
    password,
  });
  if (authError || !authData.session?.access_token) {
    console.log(`FAIL auth — ${authError?.message ?? "no session"}`);
    process.exit(2);
  }

  const token = authData.session.access_token;
  const userSupabase = createUserSupabaseClient(`Bearer ${token}`);
  const { data: profile, error: profileError } = await userSupabase
    .from("customer_profiles")
    .select("id")
    .eq("user_id", authData.user.id)
    .maybeSingle();

  if (profileError || !profile?.id) {
    console.log(`FAIL profile — ${profileError?.message ?? "not found"}`);
    process.exit(2);
  }

  const customerId = profile.id;
  const unified = await loadUnifiedCustomerState(userSupabase, customerId);
  const policyCount = unified.policy_count ?? unified.policies?.length ?? 0;
  const documentCount = unified.document_count ?? unified.documents?.length ?? 0;

  console.log(`SIDEBAR_GATE policies=${policyCount} documents=${documentCount}`);

  if (policyCount <= 0) {
    console.log("STOP — sidebar/내 보험 would be empty; RLS self-read policy likely missing");
    process.exit(3);
  }

  const questions = [
    { id: "Q1", question: "보험료 너무 비싼가?", history: [], expectP5: true },
    { id: "Q2", question: "내 문서에 암 관련 내용 있어?", history: [], expectP5: true },
    {
      id: "Q3",
      question: "지난번 대화 이어서 하자",
      history: [
        { role: "user", content: "보험료 너무 비싼가?" },
        { role: "assistant", content: "총 보험료는 검증이 필요해요." },
      ],
      expectP5: true,
    },
    { id: "Q4", question: "안녕", history: [], expectP5: false },
  ];

  let failed = 0;
  for (const item of questions) {
    const result = await handleHomeBrainFactRequest({
      userSupabase,
      customerId,
      question: item.question,
      history: item.history,
    });
    const source = result.response_source ?? "missing";
    const text = String(result.answerText ?? "");
    const forbidden = FORBIDDEN.find((pattern) => pattern.test(text));
    const continueOk =
      item.id !== "Q3" ||
      (/최근에/.test(text) && /이어서 보고 싶으세요/.test(text));
    const isSalesDirectorPilot =
      source.startsWith("sales_director_pilot_") || source === "sales_director_guarded_hold";
    const ok =
      result.ok === true && !forbidden && continueOk && (item.expectP5 ? isSalesDirectorPilot : !isSalesDirectorPilot);

    console.log(
      `${ok ? "PASS" : "FAIL"} ${item.id} source=${source}${forbidden ? " FORBIDDEN" : ""} text=${text.replace(/\s+/g, " ").slice(0, 100)}`,
    );
    if (!ok) failed += 1;
  }

  console.log(`PANEL_CHAT_ALIGN sidebar_policies=${policyCount} jwt_path=PASS`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
});
