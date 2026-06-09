/**
 * Phase 28 — Claude dual-track audit (UI connection vs API).
 *
 * Track A (UI): job result_json must not fake Claude; panel APIs are the source.
 * Track B (API): claude_explanation + claude_meta from server handlers.
 *
 * Usage:
 *   SERVICE_ROLE_KEY=... node scripts/phase28-claude-dual-track-audit.mjs
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { handleCustomerUnderwritingRiskRequest } from "../server/customerUnderwritingRiskCore.js";
import { handleCustomerRecommendationRequest } from "../server/customerRecommendationCore.js";
import { handleCustomerInsuranceDesignRequest } from "../server/customerInsuranceDesignCore.js";

const ENV_LOCAL = ".env.local";
const CUSTOMER_ID = process.env.AUDIT_CUSTOMER_ID ?? "2d61e1eb-4b8e-43f4-9d31-ad2300ed554e";

function loadEnvLocal() {
  if (!existsSync(ENV_LOCAL)) return;
  for (const line of readFileSync(ENV_LOCAL, "utf8").split(/\r?\n/)) {
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

const panelSource = readFileSync("src/components/AiRecommendationPanel.jsx", "utf8");
assert.match(panelSource, /hydrateMissingClaudeExplanations/, "UI must hydrate Claude after analysis jobs");

const report = {
  phase: "28-claude-dual-track",
  customer_id: CUSTOMER_ID,
  track_a_ui: {
    job_claude_explanations_populated_by_runner: false,
    panel_hydrates_missing_claude: true,
    note: "backgroundAnalysisJobRunner stores stages only; UI calls panel APIs for Claude",
  },
  track_b_api: {},
  anthropic_configured: Boolean(
    String(process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY ?? "").trim(),
  ),
  pass: false,
};

if (!url || !serviceRoleKey) {
  console.log(JSON.stringify(report, null, 2));
  console.error("\nMissing SUPABASE_URL or SERVICE_ROLE_KEY for Track B API audit.\n");
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

const panels = [
  {
    key: "underwriting",
    label: "인수 위험",
    run: () =>
      handleCustomerUnderwritingRiskRequest({
        testCustomerId: CUSTOMER_ID,
        adminSupabase: supabase,
        skipClaude: false,
      }),
  },
  {
    key: "recommendation",
    label: "추천",
    run: () =>
      handleCustomerRecommendationRequest({
        testCustomerId: CUSTOMER_ID,
        adminSupabase: supabase,
        skipClaude: false,
      }),
  },
  {
    key: "insurance_design",
    label: "설계",
    run: () =>
      handleCustomerInsuranceDesignRequest({
        testCustomerId: CUSTOMER_ID,
        adminSupabase: supabase,
        skipClaude: false,
      }),
  },
];

for (const panel of panels) {
  const result = await panel.run();
  const claudeMeta = result.claude_meta ?? {};
  const hasExplanation = Boolean(String(result.claude_explanation ?? "").trim());
  report.track_b_api[panel.key] = {
    label: panel.label,
    ok: result.ok === true,
    has_claude_explanation: hasExplanation,
    claude_meta_reason: claudeMeta.reason ?? null,
    claude_meta_error: claudeMeta.error_message ?? null,
    pass: result.ok === true && hasExplanation,
  };
}

report.pass = Object.values(report.track_b_api).every((entry) => entry.pass);

console.log(JSON.stringify(report, null, 2));

if (!report.pass) {
  console.error(
    "\nClaude Track B API audit FAILED — explanations must generate successfully (not hidden).\n",
  );
  process.exit(1);
}

console.log("\n✅ Claude Track B API audit PASSED — all three panel explanations generated.\n");
