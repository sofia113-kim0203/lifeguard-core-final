/**
 * Phase C Slice 2 — Preview HUL Premium Care Plan wiring trace (readonly).
 * Tom v1.1: trace "보험료 부담돼." — Phase B Judge + Phase C Care Plan on Preview.
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
import { PREMIUM_BURDEN_COMPANION_CLUSTER_ID, classifyConsultationIntent } from "../server/intentGateLayer.js";
import { ONE_BRAIN_SURFACES } from "../server/oneBrainResponseLayer.js";
import { CARE_PLAN_TRANSITION } from "../server/keyBrain/phaseCSlice1CoverageCarePlan.js";
import {
  INTERNAL_WHY_RE,
  PREMIUM_CARE_PLAN_FORBIDDEN_RE,
} from "../server/keyBrain/phaseCSlice2PremiumCarePlan.js";

const ROOT = join(import.meta.dirname, "..");
const FIX = join(ROOT, "fixtures", "key-judgment-validation-v1");
const OUT = join(FIX, "phase-c-slice-2-preview-wiring-trace-evidence.json");

const SLICE2_Q = "보험료 부담돼.";
const COMPANION_RE = /함께|같이/;

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
  const replaces = events.filter((e) => e.type === "replace").map((e) => e.data?.text ?? "");
  const deltas = events.filter((e) => e.type === "delta").map((e) => e.data?.text ?? "");
  const answerText = String(done.answerText ?? replaces.at(-1) ?? deltas.join("") ?? "").trim();
  return {
    answerText,
    composeMode: trace.finalize_trace?.key_compose_trace?.compose_mode ?? null,
    companionCluster: keyPath.companion_cluster ?? done.factBundle?.companion_cluster ?? null,
    matchedRule: keyPath.matched_rule ?? null,
    classificationIntent: keyPath.classificationIntent ?? done.consultation_intent ?? null,
  };
}

function fingerprintAnswer(text = "") {
  const answer = String(text);
  const transitionIdx = answer.indexOf(CARE_PLAN_TRANSITION);
  const judgmentEnd = answer.search(/단정하지\s*않|어렵습니다|말씀드리기\s*어렵|판단하기\s*어렵/);
  const carePlanPart = transitionIdx >= 0 ? answer.slice(transitionIdx) : answer;
  return {
    matches_phase_b_judgment: /^지금|^현재/.test(answer),
    has_care_plan_transition: answer.includes(CARE_PLAN_TRANSITION),
    transition_after_judgment: transitionIdx > 0 && judgmentEnd > 0 && transitionIdx > judgmentEnd,
    has_numbered_timeline: /①\s*이번\s*달/.test(answer) && /②/.test(answer),
    has_what_when: /①/.test(answer) && /이번\s*달|다음|그다음|갱신\s*시기/.test(answer),
    has_why_step: /\(.*때문입니다|\).*위해서입니다\)/.test(answer),
    has_companion_voice: COMPANION_RE.test(carePlanPart),
    no_first_action_overlap: !/이번에는.*같이\s*확인/.test(answer),
    no_product_push: !PREMIUM_CARE_PLAN_FORBIDDEN_RE.test(carePlanPart),
    no_internal_why: !INTERNAL_WHY_RE.test(carePlanPart),
  };
}

function inferWiringVerdict(hop, fingerprint) {
  if (
    fingerprint.matches_phase_b_judgment &&
    fingerprint.has_care_plan_transition &&
    fingerprint.has_numbered_timeline &&
    fingerprint.has_why_step &&
    fingerprint.has_companion_voice
  ) {
    return {
      slice2_path_taken: true,
      wiring_status: "phase_c_slice2_premium_care_plan_active",
      explanation: "Phase B premium judgment + Phase C Care Plan with Why and Companion voice observed.",
    };
  }
  if (fingerprint.matches_phase_b_judgment && !fingerprint.has_care_plan_transition) {
    return {
      slice2_path_taken: false,
      wiring_status: "phase_b_only_without_care_plan_override",
      explanation: "Phase B judgment without Care Plan — bundle may predate Phase C Slice 2.",
    };
  }
  return { slice2_path_taken: false, wiring_status: "indeterminate", explanation: "Care Plan fingerprint unclear." };
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
  return { answerText, fingerprint: fingerprintAnswer(answerText) };
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
    schema_version: "phase-c-slice-2-preview-wiring-trace-v1",
    question: SLICE2_Q,
    recorded_at: new Date().toISOString(),
    git_short_sha: gitShortSha(),
    preview_base: resolved.previewBase,
    auth_fingerprint: previewAuthPathFingerprint(resolved),
    slice2_artifact_status: {
      phaseCSlice2PremiumCarePlan_js: gitFileStatus("server/keyBrain/phaseCSlice2PremiumCarePlan.js"),
      humanUnderstandingLoop_js: gitFileStatus("server/humanUnderstandingLoop.js"),
      phase_c_import_present_locally: existsSync(join(ROOT, "server/keyBrain/phaseCSlice2PremiumCarePlan.js")),
    },
    local_working_tree: localHop,
    preview_runtime: remoteHop,
    care_plan_contract_note: "Tom v1.1 — Why + Companion required Slice 2",
    jerry_pass_declaration: "none",
    tom_wiring_audit_status: "pending",
  };
  writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log("[Phase C Slice 2 Preview Wiring Trace]");
  console.log(`preview slice2_path_taken: ${remoteHop.wiring?.slice2_path_taken ?? false}`);
  console.log(`preview wiring_status: ${remoteHop.wiring?.wiring_status ?? remoteHop.probe_error ?? "unknown"}`);
  console.log(`local care plan transition: ${localHop.fingerprint.has_care_plan_transition}`);
  console.log(`preview answer prefix: ${(remoteHop.answerText ?? "").slice(0, 56)}...`);
  console.log(`Evidence: ${OUT}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
