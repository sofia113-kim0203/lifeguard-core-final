/**
 * Slice 1 — JC-PREMIUM-BURDEN-v1 Preview verification ONLY (no deploy).
 * Auth path: INFRA-PREVIEW-AUTH-PATH-v1 SSOT (preview-auth-probe-path.mjs).
 *
 * Usage:
 *   node scripts/jc-premium-burden-v1-preview-verify-exec.mjs https://lifeguard-core-final-xxx.vercel.app
 *   node scripts/jc-premium-burden-v1-preview-verify-exec.mjs https://... --skip-30q
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadPreviewProbeEnvFile,
  mintPreviewProbeJwt,
  previewAuthPathFingerprint,
  probePreviewSse,
  resolvePreviewProbeEnv,
} from "./preview-auth-probe-path.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FIX = join(ROOT, "fixtures/key-judgment-validation-v1");
const OUT = join(FIX, "jc-premium-burden-v1-slice-preview-evidence.json");
const INFRA_OUT = join(FIX, "infra-preview-auth-path-v1-restore-evidence.json");
const PREVIEW_30Q_REPORT = join(ROOT, "fixtures/key-customer-validation-v1/preview-validation-report.json");

const CLUSTER_ID = "JC-PREMIUM-BURDEN-v1";
const STAGING_REF = "inwswsruvvzaeioqkelq";

const PARAPHRASE = ["보험료가 부담돼.", "보험을 줄이고 싶어.", "월 보험료를 낮추고 싶어."];
const NEGATIVE = ["월 보험료 얼마야?", "내 보험료 총액 얼마야?", "보험료 몇 원이야?"];

const SKIP_30Q = process.argv.includes("--skip-30q");
const PREVIEW_ARG = process.argv.find((a) => a.startsWith("https://"));

function gitShortSha() {
  return spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout?.trim() ?? null;
}

function slice1ServerDiffCount() {
  const proc = spawnSync(
    "git",
    ["diff", "--name-only", "HEAD", "--", "server/intentGateLayer.js", "server/salesDirectorKeyToolRegistry.js", "server/salesDirectorFormatter.js", "server/keyJudgmentRules.js", "server/salesDirectorLoop.js", "server/salesDirectorKeyOrchestrator.js", "server/keyPathRuntimeTrace.js"],
    { cwd: ROOT, encoding: "utf8" },
  );
  const files = (proc.stdout ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  return { count: files.length, files };
}

function extractTrace(done = {}) {
  const trace = done.sales_director_trace ?? done.salesDirectorTrace ?? {};
  const keyPath = trace.p10_4_key_path_trace ?? {};
  const keyOrch = trace.key_orchestrator ?? {};
  const plan = keyOrch.plan ?? {};
  const absorbed = trace.tool_brain_absorbed ?? {};
  const factBundle = done.factBundle ?? trace.agent_turn?.factBundle ?? {};
  return {
    probe_ok: true,
    answer_preview: String(done.answerText ?? "").slice(0, 240),
    classification_intent: keyPath.classificationIntent ?? factBundle.classification_intent ?? null,
    matched_rule: keyPath.matched_rule ?? null,
    companion_cluster: keyPath.companion_cluster ?? factBundle.companion_cluster ?? plan.companion_cluster ?? null,
    lookup_sub_intent: keyPath.lookup_sub_intent ?? factBundle.lookup_sub_intent ?? null,
    judgment_compose_mode: trace.finalize_trace?.key_compose_trace?.compose_mode ?? null,
    key_tools_called: keyPath.key_loop?.key_tools_called ?? keyOrch.tools_called ?? factBundle.key_tools_called ?? null,
    coverage_gap_suppressed:
      absorbed.coverage_gap_suppressed === true || plan.coverage_gap_suppressed === true || factBundle.coverage_gap_suppressed === true,
    coverage_gap_suppress_reason: absorbed.coverage_gap_suppress_reason ?? plan.coverage_gap_suppress_reason ?? null,
    sales_director_mode: keyPath.key_loop?.sales_director_mode ?? trace.observability?.sales_director_mode ?? null,
    response_source: done.response_source ?? null,
  };
}

async function probeQuestion(previewUrl, token, bypass, question) {
  const result = await probePreviewSse({
    previewBase: previewUrl,
    token,
    question,
    history: [],
    bypassSecret: bypass,
  });
  if (!result.probe_ok) return result;
  return { http_status: 200, ...extractTrace(result.done) };
}

function assessParaphraseRow(row) {
  const checks = {
    cluster: row.companion_cluster === CLUSTER_ID,
    intent: row.classification_intent === "general_consultation",
    tools: Array.isArray(row.key_tools_called) && row.key_tools_called.includes("premium_stats"),
    gap_suppressed: row.coverage_gap_suppressed === true,
    probe: row.probe_ok === true,
  };
  return { checks, aligned: Object.values(checks).every(Boolean) };
}

function assessNegativeRow(row) {
  const checks = {
    no_cluster: !row.companion_cluster,
    premium_lookup: row.classification_intent === "factual_lookup" && row.lookup_sub_intent === "premium_lookup",
    probe: row.probe_ok === true,
  };
  return { checks, preserved: Object.values(checks).every(Boolean) };
}

function runPreview30qSsot(previewUrl) {
  const proc = spawnSync(
    "node",
    [join(ROOT, "scripts/key-customer-validation-v1-preview-verify.mjs"), previewUrl],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 600000, shell: false },
  );
  let summary = null;
  let probeOkCount = null;
  try {
    if (existsSync(PREVIEW_30Q_REPORT)) {
      const report = JSON.parse(readFileSync(PREVIEW_30Q_REPORT, "utf8"));
      const steps = report.steps ?? [];
      probeOkCount = steps.filter((s) => s.probe_ok).length;
      summary = `${probeOkCount}/${steps.length} probe_ok`;
    }
  } catch {
    /* observe only */
  }
  return {
    script: "key-customer-validation-v1-preview-verify.mjs",
    exit_code: proc.status,
    summary,
    probe_ok_count: probeOkCount,
    report_path: "fixtures/key-customer-validation-v1/preview-validation-report.json",
    log_tail: `${proc.stdout ?? ""}\n${proc.stderr ?? ""}`.slice(-2000),
  };
}

