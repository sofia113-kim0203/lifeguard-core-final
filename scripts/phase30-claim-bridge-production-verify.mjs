#!/usr/bin/env node
/**
 * Phase 30-A Claim Bridge — production verification (post #83 deploy).
 */
import { createClient } from "@supabase/supabase-js";
import { assertClaimGuardrails } from "../server/claimBridgeLayer.js";

const PRODUCTION_URL = process.env.PHASE28_PRODUCTION_BASE || "https://lifeguard-core-final.vercel.app";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://fhvlxcguvjvtftttfrix.supabase.co";
const CUSTOMER_ID = process.env.PHASE28_TEST_CUSTOMER_ID || "2d61e1eb-4b8e-43f4-9d31-ad2300ed554e";

const CLAIM_QUESTIONS = [
  "청구 가능할까요?",
  "골절인데 받을 수 있나요?",
  "수술했는데 청구돼요?",
  "암 진단받았는데 보험금 나오나요?",
  "약관상 지급되나요?",
  "실손 청구 가능해요?",
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchAnonKey() {
  const fromEnv = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (fromEnv) return fromEnv;
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error("SUPABASE_ANON_KEY or SUPABASE_ACCESS_TOKEN required");
  const res = await fetch("https://api.supabase.com/v1/projects/fhvlxcguvjvtftttfrix/api-keys", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`api-keys ${res.status}`);
  const keys = await res.json();
  const anon = keys.find((k) => k.name === "anon")?.api_key;
  if (!anon) throw new Error("anon key not found");
  return anon;
}

async function createProductionToken(admin, anonKey) {
  const { data: profile, error: profileError } = await admin
    .from("customer_profiles")
    .select("id,user_id")
    .eq("id", CUSTOMER_ID)
    .maybeSingle();
  if (profileError || !profile?.user_id) {
    throw new Error(`customer profile not found: ${profileError?.message ?? CUSTOMER_ID}`);
  }

  const { data: userRow, error: userError } = await admin
    .from("users")
    .select("email")
    .eq("id", profile.user_id)
    .maybeSingle();
  if (userError || !userRow?.email) {
    throw new Error(`user email not found: ${userError?.message ?? profile.user_id}`);
  }

  const tempPassword = `Phase30ClaimBridge!${Date.now()}`;
  await admin.auth.admin.updateUserById(profile.user_id, { password: tempPassword });

  const client = createClient(SUPABASE_URL, anonKey, { auth: { persistSession: false } });
  const { data: signIn, error: signInError } = await client.auth.signInWithPassword({
    email: userRow.email,
    password: tempPassword,
  });
  if (signInError) throw new Error(`login: ${signInError.message}`);
  return { token: signIn.session.access_token, customerId: profile.id };
}

async function postQa(token, question) {
  const res = await fetch(`${PRODUCTION_URL}/api/customer-conversational-qa`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ question, auto_process: false }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function pollJob(token, jobId, maxAttempts = 120) {
  let latestJob = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const res = await fetch(`${PRODUCTION_URL}/api/customer-analysis-job`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ job_id: jobId, action: "process" }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status !== 200 || body?.ok !== true) {
      throw new Error(`job poll failed: ${res.status} ${JSON.stringify(body)}`);
    }
    latestJob = body.analysis_job ?? null;
    if (!latestJob) break;
    if (latestJob.status === "completed" || latestJob.status === "failed") {
      return latestJob;
    }
    await sleep(1200);
  }
  return latestJob;
}

async function countResultBubbles(admin, customerId, jobId) {
  const { count, error } = await admin
    .from("customer_conversations")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId)
    .eq("role", "assistant")
    .contains("metadata_json", { phase: "phase26-2a-result", analysis_job_id: jobId });
  if (error) throw error;
  return count ?? 0;
}

