/**
 * Phase 28 — Diagnostic: claude_explanations shape + underwriting path for 김진우.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { handleCustomerUnderwritingRiskRequest } from "../server/customerUnderwritingRiskCore.js";
import { normalizeClaudeExplanationEntry, hasClaudeExplanation } from "../src/lib/panelClaudeExplanation.js";

import { resolveAuditCustomerId } from "./lib/sandboxAuthGuard.js";

const CUSTOMER_ID = resolveAuditCustomerId(process.env.AUDIT_CUSTOMER_ID);

function loadEnvLocal() {
  if (!existsSync(".env.local")) return;
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
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
const serviceRoleKey = process.env.SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) throw new Error("SUPABASE_URL and SERVICE_ROLE_KEY required");

const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

const { data: latestJob } = await supabase
  .from("analysis_jobs")
  .select("id, status, result_json, completed_at")
  .eq("customer_id", CUSTOMER_ID)
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();

const claude = latestJob?.result_json?.claude_explanations ?? {};
const panels = ["underwriting", "recommendation", "insurance_design"];

const jobPanelReport = {};
for (const panel of panels) {
  const raw = claude[panel];
  const normalized = normalizeClaudeExplanationEntry(raw);
  jobPanelReport[panel] = {
    raw_type: raw == null ? "null" : typeof raw,
    has_explanation: hasClaudeExplanation(raw),
    explanation_preview: normalized.explanation ? String(normalized.explanation).slice(0, 80) : null,
    meta_policy_count: normalized.meta?.policy_count ?? null,
    meta_reason: normalized.meta?.reason ?? null,
  };
}

const uwApi = await handleCustomerUnderwritingRiskRequest({
  testCustomerId: CUSTOMER_ID,
  adminSupabase: supabase,
  skipClaude: false,
});

const legacyPanelNeedsHydration = (entry) => Boolean(entry);
const fixedPanelNeedsHydration = (entry) => !hasClaudeExplanation(entry);

const report = {
  customer_id: CUSTOMER_ID,
  latest_job_id: latestJob?.id ?? null,
  latest_job_status: latestJob?.status ?? null,
  panel_claude_policy_count: latestJob?.result_json?.panel_claude_policy_count ?? null,
  job_panels: jobPanelReport,
  underwriting_api: {
    ok: uwApi.ok,
    has_claude_explanation: Boolean(String(uwApi.claude_explanation ?? "").trim()),
    claude_meta_reason: uwApi.claude_meta?.reason ?? null,
    claude_meta_policy_count: uwApi.claude_meta?.policy_count ?? null,
  },
  hydration_logic: {
    underwriting_legacy_would_skip: legacyPanelNeedsHydration(claude.underwriting),
    underwriting_fixed_would_hydrate: fixedPanelNeedsHydration(claude.underwriting),
    recommendation_legacy_would_skip: legacyPanelNeedsHydration(claude.recommendation),
    recommendation_fixed_would_hydrate: fixedPanelNeedsHydration(claude.recommendation),
    insurance_design_legacy_would_skip: legacyPanelNeedsHydration(claude.insurance_design),
    insurance_design_fixed_would_hydrate: fixedPanelNeedsHydration(claude.insurance_design),
  },
};

console.log(JSON.stringify(report, null, 2));

assert.equal(
  typeof claude.underwriting === "string" || typeof claude.underwriting === "object" || claude.underwriting == null,
  true,
  "underwriting entry must be string, object, or null",
);

const panelSource = readFileSync("src/components/AiRecommendationPanel.jsx", "utf8");
assert.match(panelSource, /hasClaudeExplanation/, "UI must use hasClaudeExplanation for hydration gating");
assert.match(panelSource, /normalizeClaudeExplanationEntry/, "UI must normalize claude_explanations entries");
assert.match(panelSource, /ClaudePanelDebugPanel/, "UI must expose verifier debug panel for policy_count");
