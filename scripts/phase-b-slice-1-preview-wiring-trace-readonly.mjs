/**
 * Phase B Slice 1 — Preview HUL compose wiring trace (readonly).
 * Tom: trace which path "내 보험 괜찮아?" takes — do NOT modify Slice 1 compose.
 *
 * Usage:
 *   node scripts/phase-b-slice-1-preview-wiring-trace-readonly.mjs [preview-url]
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
import { COVERAGE_ANXIETY_COMPANION_CLUSTER_ID, classifyConsultationIntent } from "../server/intentGateLayer.js";
import { ONE_BRAIN_SURFACES } from "../server/oneBrainResponseLayer.js";

const ROOT = join(import.meta.dirname, "..");
const FIX = join(ROOT, "fixtures", "key-judgment-validation-v1");
const OUT = join(FIX, "phase-b-slice-1-preview-wiring-trace-evidence.json");

const SLICE1_Q = "내 보험 괜찮아?";
const OLD_RULE_JUDGMENT_PREFIX = "보장이 걱정되시는 마음은 이해해요";
const PHASE_B_JUDGMENT_PREFIX = "지금 확인";

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
    responseSource: done.response_source ?? keyPath.final_selection?.response_source ?? null,
    salesDirectorMode:
      keyPath.key_loop?.sales_director_mode ?? trace.key_orchestrator?.mode ?? null,
    classificationIntent: keyPath.classificationIntent ?? done.consultation_intent ?? null,
    matchedRule: keyPath.matched_rule ?? null,
    companionCluster: keyPath.companion_cluster ?? done.factBundle?.companion_cluster ?? null,
    composeMode: keyCompose.compose_mode ?? keyPath.build_key_structured_response?.compose_mode ?? null,
    keyComposeCalled: keyCompose.called ?? keyPath.build_key_structured_response?.called ?? null,
    keyToolsCalled: keyPath.key_loop?.key_tools_called ?? trace.key_orchestrator?.tools_called ?? [],
    generationMode: finalizeTrace.generation_mode ?? keyPath.hul?.generation_mode ?? null,
    hulEntered: keyPath.hul?.entered ?? null,
    composeTextPreview: keyCompose.text_preview ?? keyPath.build_key_structured_response?.text_preview ?? null,
    coverageGapSuppressed: keyPath.tool_brain_absorbed?.coverage_gap_suppressed ?? null,
  };
}

function fingerprintAnswer(text = "") {
  const answer = String(text);
  return {
    matches_old_rule_judgment: answer.startsWith(OLD_RULE_JUDGMENT_PREFIX),
    matches_phase_b_judgment: answer.startsWith(PHASE_B_JUDGMENT_PREFIX),
    has_internal_reason_phrase: /저장된\s*분석\s*기준/.test(answer),
    has_empathy_opener: /걱정되시는|마음은\s*이해/.test(answer),
    has_phase_b_limit_phrase: /단정하지\s*않|확인되지\s*않/.test(answer),
    has_companion_pledge: /이번에는.*같이/.test(answer),
  };
}

function inferWiringVerdict(hop, fingerprint) {
  const expectedRule = resolveKeyJudgmentRule({
    question: SLICE1_Q,
    classificationIntent: hop.classificationIntent ?? "general_consultation",
    factBundle: { companion_cluster: hop.companionCluster ?? COVERAGE_ANXIETY_COMPANION_CLUSTER_ID },
  });

  if (fingerprint.matches_phase_b_judgment) {
    return {
      slice1_path_taken: true,
      wiring_status: "slice1_compose_active",
      explanation: "Phase B Slice 1 judgment prefix observed in answer.",
    };
  }

  if (
    hop.composeMode === "key_structured" &&
    expectedRule?.id === "coverage_anxiety_companion_judgment" &&
    fingerprint.matches_old_rule_judgment
  ) {
    return {
      slice1_path_taken: false,
      wiring_status: "legacy_rule_compose_without_phase_b_override",
      explanation:
        "HUL key_structured + coverage_anxiety_companion_judgment reached, but answer matches pre-Slice-1 rule text — Phase B override not active in runtime bundle.",
    };
  }

  if (hop.composeMode !== "key_structured") {
    return {
      slice1_path_taken: false,
      wiring_status: "non_key_structured_compose",
      explanation: `Compose mode is ${hop.composeMode ?? "unknown"} — not key_structured.`,
    };
  }

  return {
    slice1_path_taken: false,
    wiring_status: "indeterminate",
    explanation: "Path reached key_structured but Slice 1 fingerprint unclear.",
  };
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
        coverage_summary: {
          riders: [{ rider_name: "실손의료비", normalized_name: "실손의료비" }],
        },
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
  const keyCompose = finalized.key_compose_trace ?? {};

  return {
    source: "local_working_tree_finalizeHumanSalesDirectorResponse",
    answerText,
    composeMode: keyCompose.compose_mode ?? null,
    generationMode: finalized.generation_mode ?? null,
    fingerprint: fingerprintAnswer(answerText),
    expectedJudgmentRuleId: resolveKeyJudgmentRule({
      question: SLICE1_Q,
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
    question: SLICE1_Q,
    history: [],
    bypassSecret: resolved.bypass,
  });

  if (!probe.ok) {
    return {
      source: "preview_customer_home_brain_fact",
      probe_ok: false,
      probe_error: probe.unauthorized ? "UNAUTHORIZED" : `http_${probe.http_status ?? "unknown"}`,
      http_status: probe.http_status ?? null,
    };
  }

  const hop = extractHopTrace(parseSse(probe.stdout));
  const fingerprint = fingerprintAnswer(hop.answerText);
  const wiring = inferWiringVerdict(hop, fingerprint);

  return {
    source: "preview_customer_home_brain_fact",
    probe_ok: true,
    http_status: probe.http_status ?? 200,
    ...hop,
    fingerprint,
    expectedJudgmentRuleId: "coverage_anxiety_companion_judgment",
    wiring,
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

  const slice1Artifacts = {
    phaseBSlice1CoverageJudgment_js: gitFileStatus("server/keyBrain/phaseBSlice1CoverageJudgment.js"),
    humanUnderstandingLoop_js: gitFileStatus("server/humanUnderstandingLoop.js"),
    phase_b_import_present_locally: existsSync(join(ROOT, "server/keyBrain/phaseBSlice1CoverageJudgment.js")),
  };

  const evidence = {
    schema_version: "phase-b-slice-1-preview-wiring-trace-v1",
    audit_purpose:
      "Preview에서 내 보험 괜찮아? HUL compose 경로 추적 — Slice 1 수정 금지 · wiring 판정만",
    question: SLICE1_Q,
    recorded_at: new Date().toISOString(),
    git_short_sha: gitShortSha(),
    preview_base: resolved.previewBase,
    auth_fingerprint: previewAuthPathFingerprint(resolved),
    slice1_artifact_status: slice1Artifacts,
    expected_path: {
      ingress: "customer-home-brain-fact → salesDirectorLoop → finalizeHumanSalesDirectorResponse",
      compose: "key_structured (generateHumanSalesDirectorResponse)",
      judgment_rule: "coverage_anxiety_companion_judgment",
      companion_cluster: COVERAGE_ANXIETY_COMPANION_CLUSTER_ID,
      phase_b_override:
        "buildKeyStructuredResponse → buildPhaseBSlice1CoverageJudgment when rule id matches",
    },
    local_working_tree: localHop,
    preview_runtime: remoteHop,
    tom_wiring_decision_tree: {
      slice1_path_not_taken: remoteHop.wiring?.slice1_path_taken === false,
      recommended_next: remoteHop.wiring?.slice1_path_taken
        ? "If answer still old → Slice 1 implementation fix"
        : "Wiring/deploy — ensure Phase B override is in Preview runtime bundle",
    },
    jerry_pass_declaration: "none",
    tom_wiring_audit_status: "pending",
  };

  writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

  console.log("[Phase B Slice 1 Preview Wiring Trace]");
  console.log(`preview compose_mode: ${remoteHop.composeMode ?? "(probe failed)"}`);
  console.log(`preview judgment_rule path: ${remoteHop.expectedJudgmentRuleId ?? "(n/a)"}`);
  console.log(`preview slice1_path_taken: ${remoteHop.wiring?.slice1_path_taken ?? false}`);
  console.log(`preview wiring_status: ${remoteHop.wiring?.wiring_status ?? remoteHop.probe_error ?? "unknown"}`);
  console.log(`local slice1_path_taken: ${localHop.fingerprint.matches_phase_b_judgment}`);
  console.log(`local answer prefix: ${localHop.answerText.slice(0, 40)}...`);
  console.log(`preview answer prefix: ${(remoteHop.answerText ?? "").slice(0, 40)}...`);
  console.log(`Evidence: ${OUT}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
