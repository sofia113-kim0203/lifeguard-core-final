/**
 * Slice 2 — JC-COVERAGE-ANXIETY-v1 paraphrase + negative + Slice1 + J04 trace (local).
 * Safe import: intentGateLayer only — tool/judgment paths mirrored (Node 24 cycle workaround).
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifyConsultationIntent,
  COVERAGE_ANXIETY_COMPANION_CLUSTER_ID,
  detectCoverageAnxietyCompanionCluster,
  detectPremiumBurdenCompanionCluster,
  PREMIUM_BURDEN_COMPANION_CLUSTER_ID,
} from "../server/intentGateLayer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "fixtures/key-judgment-validation-v1/jc-coverage-anxiety-v1-slice-local-trace-evidence.json");

const loadedContext = { memory: "present", policies: "present" };

const PARAPHRASE = [
  "내 보험 괜찮아?",
  "보장이 부족한 것 같아.",
  "뭐가 빠졌지?",
  "암보장 부족해?",
];

const NEGATIVE = [
  "어떤 보장이 있어?",
  "보장 분석해줘.",
  "뭐 가입해야 해?",
  "내 보험 문제 있어?",
];

const SLICE1_PARAPHRASE = ["보험료가 부담돼.", "보험을 줄이고 싶어.", "월 보험료를 낮추고 싶어."];
const SLICE1_NEGATIVE = ["월 보험료 얼마야?", "내 보험료 총액 얼마야?", "보험료 몇 원이야?"];
const J04_SPOT = "내 보험 부족한 부분 있어?";

const JUDGMENT = {
  PREMIUM_INTERPRETATION: "premium_interpretation",
  COVERAGE_JUDGMENT: "coverage_judgment",
  GENERAL_INSURANCE_JUDGMENT: "general_insurance_judgment",
};

const GENERAL_JUDGMENT_SIGNAL =
  /부족|모자라|충분|괜찮|공백|갭|가입해야|들어야|추천|보완|설계|구성|플랜|포트폴리오|리밸런싱|재구성|줄이|절감|해지|중복|유지|고쳐|놓친|비싸|부담/i;

const COVERAGE_JUDGMENT_QUESTION_RE =
  /내\s*보험\s*괜찮|보험\s*괜찮|내\s*보장\s*괜찮|암\s*보험\s*부족|암보험\s*부족|암\s*부족|내\s*보험\s*부족|보험\s*부족한(?:\s*부분)?|부족한\s*부분\s*있|뭐가\s*빠져|빠져\s*있|빠진\s*(?:게|것|부분)/;

const QUESTION_INTENT_RULES = [
  { pattern: /내\s*보험\s*괜찮|보험\s*괜찮|내\s*보장\s*괜찮/, intent: JUDGMENT.COVERAGE_JUDGMENT },
  { pattern: /암\s*보험\s*부족|암보험\s*부족|암\s*부족/, intent: JUDGMENT.COVERAGE_JUDGMENT },
  {
    pattern: /내\s*보험\s*부족|보험\s*부족한(?:\s*부분)?|부족한\s*부분\s*있/,
    intent: JUDGMENT.COVERAGE_JUDGMENT,
  },
  {
    pattern: /뭐가\s*빠져|빠져\s*있|빠진\s*(?:게|것|부분)/,
    intent: JUDGMENT.COVERAGE_JUDGMENT,
  },
];

function normalizeQuestion(question = "") {
  return String(question ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function matchP5BrainPilotQuestion(question = "") {
  const q = normalizeQuestion(question)
    .replace(/[?!.?！？。]/g, "")
    .toLowerCase();
  if (/보험료.*(비싼|부담|높)/.test(q)) return "premium_burden";
  if (/암보험.*(부족|없|괜찮)/.test(q) || q.includes("암보험 부족")) return "cancer_coverage";
  return null;
}

function matchToolBrainSliceQuestion(question = "") {
  const q = normalizeQuestion(question);
  if (/내\s*보험\s*(있|가입|들)/.test(q) || /보험\s*(있어|가입했|들었)/.test(q)) {
    return "insurance_presence";
  }
  if (/보험료.*(부담|비싼|비싸|높)/.test(q)) return "premium_burden";
  return null;
}

function shouldAddCoverageGapTool(classification = {}, question = "") {
  const intent = classification.intent ?? "";
  if (intent === "coverage_gap_check" || intent === "coverage_review_request") return true;
  if (COVERAGE_JUDGMENT_QUESTION_RE.test(String(question ?? ""))) return true;
  return false;
}

function planKeyToolsTrace(classification, question) {
  const tools = ["snapshot"];
  if (loadedContext.memory === "present") tools.push("memory");

  if (classification.companion_cluster === PREMIUM_BURDEN_COMPANION_CLUSTER_ID) {
    tools.push("premium_stats");
    return {
      tools,
      coverage_gap_suppressed: true,
      coverage_gap_suppress_reason: "companion_cluster_jc_premium_burden_v1",
      legacy_slice: null,
    };
  }

  if (classification.companion_cluster === COVERAGE_ANXIETY_COMPANION_CLUSTER_ID) {
    tools.push("coverage_gap");
    return {
      tools,
      coverage_gap_suppressed: false,
      coverage_gap_suppress_reason: null,
      legacy_slice: null,
    };
  }

  const legacySlice = matchToolBrainSliceQuestion(question);
  if (legacySlice === "premium_burden") {
    tools.push("premium_stats");
    return {
      tools,
      coverage_gap_suppressed: true,
      coverage_gap_suppress_reason: "tool_brain_slice_parity_p11_2c",
      legacy_slice: legacySlice,
    };
  }
  if (legacySlice === "insurance_presence") {
    return {
      tools,
      coverage_gap_suppressed: true,
      coverage_gap_suppress_reason: "tool_brain_slice_parity_p11_2c",
      legacy_slice: legacySlice,
    };
  }

  if (shouldAddCoverageGapTool(classification, question)) {
    tools.push("coverage_gap");
  }

  return {
    tools,
    coverage_gap_suppressed: false,
    coverage_gap_suppress_reason: null,
    legacy_slice: null,
  };
}

function resolveJudgmentIntent(classificationIntent = "", question = "") {
  const q = normalizeQuestion(question);
  if (!q) return null;

  const premiumBurden = detectPremiumBurdenCompanionCluster(q);
  if (premiumBurden?.cluster_id === PREMIUM_BURDEN_COMPANION_CLUSTER_ID) {
    return JUDGMENT.PREMIUM_INTERPRETATION;
  }

  const coverageAnxiety = detectCoverageAnxietyCompanionCluster(q);
  if (coverageAnxiety?.cluster_id === COVERAGE_ANXIETY_COMPANION_CLUSTER_ID) {
    return JUDGMENT.COVERAGE_JUDGMENT;
  }

  for (const rule of QUESTION_INTENT_RULES) {
    if (rule.pattern.test(q)) return rule.intent;
  }

  switch (classificationIntent) {
    case "coverage_gap_check":
    case "coverage_review_request":
      return JUDGMENT.COVERAGE_JUDGMENT;
    case "general_consultation":
      return GENERAL_JUDGMENT_SIGNAL.test(q) ? JUDGMENT.GENERAL_INSURANCE_JUDGMENT : null;
    default:
      return null;
  }
}

function resolveJudgmentRuleId(classification, judgmentIntent) {
  if (classification.companion_cluster === PREMIUM_BURDEN_COMPANION_CLUSTER_ID) {
    return "premium_burden_companion_judgment";
  }
  if (classification.companion_cluster === COVERAGE_ANXIETY_COMPANION_CLUSTER_ID) {
    return "coverage_anxiety_companion_judgment";
  }
  if (judgmentIntent === JUDGMENT.COVERAGE_JUDGMENT && classification.intent === "coverage_gap_check") {
    return "coverage_gap_judgment_or_structured";
  }
  return null;
}

function traceQuestion(q) {
  const classification = classifyConsultationIntent(q);
  const plan = planKeyToolsTrace(classification, q);
  const judgmentIntent = resolveJudgmentIntent(classification.intent, q);
  const judgmentRuleId = resolveJudgmentRuleId(classification, judgmentIntent);
  const pilotKey = matchP5BrainPilotQuestion(q);
  return {
    question: q,
    intent: classification.intent,
    matched_rule: classification.matched_rule,
    companion_cluster: classification.companion_cluster ?? null,
    companion_cluster_signals: classification.companion_cluster_signals ?? null,
    lookup_sub_intent: classification.lookup_sub_intent ?? null,
    judgment_intent: judgmentIntent,
    judgment_rule_id: judgmentRuleId,
    tools: plan.tools,
    coverage_gap_suppressed: plan.coverage_gap_suppressed === true,
    pilot_key: pilotKey,
    tool_brain_slice: matchToolBrainSliceQuestion(q),
    sales_director_mode: pilotKey && !classification.companion_cluster ? "pilot" : "chat_or_orchestrator",
  };
}

function assessParaphrase(row) {
  const aligned =
    row.companion_cluster === COVERAGE_ANXIETY_COMPANION_CLUSTER_ID &&
    row.intent === "general_consultation" &&
    row.judgment_intent === JUDGMENT.COVERAGE_JUDGMENT &&
    row.judgment_rule_id === "coverage_anxiety_companion_judgment" &&
    row.tools.includes("snapshot") &&
    row.tools.includes("memory") &&
    row.tools.includes("coverage_gap") &&
    row.coverage_gap_suppressed !== true;
  return { aligned };
}

function assessNegative(row, q) {
  const noCluster = row.companion_cluster !== COVERAGE_ANXIETY_COMPANION_CLUSTER_ID;
  const byQuestion = {
    "어떤 보장이 있어?": () => noCluster && row.intent !== "general_consultation",
    "보장 분석해줘.": () => noCluster && row.intent === "coverage_review_request",
    "뭐 가입해야 해?": () => noCluster && row.intent === "recommendation_priority_check",
    "내 보험 문제 있어?": () => noCluster && row.companion_cluster == null,
  };
  const preserved = byQuestion[q]?.() ?? noCluster;
  return { no_cluster: noCluster, preserved };
}

function assessSlice1(row) {
  if (SLICE1_PARAPHRASE.includes(row.question)) {
    return {
      aligned:
        row.companion_cluster === PREMIUM_BURDEN_COMPANION_CLUSTER_ID &&
        row.judgment_rule_id === "premium_burden_companion_judgment",
    };
  }
  return {
    lookup_ok: row.intent === "factual_lookup" && row.lookup_sub_intent === "premium_lookup",
    no_coverage_cluster: row.companion_cluster !== COVERAGE_ANXIETY_COMPANION_CLUSTER_ID,
  };
}

const paraphraseRows = PARAPHRASE.map(traceQuestion);
const negativeRows = NEGATIVE.map(traceQuestion);
const slice1Rows = [...SLICE1_PARAPHRASE, ...SLICE1_NEGATIVE].map(traceQuestion);
const j04Row = traceQuestion(J04_SPOT);

const paraphraseAssessments = paraphraseRows.map((r) => ({ ...r, assessment: assessParaphrase(r) }));
const negativeAssessments = negativeRows.map((r) => ({
  ...r,
  assessment: assessNegative(r, r.question),
}));
const slice1Assessments = slice1Rows.map((r) => ({ ...r, assessment: assessSlice1(r) }));

const paraphraseAligned = paraphraseAssessments.filter((r) => r.assessment.aligned).length;
const negativePreserved = negativeAssessments.filter((r) => r.assessment.preserved).length;
const slice1ParaphraseOk = slice1Assessments
  .filter((r) => SLICE1_PARAPHRASE.includes(r.question))
  .every((r) => r.assessment.aligned);
const slice1NegativeOk = slice1Assessments
  .filter((r) => SLICE1_NEGATIVE.includes(r.question))
  .every((r) => r.assessment.lookup_ok && r.assessment.no_coverage_cluster);

const payload = {
  document: "jc_coverage_anxiety_v1_slice_local_trace_evidence",
  slice: "SLICE-2-JC-COVERAGE-ANXIETY-v1",
  mode: "local module trace · intentGateLayer-only · no PASS · no Production deploy",
  tom_go: "conditional GO — Tom 3 amendments applied",
  observed_at: new Date().toISOString(),
  pass_declaration: "none",
  design_ref: "jc-coverage-anxiety-v1-slice-design.json",
  summary: {
    paraphrase: `${paraphraseAligned}/${PARAPHRASE.length}`,
    negative: `${negativePreserved}/${NEGATIVE.length}`,
    slice1_regression: slice1ParaphraseOk && slice1NegativeOk ? "aligned" : "drift",
    j04_spot: {
      question: J04_SPOT,
      intent: j04Row.intent,
      companion_cluster: j04Row.companion_cluster,
      preserved: j04Row.intent === "coverage_gap_check" && j04Row.companion_cluster == null,
    },
  },
  paraphrase: paraphraseAssessments,
  negative_control: negativeAssessments,
  slice1_regression: slice1Assessments,
  j04_spot: j04Row,
  jerry: "STOP — local trace only · await Tom audit · no Production PASS",
};

writeFileSync(OUT, JSON.stringify(payload, null, 2));
console.log(JSON.stringify(payload.summary, null, 2));
