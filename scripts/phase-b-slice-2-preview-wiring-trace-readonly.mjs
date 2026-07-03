/**
 * Phase B Slice 2 — Preview HUL compose wiring trace (readonly).
 * Tom: trace "보험료 부담돼." path — do NOT modify Slice 2 compose.
 */
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  loadPreviewProbeEnvFile,
  mintPreviewProbeJwt,
  previewAuthPathFingerprint,
  resolvePreviewProbeEnv,
} from "./preview-auth-probe-path.mjs";
import { fetchBypassSse, parseSse, resolveBypassSecret } from "./p10-5-preview-curl-helper.mjs";
import { finalizeHumanSalesDirectorResponse } from "../server/humanUnderstandingLoop.js";
import { resolveKeyJudgmentRule } from "../server/keyJudgmentRules.js";
import { PREMIUM_BURDEN_COMPANION_CLUSTER_ID, classifyConsultationIntent } from "../server/intentGateLayer.js";
import { ONE_BRAIN_SURFACES } from "../server/oneBrainResponseLayer.js";

const ROOT = join(import.meta.dirname, "..");
const FIX = join(ROOT, "fixtures", "key-judgment-validation-v1");
const OUT = join(FIX, "phase-b-slice-2-preview-wiring-trace-evidence.json");

const SLICE2_Q = "보험료 부담돼.";
const OLD_RULE_JUDGMENT_PREFIX = "보험료 부담이 크게 느껴지";
const DIRECTION_RE = /^지금|^현재/;

function gitShortSha() {
  return spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout?.trim() ?? null;
}

function gitFileStatus(relPath) {
  const proc = spawnSync("git", ["status", "--porcelain", relPath], { cwd: ROOT, encoding: "utf8" });
  return proc.stdout?.trim() || "committed";
}

function extractHopTrace(events) {
  const done = events.find((e) => e.type === "done")?.data ?? {};
  const trace = done.sales_director_trace ?? done.salesDirectorTrace ?? {};
  const keyPath = trace.p10_4_key_path_trace ?? {};
  const finalizeTrace = trace.finalize_trace ?? {};
  const keyCompose = finalizeTrace.key_compose_trace ?? keyPath.build_key_structured_response ?? {};
  const replaces = events.filter((e) => e.type === "replace").map((e) => e.data?.text ?? "");
  const deltas = events.filter((e) => e.type === "delta").map((e) => e.data?.text ?? "");
  const answerText = String(done.answerText ?? replaces.at(-1) ?? deltas.join("") ?? "").trim();
  return {
    answerText,
    composeMode: keyCompose.compose_mode ?? keyPath.build_key_structured_response?.compose_mode ?? null,
    companionCluster: keyPath.companion_cluster ?? done.factBundle?.companion_cluster ?? null,
    matchedRule: keyPath.matched_rule ?? null,
    classificationIntent: keyPath.classificationIntent ?? done.consultation_intent ?? null,
    responseSource: done.response_source ?? null,
  };
}

function fingerprintAnswer(text = "") {
  const answer = String(text);
  return {
    matches_old_rule_judgment: answer.startsWith(OLD_RULE_JUDGMENT_PREFIX),
    matches_phase_b_direction: DIRECTION_RE.test(answer),
    has_empathy_opener: /느껴지시는|느껴지|마음은\s*이해/.test(answer),
    has_calc_opener: /^현재\s*확인\s*가능한\s*월\s*보험료/.test(answer),
    has_value_reason: /보장|가치|납입|등록|자료/.test(answer),
    has_limit_phrase: /단정하지\s*않|어렵/.test(answer),
    has_companion_pledge: /이번에는.*같이/.test(answer),
  };
}

function inferWiringVerdict(hop, fingerprint) {
  if (fingerprint.matches_phase_b_direction && !fingerprint.matches_old_rule_judgment) {
    return {
      slice2_path_taken: true,
      wiring_status: "slice2_compose_active",
      explanation: "Phase B Slice 2 direction-first judgment observed.",
    };
  }
  if (
    hop.composeMode === "key_structured" &&
    hop.companionCluster === PREMIUM_BURDEN_COMPANION_CLUSTER_ID &&
    fingerprint.matches_old_rule_judgment
  ) {
    return {
      slice2_path_taken: false,
      wiring_status: "legacy_rule_compose_without_phase_b_override",
      explanation: "premium_burden_companion_judgment reached but pre-Slice-2 rule text — override not in bundle.",
    };
  }
  if (hop.composeMode !== "key_structured") {
    return {
      slice2_path_taken: false,
      wiring_status: "non_key_structured_compose",
      explanation: `Compose mode is ${hop.composeMode ?? "unknown"}.`,
    };
  }
  return { slice2_path_taken: false, wiring_status: "indeterminate", explanation: "Slice 2 fingerprint unclear." };
}

