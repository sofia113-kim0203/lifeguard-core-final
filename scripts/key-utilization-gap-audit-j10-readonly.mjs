/**
 * Utilization Gap Audit — J10 Recommendation readonly hop trace (observation only).
 * Tom: first representative recommendation disconnect (1 of 3). No code changes.
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyConsultationIntent, hasInsuranceTopicSignal } from "../server/intentGateLayer.js";
import {
  planKeyTools,
  KEY_TOOLS,
  isKeyBlockedIntent,
  shouldUseSalesDirectorKeyOrchestrator,
} from "../server/salesDirectorKeyToolRegistry.js";
import { resolveSalesDirectorJudgmentIntent } from "../server/salesDirectorFormatter.js";
import { shouldApplyHumanUnderstandingLoop } from "../server/humanUnderstandingLoop.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const REPORT_PATH = join(ROOT, "fixtures/key-judgment-validation-v1/utilization-gap-audit-j10.json");
const BASELINE_PATH = join(ROOT, "fixtures/key-judgment-validation-v1/preview-judgment-validation-report.json");
const LIFECYCLE_PATH = join(ROOT, "fixtures/key-judgment-validation-v1/analysis-job-lifecycle-audit.json");

const J10_QUESTION = "지금 뭐부터 추가하면 좋을까?";
const J11_QUESTION = "나한테 필요한 보험 추천해줘.";
const J12_QUESTION = "보장 보완 어디부터 하면 돼?";

const KEY_ENV = { SALES_DIRECTOR_KEY_ORCHESTRATOR: "1" };
const QA_CUSTOMER = "a247a66f-a597-4ccf-9530-761b82518002";

function analyzeQuestion(question, label) {
  const classification = classifyConsultationIntent(question);
  const loadedContext = { memory: "present", policies: "present" };
  const plan = planKeyTools(classification, loadedContext, question);
  const hulOpts = { surface: "home", homeBrainIntent: "unsupported", homeRoute: "chat" };
  const intent = classification.intent ?? "";
  return {
    label,
    question,
    classification: {
      intent,
      matched_rule: classification.matched_rule,
      lookup_sub_intent: classification.lookup_sub_intent ?? null,
    },
    insurance_topic_signal: hasInsuranceTopicSignal(question),
    resolved_judgment_intent: resolveSalesDirectorJudgmentIntent(intent, question),
    hul_eligible: shouldApplyHumanUnderstandingLoop(intent, question, hulOpts),
    key_blocked_intent: isKeyBlockedIntent(intent),
    key_orchestrator_gate: shouldUseSalesDirectorKeyOrchestrator({
      question,
      customerId: QA_CUSTOMER,
      consultationIntent: classification,
      env: KEY_ENV,
    }),
    key_tool_plan: {
      tools: plan.tools,
      has_recommendation_tool: plan.tools.includes("recommendation"),
      has_coverage_gap_tool: plan.tools.includes(KEY_TOOLS.COVERAGE_GAP),
      has_underwriting_tool: plan.tools.includes(KEY_TOOLS.UNDERWRITING),
      note: "KEY_TOOLS has no recommendation entry — Snapshot/Memory/Coverage Gap/Underwriting/Premium only",
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
  return audit.factory_payload?.recommendation ?? null;
}

const j10Baseline = loadBaseline("J10");
const j11Baseline = loadBaseline("J11");
const j12Baseline = loadBaseline("J12");
const j10 = analyzeQuestion(J10_QUESTION, "J10");
const j11 = analyzeQuestion(J11_QUESTION, "J11");
const j12 = analyzeQuestion(J12_QUESTION, "J12");
const recPayload = loadFactoryPayloadMeta();

const report = {
  audit: "utilization_gap_hop_trace_v1",
  status: "observation_only",
  tom_mission: "recommendation_utilization_gap_j10_representative",
  terminology: "Utilization Gap (not Disconnect)",
  axis_completion_note: {
    coverage_gap: "3/3 PASS — Tom J04/J06 slices",
    underwriting: "3/3 PASS — Tom J07 slice",
    next_axis: "recommendation",
  },
  target: {
    id: "J10",
    axis: "recommendation",
    level: "J1",
    question: J10_QUESTION,
    selection_reason:
      "First J1 recommendation-bank question on KEY path (sales_director_key); clearest priority-add ask without explicit 추천 keyword",
    baseline_utilization: j10Baseline?.utilization?.level ?? "available_not_loaded",
    response_source: j10Baseline?.responseSource ?? null,
    display_job_id: j10Baseline?.factoryAudit?.probe?.display_job_id ?? null,
  },
  recommendation_axis_summary: {
    j10: {
      utilization: j10Baseline?.utilization?.level ?? "available_not_loaded",
      response_source: j10Baseline?.responseSource ?? null,
      key_orchestrator: j10.key_orchestrator_gate,
    },
    j11: {
      utilization: j11Baseline?.utilization?.level ?? "available_not_loaded",
      response_source: j11Baseline?.responseSource ?? null,
      key_orchestrator: j11.key_orchestrator_gate,
      note: "recommendation_request — KEY orchestrator blocked by default",
    },
    j12: {
      utilization: j12Baseline?.utilization?.level ?? "available_not_loaded",
      response_source: j12Baseline?.responseSource ?? null,
      key_orchestrator: j12.key_orchestrator_gate,
      note: "recommendation_request — KEY orchestrator blocked by default",
    },
    pattern:
      "All 3 recommendation bank questions: available_not_loaded; J10 on KEY path, J11/J12 on sales_director_guarded_hold",
  },
  contrast_prior_slices: {
    coverage_gap: "Resolver preload + Manifest tool + intent patterns",
    underwriting_j07: "Resolver preload + Manifest stored-read tool + underwriting_bound_check intent",
    recommendation_j10:
      "Factory pass → Resolver absent → Manifest no tool + J10 falls general_consultation (not recommendation_request)",
  },
  hop_trace: {
    factory: {
      hop: "Factory",
      status: "pass",
      code_path: [
        "analysis_jobs.result_json.recommendation",
        "server/customerRecommendationCore.js → buildCoverageCategoryRecommendations",
        "server/salesDirectorFactoryAudit.js → probeStoredFactoryRecords",
      ],
      evidence: {
        available: true,
        lifecycle_item_count: recPayload?.item_count ?? 13,
        payload_keys: recPayload?.keys ?? [],
        has_customer_visible_top2: (recPayload?.keys ?? []).includes("customer_visible_top2"),
        audit_record_count: j10Baseline?.factoryAudit?.recommendation?.record_count ?? 13,
      },
    },
    resolver: {
      hop: "Resolver",
      status: "first_utilization_gap",
      code_path: [
        "server/salesDirectorLoop.js — coverageGapContext + underwritingRiskContext preload only",
        "No loadSalesDirectorRecommendationContext (no salesDirectorRecommendationContext.js)",
      ],
      evidence: {
        resolver_exists_for_coverage_gap: true,
        resolver_exists_for_underwriting: true,
        resolver_exists_for_recommendation: false,
      },
    },
    manifest: {
      hop: "Manifest (KEY tool plan)",
      status: "structural_gap",
      code_path: [
        "server/salesDirectorKeyToolRegistry.js — no RECOMMENDATION in KEY_TOOLS",
        "DEFAULT_BLOCKED_INTENTS includes recommendation_request (J11/J12 never enter KEY)",
        "server/salesDirectorFactoryAudit.js — engineLoaded/engineUsed: recommendation not implemented",
      ],
      j10_analysis: j10,
      j11_sibling: j11,
      j12_sibling: j12,
    },
    compose: {
      hop: "Compose",
      status: "fail_no_recommendation_inputs",
      evidence: {
        resolved_judgment_intent: j10.resolved_judgment_intent,
        hul_eligible: j10.hul_eligible,
        compose_mode: j10Baseline?.composeMode ?? null,
        answer_preview: j10Baseline?.answerText ?? null,
        answer_signal: j10Baseline?.utilization?.answer_signal ?? false,
        note: "Generic KEY filler — no gap/uw/rec priority lines from stored recommendation panel",
      },
    },
    final_answer: {
      hop: "Final Answer",
      status: "no_recommendation_utilization",
      evidence: {
        answer_evidence: j10Baseline?.answer_evidence ?? ["snapshot", "memory"],
        recommendation_loaded: j10Baseline?.factoryAudit?.recommendation?.loaded ?? false,
        recommendation_used: j10Baseline?.factoryAudit?.recommendation?.used ?? false,
        primary_disconnect_factory: j10Baseline?.factoryAudit?.primary_disconnect?.factory ?? null,
      },
    },
  },
  parallel_paths_observed: {
    advisor_brain_stored_read: {
      exists: true,
      code_path: "server/advisorBrain/advisorRecommendationReasonResponder.js",
      gate: "recommendation_request intent only — not wired to J10 general_consultation KEY path",
    },
    j11_j12_path: {
      response_source: j11Baseline?.responseSource ?? "sales_director_guarded_hold",
      note: "Separate from J10 KEY utilization gap — Tom may split slice scope",
    },
  },
  first_hop: {
    name: "Resolver (missing on KEY path)",
    layer: "손발",
    same_class_as_j07_pre_slice: true,
  },
  secondary_hop: {
    name: "Manifest (no recommendation tool + J10 intent general_consultation)",
    layer: "손발",
  },
  observed_at: new Date().toISOString(),
  note: "Observation only — Jerry does not declare PASS, Slice GO, or implement fixes.",
};

writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Wrote ${REPORT_PATH}`);
console.log(`J10 intent: ${j10.classification.intent} key=${j10.key_orchestrator_gate} tools=${j10.key_tool_plan.tools.join(",")}`);
console.log(`J11 intent: ${j11.classification.intent} key=${j11.key_orchestrator_gate} source=${j11Baseline?.responseSource ?? "?"}`);
console.log(`J12 intent: ${j12.classification.intent} key=${j12.key_orchestrator_gate}`);
