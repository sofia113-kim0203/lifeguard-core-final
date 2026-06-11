#!/usr/bin/env node
/**
 * Phase 31-R — AI 보험추천 panel production verification (김진우).
 */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { jobHasEnginePanelResults } from "../src/lib/analysisPanelJobUtils.js";

const CUSTOMER_ID = process.env.AUDIT_CUSTOMER_ID || "2d61e1eb-4b8e-43f4-9d31-ad2300ed554e";
const PRODUCTION_URL = process.env.PHASE28_PRODUCTION_BASE || "https://lifeguard-core-final.vercel.app";
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;

async function fetchAnonKey() {
  const fromEnv = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (fromEnv) return fromEnv;
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error("SUPABASE_ANON_KEY or SUPABASE_ACCESS_TOKEN required");
  const projectRef = SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/api-keys`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const keys = await res.json();
  return keys.find((key) => key.name === "anon")?.api_key;
}

async function createToken(admin, anonKey) {
  const { data: profile } = await admin
    .from("customer_profiles")
    .select("user_id")
    .eq("id", CUSTOMER_ID)
    .maybeSingle();
  const { data: userRow } = await admin.auth.admin.getUserById(profile.user_id);
  const tempPassword = `Phase31RProd!${Date.now()}`;
  await admin.auth.admin.updateUserById(profile.user_id, { password: tempPassword });
  const client = createClient(SUPABASE_URL, anonKey, { auth: { persistSession: false } });
  const { data: signIn } = await client.auth.signInWithPassword({
    email: userRow.user.email,
    password: tempPassword,
  });
  return { token: signIn.session.access_token, email: userRow.user.email };
}

async function callApi(token, path, body = { skip_claude: true }) {
  const res = await fetch(`${PRODUCTION_URL}${path}`, {
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

async function waitForDeploy(token) {
  for (let attempt = 1; attempt <= 36; attempt += 1) {
    const latest = await callApi(token, "/api/customer-analysis-job", { mode: "latest" });
    const job = latest.payload?.analysis_job ?? null;
    if (latest.status === 200 && latest.payload?.ok === true && job) {
      if (!jobHasEnginePanelResults(job)) {
        const gap = await callApi(token, "/api/customer-coverage-gap");
        if (gap.status === 200 && gap.payload?.ok === true) {
          return { ready: true, attempt };
        }
      } else {
        return { ready: true, attempt };
      }
    }
    console.log(`deploy probe attempt ${attempt}`);
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
  return { ready: false, attempt: 36 };
}

const serviceRoleKey = process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceRoleKey || !SUPABASE_URL) {
  console.error("SUPABASE_URL and SERVICE_ROLE_KEY required");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, serviceRoleKey, { auth: { persistSession: false } });
const anonKey = await fetchAnonKey();
const { token } = await createToken(admin, anonKey);

console.log("Waiting for production deploy...");
const deploy = await waitForDeploy(token);
assert.ok(deploy.ready, "production deploy not ready");

const latest = await callApi(token, "/api/customer-analysis-job", { mode: "latest" });
const gap = await callApi(token, "/api/customer-coverage-gap");
const uw = await callApi(token, "/api/customer-underwriting-risk");
const rec = await callApi(token, "/api/customer-recommendations");
const design = await callApi(token, "/api/customer-insurance-design");
const reb = await callApi(token, "/api/customer-rebalancing");

assert.equal(latest.status, 200);
assert.equal(jobHasEnginePanelResults(latest.payload?.analysis_job), false);

assert.equal(gap.status, 200);
assert.equal(gap.payload?.ok, true);
assert.equal(gap.payload.coverage_gap_result?.items?.length, 13);
assert.equal(gap.payload.coverage_gap_result?.top_gaps?.length, 3);
assert.equal(uw.payload.underwriting_result?.items?.length, 9);
assert.equal(rec.payload.customer_visible_top2?.length, 2);
assert.ok(
  design.payload.customer_visible_design?.design_title ?? design.payload.insurance_design?.design_title,
);
assert.equal(reb.payload.rebalancing_result?.keep_items?.length, 4);
assert.equal(reb.payload.rebalancing_result?.add_items?.length, 3);
assert.equal(reb.payload.rebalancing_result?.review_items?.length, 9);

const policyChat = await callApi(token, "/api/customer-conversational-qa", {
  question: `내 보험 알려줘 Phase31R post-chat ${Date.now()}`,
  auto_process: false,
});
assert.equal(policyChat.status, 200);
assert.equal(policyChat.payload?.analysis_job?.result_json?.intent_gate?.intent, "policy_detail");

const gapAfterChat = await callApi(token, "/api/customer-coverage-gap");
const rebAfterChat = await callApi(token, "/api/customer-rebalancing");
assert.equal(gapAfterChat.payload.coverage_gap_result?.items?.length, 13);
assert.equal(rebAfterChat.payload.rebalancing_result?.review_items?.length, 9);

console.log(
  JSON.stringify(
    {
      phase: "31-r-recommendation-panel-production",
      pass: true,
      production_url: PRODUCTION_URL,
      customer_id: CUSTOMER_ID,
      deploy_probe_attempts: deploy.attempt,
      latest_job_intent: latest.payload?.analysis_job?.result_json?.intent_gate?.intent,
      panel_api_after_policy_detail_chat: {
        gap_items: gapAfterChat.payload.coverage_gap_result?.items?.length,
        reb_review: rebAfterChat.payload.rebalancing_result?.review_items?.length,
      },
      counts: {
        gap_items: 13,
        gap_top_gaps: 3,
        uw_items: 9,
        rec_top2: 2,
        design_title:
          design.payload.customer_visible_design?.design_title ??
          design.payload.insurance_design?.design_title,
        reb_keep: 4,
        reb_add: 3,
        reb_review: 9,
      },
    },
    null,
    2,
  ),
);
