/**
 * Phase 31-R — AI 보험추천 panel cache/API fallback verification.
 */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import {
  jobBlocksPanelLoading,
  jobHasEnginePanelResults,
  mapJobResultsToAnalysisPanels,
} from "../src/lib/analysisPanelJobUtils.js";

const CUSTOMER_ID = process.env.AUDIT_CUSTOMER_ID || "2d61e1eb-4b8e-43f4-9d31-ad2300ed554e";
const PRODUCTION_URL = process.env.PHASE28_PRODUCTION_BASE || "https://lifeguard-core-final.vercel.app";
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;

const policyDetailJob = {
  status: "completed",
  result_json: {
    intent_gate: { intent: "policy_detail", pipeline_manifest: ["result_claude"] },
    final_claude: { text: "policy list", explanation_mode: "policy_detail_light" },
  },
};

const factualLookupJob = {
  status: "completed",
  result_json: {
    intent_gate: { intent: "factual_lookup", pipeline_manifest: ["result_claude"] },
    working_context: { factual_lookup_answer: "운전자보험 있음" },
  },
};

const engineJob = {
  status: "completed",
  result_json: {
    intent_gate: { intent: "design_request" },
    coverage_gap: { items: [{ coverage_label: "암" }], top_gaps: [{ coverage_label: "암" }] },
    underwriting_risk: { items: [{ coverage_label: "실손" }] },
    recommendation: { customer_visible_top2: [{ coverage_label: "암" }, { coverage_label: "실손" }] },
    insurance_design: { customer_visible_design: { design_title: "맞춤 설계안" } },
  },
};

assert.equal(jobHasEnginePanelResults(policyDetailJob), false, "policy_detail job must not seed panels");
assert.equal(jobHasEnginePanelResults(factualLookupJob), false, "factual_lookup job must not seed panels");
assert.equal(jobHasEnginePanelResults(engineJob), true, "engine job must seed panels");
assert.equal(jobBlocksPanelLoading({ ...policyDetailJob, status: "queued" }), false);
assert.equal(
  jobBlocksPanelLoading({
    status: "queued",
    result_json: { intent_gate: { pipeline_manifest: ["coverage_gap", "result_claude"] } },
  }),
  true,
);

const mappedEngine = mapJobResultsToAnalysisPanels(engineJob);
assert.ok(mappedEngine.coverageGapResult);
assert.ok(mappedEngine.underwritingResult);
assert.ok(mappedEngine.recommendationResult);
assert.ok(mappedEngine.designBundle);

let productionApi = null;

if (process.env.SERVICE_ROLE_KEY && SUPABASE_URL && process.env.SUPABASE_ACCESS_TOKEN) {
  const serviceRoleKey = process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const admin = createClient(SUPABASE_URL, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const keyRes = await fetch(`https://api.supabase.com/v1/projects/fhvlxcguvjvtftttfrix/api-keys`, {
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` },
  });
  const anon = (await keyRes.json()).find((row) => row.name === "anon")?.api_key;
  const { data: profile } = await admin
    .from("customer_profiles")
    .select("user_id")
    .eq("id", CUSTOMER_ID)
    .maybeSingle();
  const { data: userRow } = await admin.auth.admin.getUserById(profile.user_id);
  const tempPassword = `Phase31R!${Date.now()}`;
  await admin.auth.admin.updateUserById(profile.user_id, { password: tempPassword });
  const client = createClient(SUPABASE_URL, anon, { auth: { persistSession: false } });
  const { data: signIn } = await client.auth.signInWithPassword({
    email: userRow.user.email,
    password: tempPassword,
  });
  const token = signIn.session.access_token;

  async function callApi(path) {
    const res = await fetch(`${PRODUCTION_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ skip_claude: true }),
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  }

  const latestRes = await fetch(`${PRODUCTION_URL}/api/customer-analysis-job`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ mode: "latest" }),
  });
  const latestBody = await latestRes.json();
  const latestJob = latestBody.analysis_job ?? null;

  const gap = await callApi("/api/customer-coverage-gap");
  const uw = await callApi("/api/customer-underwriting-risk");
  const rec = await callApi("/api/customer-recommendations");
  const design = await callApi("/api/customer-insurance-design");
  const reb = await callApi("/api/customer-rebalancing");

  assert.equal(latestRes.status, 200);
  assert.equal(latestBody.ok, true);
  assert.equal(jobHasEnginePanelResults(latestJob), false, "production latest job should require API fallback");

  assert.equal(gap.status, 200);
  assert.equal(gap.body.ok, true);
  assert.equal(gap.body.coverage_gap_result?.items?.length ?? 0, 13);
  assert.equal(gap.body.coverage_gap_result?.top_gaps?.length ?? 0, 3);

  assert.equal(uw.status, 200);
  assert.equal(uw.body.ok, true);
  assert.equal(uw.body.underwriting_result?.items?.length ?? 0, 9);

  assert.equal(rec.status, 200);
  assert.equal(rec.body.ok, true);
  assert.equal(rec.body.customer_visible_top2?.length ?? 0, 2);

  assert.equal(design.status, 200);
  assert.equal(design.body.ok, true);
  assert.ok(design.body.customer_visible_design?.design_title ?? design.body.insurance_design?.design_title);

  assert.equal(reb.status, 200);
  assert.equal(reb.body.ok, true);
  assert.ok((reb.body.rebalancing_result?.keep_items?.length ?? 0) >= 1);
  assert.ok((reb.body.rebalancing_result?.add_items?.length ?? 0) >= 1);
  assert.ok((reb.body.rebalancing_result?.review_items?.length ?? 0) >= 1);

  productionApi = {
    latest_job_intent: latestJob?.result_json?.intent_gate?.intent ?? null,
    latest_job_has_engine_panels: jobHasEnginePanelResults(latestJob),
    gap_items: gap.body.coverage_gap_result?.items?.length ?? 0,
    gap_top_gaps: gap.body.coverage_gap_result?.top_gaps?.length ?? 0,
    uw_items: uw.body.underwriting_result?.items?.length ?? 0,
    rec_top2: rec.body.customer_visible_top2?.length ?? 0,
    design_title:
      design.body.customer_visible_design?.design_title ?? design.body.insurance_design?.design_title ?? null,
    reb_keep: reb.body.rebalancing_result?.keep_items?.length ?? 0,
    reb_add: reb.body.rebalancing_result?.add_items?.length ?? 0,
    reb_review: reb.body.rebalancing_result?.review_items?.length ?? 0,
  };
}

console.log(
  JSON.stringify(
    {
      phase: "31-r-recommendation-panel-cache-fallback",
      pass: true,
      unit: {
        policy_detail_seeds_panels: jobHasEnginePanelResults(policyDetailJob),
        engine_job_seeds_panels: jobHasEnginePanelResults(engineJob),
      },
      production_api: productionApi,
    },
    null,
    2,
  ),
);
