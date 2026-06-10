#!/usr/bin/env node
/**
 * Phase 30-B Advisor UX — production verification (post #84 deploy).
 */
import { createClient } from "@supabase/supabase-js";
import { assertClaimGuardrails } from "../server/claimBridgeLayer.js";

const PRODUCTION_URL = process.env.PHASE28_PRODUCTION_BASE || "https://lifeguard-core-final.vercel.app";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://fhvlxcguvjvtftttfrix.supabase.co";
const CUSTOMER_ID = process.env.PHASE28_TEST_CUSTOMER_ID || "2d61e1eb-4b8e-43f4-9d31-ad2300ed554e";

const DEV_TERM_PATTERN = /Coverage|Underwriting|XXXms|phase26|result_claude|coverage_gap/i;

const CASES = [
  {
    question: "내보험 보장분석해줘",
    intent: "coverage_review_request",
    pipeline: ["coverage_gap", "result_claude"],
    fastIncludes: "현재 가입 보험을 기준으로 보장 상태를 분석해 보겠습니다",
  },
  {
    question: "보장분석해줘",
    intent: "coverage_review_request",
    pipeline: ["coverage_gap", "result_claude"],
    fastIncludes: "현재 가입 보험을 기준으로 보장 상태를 분석해 보겠습니다",
  },
  {
    question: "운전자보험 있나요?",
    intent: "factual_lookup",
    pipeline: ["result_claude"],
    fastIncludes: null,
  },
  {
    question: "청구 가능할까요?",
    intent: "claim_eligibility_check",
    pipeline: ["result_claude"],
    fastIncludes: "약관",
  },
  {
    question: "뭘 가입해야 해?",
    intent: "recommendation_request",
    pipeline: ["coverage_gap", "recommendation", "result_claude"],
    fastIncludes: null,
  },
  {
    question: "설계안 만들어줘",
    intent: "insurance_design_request",
    pipeline: ["coverage_gap", "underwriting_risk", "recommendation", "insurance_design", "result_claude"],
    fastIncludes: null,
  },
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
  return keys.find((k) => k.name === "anon")?.api_key;
}

async function createProductionToken(admin, anonKey) {
  const { data: profile } = await admin
    .from("customer_profiles")
    .select("id,user_id")
    .eq("id", CUSTOMER_ID)
    .maybeSingle();
  if (!profile?.user_id) throw new Error("customer profile not found");

  const { data: userRow } = await admin.from("users").select("email").eq("id", profile.user_id).maybeSingle();
  const tempPassword = `Phase30BAdvisor!${Date.now()}`;
  await admin.auth.admin.updateUserById(profile.user_id, { password: tempPassword });

  const client = createClient(SUPABASE_URL, anonKey, { auth: { persistSession: false } });
  const { data: signIn, error } = await client.auth.signInWithPassword({
    email: userRow.email,
    password: tempPassword,
  });
  if (error) throw error;
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
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function pollJob(token, jobId) {
  let latestJob = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
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
    if (!latestJob || latestJob.status === "completed" || latestJob.status === "failed") {
      return latestJob;
    }
    await sleep(1200);
  }
  return latestJob;
}

async function countAssistantMessages(admin, customerId, jobId, phase) {
  const { count, error } = await admin
    .from("customer_conversations")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId)
    .eq("role", "assistant")
    .contains("metadata_json", { phase, analysis_job_id: jobId });
  if (error) throw error;
  return count ?? 0;
}

function filterMessagesForDisplay(rows) {
  const resultJobIds = new Set(
    rows
      .filter((row) => row?.metadata?.phase === "phase26-2a-result" && row?.metadata?.analysis_job_id)
      .map((row) => String(row.metadata.analysis_job_id)),
  );
  return rows.filter((row) => {
    if (row?.metadata?.phase !== "phase26-2a-fast") return true;
    const jobId = row?.metadata?.analysis_job_id;
    if (!jobId) return true;
    return !resultJobIds.has(String(jobId));
  });
}

