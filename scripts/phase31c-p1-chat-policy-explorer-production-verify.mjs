#!/usr/bin/env node
/**
 * Phase 31-C-P1 — Policy Explorer chat production verification (post #87 deploy).
 */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { POLICY_DETAIL_RIDER_UNAVAILABLE_MESSAGE } from "../server/intentGateLayer.js";

const PRODUCTION_URL = process.env.PHASE28_PRODUCTION_BASE || "https://lifeguard-core-final.vercel.app";
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const CUSTOMER_ID = process.env.AUDIT_CUSTOMER_ID || "2d61e1eb-4b8e-43f4-9d31-ad2300ed554e";

const QUESTIONS = ["내 보험 알려줘", "내가 가입한 보험은?", "보험 보여줘"];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAnonKey() {
  const fromEnv = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (fromEnv) return fromEnv;
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error("SUPABASE_ANON_KEY or SUPABASE_ACCESS_TOKEN required");
  const projectRef = SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
  if (!projectRef) throw new Error("Could not parse Supabase project ref");
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/api-keys`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`api-keys ${res.status}`);
  const keys = await res.json();
  const anon = keys.find((key) => key.name === "anon")?.api_key;
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

  const { data: userRow, error: userError } = await admin.auth.admin.getUserById(profile.user_id);
  const email = userRow?.user?.email;
  if (userError || !email) {
    throw new Error(`user email not found: ${userError?.message ?? profile.user_id}`);
  }

  const tempPassword = `Phase31CP1!${Date.now()}`;
  await admin.auth.admin.updateUserById(profile.user_id, { password: tempPassword });

  const client = createClient(SUPABASE_URL, anonKey, { auth: { persistSession: false } });
  const { data: signIn, error: signInError } = await client.auth.signInWithPassword({
    email,
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

function assertPolicyDetailResponse(text, label) {
  assert.match(text, /총\s*8건/, `${label}: expected 8 policies`);
  assert.match(text, /656,713원/, `${label}: expected premium sum 656,713원`);
  assert.match(
    text,
    new RegExp(POLICY_DETAIL_RIDER_UNAVAILABLE_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `${label}: expected rider unavailable message`,
  );
  assert.match(text, /1\.\s*.+\s*\/\s*.+/, `${label}: expected per-contract listing`);
  assert.ok(!/가입 보험 확인 중/.test(text), `${label}: must not stall on coverage_gap label`);
  assert.ok(
    !/암보험|뇌혈관|추천|설계안|보장이\s*부족/.test(text),
    `${label}: must not include unsolicited analysis`,
  );
}

async function verifyQuestion(token, admin, customerId, message) {
  const qa = await postQa(token, message);
  assert.equal(qa.status, 200, JSON.stringify(qa.body));
  assert.equal(qa.body?.ok, true, JSON.stringify(qa.body));

  const jobFromCreate = qa.body?.analysis_job ?? null;
  const intentGate = jobFromCreate?.result_json?.intent_gate ?? {};
  const intent = intentGate.intent ?? null;
  const pipeline = intentGate.pipeline_manifest ?? null;
  const fast = qa.body?.fast_response ?? "";
  const jobId = qa.body?.analysis_job_id ?? null;

  assert.equal(intent, "policy_detail", `${message}: intent must be policy_detail`);
  assert.deepEqual(pipeline, ["result_claude"], `${message}: pipeline must be result_claude only`);
  assertPolicyDetailResponse(fast, `${message} fast`);

  const job = await pollJob(token, jobId);
  assert.equal(job?.status, "completed", `${message}: job must complete`);
  assert.ok(!job?.stages_completed?.includes("coverage_gap"), `${message}: must not run coverage_gap`);

  const finalText = String(job?.final_response_text ?? job?.result_json?.result_claude?.text ?? "");
  assertPolicyDetailResponse(finalText, `${message} final`);
  assert.equal(
    job?.result_json?.final_claude?.explanation_mode ?? job?.result_json?.result_claude?.explanation_mode ?? null,
    "policy_detail_light",
    `${message}: explanation_mode must be policy_detail_light`,
  );

  const duplicateCount = await countResultBubbles(admin, customerId, jobId);
  assert.equal(duplicateCount, 1, `${message}: expected exactly 1 phase26-2a-result bubble`);

  return {
    message,
    pass: true,
    intent,
    pipeline,
    fast_preview: fast.slice(0, 200),
    final_preview: finalText.slice(0, 200),
    stages_completed: job?.stages_completed ?? [],
    phase26_2a_result_count: duplicateCount,
  };
}

async function waitForDeploy(admin, anonKey, maxAttempts = 30) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const { token } = await createProductionToken(admin, anonKey);
      const qa = await postQa(token, "내 보험 알려줘");
      const intent = qa.body?.analysis_job?.result_json?.intent_gate?.intent ?? null;
      if (qa.status === 200 && qa.body?.ok === true && intent === "policy_detail") {
        return { ready: true, attempt };
      }
      console.log(`deploy probe attempt ${attempt}: intent=${intent ?? "null"}`);
    } catch (error) {
      console.log(`deploy probe attempt ${attempt}: ${error.message}`);
    }
    await sleep(10000);
  }
  return { ready: false, attempt: maxAttempts };
}

async function main() {
  const serviceRoleKey = process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey || !SUPABASE_URL) {
    console.error("SUPABASE_URL and SERVICE_ROLE_KEY required");
    process.exit(1);
  }

  console.log("Phase 31-C-P1 Policy Explorer Chat — Production Verify");
  console.log(`URL: ${PRODUCTION_URL}`);
  console.log(`Customer: ${CUSTOMER_ID}\n`);

  const admin = createClient(SUPABASE_URL, serviceRoleKey, { auth: { persistSession: false } });
  const anonKey = await fetchAnonKey();

  console.log("Waiting for production deploy...");
  const deploy = await waitForDeploy(admin, anonKey);
  if (!deploy.ready) {
    console.error("Production deploy not ready for policy_detail routing");
    process.exit(1);
  }
  console.log(`Deploy ready after ${deploy.attempt} probe(s)\n`);

  const { token, customerId } = await createProductionToken(admin, anonKey);
  const results = [];
  for (const question of QUESTIONS) {
    console.log(`Testing: ${question}`);
    const result = await verifyQuestion(token, admin, customerId, question);
    results.push(result);
    console.log("  PASS");
    await sleep(1500);
  }

  console.log(
    JSON.stringify(
      {
        phase: "31c-p1-chat-policy-explorer-production",
        pass: true,
        production_url: PRODUCTION_URL,
        customer_id: CUSTOMER_ID,
        deploy_probe_attempts: deploy.attempt,
        results,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