function localWorkingTreeHop() {
  const classification = classifyConsultationIntent(SLICE2_Q);
  const factBundle = {
    question: SLICE2_Q,
    key_orchestrator: true,
    classification_intent: classification.intent,
    companion_cluster: PREMIUM_BURDEN_COMPANION_CLUSTER_ID,
    companion_cluster_signals: classification.companion_cluster_signals ?? ["burden"],
    policy_count: 2,
    policies: [
      { product_name: "QA실손A", monthly_premium: 85000, coverage_summary: { riders: [{ rider_name: "실손" }] } },
      { product_name: "QA암B", monthly_premium: 120000, coverage_summary: { riders: [{ rider_name: "암" }] } },
    ],
    premium_stats: { premiumKnownCount: 2, premiumTotal: 205000, premiumUnknownCount: 0, totalCount: 2 },
    premium_used: true,
    coverage_gap_maintained: ["실손"],
    coverage_gap_used: true,
    has_stored_coverage_analysis: true,
  };
  const finalized = finalizeHumanSalesDirectorResponse({
    question: SLICE2_Q,
    classificationIntent: classification.intent,
    surface: ONE_BRAIN_SURFACES.HOME,
    factBundle,
    customerState: { question: SLICE2_Q, keyOrchestrator: true },
  });
  const answerText = typeof finalized === "string" ? finalized : finalized.text;
  return {
    answerText,
    composeMode: finalized.key_compose_trace?.compose_mode ?? null,
    fingerprint: fingerprintAnswer(answerText),
    expectedJudgmentRuleId: resolveKeyJudgmentRule({
      question: SLICE2_Q,
      classificationIntent: classification.intent,
      factBundle,
    })?.id ?? null,
  };
}

async function previewHop(resolved) {
  const token = await mintPreviewProbeJwt(resolved);
  const probe = await fetchBypassSse({
    previewBase: resolved.previewBase,
    token,
    question: SLICE2_Q,
    history: [],
    bypassSecret: resolved.bypass,
  });
  if (!probe.ok) {
    return {
      probe_ok: false,
      probe_error: probe.unauthorized ? "UNAUTHORIZED" : `http_${probe.http_status ?? "unknown"}`,
      http_status: probe.http_status ?? null,
    };
  }
  const hop = extractHopTrace(parseSse(probe.stdout));
  const fingerprint = fingerprintAnswer(hop.answerText);
  return {
    probe_ok: true,
    http_status: probe.http_status ?? 200,
    ...hop,
    fingerprint,
    expectedJudgmentRuleId: "premium_burden_companion_judgment",
    wiring: inferWiringVerdict(hop, fingerprint),
  };
}

async function main() {
  loadPreviewProbeEnvFile(join(ROOT, ".env.local"));
  loadPreviewProbeEnvFile(join(ROOT, ".env.preview.pulled"));
  const previewBaseArg = process.argv[2]?.startsWith("http") ? process.argv[2].trim() : "";
  const resolved = resolvePreviewProbeEnv({ previewBase: previewBaseArg });
  if (!resolved.previewBase || !resolveBypassSecret()) {
    console.error("BLOCKED — preview URL and bypass required");
    process.exit(1);
  }
  const localHop = localWorkingTreeHop();
  const remoteHop = await previewHop(resolved);
  const evidence = {
    schema_version: "phase-b-slice-2-preview-wiring-trace-v1",
    question: SLICE2_Q,
    recorded_at: new Date().toISOString(),
    git_short_sha: gitShortSha(),
    preview_base: resolved.previewBase,
    auth_fingerprint: previewAuthPathFingerprint(resolved),
    slice2_artifact_status: {
      phaseBSlice2PremiumBurdenJudgment_js: gitFileStatus("server/keyBrain/phaseBSlice2PremiumBurdenJudgment.js"),
      humanUnderstandingLoop_js: gitFileStatus("server/humanUnderstandingLoop.js"),
      phase_b_import_present_locally: existsSync(join(ROOT, "server/keyBrain/phaseBSlice2PremiumBurdenJudgment.js")),
    },
    local_working_tree: localHop,
    preview_runtime: remoteHop,
    jerry_pass_declaration: "none",
    tom_wiring_audit_status: "pending",
  };
  writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log("[Phase B Slice 2 Preview Wiring Trace]");
  console.log(`preview slice2_path_taken: ${remoteHop.wiring?.slice2_path_taken ?? false}`);
  console.log(`preview wiring_status: ${remoteHop.wiring?.wiring_status ?? remoteHop.probe_error ?? "unknown"}`);
  console.log(`local direction-first: ${localHop.fingerprint.matches_phase_b_direction}`);
  console.log(`preview answer prefix: ${(remoteHop.answerText ?? "").slice(0, 48)}...`);
  console.log(`Evidence: ${OUT}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
