/**
 * Legacy-S1 — local read-only audit (Tom 5 checks).
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stripLegacyClaudeFromJobResultJson } from "../server/stripLegacyClaudeFromJobResultJson.js";
import { mapJobResultsToAnalysisPanels } from "../src/lib/analysisPanelJobUtils.js";
import { normalizeClaudeExplanationEntry } from "../src/lib/panelClaudeExplanation.js";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "fixtures", "key-judgment-validation-v1", "legacy-s1-local-audit-evidence.json");

const LEGACY_JOB = {
  id: "job-legacy-1",
  customer_id: "cust-1",
  status: "completed",
  stages_completed: ["coverage_gap", "underwriting_risk", "recommendation", "result_claude"],
  result_json: {
    coverage_gap: { items: [{ coverage_category: "cancer", gap_level: "critical" }] },
    underwriting_risk: { items: [{ coverage_category: "cancer", underwriting_status: "likely_standard" }] },
    recommendation: { customer_visible_top2: [{ coverage_label: "암", recommendation_type: "add_coverage" }] },
    claude_explanations: {
      recommendation: "legacy_string prose from DB",
      underwriting: { explanation: "older uw claude paragraph", meta: { panel: "underwriting" } },
    },
    result_claude: { text: "connected result claude prose", fallback_text: "fallback prose", explanation_mode: "short" },
    final_claude: { text: "final claude mirror prose", explanation_mode: "short" },
    panel_claude_policy_count: 8,
  },
};

function auditStripHelper() {
  const stripped = stripLegacyClaudeFromJobResultJson(LEGACY_JOB.result_json);
  return {
    pass:
      !Object.hasOwn(stripped, "claude_explanations") &&
      stripped.result_claude?.text == null &&
      stripped.result_claude?.fallback_text == null &&
      stripped.final_claude?.text == null &&
      stripped.coverage_gap?.items?.length === 1 &&
      stripped.recommendation?.customer_visible_top2?.length === 1,
    stripped_keys: Object.keys(stripped),
    has_claude_explanations: Object.hasOwn(stripped, "claude_explanations"),
    engine_preserved: Boolean(stripped.coverage_gap && stripped.recommendation),
  };
}

function auditMapAnalysisJobForClient() {
  const coreSource = readFileSync(
    join(ROOT, "server/conversationalBackgroundAnalysisCore.js"),
    "utf8",
  );
  const wired =
    coreSource.includes('import { stripLegacyClaudeFromJobResultJson }') &&
    coreSource.includes("result_json: stripLegacyClaudeFromJobResultJson(job.result_json");
  const resultJson = stripLegacyClaudeFromJobResultJson(LEGACY_JOB.result_json ?? {});
  return {
    pass:
      wired &&
      !Object.hasOwn(resultJson, "claude_explanations") &&
      resultJson.result_claude?.text == null &&
      resultJson.final_claude?.text == null &&
      resultJson.coverage_gap?.items?.length === 1,
    map_analysis_job_wired: wired,
    has_claude_explanations: Object.hasOwn(resultJson, "claude_explanations"),
    engine_preserved: Boolean(resultJson.recommendation?.customer_visible_top2?.length),
  };
}

function auditMapper() {
  const mapped = mapJobResultsToAnalysisPanels(LEGACY_JOB);
  return {
    pass:
      mapped.claudeExplanations &&
      Object.keys(mapped.claudeExplanations).length === 0 &&
      mapped.finalClaude == null &&
      mapped.recommendationResult?.customer_visible_top2?.length === 1 &&
      mapped.coverageGapResult?.items?.length === 1,
    claude_explanations_keys: Object.keys(mapped.claudeExplanations ?? {}),
    final_claude: mapped.finalClaude,
    engine_preserved: Boolean(mapped.recommendationResult && mapped.coverageGapResult),
  };
}

function auditLegacyStringNotPromoted() {
  const legacyEntry = LEGACY_JOB.result_json.claude_explanations.recommendation;
  const normalized = normalizeClaudeExplanationEntry(legacyEntry);
  const mapped = mapJobResultsToAnalysisPanels(LEGACY_JOB);
  const mapperHasProse = Object.values(mapped.claudeExplanations ?? {}).some((entry) => {
    const n = normalizeClaudeExplanationEntry(entry);
    return Boolean(String(n.explanation ?? "").trim());
  });
  return {
    pass: normalized.explanation === "legacy_string prose from DB" && !mapperHasProse,
    note: "normalize still detects legacy_string for guards; mapper no longer forwards it",
    mapper_forwards_prose: mapperHasProse,
  };
}

function auditPanelApplySource() {
  const source = readFileSync(join(ROOT, "src/components/AiRecommendationPanel.jsx"), "utf8");
  const applyMatch = source.match(/function applyJobResultsToPanelState[\s\S]*?\n\}/);
  const applyBody = applyMatch?.[0] ?? "";
  const hasLegacyStrip = source.includes('reason: "LEGACY_S1_STRIP"');
  return {
    pass: hasLegacyStrip && !applyBody.includes("resolveClaudeFromJobEntry"),
    has_legacy_s1_strip: hasLegacyStrip,
    apply_uses_resolve_claude_from_job: applyBody.includes("resolveClaudeFromJobEntry"),
  };
}

const tomChecks = {
  check_1_legacy_string_not_promoted_to_state_path: {
    question: "legacy_string entry가 state로 승격되지 않음",
    ...auditLegacyStringNotPromoted(),
  },
  check_2_api_strips_claude_explanations: {
    question: "result_json.claude_explanations가 API 응답에서 제거됨",
    ...auditMapAnalysisJobForClient(),
  },
  check_3_mapper_empty_claude: {
    question: "mapper가 claudeExplanations를 넘기지 않음",
    ...auditMapper(),
  },
  check_4_panel_apply_null: {
    question: "panel state claudeExplanation 항상 null (LEGACY_S1_STRIP)",
    ...auditPanelApplySource(),
  },
  check_5_engine_payload_preserved: {
    question: "KEY voice / panel structured data 유지",
    pass:
      auditStripHelper().engine_preserved &&
      auditMapAnalysisJobForClient().engine_preserved &&
      auditMapper().engine_preserved,
    evidence: {
      strip_helper: auditStripHelper(),
      api_mapper: auditMapAnalysisJobForClient(),
      client_mapper: auditMapper(),
    },
  },
};

for (const check of Object.values(tomChecks)) {
  if (check.pass !== true) {
    check.pass = false;
  }
}

const overallPass = Object.values(tomChecks).every((check) => check.pass === true);

const evidence = {
  schema_version: "legacy-s1-local-audit-v1",
  audit: "legacy_s1_local",
  status: overallPass ? "local_pass · commit_pending" : "local_fail",
  observed_at: new Date().toISOString(),
  tom_checks: tomChecks,
  overall_pass: overallPass,
  strip_helper: auditStripHelper(),
  forbidden: ["db_migration", "final_response_text", "conversational_qa", "advisor", "production_change"],
};

writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

console.log("legacy-s1-local-audit");
for (const [key, check] of Object.entries(tomChecks)) {
  console.log(`  ${check.pass ? "ok" : "FAIL"} ${key}`);
}
console.log(`\nevidence → ${OUT}`);
console.log(`overall: ${overallPass ? "PASS" : "FAIL"}`);

if (!overallPass) process.exit(1);