async function verifyQuestion(token, admin, customerId, message) {
  const qa = await postQa(token, message);
  const jobFromCreate = qa.body?.analysis_job ?? null;
  const intentGate = jobFromCreate?.result_json?.intent_gate ?? {};
  const intent = intentGate.intent ?? null;
  const pipeline = intentGate.pipeline_manifest ?? null;
  const fast = qa.body?.fast_response ?? null;
  const jobId = qa.body?.analysis_job_id ?? null;

  const intentOk = intent === "claim_eligibility_check";
  const pipelineOk =
    Array.isArray(pipeline) && pipeline.length === 1 && pipeline[0] === "result_claude";
  const fastOk = typeof fast === "string" && fast.length > 0 && /약관|서류/.test(fast);

  let job = null;
  let resultOk = false;
  let ragMode = null;
  let guardrailOk = false;
  let duplicateCount = 0;
  let resultPreview = null;

  if (jobId) {
    job = await pollJob(token, jobId);
    const resultJson = job?.result_json ?? {};
    ragMode = resultJson?.result_claude?.audit?.rag_context_included ? "rag_hit" : "none";
    const finalText = String(job?.final_response_text ?? resultJson?.result_claude?.text ?? "");
    guardrailOk = assertClaimGuardrails(finalText).ok;
    resultPreview = finalText.slice(0, 160);
    resultOk =
      job?.status === "completed" &&
      finalText.length > 0 &&
      (/청구|보험금|지급|약관|가능|서류|심사/.test(finalText));
    duplicateCount = await countResultBubbles(admin, customerId, jobId);
  }

  const pass =
    qa.status === 200 &&
    qa.body?.ok === true &&
    intentOk &&
    pipelineOk &&
    fastOk &&
    resultOk &&
    duplicateCount <= 1;

  return {
    message,
    pass,
    status: qa.status,
    intent,
    pipeline,
    result_mode: intentGate.result_mode ?? null,
    fast_preview: fast ? fast.slice(0, 100) : null,
    job_status: job?.status ?? null,
    rag_mode: ragMode,
    guardrails_ok: guardrailOk,
    phase26_2a_result_count: duplicateCount,
    result_preview: resultPreview,
    stages_completed: job?.stages_completed ?? null,
  };
}

async function main() {
  const serviceRoleKey = process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    console.error("SERVICE_ROLE_KEY required");
    process.exit(1);
  }

  console.log("Phase 30-A Claim Bridge — Production Verify");
  console.log(`URL: ${PRODUCTION_URL}`);
  console.log(`Customer: ${CUSTOMER_ID}\n`);

  const admin = createClient(SUPABASE_URL, serviceRoleKey, { auth: { persistSession: false } });
  const anonKey = await fetchAnonKey();
  const { token, customerId } = await createProductionToken(admin, anonKey);

  const results = [];
  for (const q of CLAIM_QUESTIONS) {
    console.log(`Testing: ${q}`);
    const r = await verifyQuestion(token, admin, customerId, q);
    results.push(r);
    console.log(
      r.pass ? "  PASS" : "  FAIL",
      `intent=${r.intent}`,
      `pipeline=${JSON.stringify(r.pipeline)}`,
      `rag=${r.rag_mode}`,
      `guardrail=${r.guardrails_ok}`,
      `dup=${r.phase26_2a_result_count}`,
    );
    await sleep(1500);
  }

  const allPass = results.every((r) => r.pass);
  console.log("\n=== SUMMARY ===");
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"} | ${r.message}`);
    console.log(`  intent=${r.intent} pipeline=${JSON.stringify(r.pipeline)} mode=${r.result_mode}`);
    console.log(`  fast=${r.fast_preview}`);
    console.log(`  rag=${r.rag_mode} guardrail=${r.guardrails_ok} dup=${r.phase26_2a_result_count}`);
    if (r.result_preview) console.log(`  result=${r.result_preview}...`);
    if (r.stages_completed) console.log(`  stages=${JSON.stringify(r.stages_completed)}`);
  }

  console.log(`\nOVERALL: ${allPass ? "PASS" : "FAIL"} (${results.filter((r) => r.pass).length}/${results.length})`);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
