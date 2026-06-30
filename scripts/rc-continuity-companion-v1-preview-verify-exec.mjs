/**
 * RC-CONTINUITY-COMPANION-v1 — Preview verification ONLY (no Production · no alias · no PASS).
 *
 * Usage:
 *   node scripts/rc-continuity-companion-v1-preview-verify-exec.mjs <preview-url>
 *   node scripts/rc-continuity-companion-v1-preview-verify-exec.mjs <preview-url> --skip-30q
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
  resolveJudgmentComposeMode,
} from "./preview-auth-probe-path.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FIX = join(ROOT, "fixtures/key-judgment-validation-v1");
const OUT = join(FIX, "rc-continuity-companion-v1-slice-preview-trace-instrumentation-evidence.json");
const PREVIEW_30Q_REPORT = join(ROOT, "fixtures/key-customer-validation-v1/preview-validation-report.json");

const CLUSTER_ID = "RC-CONTINUITY-COMPANION-v1";
const SLICE1_CLUSTER = "JC-PREMIUM-BURDEN-v1";
const SLICE2_CLUSTER = "JC-COVERAGE-ANXIETY-v1";

const PARAPHRASE = [
  "그 이야기 이어서.",
  "아까 말한 거.",
  "전에 말한 거.",
  "그때 이야기.",
  "지난번 이야기.",
];

const NEGATIVE = [
  "암보장 부족해?",
  "보험료 부담돼.",
  "뭐 가입해야 해?",
  "내 보험 부족한 부분 있어?",
  "지난번 이야기 기억해?",
  "아까 보험료 얘기했잖아.",
  "오늘 너무 힘들어.",
  "그냥 이야기하자.",
];

const MEMORY_ANCHOR = ["지난번 이야기 기억해?", "전에 말했던 거 기억해?", "기억나?"];

const R0_ROLE_SPLIT = [
  { question: "힘들어요.", expected: "Companion" },
  { question: "암보험이 부족한가요?", expected: "Insurance" },
];

const SLICE1_SPOT = ["보험료가 부담돼.", "월 보험료 얼마야?"];
const SLICE2_SPOT = ["내 보험 괜찮아?", "내 보험 부족한 부분 있어?"];

const TIME_CONTINUITY_SPOT = [
  {
    id: "TC3-prior-promise",
    question: "지난번 우리가 이야기했던 부담 줄이기, 어떻게 됐어?",
    history: [
      { role: "user", content: "보험료 부담이 너무 커요." },
      {
        role: "assistant",
        content: "부담 줄이는 방향부터 같이 보면 됩니다. 무거운 계약부터 순서를 정해 봐요.",
      },
    ],
    expect_compose: "time_continuity",
    must_not_cluster: CLUSTER_ID,
  },
  {
    id: "TC4-prior-judgment",
    question: "지난번 당신이 말했던 그 판단, 아직 맞는 것 같아?",
    history: [
      { role: "user", content: "어떤 보험부터 보면 될까?" },
      {
        role: "assistant",
        content: "가장 무거운 계약부터 순서를 정리해 보면, 줄일지 유지할지가 보입니다.",
      },
    ],
    expect_compose: "time_continuity",
    must_not_cluster: CLUSTER_ID,
  },
];

const MEMORY_ABSENT_SHAPE_RE = /이전\s*대화를\s*확인할\s*수\s*없/;
const MEMORY_PRESENT_SHAPE_RE = /지난번\s*이야기\s*이어서/;
const MEMORY_LOOKUP_LEAK_RE = /저장(?:해|된)\s*상담\s*맥락|memory_fact|확인(?:된|돼)\s*기억/;

const SKIP_30Q = process.argv.includes("--skip-30q");
const PREVIEW_ARG = process.argv.find((a) => a.startsWith("https://"));

function gitShortSha() {
  return spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout?.trim() ?? null;
}

function extractTrace(done = {}) {
  const trace = done.sales_director_trace ?? done.salesDirectorTrace ?? {};
  const keyPath = trace.p10_4_key_path_trace ?? {};
  const keyOrch = trace.key_orchestrator ?? {};
  const plan = keyOrch.plan ?? {};
  const absorbed = trace.tool_brain_absorbed ?? {};
  const factBundle = done.factBundle ?? trace.agent_turn?.factBundle ?? {};
  const tools = keyPath.key_loop?.key_tools_called ?? keyOrch.tools_called ?? factBundle.key_tools_called ?? [];
  return {
    probe_ok: true,
    answer_preview: String(done.answerText ?? "").slice(0, 320),
    answer_full: String(done.answerText ?? ""),
    classification_intent: keyPath.classificationIntent ?? factBundle.classification_intent ?? null,
    matched_rule: keyPath.matched_rule ?? null,
    companion_cluster: keyPath.companion_cluster ?? factBundle.companion_cluster ?? plan.companion_cluster ?? null,
    lookup_sub_intent: keyPath.lookup_sub_intent ?? factBundle.lookup_sub_intent ?? null,
    home_brain_intent: keyPath.home_brain_intent ?? null,
    judgment_compose_mode: resolveJudgmentComposeMode(done),
    compose_mode_source: trace.finalize_trace?.key_compose_trace?.compose_mode
      ? "finalize_trace"
      : keyPath.build_key_structured_response?.compose_mode
        ? "p10_4_fallback"
        : null,
    key_tools_called: tools,
    coverage_gap_suppressed:
      absorbed.coverage_gap_suppressed === true ||
      plan.coverage_gap_suppressed === true ||
      factBundle.coverage_gap_suppressed === true,
    has_coverage_gap: Array.isArray(tools) && tools.includes("coverage_gap"),
    has_premium_stats: Array.isArray(tools) && tools.includes("premium_stats"),
    has_recommendation: Array.isArray(tools) && tools.includes("recommendation"),
    response_source: done.response_source ?? null,
  };
}

async function probeQuestion(previewUrl, token, bypass, question, history = []) {
  const result = await probePreviewSse({
    previewBase: previewUrl,
    token,
    question,
    history,
    bypassSecret: bypass,
  });
  if (!result.probe_ok) return result;
  return { http_status: 200, ...extractTrace(result.done) };
}

function responseShape(text = "") {
  if (MEMORY_ABSENT_SHAPE_RE.test(text)) return "memory_absent";
  if (MEMORY_PRESENT_SHAPE_RE.test(text)) return "memory_present";
  return "other";
}

function assessParaphrase(row) {
  const checks = {
    cluster: row.companion_cluster === CLUSTER_ID,
    compose: row.judgment_compose_mode === "continuity_companion_bridge",
    memory_only:
      Array.isArray(row.key_tools_called) &&
      row.key_tools_called.includes("memory") &&
      !row.has_coverage_gap &&
      !row.has_premium_stats &&
      !row.has_recommendation,
    absent_shape: responseShape(row.answer_full) === "memory_absent",
    no_memory_leak: !MEMORY_LOOKUP_LEAK_RE.test(row.answer_full),
    probe: row.probe_ok === true,
  };
  return { checks, aligned: Object.values(checks).every(Boolean) };
}

function assessCustomerSeatPresent(row) {
  const checks = {
    cluster: row.companion_cluster === CLUSTER_ID,
    compose: row.judgment_compose_mode === "continuity_companion_bridge",
    present_shape: responseShape(row.answer_full) === "memory_present",
    no_memory_leak: !MEMORY_LOOKUP_LEAK_RE.test(row.answer_full),
    probe: row.probe_ok === true,
  };
  return { checks, aligned: Object.values(checks).every(Boolean) };
}

function assessCustomerSeatAbsent(row) {
  const checks = {
    cluster: row.companion_cluster === CLUSTER_ID,
    compose: row.judgment_compose_mode === "continuity_companion_bridge",
    absent_shape: responseShape(row.answer_full) === "memory_absent",
    no_fabrication: !/힘들|어제|지난번\s*말/.test(row.answer_full),
    probe: row.probe_ok === true,
  };
  return { checks, aligned: Object.values(checks).every(Boolean) };
}

function assessNegative(row, q) {
  const noCluster = row.companion_cluster !== CLUSTER_ID;
  const byQ = {
    "암보장 부족해?": () => noCluster && row.companion_cluster === SLICE2_CLUSTER,
    "보험료 부담돼.": () => noCluster && row.companion_cluster === SLICE1_CLUSTER,
    "뭐 가입해야 해?": () => noCluster && row.classification_intent === "recommendation_request",
    "내 보험 부족한 부분 있어?": () => noCluster && row.classification_intent === "coverage_gap_check",
    "지난번 이야기 기억해?": () => noCluster && row.classification_intent !== CLUSTER_ID,
    "아까 보험료 얘기했잖아.": () => noCluster,
    "오늘 너무 힘들어.": () => noCluster,
    "그냥 이야기하자.": () => noCluster,
  };
  const preserved = byQ[q]?.() ?? noCluster;
  return {
    checks: { no_cluster: noCluster, probe: row.probe_ok === true },
    preserved: preserved && row.probe_ok === true,
  };
}

function assessMemoryAnchor(row) {
  return {
    preserved:
      row.companion_cluster !== CLUSTER_ID &&
      row.probe_ok === true &&
      (row.classification_intent === "memory_recall_lookup" ||
        row.home_brain_intent === "memory_recall_lookup" ||
        /기억|확인/.test(row.answer_preview ?? "")),
  };
}

function assessR0(row, spec) {
  if (spec.expected === "Companion") {
    return { preserved: row.companion_cluster !== CLUSTER_ID && row.probe_ok === true };
  }
  return {
    preserved:
      row.companion_cluster !== CLUSTER_ID &&
      row.probe_ok === true &&
      (row.companion_cluster === SLICE2_CLUSTER || row.classification_intent === "coverage_gap_check"),
  };
}

function assessSlice1(row, q) {
  if (q === SLICE1_SPOT[0]) {
    return { aligned: row.companion_cluster === SLICE1_CLUSTER && row.probe_ok === true };
  }
  return {
    preserved:
      row.companion_cluster !== CLUSTER_ID &&
      row.classification_intent === "factual_lookup" &&
      row.probe_ok === true,
  };
}

function assessSlice2(row, q) {
  if (q === SLICE2_SPOT[0]) {
    return { aligned: row.companion_cluster === SLICE2_CLUSTER && row.probe_ok === true };
  }
  return {
    preserved: row.companion_cluster !== CLUSTER_ID && row.classification_intent === "coverage_gap_check",
  };
}

function assessTimeContinuity(row, spec) {
  const checks = {
    probe: row.probe_ok === true,
    not_rc_cluster: row.companion_cluster !== spec.must_not_cluster,
    time_compose:
      row.judgment_compose_mode === spec.expect_compose ||
      (spec.expect_compose === "time_continuity" &&
        /지난|이어|아까|그\s*흐름|부담/.test(row.answer_preview ?? "")),
  };
  return { checks, preserved: Object.values(checks).every(Boolean) };
}

function runPreview30q(previewUrl) {
  const proc = spawnSync(
    "node",
    [join(ROOT, "scripts/key-customer-validation-v1-preview-verify.mjs"), previewUrl],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 600000, shell: false },
  );
  let summary = null;
  let probeOkCount = null;
  let friction = null;
  try {
    if (existsSync(PREVIEW_30Q_REPORT)) {
      const report = JSON.parse(readFileSync(PREVIEW_30Q_REPORT, "utf8"));
      const steps = report.steps ?? [];
      probeOkCount = steps.filter((s) => s.probe_ok).length;
      summary = `${probeOkCount}/${steps.length} probe_ok`;
      friction = report.friction_count ?? report.summary?.friction ?? null;
    }
  } catch {
    /* observe */
  }
  return {
    exit_code: proc.status,
    summary,
    probe_ok_count: probeOkCount,
    friction,
    report_path: "fixtures/key-customer-validation-v1/preview-validation-report.json",
  };
}