function runStagingPairingVerify(previewUrl) {
  const proc = spawnSync(
    "node",
    [join(ROOT, "scripts/key-preview-staging-env-verify.mjs"), previewUrl],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 180000, shell: false },
  );
  let gates = null;
  const verifyPath = join(FIX, "preview-staging-env-verify.json");
  try {
    if (existsSync(verifyPath)) {
      gates = JSON.parse(readFileSync(verifyPath, "utf8")).gates ?? null;
    }
  } catch {
    /* observe only */
  }
  return { exit_code: proc.status, gates, report_path: "fixtures/key-judgment-validation-v1/preview-staging-env-verify.json" };
}

async function main() {
  if (process.argv.includes("--deploy")) {
    console.error("HOLD — deploy is not part of Preview verification.");
    console.error("Use: node scripts/jc-premium-burden-v1-preview-deploy-exec.mjs");
    process.exit(2);
  }

  loadPreviewProbeEnvFile(join(ROOT, ".env.local"));
  mkdirSync(FIX, { recursive: true });

  const previewUrl = PREVIEW_ARG?.replace(/\/$/, "") ?? null;
  if (!previewUrl) {
    console.error("Usage: node scripts/jc-premium-burden-v1-preview-verify-exec.mjs <preview-url> [--skip-30q]");
    process.exit(1);
  }

  const probeEnv = resolvePreviewProbeEnv({ previewBase: previewUrl });
  const authPathFingerprint = previewAuthPathFingerprint(probeEnv);
  const token = await mintPreviewProbeJwt(probeEnv);

  console.log("Preview staging pairing check...");
  const stagingPairing = runStagingPairingVerify(previewUrl);

  const paraphrase = [];
  for (const q of PARAPHRASE) {
    const row = await probeQuestion(previewUrl, token, probeEnv.bypass, q);
    paraphrase.push({ question: q, ...row, assessment: assessParaphraseRow(row) });
    console.log(q, row.companion_cluster, row.key_tools_called);
  }

  const negative_control = [];
  for (const q of NEGATIVE) {
    const row = await probeQuestion(previewUrl, token, probeEnv.bypass, q);
    negative_control.push({ question: q, ...row, assessment: assessNegativeRow(row) });
    console.log(q, row.classification_intent, row.lookup_sub_intent, row.companion_cluster);
  }

  let regression_30q = { skipped: true };
  if (!SKIP_30Q) {
    console.log("Running Preview 30Q (SSOT runner)...");
    regression_30q = runPreview30qSsot(previewUrl);
  }

  const slice1Diff = slice1ServerDiffCount();
  const paraphraseAligned = paraphrase.every((r) => r.assessment.aligned);
  const negativePreserved = negative_control.every((r) => r.assessment.preserved);
  const paraphraseProbeOk = paraphrase.every((r) => r.probe_ok);
  const negativeProbeOk = negative_control.every((r) => r.probe_ok);

  const infraEvidence = {
    document: "infra_preview_auth_path_v1_restore_evidence",
    slice: "INFRA-PREVIEW-AUTH-PATH-v1",
    mode: "Preview auth path restore · Jerry observes only",
    pass_declaration: "none",
    observed_at: new Date().toISOString(),
    git_short_sha: gitShortSha(),
    preview_url: previewUrl,
    changed_files: [
      "scripts/preview-auth-probe-path.mjs",
      "scripts/jc-premium-burden-v1-preview-verify-exec.mjs",
      "scripts/key-customer-validation-v1-preview-verify.mjs",
    ],
    slice1_server_diff: slice1Diff,
    auth_path_fingerprint: authPathFingerprint,
    staging_pairing: stagingPairing,
    preview_30q: regression_30q,
    jc_paraphrase: paraphrase,
    jc_negative_control: negative_control,
    infra_gates: {
      G0_fingerprint_staging: authPathFingerprint.supabase_url_ref === STAGING_REF,
      G1_staging_paired: stagingPairing.gates?.probe_paired_with_staging === true,
      G2_30q_probe_ok: regression_30q.skipped ? null : regression_30q.probe_ok_count === 30,
      G3_jc_probe_ok: paraphraseProbeOk && negativeProbeOk,
    },
    production_deploy: "HOLD — Tom",
  };
  writeFileSync(INFRA_OUT, JSON.stringify(infraEvidence, null, 2));

  const evidence = {
    document: "jc_premium_burden_v1_slice_preview_evidence",
    slice: "SLICE-1-JC-PREMIUM-BURDEN-v1",
    infra_slice: "INFRA-PREVIEW-AUTH-PATH-v1",
    mode: "Preview verification · SSOT auth path",
    pass_declaration: "none — await Tom audit",
    observed_at: new Date().toISOString(),
    baseline_ref: "lifeguard-personal-customer-baseline-v1.json",
    git_short_sha: gitShortSha(),
    preview_url: previewUrl,
    auth_path_fingerprint: authPathFingerprint,
    staging_pairing: stagingPairing.gates,
    paraphrase,
    negative_control,
    paraphrase_all_aligned: paraphraseAligned,
    negative_control_preserved: negativePreserved,
    regression_30q_preview: regression_30q,
    slice1_server_diff_count: slice1Diff.count,
    production_deploy: "HOLD — Tom GO required after audit",
    tom_note: "Auth path restored · Slice 1 cluster judgment awaits Tom",
  };

  writeFileSync(OUT, JSON.stringify(evidence, null, 2));
  console.log(`Wrote ${OUT}`);
  console.log(`Wrote ${INFRA_OUT}`);
  console.log(
    `paraphrase_probe_ok=${paraphraseProbeOk} aligned=${paraphraseAligned} negative_probe_ok=${negativeProbeOk} 30q=${regression_30q.summary ?? regression_30q.skipped}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