async function verifyCase(token, admin, customerId, testCase) {
  const qa = await postQa(token, testCase.question);
  const jobFromCreate = qa.body?.analysis_job ?? null;
  const intentGate = jobFromCreate?.result_json?.intent_gate ?? {};
  const intent = intentGate.intent ?? null;
  const pipeline = intentGate.pipeline_manifest ?? null;
  const fast = qa.body?.fast_response ?? "";
  const jobId = qa.body?.analysis_job_id ?? null;

  const intentOk = intent === testCase.intent;
  const pipelineOk = JSON.stringify(pipeline) === JSON.stringify(testCase.pipeline);
  const fastOk =
    testCase.fastIncludes == null
      ? typeof fast === "string" && fast.length > 0
      : fast.includes(testCase.fastIncludes);
  const fastDevTermFree = !DEV_TERM_PATTERN.test(fast);

  let job = null;
  let resultOk = false;
  let resultDevTermFree = true;
  let duplicateResultCount = 0;
  let displayBubbleOk = true;
  let claimGuardrailOk = true;
  let resultPreview = null;

  if (jobId) {
    job = await pollJob(token, jobId);
    const finalText = String(job?.final_response_text ?? job?.result_json?.result_claude?.text ?? "");
    resultPreview = finalText.slice(0, 140);
    resultOk = job?.status === "completed" && finalText.length > 0;
    resultDevTermFree = !DEV_TERM_PATTERN.test(finalText);

    duplicateResultCount = await countAssistantMessages(admin, customerId, jobId, "phase26-2a-result");
    const fastCount = await countAssistantMessages(admin, customerId, jobId, "phase26-2a-fast");
    const resultCount = duplicateResultCount;

    const { data: convRows } = await admin
      .from("customer_conversations")
      .select("id, role, content, metadata_json, created_at")
      .eq("customer_id", customerId)
      .contains("metadata_json", { analysis_job_id: jobId })
      .order("created_at", { ascending: true });

    const mapped = (convRows ?? []).map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      metadata: row.metadata_json ?? {},
      createdAt: row.created_at,
    }));
    const displayed = filterMessagesForDisplay(mapped).filter((row) => row.role === "assistant");
    const assistantPhases = displayed.map((row) => row.metadata?.phase).filter(Boolean);
    displayBubbleOk = !assistantPhases.includes("phase26-2a-fast") || !assistantPhases.includes("phase26-2a-result")
      ? true
      : displayed.filter((row) => row.metadata?.phase === "phase26-2a-fast" || row.metadata?.phase === "phase26-2a-result").length === 1;

    if (testCase.intent === "claim_eligibility_check") {
      claimGuardrailOk = assertClaimGuardrails(finalText).ok;
    }

    if (fastCount > 0 && resultCount > 0 && !displayBubbleOk) {
      displayBubbleOk = false;
    }
  }

  const pass =
    qa.status === 200 &&
    qa.body?.ok === true &&
    intentOk &&
    pipelineOk &&
    fastOk &&
    fastDevTermFree &&
    resultOk &&
    resultDevTermFree &&
    duplicateResultCount <= 1 &&
    displayBubbleOk &&
    claimGuardrailOk;

  return {
    question: testCase.question,
    pass,
    intent,
    expected_intent: testCase.intent,
    pipeline,
    expected_pipeline: testCase.pipeline,
    fast_preview: fast.slice(0, 100),
    fast_dev_term_free: fastDevTermFree,
    result_preview: resultPreview,
    result_dev_term_free: resultDevTermFree,
    phase26_2a_result_count: duplicateResultCount,
    display_single_bubble: displayBubbleOk,
    claim_guardrail_ok: claimGuardrailOk,
    stages_completed: job?.stages_completed ?? null,
  };
}

async function main() {
  const serviceRoleKey = process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) throw new Error("SERVICE_ROLE_KEY required");

  console.log("Phase 30-B Advisor UX — Production Verify");
  console.log(`URL: ${PRODUCTION_URL}\n`);

  const admin = createClient(SUPABASE_URL, serviceRoleKey, { auth: { persistSession: false } });
  const anonKey = await fetchAnonKey();
  const { token, customerId } = await createProductionToken(admin, anonKey);

  const results = [];
  for (const testCase of CASES) {
    console.log(`Testing: ${testCase.question}`);
    const result = await verifyCase(token, admin, customerId, testCase);
    results.push(result);
    console.log(
      result.pass ? "  PASS" : "  FAIL",
      `intent=${result.intent}`,
      `pipeline=${JSON.stringify(result.pipeline)}`,
      `display=${result.display_single_bubble}`,
      `dup=${result.phase26_2a_result_count}`,
    );
    await sleep(1500);
  }

  const allPass = results.every((r) => r.pass);
  console.log("\n=== SUMMARY ===");
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"} | ${r.question}`);
    console.log(`  intent=${r.intent} (expected ${r.expected_intent})`);
    console.log(`  pipeline=${JSON.stringify(r.pipeline)}`);
    console.log(`  fast=${r.fast_preview}`);
    console.log(`  dev_terms_free=${r.fast_dev_term_free && r.result_dev_term_free}`);
    console.log(`  display_single_bubble=${r.display_single_bubble} dup=${r.phase26_2a_result_count}`);
    if (r.result_preview) console.log(`  result=${r.result_preview}...`);
  }

  console.log(`\nOVERALL: ${allPass ? "PASS" : "FAIL"} (${results.filter((r) => r.pass).length}/${results.length})`);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