function runStagingPairing(previewUrl) {
  const proc = spawnSync(
    "node",
    [join(ROOT, "scripts/key-preview-staging-env-verify.mjs"), previewUrl],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 180000, shell: false },
  );
  let gates = null;
  const verifyPath = join(FIX, "preview-staging-env-verify.json");
  try {
    if (existsSync(verifyPath)) gates = JSON.parse(readFileSync(verifyPath, "utf8")).gates ?? null;
  } catch {
    /* observe */
  }
  return { exit_code: proc.status, gates };
}

async function main() {
  if (process.argv.includes("--deploy")) {
    console.error("HOLD — use vercel deploy separately; this script verifies only.");
    process.exit(2);
  }

  loadPreviewProbeEnvFile(join(ROOT, ".env.local"));
  mkdirSync(FIX, { recursive: true });

  const previewUrl = PREVIEW_ARG?.replace(/\/$/, "") ?? null;
  if (!previewUrl) {
    console.error("Usage: node scripts/rc-continuity-companion-v1-preview-verify-exec.mjs <preview-url> [--skip-30q]");
    process.exit(1);
  }

  const probeEnv = resolvePreviewProbeEnv({ previewBase: previewUrl });
  const authPathFingerprint = previewAuthPathFingerprint(probeEnv);
  const token = await mintPreviewProbeJwt(probeEnv);

  console.log("Staging pairing...");
  const stagingPairing = runStagingPairing(previewUrl);

  const paraphrase = [];
  for (const q of PARAPHRASE) {
    const row = await probeQuestion(previewUrl, token, probeEnv.bypass, q, []);
    paraphrase.push({ question: q, ...row, assessment: assessParaphrase(row) });
    console.log(q, row.companion_cluster, row.judgment_compose_mode, row.key_tools_called);
  }

  console.log("Customer-seat memory present...");
  const presentRow = await probeQuestion(
    previewUrl,
    token,
    probeEnv.bypass,
    "그 이야기 이어서.",
    [{ role: "user", content: "오늘 너무 힘들었어." }],
  );
  const customer_seat_memory_present = {
    ...presentRow,
    assessment: assessCustomerSeatPresent(presentRow),
  };
  console.log("present:", responseShape(presentRow.answer_full), presentRow.judgment_compose_mode);

  console.log("Customer-seat memory absent...");
  const absentRow = await probeQuestion(previewUrl, token, probeEnv.bypass, "그 이야기 이어서.", []);
  const customer_seat_memory_absent = {
    ...absentRow,
    assessment: assessCustomerSeatAbsent(absentRow),
  };
  console.log("absent:", responseShape(absentRow.answer_full));

  const negative = [];
  for (const q of NEGATIVE) {
    const row = await probeQuestion(previewUrl, token, probeEnv.bypass, q, []);
    negative.push({ question: q, ...row, assessment: assessNegative(row, q) });
    console.log("neg", q, row.companion_cluster);
  }

  const memory_anchor = [];
  for (const q of MEMORY_ANCHOR) {
    const row = await probeQuestion(previewUrl, token, probeEnv.bypass, q, []);
    memory_anchor.push({ question: q, ...row, assessment: assessMemoryAnchor(row) });
  }

  const r0_role_split = [];
  for (const spec of R0_ROLE_SPLIT) {
    const row = await probeQuestion(previewUrl, token, probeEnv.bypass, spec.question, []);
    r0_role_split.push({ ...spec, ...row, assessment: assessR0(row, spec) });
  }

  const slice1_regression = [];
  for (const q of SLICE1_SPOT) {
    const row = await probeQuestion(previewUrl, token, probeEnv.bypass, q, []);
    slice1_regression.push({ question: q, ...row, assessment: assessSlice1(row, q) });
  }

  const slice2_regression = [];
  for (const q of SLICE2_SPOT) {
    const row = await probeQuestion(previewUrl, token, probeEnv.bypass, q, []);
    slice2_regression.push({ question: q, ...row, assessment: assessSlice2(row, q) });
  }

  const time_continuity_spot = [];
  for (const spec of TIME_CONTINUITY_SPOT) {
    const row = await probeQuestion(previewUrl, token, probeEnv.bypass, spec.question, spec.history);
    time_continuity_spot.push({ ...spec, ...row, assessment: assessTimeContinuity(row, spec) });
    console.log("TC", spec.id, row.companion_cluster, row.judgment_compose_mode);
  }

  let regression_30q = { skipped: true };
  if (!SKIP_30Q) {
    console.log("Preview 30Q...");
    regression_30q = runPreview30q(previewUrl);
  }

  const summary = {
    compose_mode_5_5: `${paraphrase.filter((r) => r.judgment_compose_mode === "continuity_companion_bridge").length}/${PARAPHRASE.length}`,
    paraphrase: `${paraphrase.filter((r) => r.assessment.aligned).length}/${PARAPHRASE.length}`,
    customer_seat_present: customer_seat_memory_present.assessment.aligned ? "aligned" : "observe",
    customer_seat_absent: customer_seat_memory_absent.assessment.aligned ? "aligned" : "observe",
    negative: `${negative.filter((r) => r.assessment.preserved).length}/${NEGATIVE.length}`,
    memory_anchor: `${memory_anchor.filter((r) => r.assessment.preserved).length}/${MEMORY_ANCHOR.length}`,
    r0_role_split: `${r0_role_split.filter((r) => r.assessment.preserved).length}/${R0_ROLE_SPLIT.length}`,
    slice1_regression: slice1_regression.every((r) => r.assessment.aligned || r.assessment.preserved)
      ? "spot_ok"
      : "observe",
    slice2_regression: slice2_regression.every((r) => r.assessment.aligned || r.assessment.preserved)
      ? "spot_ok"
      : "observe",
    time_continuity_spot: `${time_continuity_spot.filter((r) => r.assessment.preserved).length}/${TIME_CONTINUITY_SPOT.length}`,
    regression_30q: regression_30q.summary ?? (regression_30q.skipped ? "skipped" : null),
  };

  const evidence = {
    document: "rc_continuity_companion_v1_slice_preview_trace_instrumentation_evidence",
    slice: "RELATIONSHIP-ARC-SLICE-1-RC-CONTINUITY-COMPANION-v1",
    gate: "TRACE-INSTRUMENTATION-REVERIFY",
    contract_subtitle: "Conversation Continuity Bridge",
    mode: "Preview re-verify · trace instrumentation · no Production · no PASS",
    pass_declaration: "none — await Tom audit",
    observed_at: new Date().toISOString(),
    upstream_ref: "rc-continuity-companion-v1-compose-trace-readonly-evidence.json",
    instrumentation_fix: {
      homeBrainFactCore: "finalize_trace wired to sales_director_trace",
      verify_ssot: "resolveJudgmentComposeMode in preview-auth-probe-path.mjs",
    },
    git_short_sha: gitShortSha(),
    preview_url: previewUrl,
    auth_path_fingerprint: authPathFingerprint,
    staging_pairing: stagingPairing.gates,
    tom_note:
      "personalKeyTimeContinuity exclusion on RC cluster — time_continuity_spot must not regress",
    summary,
    paraphrase,
    customer_seat: {
      memory_present: customer_seat_memory_present,
      memory_absent: customer_seat_memory_absent,
    },
    negative,
    memory_anchor,
    r0_role_split,
    slice1_regression,
    slice2_regression,
    time_continuity_spot,
    regression_30q_preview: regression_30q,
    production_deploy: "HOLD — Tom GO required",
    alias_promote: "HOLD — forbidden in this gate",
    jerry: "STOP — evidence only",
  };

  writeFileSync(OUT, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Wrote ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
