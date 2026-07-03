/**
 * Phase B Slice 3 — Preview HUL compose wiring trace (readonly).
 * Tom: trace "알아서 봐줘." path — do NOT modify Slice 3 compose.
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
import { ONE_BRAIN_SURFACES } from "../server/oneBrainResponseLayer.js";
import {
  DELEGATION_FORBIDDEN_RE,
  DELEGATION_OPENER,
} from "../server/keyBrain/phaseBSlice3DelegationJudgment.js";

const ROOT = join(import.meta.dirname, "..");
const FIX = join(ROOT, "fixtures", "key-judgment-validation-v1");
const OUT = join(FIX, "phase-b-slice-3-preview-wiring-trace-evidence.json");

const SLICE3_Q = "알아서 봐줘.";
const LEGACY_COMPANION_PREFIX = "제일 걸리는 축";
const LEGACY_RELATIONAL_RE = /여쭤볼|확인이\s*목적.{0,12}결정/;

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
    classificationIntent: keyPath.classificationIntent ?? done.consultation_intent ?? null,
    responseSource: done.response_source ?? null,
  };
}

function fingerprintAnswer(text = "") {
  const answer = String(text);
  return {
    matches_delegation_opener: answer.startsWith(DELEGATION_OPENER),
    matches_legacy_companion: answer.includes(LEGACY_COMPANION_PREFIX),
    matches_legacy_relational: LEGACY_RELATIONAL_RE.test(answer),
    has_forbidden_deflection: DELEGATION_FORBIDDEN_RE.test(answer),
    has_reason_phrase: /등록|보장|분석|이전|자료|유지|구조/.test(answer),
    has_limit_phrase: /단정하지\s*않|어렵|확인되지\s*않/.test(answer),
    has_first_action: /이번에는.*같이|같이\s*확인|저장해\s*주시면/.test(answer),
  };
}

function inferWiringVerdict(hop, fingerprint) {
  if (
    (hop.composeMode === "phase_b_slice3_delegation" || fingerprint.matches_delegation_opener) &&
    !fingerprint.matches_legacy_companion &&
    !fingerprint.matches_legacy_relational &&
    !fingerprint.has_forbidden_deflection
  ) {
    return {
      slice3_path_taken: true,
      wiring_status: "slice3_compose_active",
      explanation: "Phase B Slice 3 delegation judgment observed.",
    };
  }
  if (hop.composeMode === "key_companion_guidance" || fingerprint.matches_legacy_companion) {
    return {
      slice3_path_taken: false,
      wiring_status: "legacy_companion_guidance_without_phase_b_override",
      explanation: "Legacy companion guidance path — override not in bundle.",
    };
  }
  if (hop.composeMode === "key_relational" || fingerprint.matches_legacy_relational) {
    return {
      slice3_path_taken: false,
      wiring_status: "legacy_relational_without_phase_b_override",
      explanation: "Legacy relational/trust path — override not in bundle.",
    };
  }
  return { slice3_path_taken: false, wiring_status: "indeterminate", explanation: "Slice 3 fingerprint unclear." };
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
    memory_facts: [{ theme: "보험료 부담" }],
  };
  const finalized = finalizeHumanSalesDirectorResponse({
    question: SLICE3_Q,
    classificationIntent: "general_consultation",
    surface: ONE_BRAIN_SURFACES.HOME,
    factBundle,
    customerState: { question: SLICE3_Q, keyOrchestrator: true },
  });
  const answerText = typeof finalized === "string" ? finalized : finalized.text;
  return {
    answerText,
    composeMode: finalized.key_compose_trace?.compose_mode ?? null,
    fingerprint: fingerprintAnswer(answerText),
  };
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
    schema_version: "phase-b-slice-3-preview-wiring-trace-v1",
    question: SLICE3_Q,
    recorded_at: new Date().toISOString(),
    git_short_sha: gitShortSha(),
    preview_base: resolved.previewBase,
    auth_fingerprint: previewAuthPathFingerprint(resolved),
    slice3_artifact_status: {
      phaseBSlice3DelegationJudgment_js: gitFileStatus("server/keyBrain/phaseBSlice3DelegationJudgment.js"),
      humanUnderstandingLoop_js: gitFileStatus("server/humanUnderstandingLoop.js"),
      phase_b_import_present_locally: existsSync(join(ROOT, "server/keyBrain/phaseBSlice3DelegationJudgment.js")),
    },
    local_working_tree: localHop,
    preview_runtime: remoteHop,
    jerry_pass_declaration: "none",
    tom_wiring_audit_status: "pending",
  };
  writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log("[Phase B Slice 3 Preview Wiring Trace]");
  console.log(`preview slice3_path_taken: ${remoteHop.wiring?.slice3_path_taken ?? false}`);
  console.log(`preview wiring_status: ${remoteHop.wiring?.wiring_status ?? remoteHop.probe_error ?? "unknown"}`);
  console.log(`local delegation opener: ${localHop.fingerprint.matches_delegation_opener}`);
  console.log(`preview answer prefix: ${(remoteHop.answerText ?? "").slice(0, 48)}...`);
  console.log(`Evidence: ${OUT}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
