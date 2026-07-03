/**
 * Phase C Slice 3 — Preview Delegation Care Plan wiring trace (readonly).
 * Tom v1.2: trace "알아서 봐줘." — useDelegation + Care Leadership on Preview.
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
import { DELEGATION_OPENER } from "../server/keyBrain/phaseBSlice3DelegationJudgment.js";
import {
  DELEGATION_CARE_PLAN_FORBIDDEN_RE,
  DELEGATION_CARE_PLAN_TRANSITION,
  INTERNAL_WHY_RE,
} from "../server/keyBrain/phaseCSlice3DelegationCarePlan.js";
import { ONE_BRAIN_SURFACES } from "../server/oneBrainResponseLayer.js";

const ROOT = join(import.meta.dirname, "..");
const FIX = join(ROOT, "fixtures", "key-judgment-validation-v1");
const OUT = join(FIX, "phase-c-slice-3-preview-wiring-trace-evidence.json");

const SLICE3_Q = "알아서 봐줘.";
const LEADERSHIP_RE = /제가\s*먼저/;

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
  const composeMode = trace.finalize_trace?.key_compose_trace?.compose_mode ?? null;
  const replaces = events.filter((e) => e.type === "replace").map((e) => e.data?.text ?? "");
  const deltas = events.filter((e) => e.type === "delta").map((e) => e.data?.text ?? "");
  const answerText = String(done.answerText ?? replaces.at(-1) ?? deltas.join("") ?? "").trim();
  return {
    answerText,
    composeMode,
    companionCluster: keyPath.companion_cluster ?? done.factBundle?.companion_cluster ?? null,
    matchedRule: keyPath.matched_rule ?? null,
    classificationIntent: keyPath.classificationIntent ?? done.consultation_intent ?? null,
  };
}

function fingerprintAnswer(text = "") {
  const answer = String(text);
  const transitionIdx = answer.indexOf(DELEGATION_CARE_PLAN_TRANSITION);
  const judgmentEnd = answer.search(/단정하지\s*않|어렵습니다|말씀드리기\s*어렵|판단하기\s*어렵/);
  const carePlanPart = transitionIdx >= 0 ? answer.slice(transitionIdx) : answer;
  return {
    matches_delegation_opener: answer.startsWith(DELEGATION_OPENER),
    compose_mode_expected: "phase_b_slice3_delegation",
    has_care_plan_transition: answer.includes(DELEGATION_CARE_PLAN_TRANSITION),
    transition_after_judgment: transitionIdx > 0 && judgmentEnd > 0 && transitionIdx > judgmentEnd,
    has_numbered_timeline: /①/.test(answer) && /②/.test(answer),
    has_why_step: /\(.*때문입니다|\).*하려는\s*것입니다\)/.test(answer),
    has_care_leadership: LEADERSHIP_RE.test(carePlanPart),
    has_shared_decision: /함께\s*결정|같이/.test(carePlanPart),
    no_first_action_overlap: !/이번에는.*같이\s*확인/.test(answer),
    no_over_delegation_promise: !/다\s*맡겨|맡겨\s*주/.test(carePlanPart),
    no_decide_for_customer: !DELEGATION_CARE_PLAN_FORBIDDEN_RE.test(carePlanPart),
    no_internal_why: !INTERNAL_WHY_RE.test(carePlanPart),
  };
}

function inferWiringVerdict(hop, fingerprint) {
  if (
    hop.composeMode === "phase_b_slice3_delegation" &&
    fingerprint.matches_delegation_opener &&
    fingerprint.has_care_plan_transition &&
    fingerprint.has_care_leadership
  ) {
    return {
      slice3_path_taken: true,
      wiring_status: "phase_c_slice3_delegation_care_plan_active",
      explanation: "useDelegation + Phase B opener + Phase C Care Leadership plan observed.",
    };
  }
  if (fingerprint.matches_delegation_opener && !fingerprint.has_care_plan_transition) {
    return {
      slice3_path_taken: false,
      wiring_status: "phase_b_only_without_care_plan",
      explanation: "Delegation judgment without Care Plan — bundle may predate Phase C Slice 3.",
    };
  }
  return { slice3_path_taken: false, wiring_status: "indeterminate", explanation: "Delegation Care Plan fingerprint unclear." };
}

function localWorkingTreeHop() {
  const factBundle = {
    question: SLICE3_Q,
    key_orchestrator: true,
    classification_intent: "general_consultation",
    policy_count: 2,
    policies: [
      { product_name: "QA실손A", coverage_summary: { riders: [{ rider_name: "실손" }] } },
      { product_name: "QA암B", coverage_summary: { riders: [{ rider_name: "암" }] } },
    ],
    coverage_gap_used: true,
    has_stored_coverage_analysis: true,
    coverage_gap_maintained: ["실손"],
  };
  const finalized = finalizeHumanSalesDirectorResponse({
    question: SLICE3_Q,
    classificationIntent: "general_consultation",
    surface: ONE_BRAIN_SURFACES.HOME,
    factBundle,
    customerState: { question: SLICE3_Q, keyOrchestrator: true },
  });
  const answerText = typeof finalized === "string" ? finalized : finalized.text;
  const composeMode = finalized.key_compose_trace?.compose_mode ?? null;
  return { answerText, composeMode, fingerprint: fingerprintAnswer(answerText) };
}

async function previewHop(resolved) {
  const token = await mintPreviewProbeJwt(resolved);
  const probe = await fetchBypassSse({
    previewBase: resolved.previewBase,
    token,
    question: SLICE3_Q,
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
    schema_version: "phase-c-slice-3-preview-wiring-trace-v1",
    question: SLICE3_Q,
    recorded_at: new Date().toISOString(),
    git_short_sha: gitShortSha(),
    preview_base: resolved.previewBase,
    auth_fingerprint: previewAuthPathFingerprint(resolved),
    slice3_artifact_status: {
      phaseCSlice3DelegationCarePlan_js: gitFileStatus("server/keyBrain/phaseCSlice3DelegationCarePlan.js"),
      humanUnderstandingLoop_js: gitFileStatus("server/humanUnderstandingLoop.js"),
      phase_c_import_present_locally: existsSync(join(ROOT, "server/keyBrain/phaseCSlice3DelegationCarePlan.js")),
    },
    local_working_tree: localHop,
    preview_runtime: remoteHop,
    care_plan_contract_note: "Tom v1.2 — Care Leadership + useDelegation path",
    jerry_pass_declaration: "none",
    tom_wiring_audit_status: "pending",
  };
  writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log("[Phase C Slice 3 Preview Wiring Trace]");
  console.log(`preview slice3_path_taken: ${remoteHop.wiring?.slice3_path_taken ?? false}`);
  console.log(`preview compose_mode: ${remoteHop.composeMode ?? "unknown"}`);
  console.log(`preview wiring_status: ${remoteHop.wiring?.wiring_status ?? remoteHop.probe_error ?? "unknown"}`);
  console.log(`local care plan transition: ${localHop.fingerprint.has_care_plan_transition}`);
  console.log(`preview answer prefix: ${(remoteHop.answerText ?? "").slice(0, 56)}...`);
  console.log(`Evidence: ${OUT}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
