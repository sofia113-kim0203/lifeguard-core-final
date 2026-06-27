/**
 * J10 Recommendation — Compose → Final Answer disconnect hop trace (observation only).
 * Tom HOLD follow-up: no production fixes; narrow first disconnect after Manifest pass.
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildRecommendationContextFromPayload,
  normalizeRecommendationForDirector,
  extractRecommendationTop2Items,
} from "../server/salesDirectorRecommendationContext.js";
import { countStoredFactoryRecords } from "../server/salesDirectorFactoryAudit.js";
import { buildKeyJudgmentFromRules, resolveKeyJudgmentRule } from "../server/keyJudgmentRules.js";
import { finalizeHumanSalesDirectorResponse } from "../server/humanUnderstandingLoop.js";
import { classifyConsultationIntent } from "../server/intentGateLayer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "fixtures/key-judgment-validation-v1/j10-compose-disconnect-hop-trace.json");
const J10_EVIDENCE = join(ROOT, "fixtures/key-judgment-validation-v1/j10-recommendation-slice-preview-evidence.json");
const LIFECYCLE = join(ROOT, "fixtures/key-judgment-validation-v1/analysis-job-lifecycle-audit.json");

const J10_QUESTION = "지금 뭐부터 추가하면 좋을까?";

const SAMPLE_TOP2_PAYLOAD = {
  customer_id: "a247a66f-a597-4ccf-9530-761b82518002",
  generated_at: "2026-06-27T12:14:20.184+00:00",
  recommendations: [{ coverage_label: "암" }, { coverage_label: "실손" }],
  customer_visible_top2: [
    { coverage_label: "암", recommendation_type: "add_coverage", recommendation_rank: 1 },
    { coverage_label: "실손", recommendation_type: "add_coverage", recommendation_rank: 2 },
  ],
};

function readJson(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

function simulateOrchestratorFactBundle({ recommendation_used = true } = {}) {
  return {
    question: J10_QUESTION,
    key_orchestrator: true,
    recommendation_used,
    recommendation_loaded: recommendation_used,
    has_stored_recommendation_analysis: recommendation_used,
    policies: [{ product_name: "테스트상품", insurer_name: "테스트보험" }],
    policy_count: 1,
  };
}

function simulateHomeBrainCustomerState(recommendationContext = null) {
  return {
    question: J10_QUESTION,
    keyOrchestrator: true,
    coverageGapContext: { loaded: true, signals: [], top_concerns: [], maintained: [] },
    recommendationContext,
  };
}

function traceJudgmentBranch(factBundle) {
  const labels = factBundle.recommendation_priority_labels ?? [];
  const hasStored =
    factBundle.recommendation_used === true ||
    factBundle.has_stored_recommendation_analysis === true;
  let branch = "empty_absence_line_441";
  if (hasStored && labels.length >= 2) branch = "stored_top2_line_435";
  else if (hasStored && labels.length === 1) branch = "stored_top1_line_438";
  else if (hasStored && labels.length === 0) branch = "hasStored_but_labels_empty_line_441";
  else if (!hasStored) branch = "no_stored_line_441";

  const judgment = buildKeyJudgmentFromRules({
    question: J10_QUESTION,
    classificationIntent: "recommendation_priority_check",
    factBundle,
  });

  return { labels, hasStored, branch, judgment };
}

function runComposeScenario(name, { factBundle, customerState, classificationIntent }) {
  const finalized = finalizeHumanSalesDirectorResponse({
    rawText: "",
    classificationIntent,
    surface: "home",
    factBundle,
    customerState,
    conversationContext: { responseSource: "sales_director_key" },
  });

  const enrichedLabels =
    finalized.humanFrame?.fact_bundle?.recommendation_priority_labels ??
    finalized.basisTaggedFacts?.recommendation_priority_labels ??
    null;

  const preMerge = traceJudgmentBranch(factBundle);
  const postMergeBundle = {
    ...factBundle,
    ...(customerState?.recommendationContext
      ? {
          recommendation_priority_labels: customerState.recommendationContext.priority_labels ?? [],
          recommendation_used:
            factBundle.recommendation_used === true ||
            customerState.recommendationContext.loaded === true,
          has_stored_recommendation_analysis:
            factBundle.has_stored_recommendation_analysis === true ||
            customerState.recommendationContext.loaded === true,
        }
      : {}),
  };
  const postMerge = traceJudgmentBranch(postMergeBundle);

  const activeRule = resolveKeyJudgmentRule({
    question: J10_QUESTION,
    classificationIntent,
  });

  return {
    scenario: name,
    classificationIntent,
    active_judgment_rule: activeRule?.id ?? null,
    factBundle_in: {
      recommendation_used: factBundle.recommendation_used ?? false,
      recommendation_priority_labels: factBundle.recommendation_priority_labels ?? [],
      has_stored_recommendation_analysis: factBundle.has_stored_recommendation_analysis ?? false,
    },
    customerState_in: {
      has_recommendationContext: Boolean(customerState?.recommendationContext),
      priority_labels: customerState?.recommendationContext?.priority_labels ?? [],
      loaded: customerState?.recommendationContext?.loaded ?? false,
      record_count: customerState?.recommendationContext?.record_count ?? 0,
      passes_homeBrainFactCore_wiring:
        name === "production_homeBrainFactCore_shape"
          ? customerState?.recommendationContext == null
          : null,
    },
    judgment_pre_hul_merge: preMerge,
    judgment_if_merge_applied: postMerge,
    compose: {
      generation_mode: finalized.generation_mode ?? null,
      key_compose_trace: finalized.key_compose_trace ?? null,
      text_preview: String(finalized.text ?? "").slice(0, 400),
    },
    enriched_labels_observed: enrichedLabels,
  };
}

const classification = classifyConsultationIntent(J10_QUESTION);
const recContext = buildRecommendationContextFromPayload(SAMPLE_TOP2_PAYLOAD);
const normalized = normalizeRecommendationForDirector(SAMPLE_TOP2_PAYLOAD);
const top2Items = extractRecommendationTop2Items(SAMPLE_TOP2_PAYLOAD);
const auditRecordCount = countStoredFactoryRecords("recommendation", SAMPLE_TOP2_PAYLOAD);

const j10Evidence = readJson(J10_EVIDENCE);
const lifecycle = readJson(LIFECYCLE);

const productionScenario = runComposeScenario("production_homeBrainFactCore_shape", {
  factBundle: simulateOrchestratorFactBundle({ recommendation_used: true }),
  customerState: simulateHomeBrainCustomerState(null),
  classificationIntent: "recommendation_priority_check",
});

const fixedScenario = runComposeScenario("if_recommendationContext_wired_like_coverageGap", {
  factBundle: simulateOrchestratorFactBundle({ recommendation_used: true }),
  customerState: simulateHomeBrainCustomerState(recContext),
  classificationIntent: "recommendation_priority_check",
});

const report = {
  audit: "j10_compose_final_answer_disconnect_hop_trace_v1",
  status: "observation_only",
  tom_hold: "J10 Recommendation Slice — used=true vs final answer '분석이 아직 없어'",
  question: J10_QUESTION,
  observed_at: new Date().toISOString(),
  preview_evidence_ref: j10Evidence
    ? {
        answerText: j10Evidence.j10?.answerText ?? null,
        factory: j10Evidence.j10?.recommendation_factory ?? null,
        answer_evidence: j10Evidence.j10?.answer_evidence ?? null,
      }
    : null,
  checkpoints: {
    "1_customer_visible_top2_exists": {
      lifecycle_audit: lifecycle?.factory_payload?.recommendation ?? null,
      sample_normalize: {
        top2_item_count: top2Items.length,
        top2_items: top2Items,
        has_customer_visible_top2_key: Array.isArray(SAMPLE_TOP2_PAYLOAD.customer_visible_top2),
      },
      verdict: "PASS at Factory — customer_visible_top2 present in completed analysis_jobs payload",
    },
    "2_priority_labels_generation": {
      resolver_code: "server/salesDirectorRecommendationContext.js → normalizeRecommendationForDirector / extractRecommendationTop2Items",
      normalized,
      recContext_from_sample: {
        loaded: recContext.loaded,
        record_count: recContext.record_count,
        priority_labels: recContext.priority_labels,
        priority_signals: recContext.priority_signals,
      },
      record_count_fallback_note:
        "record_count uses items.length || countStoredFactoryRecords — audit record_count=2 can come from top2.length even when priority_labels=[] if coverage_label missing on items",
      countStoredFactoryRecords_top2_only: auditRecordCount,
      verdict:
        recContext.priority_labels.length >= 2
          ? "PASS — priority_labels generated when customer_visible_top2 items have coverage_label"
          : "FAIL — labels empty despite top2 array",
    },
    "3_hul_compose_priority_labels_transfer": {
      merge_gate: "humanUnderstandingLoop.js finalizeHumanSalesDirectorResponse L1659-1677",
      condition: "input.customerState?.recommendationContext must be truthy to merge recommendation_priority_labels into enrichedBundle",
      orchestrator_factBundle: {
        code: "salesDirectorKeyOrchestrator.js buildKeyAgentTurn L90-92",
        sets: ["recommendation_used", "recommendation_loaded", "has_stored_recommendation_analysis"],
        omits: ["recommendation_priority_labels"],
      },
      homeBrain_wiring: {
        code: "homeBrainFactCore.js finalizeHomeAgentResponse L494-499",
        passes: ["coverageGapContext", "keyOrchestrator", "freeThinking"],
        omits: ["recommendationContext", "underwritingRiskContext"],
      },
      verdict: "FIRST DISCONNECT — recommendationContext exists on customerContextBundle after Resolver/Tool but is not passed into finalize customerState",
    },
    "4_judgment_rule_empty_branch": {
      rule_id: "recommendation_priority_judgment",
      code: "keyJudgmentRules.js buildRecommendationPriorityJudgment L430-441",
      branches: {
        stored_top2: "hasStored && labels.length >= 2 → line 435",
        stored_top1: "hasStored && labels.length === 1 → line 438",
        absence: "else → line 441 '저장된 우선순위 분석이 아직 없어...'",
      },
      production_scenario_branch: productionScenario.judgment_pre_hul_merge.branch,
      production_scenario_judgment: productionScenario.judgment_pre_hul_merge.judgment,
      verdict:
        productionScenario.judgment_pre_hul_merge.branch === "hasStored_but_labels_empty_line_441"
          ? "Judgment treats stored=true + labels=[] as ABSENCE (unlike underwriting which speaks generically when hasStored)"
          : productionScenario.judgment_pre_hul_merge.branch,
    },
    "5_final_answer_absence_condition": {
      judgment_sentence_source: "buildRecommendationPriorityJudgment line 441 (first slot in buildKeyStructuredResponse)",
      limitation_split: {
        when_recommendation_used_true:
          "buildKeyStructuredResponse L692-699 — limitation = '특정 상품 가입을 단정...' (stored-aware)",
        when_recommendation_used_false:
          "limitation repeats '아직 없어' (information_gap)",
      },
      production_final_text: productionScenario.compose.text_preview,
      matches_preview_evidence:
        j10Evidence?.j10?.answerText != null
          ? productionScenario.compose.text_preview.includes("아직 없어") &&
            productionScenario.compose.text_preview.includes("특정 상품")
          : null,
      exact_condition:
        "classificationIntent=recommendation_priority_check AND factBundle.recommendation_used=true AND (factBundle.recommendation_priority_labels ?? []).length===0 → judgment line 441 + limitation line 698",
    },
  },
  hop_chain_post_implementation: {
    factory: "PASS — analysis_jobs.result_json.recommendation + customer_visible_top2",
    resolver: "PASS — salesDirectorLoop.js preloads recommendationContext onto customerContextBundle",
    manifest: "PASS — KEY_TOOLS.RECOMMENDATION + recommendation_priority_check intent; used=true record_count=2",
    compose: "FAIL — priority_labels never reach enrichedBundle at finalize",
    final_answer: "FAIL — speaks absence while manifest says used",
  },
  first_disconnect: {
    hop: "Compose ingress (homeBrainFactCore → finalizeHumanSalesDirectorResponse)",
    layer: "손발",
    mechanism:
      "customerContextBundle.recommendationContext.priority_labels not forwarded in customerState; orchestrator factBundle sets recommendation_used without labels; HUL merge skipped",
    contrast_j07_underwriting:
      "underwriting_bound_judgment returns stored-generic text when hasStored=true even without signals in bundle; recommendation_priority_judgment requires labels.length>=1",
  },
  counterfactual: fixedScenario,
  production_replay: productionScenario,
  classification: {
    intent: classification.intent,
    matched_rule: classification.matched_rule,
  },
  note: "Observation only — Jerry does not declare PASS or implement fixes.",
};

writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ok: true, out: OUT, first_disconnect: report.first_disconnect.hop }, null, 2));
