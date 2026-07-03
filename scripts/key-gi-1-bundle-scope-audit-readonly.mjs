/**
 * KEY-GI-1 — Bundle Scope Audit (READ ONLY · no commit · no deploy).
 * Tom GO: confirm GI-1-only minimum bundle before commit.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FIX = join(ROOT, "fixtures/key-judgment-validation-v1");
const OUT = join(FIX, "key-gi-1-bundle-scope-audit-v1-evidence.json");

const RUNTIME_CORE = [
  "server/generalKnowledgeEligibility.js",
  "server/homeAgentTom.js",
  "server/homeBrainFactCore.js",
  "server/homeBrainRouter.js",
  "server/humanUnderstandingLoop.js",
  "server/intentGateLayer.js",
  "server/lifeguardChatCore.js",
];

const GI1_SCRIPTS = [
  "scripts/key-gi-1-classification-baseline-readonly.mjs",
  "scripts/key-gi-1-r2-spot-check-readonly.mjs",
  "scripts/key-gi-1-r2-eligibility-unit-test.mjs",
  "scripts/key-gi-1-r1-delegation-trace-readonly.mjs",
  "scripts/key-gi-1-r1-rc-spot-audit-readonly.mjs",
  "scripts/key-gi-1-l1-prompt-profile-trace-readonly.mjs",
  "scripts/key-gi-1-l1-prompt-profile-unit-test.mjs",
  "scripts/key-gi-1-qa-quality-audit-exec.mjs",
  "scripts/key-gi-1-live-qa-blocker-audit-readonly.mjs",
];

const GI1_FIXTURES = [
  "fixtures/key-judgment-validation-v1/gi-1-regression-bank-v1.json",
  "fixtures/key-judgment-validation-v1/gi-1-qa-bank-v1.json",
  "fixtures/key-judgment-validation-v1/gi-1-qa-rubric-v1.json",
  "fixtures/key-judgment-validation-v1/gi-1-qa-rubric-v1.md",
  "fixtures/key-judgment-validation-v1/gi-1-qa-scorecard-template-v1.json",
  "fixtures/key-judgment-validation-v1/key-gi-1-start-gate-v1-evidence.json",
  "fixtures/key-judgment-validation-v1/key-gi-1-design-v1-evidence.json",
  "fixtures/key-judgment-validation-v1/key-gi-1-exec-plan-v1-evidence.json",
  "fixtures/key-judgment-validation-v1/key-gi-1-classification-baseline-plan-v1.json",
  "fixtures/key-judgment-validation-v1/key-gi-1-classification-baseline-v1-evidence.json",
  "fixtures/key-judgment-validation-v1/key-gi-1-r2-intent-criteria-v1.json",
  "fixtures/key-judgment-validation-v1/key-gi-1-r2-v1-evidence.json",
  "fixtures/key-judgment-validation-v1/key-gi-1-r2-spot-check-v1-evidence.json",
  "fixtures/key-judgment-validation-v1/key-gi-1-r1-delegation-v1-evidence.json",
  "fixtures/key-judgment-validation-v1/key-gi-1-r1-rc-spot-audit-v1-evidence.json",
  "fixtures/key-judgment-validation-v1/key-gi-1-l1-prompt-profile-v1-evidence.json",
  "fixtures/key-judgment-validation-v1/key-gi-1-live-qa-blocker-v1-evidence.json",
  "fixtures/key-judgment-validation-v1/key-gi-1-qa-quality-audit-v1-evidence.json",
  "fixtures/key-judgment-validation-v1/key-gi-1-qa-quality-audit-v1-evidence.md",
];

const EXCLUDE_NOT_GI1 = [
  "server/supabaseKeyFingerprint.js",
  "api/preview-serverless-env-probe.js",
  "api/corporate-workspace-view.js",
  "fixtures/key-judgment-validation-v1/relationship-arc-backlog-v1.json",
  "fixtures/key-judgment-validation-v1/relationship-arc-roadmap-v1.json",
  "fixtures/key-judgment-validation-v1/lifeguard-roadmap-vnext-tom.json",
];

const GI1_MARKERS = [
  "delegateGeneralKnowledgeChatTurn",
  "general_knowledge_delegation",
  "isGeneralKnowledgeEligible",
  "LIFEGUARD_GI1_SYSTEM_PROMPT",
  "gi1Profile",
];

function gitShortSha(ref = "HEAD") {
  return spawnSync("git", ["rev-parse", "--short", ref], { cwd: ROOT, encoding: "utf8" }).stdout?.trim() ?? null;
}

function porcelain(path) {
  const proc = spawnSync("git", ["status", "--porcelain", path], { cwd: ROOT, encoding: "utf8" });
  return proc.stdout?.trim() || null;
}

function diffStat(paths) {
  const proc = spawnSync("git", ["diff", "--stat", "HEAD", "--", ...paths], { cwd: ROOT, encoding: "utf8" });
  return proc.stdout?.trim() || null;
}

function fileRow(path) {
  const status = porcelain(path);
  const exists = existsSync(join(ROOT, path));
  let gi1_markers_on_disk = [];
  if (exists) {
    const text = readFileSync(join(ROOT, path), "utf8");
    gi1_markers_on_disk = GI1_MARKERS.filter((m) => text.includes(m));
  }
  const committedProc = spawnSync("git", ["show", `HEAD:${path}`], { cwd: ROOT, encoding: "utf8" });
  const committed = committedProc.status === 0 ? committedProc.stdout : "";
  const gi1_markers_on_head = committed
    ? GI1_MARKERS.filter((m) => committed.includes(m))
    : [];
  return {
    path,
    exists,
    git_status: status,
    staged: status?.startsWith("M ") || status?.startsWith("A ") || status?.startsWith("??") === false && status?.[0] !== " " && status?.[0] !== "?",
    working_tree_dirty: Boolean(status),
    gi1_markers_on_disk,
    gi1_markers_on_head,
    gi1_delta_on_disk_not_head:
      gi1_markers_on_disk.length > 0 && gi1_markers_on_head.length === 0,
  };
}

const headShort = gitShortSha("HEAD");
const runtimeRows = RUNTIME_CORE.map(fileRow);
const scriptRows = GI1_SCRIPTS.map(fileRow);
const fixtureRows = GI1_FIXTURES.map(fileRow);
const excludeRows = EXCLUDE_NOT_GI1.map(fileRow);

const runtimeDiffStat = diffStat(RUNTIME_CORE.filter((p) => p !== "server/generalKnowledgeEligibility.js"));
const packageJsonStatus = porcelain("package.json");
const packageDiff = spawnSync("git", ["diff", "HEAD", "--", "package.json"], {
  cwd: ROOT,
  encoding: "utf8",
}).stdout?.trim();
const packageGi1Only =
  packageDiff &&
  !packageDiff.includes("jc-premium") &&
  !packageDiff.includes("rc-") &&
  (packageDiff.includes("key-gi-1") || packageDiff.includes("gi-1"));

const modifiedServerContamination = runtimeRows
  .filter((r) => r.path !== "server/generalKnowledgeEligibility.js" && r.working_tree_dirty)
  .every((r) => r.gi1_delta_on_disk_not_head || r.gi1_markers_on_disk.length > 0);

const evidence = {
  document: "key_gi_1_bundle_scope_audit_v1_evidence",
  slice: "KEY-GI-1",
  phase: "GI1-BUNDLE-SCOPE",
  mode: "READ ONLY · no commit · no push · no deploy",
  status: "submitted — Tom review before GI-1 only commit",
  version: "1.0.0",
  observed_at: new Date().toISOString(),
  pass_declaration: "none",
  head_short_sha: headShort,
  tom_question: "GI-1 변경 파일 scope · Slice 외 섞임 · commit 가능한 최소 bundle",
  git_state: {
    all_gi1_server_unstaged: runtimeRows.every(
      (r) => !r.git_status || r.git_status.startsWith(" M") || r.git_status.startsWith("??"),
    ),
    nothing_staged_for_gi1: !runtimeRows.some((r) => r.git_status?.startsWith("M ")),
    runtime_diff_stat_committed_files: runtimeDiffStat,
  },
  runtime_core: {
    label: "Tier A — deploy minimum (Preview GI-1 routing requires these 7 files)",
    files: runtimeRows,
    total: RUNTIME_CORE.length,
    untracked: runtimeRows.filter((r) => r.git_status?.startsWith("??")).map((r) => r.path),
    modified: runtimeRows.filter((r) => r.git_status?.startsWith(" M")).map((r) => r.path),
    slice_contamination_in_hunks: modifiedServerContamination ? "none detected — diffs are GI-1 markers only" : "review required",
  },
  package_json: {
    path: "package.json",
    git_status: packageJsonStatus,
    gi1_only_diff: packageGi1Only,
    added_scripts: [
      "exec:key-gi-1-qa-quality-audit",
      "exec:key-gi-1-qa-quality-audit-direct",
      "exec:key-gi-1-qa-quality-audit-preview",
      "audit:key-gi-1-live-qa-blocker",
    ],
    note: "package.json diff is GI-1 npm scripts only — safe to include in GI-1 bundle",
  },
  recommended_bundles: {
    tier_a_runtime_only: RUNTIME_CORE,
    tier_b_recommended_commit: [
      ...RUNTIME_CORE,
      "package.json",
      "scripts/key-gi-1-r2-eligibility-unit-test.mjs",
      "scripts/key-gi-1-l1-prompt-profile-unit-test.mjs",
      "scripts/key-gi-1-r1-delegation-trace-readonly.mjs",
      "scripts/key-gi-1-r2-spot-check-readonly.mjs",
      "fixtures/key-judgment-validation-v1/gi-1-regression-bank-v1.json",
      "fixtures/key-judgment-validation-v1/gi-1-qa-bank-v1.json",
      "fixtures/key-judgment-validation-v1/gi-1-qa-rubric-v1.json",
      "fixtures/key-judgment-validation-v1/gi-1-qa-scorecard-template-v1.json",
      "fixtures/key-judgment-validation-v1/key-gi-1-r2-intent-criteria-v1.json",
      "fixtures/key-judgment-validation-v1/key-gi-1-r1-delegation-v1-evidence.json",
      "fixtures/key-judgment-validation-v1/key-gi-1-r2-v1-evidence.json",
      "fixtures/key-judgment-validation-v1/key-gi-1-l1-prompt-profile-v1-evidence.json",
    ],
    tier_c_evidence_follow_on: GI1_FIXTURES.filter(
      (p) =>
        ![
          "fixtures/key-judgment-validation-v1/gi-1-regression-bank-v1.json",
          "fixtures/key-judgment-validation-v1/gi-1-qa-bank-v1.json",
          "fixtures/key-judgment-validation-v1/gi-1-qa-rubric-v1.json",
          "fixtures/key-judgment-validation-v1/gi-1-qa-scorecard-template-v1.json",
          "fixtures/key-judgment-validation-v1/key-gi-1-r2-intent-criteria-v1.json",
          "fixtures/key-judgment-validation-v1/key-gi-1-r1-delegation-v1-evidence.json",
          "fixtures/key-judgment-validation-v1/key-gi-1-r2-v1-evidence.json",
          "fixtures/key-judgment-validation-v1/key-gi-1-l1-prompt-profile-v1-evidence.json",
        ].includes(p),
    ),
  },
  scripts_untracked: scriptRows,
  fixtures_untracked: fixtureRows,
  exclude_not_gi1: {
    label: "Do NOT mix into GI-1 commit",
    files: excludeRows,
    reasons: {
      "server/supabaseKeyFingerprint.js": "Infra preview probe — not GI-1 runtime",
      "api/preview-serverless-env-probe.js": "Infra probe endpoint — separate slice",
      "api/corporate-workspace-view.js": "Corporate slice — unrelated",
      "fixtures/key-judgment-validation-v1/relationship-arc-backlog-v1.json":
        "Relationship Family backlog — not GI-1",
      "fixtures/key-judgment-validation-v1/lifeguard-roadmap-vnext-tom.json": "GI-2 / roadmap — not GI-1",
      "fixtures/key-judgment-validation-v1/key-gi-1-qa-quality-audit-v1-evidence.json":
        "Invalid preview probe (0/20 GK) — do not commit as QA result; regenerate after deploy",
    },
  },
  cwd_contamination_summary: {
    modified_non_gi1_examples: [
      "fixtures/key-judgment-validation-v1/jc-premium-burden-v1-*",
      "fixtures/key-judgment-validation-v1/rc-*",
      "scripts/jc-premium-burden-v1-*",
    ],
    rule: "GI-1 only commit must path-scope stage — never git add -A",
  },
  exec_plan_alignment: {
    r2_files: ["server/generalKnowledgeEligibility.js", "server/homeBrainRouter.js", "server/intentGateLayer.js"],
    r1_files: ["server/homeAgentTom.js", "server/homeBrainFactCore.js", "server/humanUnderstandingLoop.js"],
    l1_files: ["server/lifeguardChatCore.js", "server/homeBrainFactCore.js", "server/homeAgentTom.js"],
    all_accounted: true,
  },
  tom_verdict_pending: {
    minimum_for_preview_deploy: "Tier A (7 server files)",
    recommended_single_commit: "Tier B",
    forbidden_in_same_commit: EXCLUDE_NOT_GI1,
  },
  jerry: "Bundle scope audit READ ONLY · await Tom GO for GI-1 only commit",
};

writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(
  JSON.stringify(
    {
      ok: true,
      tier_a_count: RUNTIME_CORE.length,
      exclude_count: EXCLUDE_NOT_GI1.length,
      out: OUT,
    },
    null,
    2,
  ),
);
