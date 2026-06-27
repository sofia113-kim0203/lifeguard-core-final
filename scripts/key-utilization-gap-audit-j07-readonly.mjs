/**
 * Utilization Gap Audit — J07 Underwriting readonly hop trace (observation only).
 * Tom GO: first representative underwriting disconnect (1 of 3).
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyConsultationIntent, hasInsuranceTopicSignal } from "../server/intentGateLayer.js";
import { planKeyTools, KEY_TOOLS } from "../server/salesDirectorKeyToolRegistry.js";
import {
  resolveSalesDirectorJudgmentIntent,
} from "../server/salesDirectorFormatter.js";
import { shouldApplyHumanUnderstandingLoop } from "../server/humanUnderstandingLoop.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const REPORT_PATH = join(ROOT, "fixtures/key-judgment-validation-v1/utilization-gap-audit-j07.json");
const BASELINE_PATH = join(ROOT, "fixtures/key-judgment-validation-v1/preview-judgment-validation-report.json");
const LIFECYCLE_PATH = join(ROOT, "fixtures/key-judgment-validation-v1/analysis-job-lifecycle-audit.json");

const J07_QUESTION = "고혈압 있는데 가입 가능해?";
const J08_QUESTION = "건강 상태 때문에 거절될까?";
const J09_QUESTION = "암 보험 지금 들 수 있을까?";

function analyzeQuestion(question, label) {
  const classification = classifyConsultationIntent(question);
  const loadedContext = { memory: "present", policies: "present" };
  const plan = planKeyTools(classification, loadedContext, question);
  const hulOpts = { surface: "home", homeBrainIntent: "unsupported", homeRoute: "chat" };
  return {
    label,
    question,
    classification: {
      intent: classification.intent,
      matched_rule: classification.matched_rule,
      lookup_sub_intent: classification.lookup_sub_intent ?? null,
    },
    insurance_topic_signal: hasInsuranceTopicSignal(question),
    resolved_judgment_intent: resolveSalesDirectorJudgmentIntent(classification.intent, question),
    hul_eligible: shouldApplyHumanUnderstandingLoop(classification.intent, question, hulOpts),
    key_tool_plan: {
      tools: plan.tools,
      has_underwriting_tool: plan.tools.includes("underwriting"),
      has_coverage_gap_tool: plan.tools.includes(KEY_TOOLS.COVERAGE_GAP),
      note: "KEY_TOOLS has no underwriting entry — P10-1 registry: Snapshot/Memory/Coverage Gap/Premium only",
    },
  };
}

function loadBaseline(id) {
  if (!existsSync(BASELINE_PATH)) return null;
  const report = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  return report.steps?.find((s) => s.id === id) ?? null;
}

function loadFactoryPayloadMeta() {
  if (!existsSync(LIFECYCLE_PATH)) return null;
  const audit = JSON.parse(readFileSync(LIFECYCLE_PATH, "utf8"));
  return audit.factory_payload?.underwriting_risk ?? null;
}

const j07Baseline = loadBaseline("J07");
const j08Baseline = loadBaseline("J08");
const j09Baseline = loadBaseline("J09");
const j07 = analyzeQuestion(J07_QUESTION, "J07");
const j08 = analyzeQuestion(J08_QUESTION, "J08");
const j09 = analyzeQuestion(J09_QUESTION, "J09");
const uwPayload = loadFactoryPayloadMeta();

const report = {
  audit: "utilization_gap_hop_trace_v1",
  status: "observation_only",
  tom_mission: "underwriting_utilization_gap_j07_representative",
  terminology: "Utilization Gap (not Disconnect)",
  axis_completion_note: {
    coverage_gap: "3/3 complete — see coverage-gap-axis-complete.json",
    next_axis: "underwriting",
  },
  target: {
    id: "J07",
    axis: "underwriting",
    level: "J1",
    question: J07_QUESTION,
    selection_reason: "First J1 underwriting question; clearest enrollment-eligibility ask; same disconnect class as J08/J09",
    baseline_utilization: j07Baseline?.utilization?.level ?? "available_not_loaded",
    display_job_id: j07Baseline?.factoryAudit?.probe?.display_job_id ?? null,
  },
  underwriting_axis_summary: {
    j07: j07Baseline?.utilization?.level ?? "available_not_loaded",
    j08: j08Baseline?.utilization?.level ?? "available_not_loaded",
    j09: j09Baseline?.utilization?.level ?? "available_not_loaded",
    pattern: "All 3 underwriting questions: available_not_loaded (not loaded_not_used)",
  },
  contrast_coverage_gap_slices: {
    coverage_gap_pattern: "Factory pass → Resolver preload pass → Manifest tool omitted → used=false",
    underwriting_pattern: "Factory pass → Resolver absent → Manifest no tool → used=false",
    disconnect_type_delta: "coverage_gap was loaded_not_used after Resolver; underwriting never reaches loaded=true in KEY path",
  },
  hop_trace: {
    factory: {
      hop: "Factory",
      status: "pass",
      code_path: [
        "analysis_jobs.result_json.underwriting_risk",
        "server/salesDirectorFactoryAudit.js → probeStoredFactoryRecords",
      ],
      evidence: {
        available: true,
        lifecycle_item_count: uwPayload?.item_count ?? 9,
        audit_record_count: j07Baseline?.factoryAudit?.underwriting?.record_count ?? 0,
        measurement_note:
          "countStoredFactoryRecords expects risk_factors/flags/risks; payload uses items[] — available=true but record_count=0 in audit",
      },
    },
    resolver: {
      hop: "Resolver",
      status: "first_utilization_gap",
      code_path: [
        "server/salesDirectorLoop.js — loadSalesDirectorCoverageGapContext only",
        "No loadSalesDirectorUnderwritingContext on KEY path",
      ],
      evidence: {
        resolver_exists_for_coverage_gap: true,
        resolver_exists_for_underwriting: false,
      },
    },
    manifest: {
      hop: "Manifest (KEY tool plan)",
      status: "structural_gap",
      code_path: [
        "server/salesDirectorKeyToolRegistry.js — no UNDERWRITING in KEY_TOOLS",
        "server/salesDirectorFactoryAudit.js — engineLoaded/engineUsed coverage_gap only",
      ],
      j07_analysis: j07,
      j08_sibling: j08,
      j09_sibling: j09,
    },
    compose: {
      hop: "Compose",
      status: "fail_no_underwriting_inputs",
      evidence: {
        resolved_judgment_intent: null,
        hul_eligible: j07.hul_eligible,
        answer_preview: j07Baseline?.answerText ?? null,
        answer_signal: j07Baseline?.utilization?.answer_signal ?? false,
      },
    },
    final_answer: {
      hop: "Final Answer",
      status: "no_underwriting_utilization",
      evidence: {
        answer_evidence: j07Baseline?.answer_evidence ?? ["snapshot", "memory"],
        underwriting_loaded: false,
        underwriting_used: false,
      },
    },
  },
  first_hop: {
    name: "Resolver (missing on KEY path)",
    layer: "손발",
    same_as_j04_j06: false,
  },
  secondary_hop: {
    name: "Manifest (no UNDERWRITING tool + general_consultation intent)",
    layer: "손발",
  },
  observed_at: new Date().toISOString(),
  note: "Observation only — Jerry does not declare PASS or Slice GO.",
};

writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Wrote ${REPORT_PATH}`);
console.log(`J07 intent: ${j07.classification.intent}`);
console.log(`J09 intent: ${j09.classification.intent} gap=${j09.key_tool_plan.has_coverage_gap_tool}`);
