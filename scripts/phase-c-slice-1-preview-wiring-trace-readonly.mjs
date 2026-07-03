/**
 * Phase C Slice 1 — Preview HUL Care Plan wiring trace (readonly).
 * Tom: trace "내 보험 괜찮아?" — Phase B Judge + Phase C Care Plan on Preview.
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
import { COVERAGE_ANXIETY_COMPANION_CLUSTER_ID, classifyConsultationIntent } from "../server/intentGateLayer.js";
import { ONE_BRAIN_SURFACES } from "../server/oneBrainResponseLayer.js";
import {
  CARE_PLAN_FORBIDDEN_RE,
  CARE_PLAN_TRANSITION,
} from "../server/keyBrain/phaseCSlice1CoverageCarePlan.js";

const ROOT = join(import.meta.dirname, "..");
const FIX = join(ROOT, "fixtures", "key-judgment-validation-v1");
const OUT = join(FIX, "phase-c-slice-1-preview-wiring-trace-evidence.json");

const SLICE1_Q = "내 보험 괜찮아?";
const OLD_EMPATHY_PREFIX = "보장이 걱정되시는";

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
  const judgmentEnd = answer.search(/단정하지\s*않|어렵습니다|말씀드리기\s*어렵/);
  return {
    matches_phase_b_judgment: /^지금 확인|지금은\s*등록/.test(answer),
    matches_legacy_empathy: answer.startsWith(OLD_EMPATHY_PREFIX),
    has_care_plan_transition: answer.includes(CARE_PLAN_TRANSITION),
    transition_after_judgment: transitionIdx > 0 && judgmentEnd > 0 && transitionIdx > judgmentEnd,
    has_numbered_timeline: /①\s*이번\s*달/.test(answer) && /②/.test(answer),
    has_what_when: /①/.test(answer) && /이번\s*달|올해\s*안|갱신\s*시기/.test(answer),
    has_why_step: /때문|위해서|급하지|확정하기/.test(answer),
    no_first_action_overlap: !/이번에는.*같이\s*확인/.test(answer),
    no_product_push: !CARE_PLAN_FORBIDDEN_RE.test(answer),
  };
}

function inferWiringVerdict(hop, fingerprint) {
  if (
    fingerprint.matches_phase_b_judgment &&
    fingerprint.has_care_plan_transition &&
    fingerprint.has_numbered_timeline &&
    !fingerprint.matches_legacy_empathy
  ) {
    return {
      slice1_path_taken: true,
      wiring_status: "phase_c_slice1_care_plan_active",
      explanation: "Phase B judgment + Phase C Care Plan transition and timeline observed.",
    };
  }
  if (fingerprint.matches_phase_b_judgment && !fingerprint.has_care_plan_transition) {
    return {
      slice1_path_taken: false,
      wiring_status: "phase_b_only_without_care_plan_override",
      explanation: "Phase B judgment without Care Plan — bundle may predate Phase C Slice 1.",
    };
  }
  return { slice1_path_taken: false, wiring_status: "indeterminate", explanation: "Care Plan fingerprint unclear." };
}

function localWorkingTreeHop() {
  const classification = classifyConsultationIntent(SLICE1_Q);
  const factBundle = {
    question: SLICE1_Q,
    key_orchestrator: true,
    classification_intent: classification.intent,
    companion_cluster: COVERAGE_ANXIETY_COMPANION_CLUSTER_ID,
    companion_cluster_signals: classification.companion_cluster_signals ?? ["adequacy_ok"],
    policy_count: 1,
    policies: [
      {
        product_name: "QA종합보장A",
        coverage_summary: { riders: [{ rider_name: "실손의료비" }] },
      },
    ],
    coverage_gap_used: true,
    has_stored_coverage_analysis: true,
    coverage_gap_maintained: ["실손"],
  };
  const finalized = finalizeHumanSalesDirectorResponse({
    question: SLICE1_Q,
    classificationIntent: classification.intent,
    surface: ONE_BRAIN_SURFACES.HOME,
    factBundle,
    customerState: { question: SLICE1_Q, keyOrchestrator: true },
  });
  const answerText = typeof finalized === "string" ? finalized : finalized.text;
  return {
    answerText,
    fingerprint: fingerprintAnswer(answerText),
  };
}

async function previewHop(resolved) {
  const token = await mintPreviewProbeJwt(resolved);
  const probe = await fetchBypassSse({
    previewBase: resolved.previewBase,
    token,
    question: SLICE1_Q,
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
    schema_version: "phase-c-slice-1-preview-wiring-trace-v1",
    question: SLICE1_Q,
    recorded_at: new Date().toISOString(),
    git_short_sha: gitShortSha(),
    preview_base: resolved.previewBase,
    auth_fingerprint: previewAuthPathFingerprint(resolved),
    slice1_artifact_status: {
      phaseCSlice1CoverageCarePlan_js: gitFileStatus("server/keyBrain/phaseCSlice1CoverageCarePlan.js"),
      humanUnderstandingLoop_js: gitFileStatus("server/humanUnderstandingLoop.js"),
      phase_c_import_present_locally: existsSync(join(ROOT, "server/keyBrain/phaseCSlice1CoverageCarePlan.js")),
    },
    local_working_tree: localHop,
    preview_runtime: remoteHop,
    care_plan_contract_note: "Why per step — Slice 2+ standard; Slice 1 exempt",
    jerry_pass_declaration: "none",
    tom_wiring_audit_status: "pending",
  };
  writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log("[Phase C Slice 1 Preview Wiring Trace]");
  console.log(`preview slice1_path_taken: ${remoteHop.wiring?.slice1_path_taken ?? false}`);
  console.log(`preview wiring_status: ${remoteHop.wiring?.wiring_status ?? remoteHop.probe_error ?? "unknown"}`);
  console.log(`local care plan transition: ${localHop.fingerprint.has_care_plan_transition}`);
  console.log(`preview answer prefix: ${(remoteHop.answerText ?? "").slice(0, 56)}...`);
  console.log(`Evidence: ${OUT}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
