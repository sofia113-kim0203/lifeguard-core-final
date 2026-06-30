/**
 * Slice 1 — JC-PREMIUM-BURDEN-v1 paraphrase trace (local readonly).
 */
import { writeFileSync } from "node:fs";
import { classifyConsultationIntent } from "../server/intentGateLayer.js";
import { matchP5BrainPilotQuestion } from "../server/p5BrainPilotQuestions.js";
import { matchToolBrainSliceQuestion } from "../server/salesDirectorToolBrain.js";
import { resolveSalesDirectorJudgmentIntent } from "../server/salesDirectorFormatter.js";
import { planKeyTools } from "../server/salesDirectorKeyToolRegistry.js";
import { resolveKeyJudgmentRule } from "../server/keyJudgmentRules.js";

const loadedContext = { memory: "present", policies: "present" };

function traceQuestion(q) {
  const classification = classifyConsultationIntent(q);
  const plan = planKeyTools(classification, loadedContext, q);
  const judgmentIntent = resolveSalesDirectorJudgmentIntent(classification.intent, q);
  const rule = resolveKeyJudgmentRule({
    question: q,
    resolvedIntent: judgmentIntent,
    classificationIntent: classification.intent,
    factBundle: {
      companion_cluster: classification.companion_cluster ?? null,
      lookup_sub_intent: classification.lookup_sub_intent ?? null,
    },
  });
  const pilotKey = matchP5BrainPilotQuestion(q);
  const pilotBypassed = pilotKey != null && classification.companion_cluster != null;
  const salesDirectorMode = pilotKey && !classification.companion_cluster ? "pilot" : "chat_or_orchestrator";
  return {
    question: q,
    intent: classification.intent,
    matched_rule: classification.matched_rule,
    companion_cluster: classification.companion_cluster ?? null,
    lookup_sub_intent: classification.lookup_sub_intent ?? null,
    judgment_intent: judgmentIntent,
    judgment_rule_id: rule?.id ?? null,
    tools: plan.tools,
    coverage_gap_suppressed: plan.coverage_gap_suppressed === true,
    pilot_key: pilotKey,
    tool_brain_slice: matchToolBrainSliceQuestion(q),
    sales_director_mode: salesDirectorMode,
    pilot_bypassed: pilotBypassed,
  };
}

const paraphrase = ["보험료가 부담돼.", "보험을 줄이고 싶어.", "월 보험료를 낮추고 싶어."];
const negative = ["월 보험료 얼마야?", "내 보험료 총액 얼마야?", "보험료 몇 원이야?"];

const results = {
  paraphrase: paraphrase.map(traceQuestion),
  negative_control: negative.map(traceQuestion),
};

const payload = {
  document: "jc_premium_burden_v1_slice_local_trace_evidence",
  slice: "SLICE-1-JC-PREMIUM-BURDEN-v1",
  mode: "local readonly trace · no PASS declaration",
  observed_at: new Date().toISOString(),
  pass_declaration: "none",
  results,
};

writeFileSync(
  "fixtures/key-judgment-validation-v1/jc-premium-burden-v1-slice-local-trace-evidence.json",
  JSON.stringify(payload, null, 2),
);
console.log(JSON.stringify(payload, null, 2));
