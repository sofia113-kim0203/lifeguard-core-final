/**
 * P2a — Tom-first light path for coverage_gap_check (policies-only, skip heavy pipeline).
 */
import { ONE_BRAIN_SURFACES } from "./oneBrainResponseLayer.js";
import { applyTom2AGapVoiceIfEligible, isTom2AGapVoiceEnabled } from "./tomThinkingLoop.js";

function normalizeQuestion(question = "") {
  return String(question ?? "").replace(/\s+/g, " ").trim();
}

export function isTomGapLightPathEnabled(env = process.env) {
  const flag = String(env?.TOM_GAP_LIGHT_PATH ?? env?.P2A_GAP_LIGHT_PATH ?? "true")
    .trim()
    .toLowerCase();
  return flag !== "false" && flag !== "0";
}

export function shouldUseTomGapLightPath(intentClassification, env = process.env) {
  if (!isTomGapLightPathEnabled(env)) return false;
  if (!isTom2AGapVoiceEnabled(env)) return false;
  const intent =
    typeof intentClassification === "string" ? intentClassification : intentClassification?.intent ?? null;
  return intent === "coverage_gap_check";
}

/** Policies-only bundle — same policy rows as legacy path, no inventory fields for Tom audit. */
export function buildTomGapLightFactBundle(policies = [], question = "") {
  const policyRows = Array.isArray(policies) ? policies : [];
  return {
    policies: policyRows,
    policy_count: policyRows.length,
    question: normalizeQuestion(question),
  };
}

export async function runTomGapLightVoiceTurn({
  question = "",
  intentClassification = null,
  surface = ONE_BRAIN_SURFACES.CONSULTATION,
  policies = [],
  history = [],
  fetchImpl = fetch,
  env = process.env,
  handler = "",
  startedAt = Date.now(),
} = {}) {
  const factBundle = buildTomGapLightFactBundle(policies, question);
  const tomApply = await applyTom2AGapVoiceIfEligible({
    question,
    intentClassification,
    surface,
    factBundle,
    history,
    fetchImpl,
    env,
    handler,
  });
  const elapsed_ms = Date.now() - startedAt;
  return {
    tomApply,
    factBundle,
    elapsed_ms,
    path: "tom_gap_light",
    skipped_stages: [
      "central_brain",
      "advisor_brain",
      "analysis_context",
      "build_conversational_answer",
      "guidance_builder",
    ],
  };
}
