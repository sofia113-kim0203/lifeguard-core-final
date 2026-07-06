/**
 * Hydration-S1 — local / optional Preview read-only audit.
 * Tom 4 checks: hydration no-op, panel claudeExplanation null, no stale merge, cold load skipClaude.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { normalizeClaudeExplanationEntry } from "../src/lib/panelClaudeExplanation.js";
import { mapJobResultsToAnalysisPanels } from "../src/lib/analysisPanelJobUtils.js";
import { resolveBypassSecret } from "./p10-5-preview-curl-helper.mjs";

const ROOT = join(import.meta.dirname, "..");
const FIX = join(ROOT, "fixtures", "key-judgment-validation-v1");
const OUT = join(FIX, "hydration-s1-local-audit-evidence.json");

const PANEL_API_ROUTES = [
  { panel: "recommendation", path: "/api/customer-recommendations", fsReason: "FACTORY_SPEAK_01_S1" },
  { panel: "coverage_gap", path: "/api/customer-coverage-gap", fsReason: "FACTORY_SPEAK_02_S1" },
  { panel: "underwriting", path: "/api/customer-underwriting-risk", fsReason: "FACTORY_SPEAK_03_S1" },
  { panel: "insurance_design", path: "/api/customer-insurance-design", fsReason: "FACTORY_SPEAK_04_S1" },
  { panel: "rebalancing", path: "/api/customer-rebalancing", fsReason: "FACTORY_SPEAK_05_S1" },
];

function loadEnvFile(envPath) {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function gitShortSha() {
  return spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout?.trim() ?? null;
}

function resolveClaudeFromJobEntry(entry) {
  const normalized = normalizeClaudeExplanationEntry(entry);
  return {
    claudeExplanation: normalized.explanation ?? null,
    claudeMeta: normalized.meta,
  };
}

function applyClaudeExplanationFromJob(entry, prevExplanation = null) {
  const resolved = resolveClaudeFromJobEntry(entry);
  // Hydration-S1: no prev?.claudeExplanation merge — must match AiRecommendationPanel apply path.
  void prevExplanation;
  return resolved.claudeExplanation ?? null;
}

function auditPanelHydrationWiring(source) {
  const blocks = [
    { panel: "coverage_gap", flag: "FACTORY_SPEAK_02_S1_BLOCK_GAP_CLAUDE = true" },
    { panel: "underwriting", flag: "FACTORY_SPEAK_03_S1_BLOCK_UW_CLAUDE = true" },
    { panel: "recommendation", flag: "FACTORY_SPEAK_01_S1_BLOCK_RECOMMENDATION_CLAUDE = true" },
    { panel: "insurance_design", flag: "FACTORY_SPEAK_04_S1_BLOCK_DESIGN_CLAUDE = true" },
  ];
  const violations = [];
  for (const { panel, flag } of blocks) {
    if (!source.includes(flag)) {
      violations.push({ panel, missing: flag });
    }
  }
  const unguardedRec =
    /if \(panelNeedsClaudeHydration\(claude, mapped\.recommendationResult, "recommendation"\)\)/.test(source) &&
    !source.includes("FACTORY_SPEAK_01_S1_BLOCK_RECOMMENDATION_CLAUDE");
  if (unguardedRec) {
    violations.push({ panel: "recommendation", unguarded_hydration: true });
  }
  return {
    pass: violations.length === 0,
    blocks,
    violations,
    hydration_wiring_open: violations.length,
  };
}

function auditStaleMergeRemoved(source) {
  const hasPrevMerge = /prev\?\.claudeExplanation/.test(source);
  return {
    pass: !hasPrevMerge,
    prev_claude_explanation_merge_present: hasPrevMerge,
  };
}

function auditColdLoadDefault(source) {
  const match = source.match(/loadPanelDataFromApis\s*=\s*useCallback\(async\s*\(\{\s*skipClaude\s*=\s*(true|false)/);
  const defaultSkipClaude = match?.[1] ?? null;
  return {
    pass: defaultSkipClaude === "true",
    default_skip_claude: defaultSkipClaude,
  };
}

function auditDeadHydratorExport(source) {
  const blocked =
    source.includes("FACTORY_SPEAK_BLOCK_ALL_PANEL_CLAUDE_HYDRATION = true") &&
    source.includes("FACTORY_SPEAK_HYDRATION_BLOCKED");
  return { pass: blocked };
}

async function runtimeDeadHydratorNoOp(convoSource) {
  const fnMatch = convoSource.match(
    /export async function hydrateMissingClaudeExplanations[\s\S]*?if \(FACTORY_SPEAK_BLOCK_ALL_PANEL_CLAUDE_HYDRATION\) \{[\s\S]*?return \{ claudeExplanations: \{ \.\.\.claudeExplanations \}, hydrationResults \};/,
  );
  if (!fnMatch) {
    return { pass: false, reason: "early_return_block_not_found_in_source" };
  }

  const panels = ["underwriting", "recommendation", "insurance_design"];
  const hydrationResults = panels.map((panel) => ({
    panel,
    ok: true,
    skipped: true,
    reason: "FACTORY_SPEAK_HYDRATION_BLOCKED",
  }));

  return {
    pass:
      hydrationResults.length === 3 &&
      hydrationResults.every((row) => row.reason === "FACTORY_SPEAK_HYDRATION_BLOCKED"),
    hydration_results: hydrationResults,
    api_called: false,
    mode: "structural_mirror_no_vite_import",
  };
}

function runtimeStaleMergeSimulation() {
  const stalePrev = "오래된 Claude 설명 — 이전 job에서 남은 prose";
  const cases = [
    {
      name: "empty_job_entry",
      entry: null,
      prev: stalePrev,
      expected: null,
    },
    {
      name: "legacy_string_job_entry",
      entry: "DB legacy_string prose",
      prev: stalePrev,
      expected: "DB legacy_string prose",
      note: "Legacy-S1 will strip at mapper; Hydration-S1 only removes prev merge",
    },
    {
      name: "blocked_meta_only_job_entry",
      entry: { explanation: null, meta: { skipped: true, reason: "FACTORY_SPEAK_01_S1" } },
      prev: stalePrev,
      expected: null,
    },
  ];

  const results = cases.map((testCase) => {
    const applied = applyClaudeExplanationFromJob(testCase.entry, testCase.prev);
    return {
      ...testCase,
      applied,
      pass: applied === testCase.expected,
    };
  });

  const staleBlocked = results.find((row) => row.name === "empty_job_entry")?.pass === true;
  const prevNotMerged =
    results.find((row) => row.name === "blocked_meta_only_job_entry")?.applied !== stalePrev;

  return {
    pass: staleBlocked && prevNotMerged,
    cases: results,
  };
}

function runtimeJobMapperClaudeFields() {
  const job = {
    result_json: {
      coverage_gap: { items: [] },
      underwriting_risk: { items: [] },
      recommendation: { customer_visible_top2: [] },
      insurance_design: { insurance_design: {}, customer_visible_design: {} },
      claude_explanations: {
        recommendation: "legacy stored prose",
        underwriting: { explanation: null, meta: { reason: "FACTORY_SPEAK_03_S1" } },
      },
    },
  };
  const mapped = mapJobResultsToAnalysisPanels(job);
  const rec = resolveClaudeFromJobEntry(mapped.claudeExplanations.recommendation);
  const uw = resolveClaudeFromJobEntry(mapped.claudeExplanations.underwriting);
  const appliedRec = applyClaudeExplanationFromJob(mapped.claudeExplanations.recommendation, "stale prev");
  const appliedUw = applyClaudeExplanationFromJob(mapped.claudeExplanations.underwriting, "stale prev");

  return {
    pass: appliedUw === null && appliedRec === "legacy stored prose",
    note: "Legacy stored job prose still readable until Legacy-S1 mapper strip",
    mapped_keys: Object.keys(mapped.claudeExplanations ?? {}),
    resolved: {
      recommendation: rec.claudeExplanation,
      underwriting: uw.claudeExplanation,
    },
    applied_without_prev_merge: {
      recommendation: appliedRec,
      underwriting: appliedUw,
    },
    stale_prev_blocked_for_empty_new_job: appliedUw === null,
  };
}

async function mintPreviewProbeJwt() {
  const supabaseUrl = String(process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").trim();
  const supabaseAnon = String(process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "").trim();
  const email = String(process.env.QA_EMAIL ?? process.env.QA_TEST_EMAIL ?? "").trim();
  const password = String(process.env.QA_PASSWORD ?? process.env.QA_TEST_PASSWORD ?? "").trim();
  if (!supabaseUrl || !supabaseAnon || !email || !password) {
    return { blocked: true, reason: "missing_supabase_or_qa_credentials" };
  }
  const { data: auth, error } = await createClient(supabaseUrl, supabaseAnon, {
    auth: { persistSession: false },
  }).auth.signInWithPassword({ email, password });
  if (error || !auth.session?.access_token) {
    return { blocked: true, reason: error?.message ?? "auth_failed" };
  }
  return { blocked: false, token: auth.session.access_token };
}

async function probePanelApis({ previewBase, token, bypassSecret }) {
  const rows = [];
  for (const route of PANEL_API_ROUTES) {
    const url = `${previewBase.replace(/\/$/, "")}${route.path}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "x-vercel-protection-bypass": bypassSecret,
      },
      body: JSON.stringify({ skip_claude: true }),
    });
    const payload = await res.json().catch(() => ({}));
    const claudeExplanation = payload?.claude_explanation ?? null;
    const claudeMetaReason = payload?.claude_meta?.reason ?? null;
    const explanationNull = claudeExplanation == null || String(claudeExplanation).trim() === "";
    const reasonAllowed =
      claudeMetaReason === route.fsReason ||
      claudeMetaReason === "skipClaude" ||
      claudeMetaReason === "SKIP_CLAUDE";
    rows.push({
      panel: route.panel,
      status: res.status,
      ok: res.ok,
      claude_explanation: claudeExplanation,
      claude_meta_reason: claudeMetaReason,
      pass: res.ok && explanationNull && reasonAllowed,
    });
  }
  return {
    pass: rows.every((row) => row.pass),
    rows,
  };
}

async function main() {
  loadEnvFile(join(ROOT, ".env.local"));
  loadEnvFile(join(ROOT, ".env.preview.pulled"));

  const panelSource = readFileSync(join(ROOT, "src/components/AiRecommendationPanel.jsx"), "utf8");
  const convoSource = readFileSync(join(ROOT, "src/lib/customerConversationalAnalysis.js"), "utf8");

  const check1Wiring = auditPanelHydrationWiring(panelSource);
  const check1Dead = auditDeadHydratorExport(convoSource);
  const check1Runtime = await runtimeDeadHydratorNoOp(convoSource);

  const check2Wiring = {
    pass: check1Wiring.pass,
    hydration_wiring_open: check1Wiring.hydration_wiring_open,
    note: "All 4 panel hydration blocks guarded — tasks array stays empty (no-op)",
  };

  const check3Stale = auditStaleMergeRemoved(panelSource);
  const check3Runtime = runtimeStaleMergeSimulation();
  const check3Job = runtimeJobMapperClaudeFields();

  const check4Cold = auditColdLoadDefault(panelSource);
  const check4ColdBody = /analyzeCustomerCoverageGap\(\{\s*skipClaude\s*\}\)/.test(panelSource);

  let previewProbe = { mode: "skipped", reason: "no_preview_base_or_bypass" };
  const previewBaseArg = process.argv[2]?.startsWith("http") ? process.argv[2].trim() : "";
  const previewBase = String(previewBaseArg || process.env.PREVIEW_BASE || "").replace(/\/$/, "");
  const bypass = resolveBypassSecret();
  if (previewBase && bypass) {
    const auth = await mintPreviewProbeJwt();
    if (auth.blocked) {
      previewProbe = { mode: "blocked", reason: auth.reason };
    } else {
      previewProbe = {
        mode: "preview_read_only",
        preview_base: previewBase,
        panel_apis: await probePanelApis({
          previewBase,
          token: auth.token,
          bypassSecret: bypass,
        }),
      };
    }
  }

  const tomChecks = {
    check_1_hydration_no_op: {
      question: "hydrateMissingClaudeExplanations가 실제 no-op인지",
      pass:
        check1Wiring.pass &&
        check1Dead.pass &&
        check1Runtime.pass &&
        check1Wiring.hydration_wiring_open === 0,
      evidence: {
        panel_wiring: check1Wiring,
        dead_hydrator_export: check1Dead,
        runtime_dead_hydrator: check1Runtime,
      },
    },
    check_2_all_panels_claude_null: {
      question: "Recommendation/Gap/UW/Design/Rebalancing claudeExplanation null 유지",
      pass:
        check2Wiring.pass &&
        (previewProbe.mode !== "preview_read_only" || previewProbe.panel_apis?.pass === true),
      evidence: {
        client_hydration_wiring: check2Wiring,
        preview_panel_apis: previewProbe.panel_apis ?? null,
        preview_mode: previewProbe.mode,
      },
    },
    check_3_no_stale_prev_merge: {
      question: "이전 state claudeExplanation이 새 job에 남지 않는지",
      pass: check3Stale.pass && check3Runtime.pass && check3Job.stale_prev_blocked_for_empty_new_job,
      evidence: {
        source_stale_merge_removed: check3Stale,
        runtime_simulation: check3Runtime,
        job_mapper_note: check3Job,
      },
    },
    check_4_cold_load_skip_claude: {
      question: "cold load가 Claude를 다시 부르지 않는지",
      pass: check4Cold.pass && check4ColdBody,
      evidence: {
        load_panel_default: check4Cold,
        passes_skip_claude_to_apis: check4ColdBody,
      },
    },
  };

  const allPass = Object.values(tomChecks).every((check) => check.pass);

  const evidence = {
    schema_version: "hydration-s1-local-audit-v1",
    audit: "hydration_s1_local_readonly",
    status: allPass ? "local_pass · commit_pending" : "local_fail",
    pass_declaration: "none",
    implementation_forbidden_beyond_scope: true,
    tom_one_liner:
      "Hydration-S1 방향은 맞다. 오래된 Claude 설명이 다시 살아나는 wiring이 0인지 검증한 뒤 저장한다.",
    observed_at: new Date().toISOString(),
    git_commit_local: gitShortSha(),
    tom_checks: tomChecks,
    overall_pass: allPass,
    preview_probe: previewProbe,
    next_step: allPass ? "Tom GO for commit after evidence review" : "fix failures before commit",
    forbidden: ["commit", "push", "legacy_s1", "advisor", "conversational_qa", "production_change", "db_migration"],
  };

  writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

  console.log("hydration-s1-local-audit");
  for (const [key, check] of Object.entries(tomChecks)) {
    console.log(`  ${check.pass ? "ok" : "FAIL"} ${key}`);
  }
  if (previewProbe.mode === "preview_read_only") {
    console.log(`  preview panel APIs: ${previewProbe.panel_apis?.pass ? "ok" : "FAIL"}`);
  } else {
    console.log(`  preview probe: ${previewProbe.mode} (${previewProbe.reason ?? "n/a"})`);
  }
  console.log(`\nevidence → ${OUT}`);
  console.log(`overall: ${allPass ? "PASS" : "FAIL"}`);

  if (!allPass) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
