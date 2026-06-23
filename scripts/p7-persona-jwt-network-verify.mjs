/**
 * P7-PERSONA — JWT-path Preview-equivalent verify for trusted advisor persona.
 */
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

import { handleHomeBrainFactRequest } from "../server/homeBrainFactCore.js";
import { createUserSupabaseClient } from "../server/requireCustomerAuth.js";
import { SALES_DIRECTOR_PERSONA_ID } from "../server/salesDirectorPersona.js";

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

const questions = ["암보장 있어?", "보험료 부담돼", "내 보험 괜찮아?"];

const FORBIDDEN_MEMORY_REPETITION = /프리랜서|지난번\s+.+\s*얘기|전에\s+.+\s*얘기\s*나눴|기억해\s*둔\s*상담/i;
const FORBIDDEN_READOUT = /부족한\s*보장|우선\s*보강|Gap\s*분석|coverage_gap|엔진\s*결과/i;
const FORBIDDEN_PUSH = /상담\s*예약|시간\s*되|예약\s*잡|콜\s*드릴|전화\s*드릴|바로\s*연결/i;
const ANXIOUS_PUSH = /지금\s*당장|서두르|급히\s*결정|바로\s*가입|놓치면\s*안/i;

function qualityChecks(answerText = "") {
  const text = String(answerText ?? "").trim();
  return {
    has_answer: text.length > 0,
    no_memory_verbatim: !FORBIDDEN_MEMORY_REPETITION.test(text),
    no_gap_readout: !FORBIDDEN_READOUT.test(text),
    no_booking_push: !FORBIDDEN_PUSH.test(text),
    no_anxious_push: !ANXIOUS_PUSH.test(text),
    has_follow_up: /[?？]|할까요|볼게요|말씀해|알려주|짚어|보면/.test(text),
    advisor_tone: /괜찮|함께|천천히|걱정|느껴|이해|맞춰|곁|차근/.test(text),
    direct_opening: /암|보험료|부담|괜찮|가입|보장|확인|걸리|신경/.test(text.split("\n")[0] ?? ""),
  };
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
  const supabaseAnon = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
  const email = String(process.env.QA_EMAIL ?? process.env.QA_TEST_EMAIL ?? "sofia113@naver.com").trim();
  const password = String(process.env.QA_PASSWORD ?? process.env.QA_TEST_PASSWORD ?? "").trim();

  if (!supabaseUrl || !supabaseAnon || !password) {
    console.log("FAIL setup — missing env");
    process.exit(2);
  }

  const authClient = createClient(supabaseUrl, supabaseAnon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await authClient.auth.signInWithPassword({ email, password });
  if (authError || !authData.session?.access_token) {
    console.log(`FAIL auth — ${authError?.message ?? "no session"}`);
    process.exit(2);
  }

  const userSupabase = createUserSupabaseClient(`Bearer ${authData.session.access_token}`);
  const { data: profile } = await userSupabase
    .from("customer_profiles")
    .select("id")
    .eq("user_id", authData.user.id)
    .maybeSingle();
  const customerId = profile?.id;
  if (!customerId) {
    console.log("FAIL — no customer profile");
    process.exit(2);
  }

  console.log(`p7-persona-jwt-verify customer_id=${customerId}`);

  let failed = 0;

  for (const question of questions) {
    const result = await handleHomeBrainFactRequest({
      userSupabase,
      customerId,
      question,
      history: [],
      fetchImpl: fetch,
    });

    const trace = result.sales_director_trace ?? {};
    const brain = trace.conversation_brain ?? {};
    const answerText = String(result.answerText ?? "").trim();
    const quality = qualityChecks(answerText);

    const network = {
      persona_status: brain.status === "p7_persona",
      persona_id:
        brain.persona === SALES_DIRECTOR_PERSONA_ID ||
        result.factBundle?.sales_director_persona === SALES_DIRECTOR_PERSONA_ID ||
        trace.conversation_brain?.free_thinking?.persona === SALES_DIRECTOR_PERSONA_ID,
      answer_evidence: Array.isArray(result.answer_evidence),
      coverage_gap_in_evidence: Array.isArray(result.answer_evidence) && result.answer_evidence.includes("coverage_gap"),
    };

    const ok =
      result.ok === true &&
      Object.values(network).every(Boolean) &&
      Object.values(quality).every(Boolean);
    if (!ok) failed += 1;

    console.log(`\n=== ${question} ===`);
    console.log(`response_source=${result.response_source}`);
    console.log(`network=${JSON.stringify(network)}`);
    console.log(`conversation_brain.status=${brain.status} persona=${brain.persona}`);
    console.log(`answer_evidence=${JSON.stringify(result.answer_evidence)}`);
    console.log(`quality=${JSON.stringify(quality)}`);
    console.log(`answer_preview=${answerText.slice(0, 320).replace(/\s+/g, " ")}`);
  }

  console.log(
    `\nP7-PERSONA jwt verify: ${failed > 0 ? "FAILED" : "ALL CHECKS PASSED"} (${questions.length - failed}/${questions.length}) — not a PASS declaration`,
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
