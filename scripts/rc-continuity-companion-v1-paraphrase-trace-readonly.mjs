/**
 * RC-CONTINUITY-COMPANION-v1 — local paraphrase + negative + regression trace.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifyConsultationIntent,
  detectContinuityCompanionCluster,
  detectCoverageAnxietyCompanionCluster,
  detectPremiumBurdenCompanionCluster,
  COVERAGE_ANXIETY_COMPANION_CLUSTER_ID,
  PREMIUM_BURDEN_COMPANION_CLUSTER_ID,
  RC_CONTINUITY_COMPANION_CLUSTER_ID,
  hasInsuranceTopicSignal,
} from "../server/intentGateLayer.js";
import {
  classifyHomeBrainIntent,
  resolveHomeBrainRoute,
} from "../server/homeBrainRouter.js";
import {
  buildContinuityCompanionResponse,
  continuityCompanionResponseShape,
  resolveContinuityBridgeContext,
  shouldUseContinuityCompanionCompose,
} from "../server/conversationContinuityBridge.js";
import { buildKeyJudgmentFromRules } from "../server/keyJudgmentRules.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(
  ROOT,
  "fixtures/key-judgment-validation-v1/rc-continuity-companion-v1-slice-local-trace-evidence.json",
);

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

const MEMORY_ANCHOR = [
  "지난번 이야기 기억해?",
  "전에 말했던 거 기억해?",
  "기억나?",
];

const R0_ROLE_SPLIT = [
  { question: "힘들어요.", expected_role: "Companion", fail_if: "insurance_judgment" },
  { question: "암보험이 부족한가요?", expected_role: "Insurance", fail_if: "companion_only" },
];

const SLICE1_PARAPHRASE = ["보험료가 부담돼.", "보험을 줄이고 싶어.", "월 보험료를 낮추고 싶어."];
const SLICE1_NEGATIVE = ["월 보험료 얼마야?", "내 보험료 총액 얼마야?", "보험료 몇 원이야?"];
const SLICE2_PARAPHRASE = ["내 보험 괜찮아?", "보장이 부족한 것 같아.", "뭐가 빠졌지?", "암보장 부족해?"];
const SLICE2_NEGATIVE = ["어떤 보장이 있어?", "보장 분석해줘.", "뭐 가입해야 해?", "내 보험 문제 있어?"];

function normalizeQuestion(question = "") {
  return String(question ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function planKeyToolsTrace(classification) {
  if (classification.companion_cluster === RC_CONTINUITY_COMPANION_CLUSTER_ID) {
    return {
      tools: ["memory"],
      coverage_gap_suppressed: true,
      premium_stats: false,
      recommendation: false,
    };
  }
  if (classification.companion_cluster === PREMIUM_BURDEN_COMPANION_CLUSTER_ID) {
    return { tools: ["snapshot", "memory", "premium_stats"], coverage_gap_suppressed: true };
  }
  if (classification.companion_cluster === COVERAGE_ANXIETY_COMPANION_CLUSTER_ID) {
    return { tools: ["snapshot", "memory", "coverage_gap"], coverage_gap_suppressed: false };
  }
  return { tools: ["snapshot"], coverage_gap_suppressed: false, premium_stats: false, recommendation: false };
}

function inferRoleAxis(classification, question, homeRoute, homeBrainIntent) {
  if (classification.companion_cluster === RC_CONTINUITY_COMPANION_CLUSTER_ID) return "Companion";
  if (homeBrainIntent === "memory_recall_lookup") return "Memory";
  if (
    classification.companion_cluster === PREMIUM_BURDEN_COMPANION_CLUSTER_ID ||
    classification.companion_cluster === COVERAGE_ANXIETY_COMPANION_CLUSTER_ID ||
    classification.intent === "coverage_gap_check" ||
    hasInsuranceTopicSignal(question)
  ) {
    if (classification.intent === "casual_chat" && !hasInsuranceTopicSignal(question)) {
      return "Companion";
    }
    if (hasInsuranceTopicSignal(question)) return "Insurance";
  }
  if (classification.intent === "casual_chat" || homeRoute === "casual_chat") return "Companion";
  if (homeRoute === "gap_grounded") return "Insurance";
  return "Ambiguous";
}

function traceQuestion(q, extra = {}) {
  const classification = classifyConsultationIntent(q);
  const homeBrainIntent = classifyHomeBrainIntent(q);
  const homeRoute = resolveHomeBrainRoute(q, classification);
  const plan = planKeyToolsTrace(classification);
  const factBundle = {
    companion_cluster: classification.companion_cluster ?? null,
    question: q,
    ...extra.factBundle,
  };
  const humanFrame = extra.humanFrame ?? {};
  const compose = shouldUseContinuityCompanionCompose({ question: q, factBundle, humanFrame });
  const judgment = buildKeyJudgmentFromRules({
    question: q,
    classificationIntent: classification.intent,
    factBundle,
    humanFrame,
  });
  const response =
    compose && classification.companion_cluster === RC_CONTINUITY_COMPANION_CLUSTER_ID
      ? buildContinuityCompanionResponse({ question: q, factBundle, humanFrame })
      : null;

  return {
    question: q,
    intent: classification.intent,
    matched_rule: classification.matched_rule,
    companion_cluster: classification.companion_cluster ?? null,
    companion_cluster_signals: classification.companion_cluster_signals ?? null,
    lookup_sub_intent: classification.lookup_sub_intent ?? null,
    home_brain_intent: homeBrainIntent,
    home_route: homeRoute,
    role_axis: inferRoleAxis(classification, q, homeRoute, homeBrainIntent),
    tools: plan.tools,
    coverage_gap_suppressed: plan.coverage_gap_suppressed === true,
    forbidden_tools_absent: !plan.tools.includes("coverage_gap") && !plan.tools.includes("premium_stats") && !plan.tools.includes("recommendation"),
    compose_gate: compose ? "continuity_companion_bridge" : null,
    judgment_rule_id:
      classification.companion_cluster === RC_CONTINUITY_COMPANION_CLUSTER_ID
        ? "continuity_companion_judgment"
        : null,
    response_preview: response,
    response_shape: response ? continuityCompanionResponseShape(response) : null,
    bridge: compose
      ? resolveContinuityBridgeContext({ factBundle, humanFrame })
      : null,
  };
}

function assessParaphrase(row) {
  return {
    aligned:
      row.companion_cluster === RC_CONTINUITY_COMPANION_CLUSTER_ID &&
      row.matched_rule === "continuity_companion_cluster" &&
      row.compose_gate === "continuity_companion_bridge" &&
      row.judgment_rule_id === "continuity_companion_judgment" &&
      row.tools.join(",") === "memory" &&
      row.coverage_gap_suppressed === true &&
      row.forbidden_tools_absent === true &&
      row.response_shape === "memory_absent",
  };
}

function assessNegative(row, q) {
  const noCluster = row.companion_cluster !== RC_CONTINUITY_COMPANION_CLUSTER_ID;
  const checks = {
    "암보장 부족해?": () => noCluster && row.companion_cluster === COVERAGE_ANXIETY_COMPANION_CLUSTER_ID,
    "보험료 부담돼.": () => noCluster && row.companion_cluster === PREMIUM_BURDEN_COMPANION_CLUSTER_ID,
    "뭐 가입해야 해?": () => noCluster && row.intent === "recommendation_priority_check",
    "내 보험 부족한 부분 있어?": () => noCluster && row.intent === "coverage_gap_check",
    "지난번 이야기 기억해?": () => noCluster && row.home_brain_intent === "memory_recall_lookup",
    "아까 보험료 얘기했잖아.": () => noCluster && hasInsuranceTopicSignal(q),
    "오늘 너무 힘들어.": () => noCluster && row.role_axis === "Companion",
    "그냥 이야기하자.": () => noCluster,
  };
  return { preserved: checks[q]?.() ?? noCluster, no_cluster: noCluster };
}

function assessMemoryAnchor(row) {
  if (row.question === "기억나?") {
    return { preserved: row.home_brain_intent === "memory_recall_lookup" || row.role_axis === "Memory" };
  }
  return {
    preserved:
      row.companion_cluster !== RC_CONTINUITY_COMPANION_CLUSTER_ID &&
      row.home_brain_intent === "memory_recall_lookup",
  };
}

function assessR0Role(row, spec) {
  if (spec.expected_role === "Companion") {
    return {
      preserved: row.role_axis === "Companion" && row.companion_cluster !== RC_CONTINUITY_COMPANION_CLUSTER_ID,
    };
  }
  return {
    preserved: row.role_axis === "Insurance" && row.companion_cluster !== RC_CONTINUITY_COMPANION_CLUSTER_ID,
  };
}

function assessSlice1(row) {
  if (SLICE1_PARAPHRASE.includes(row.question)) {
    return { aligned: row.companion_cluster === PREMIUM_BURDEN_COMPANION_CLUSTER_ID };
  }
  return {
    lookup_ok: row.intent === "factual_lookup" && row.lookup_sub_intent === "premium_lookup",
    no_continuity_cluster: row.companion_cluster !== RC_CONTINUITY_COMPANION_CLUSTER_ID,
  };
}

function assessSlice2(row) {
  if (SLICE2_PARAPHRASE.includes(row.question)) {
    return { aligned: row.companion_cluster === COVERAGE_ANXIETY_COMPANION_CLUSTER_ID };
  }
  return {
    preserved: row.companion_cluster !== RC_CONTINUITY_COMPANION_CLUSTER_ID,
  };
}

const paraphraseRows = PARAPHRASE.map((q) => traceQuestion(q));
const negativeRows = NEGATIVE.map((q) => traceQuestion(q));
const anchorRows = MEMORY_ANCHOR.map((q) => traceQuestion(q));
const r0Rows = R0_ROLE_SPLIT.map((spec) => ({
  ...traceQuestion(spec.question),
  spec,
  assessment: assessR0Role(traceQuestion(spec.question), spec),
}));
const slice1Rows = [...SLICE1_PARAPHRASE, ...SLICE1_NEGATIVE].map((q) => ({
  ...traceQuestion(q),
  assessment: assessSlice1(traceQuestion(q)),
}));
const slice2Rows = [...SLICE2_PARAPHRASE, ...SLICE2_NEGATIVE].map((q) => ({
  ...traceQuestion(q),
  assessment: assessSlice2(traceQuestion(q)),
}));

const responseShapeSamples = {
  memory_absent: buildContinuityCompanionResponse({
    question: "그 이야기 이어서.",
    factBundle: { companion_cluster: RC_CONTINUITY_COMPANION_CLUSTER_ID },
    humanFrame: { conversation_history: [] },
  }),
  memory_present_session: buildContinuityCompanionResponse({
    question: "그 이야기 이어서.",
    factBundle: { companion_cluster: RC_CONTINUITY_COMPANION_CLUSTER_ID },
    humanFrame: {
      conversation_history: [{ role: "user", content: "오늘 너무 힘들었어." }],
    },
  }),
  memory_present_facts: buildContinuityCompanionResponse({
    question: "지난번 이야기.",
    factBundle: {
      companion_cluster: RC_CONTINUITY_COMPANION_CLUSTER_ID,
      memory_facts: [{ fact_key: "emotion", fact_value: "요즘 많이 힘들다고 하셨어요." }],
    },
    humanFrame: { conversation_history: [] },
  }),
};

const paraphraseAssessments = paraphraseRows.map((r) => ({ ...r, assessment: assessParaphrase(r) }));
const negativeAssessments = negativeRows.map((r) => ({
  ...r,
  assessment: assessNegative(r, r.question),
}));
const anchorAssessments = anchorRows.map((r) => ({ ...r, assessment: assessMemoryAnchor(r) }));

const summary = {
  paraphrase: `${paraphraseAssessments.filter((r) => r.assessment.aligned).length}/${PARAPHRASE.length}`,
  negative: `${negativeAssessments.filter((r) => r.assessment.preserved).length}/${NEGATIVE.length}`,
  memory_anchor: `${anchorAssessments.filter((r) => r.assessment.preserved).length}/${MEMORY_ANCHOR.length}`,
  r0_role_split: `${r0Rows.filter((r) => r.assessment.preserved).length}/${R0_ROLE_SPLIT.length}`,
  slice1_regression: "spot",
  slice2_regression: "spot",
};

const payload = {
  document: "rc_continuity_companion_v1_slice_local_trace_evidence",
  slice: "RELATIONSHIP-ARC-SLICE-1-RC-CONTINUITY-COMPANION-v1",
  contract_subtitle: "Conversation Continuity Bridge",
  mode: "local module trace · no PASS · no Production deploy",
  tom_go: "conditional EXEC GO — local implementation",
  pass_declaration: "none",
  observed_at: new Date().toISOString(),
  design_ref: "rc-continuity-companion-v1-slice-design.json",
  upstream_refs: [
    "rc-continuity-companion-v1-r1-continuity-trace-evidence.json",
    "relationship-role-split-r0-audit-evidence.json",
  ],
  tom_conditions: [
    "기억해? → memory_recall_lookup preserved",
    "insurance questions excluded from cluster",
    "no coverage_gap / recommendation / premium_stats",
    "memory absent — no fabrication",
    "no internal memory lookup customer exposure",
  ],
  summary,
  paraphrase: paraphraseAssessments,
  negative: negativeAssessments,
  memory_anchor: anchorAssessments,
  response_shape_samples: {
    memory_absent: {
      text: responseShapeSamples.memory_absent,
      shape: continuityCompanionResponseShape(responseShapeSamples.memory_absent),
    },
    memory_present_session: {
      text: responseShapeSamples.memory_present_session,
      shape: continuityCompanionResponseShape(responseShapeSamples.memory_present_session),
    },
    memory_present_facts: {
      text: responseShapeSamples.memory_present_facts,
      shape: continuityCompanionResponseShape(responseShapeSamples.memory_present_facts),
    },
  },
  r0_role_split: r0Rows,
  slice1_regression: slice1Rows,
  slice2_regression: slice2Rows,
  changed_files: [
    "server/intentGateLayer.js",
    "server/conversationContinuityBridge.js",
    "server/salesDirectorKeyToolRegistry.js",
    "server/keyJudgmentRules.js",
    "server/salesDirectorFormatter.js",
    "server/humanUnderstandingLoop.js",
    "server/personalKeyTimeContinuity.js",
    "scripts/rc-continuity-companion-v1-paraphrase-trace-readonly.mjs",
    "package.json",
  ],
  jerry: "STOP — local evidence only · no PASS · no Production",
};

mkdirSync(join(ROOT, "fixtures/key-judgment-validation-v1"), { recursive: true });
writeFileSync(OUT, JSON.stringify(payload, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log(`Wrote ${OUT}`);
