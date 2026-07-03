/**
 * RC-RECOGNITION-COMPANION-v1 — local paraphrase + exclude + regression trace.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifyConsultationIntent,
  detectContinuityCompanionCluster,
  detectCoverageAnxietyCompanionCluster,
  detectPremiumBurdenCompanionCluster,
  detectRecognitionCompanionCluster,
  COVERAGE_ANXIETY_COMPANION_CLUSTER_ID,
  PREMIUM_BURDEN_COMPANION_CLUSTER_ID,
  RC_CONTINUITY_COMPANION_CLUSTER_ID,
  RC_RECOGNITION_COMPANION_CLUSTER_ID,
  hasInsuranceTopicSignal,
} from "../server/intentGateLayer.js";
import {
  classifyHomeBrainIntent,
  resolveHomeBrainRoute,
} from "../server/homeBrainRouter.js";
import {
  buildRecognitionCompanionResponse,
  recognitionCompanionResponseShape,
  shouldUseRecognitionCompanionCompose,
} from "../server/conversationRecognitionBridge.js";
import {
  buildContinuityCompanionResponse,
  shouldUseContinuityCompanionCompose,
} from "../server/conversationContinuityBridge.js";
import { resolveKeyJudgmentRule } from "../server/keyJudgmentRules.js";
import { handleHomeBrainFactRequest } from "../server/homeBrainFactCore.js";
import { planKeyTools } from "../server/salesDirectorKeyToolRegistry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(
  ROOT,
  "fixtures/key-judgment-validation-v1/rc-recognition-companion-v1-slice-local-trace-evidence.json",
);

const PARAPHRASE = [
  "오랜만이야",
  "다시 왔어",
  "또 왔어",
  "오늘도 왔어",
  "또 보네",
  "다시 왔네",
  "왔어",
];

const EXCLUDE = [
  "나 기억해?",
  "기억하지?",
  "기억해?",
  "지난번 기억?",
  "전에 말한 거 기억?",
];

const RC_CONTINUITY_SPOT = [
  "그 이야기 이어서.",
  "아까 말한 거.",
  "전에 말한 거.",
  "지난번 이야기.",
];

const JC_PREMIUM = ["보험료가 너무 부담돼요", "보험을 줄이고 싶어."];
const JC_COVERAGE = ["내 보험 괜찮을까?", "보장이 부족한 것 같아."];
const INSURANCE_EXCLUDE = ["오랜만이야. 보험료부터 볼까요?", "다시 왔어. 보험 점검해줘."];

const INSURANCE_PIVOT_RE =
  /보험|가입|보장|실손|보험료|점검|확인된\s*범위|담보|한도|걱정되는\s*축/;

function buildMockSupabase() {
  return {
    from(table) {
      const chain = {
        select() {
          return chain;
        },
        eq() {
          return chain;
        },
        is() {
          return chain;
        },
        order() {
          return chain;
        },
        limit() {
          return chain;
        },
        maybeSingle: async () => ({
          data: { id: "cust-rc-reco-local", display_name: "QA", memory_version: 1 },
          error: null,
        }),
        then(onFulfilled, onRejected) {
          let payload = { data: [], error: null, count: 0 };
          if (table === "active_profile_insurance_policies") {
            payload = {
              data: [{ product_name: "실손", policy_type: "health", monthly_premium: 45000 }],
              error: null,
            };
          }
          if (table === "customer_memory_facts") {
            payload = {
              data: [{ fact_key: "worry", fact_value: "보험료 부담" }],
              error: null,
              count: 1,
            };
          }
          return Promise.resolve(payload).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
  };
}

async function probeRuntime(question) {
  const result = await handleHomeBrainFactRequest({
    question,
    history: [],
    userSupabase: buildMockSupabase(),
    customerId: "cust-rc-reco-local",
    env: {
      ...process.env,
      SALES_DIRECTOR_KEY_ORCHESTRATOR: "1",
      SALES_DIRECTOR_KEY_CUSTOMER_ALLOWLIST: "cust-rc-reco-local",
      ANTHROPIC_API_KEY: "mock-key",
    },
    fetchImpl: async () => new Response("", { status: 200 }),
    requestStartedAt: Date.now(),
    streamHandlers: { _emitted: false, onDelta() {}, onReplace() {} },
  });
  const sdt = result.sales_director_trace ?? {};
  const p10 = sdt.p10_4_key_path_trace ?? {};
  const kct = p10.build_key_structured_response ?? sdt.finalize_trace?.key_compose_trace ?? {};
  const answer = String(result.answerText ?? "");
  return {
    answer_preview: answer.slice(0, 200),
    compose_mode: kct.compose_mode ?? null,
    insurance_pivot: INSURANCE_PIVOT_RE.test(answer),
    memory_used_in_answer: /저장(?:해|된)|확인된\s*기억/.test(answer),
  };
}

async function traceQuestion(q) {
  const classification = classifyConsultationIntent(q);
  const homeBrainIntent = classifyHomeBrainIntent(q);
  const homeRoute = resolveHomeBrainRoute(q, classification);
  const factBundle = {
    companion_cluster: classification.companion_cluster ?? null,
    question: q,
    memory_facts: [{ fact_key: "worry", fact_value: "보험료 부담" }],
    memory_fact_count: 1,
    policies: [{ product_name: "실손" }],
    policy_count: 1,
  };
  const humanFrame = { conversation_history: [] };
  const composeRecognition = shouldUseRecognitionCompanionCompose({ question: q, factBundle, humanFrame });
  const composeContinuity = shouldUseContinuityCompanionCompose({ question: q, factBundle, humanFrame });
  const toolPlan = planKeyTools(classification, { policies: factBundle.policies, memory: factBundle.memory_facts }, q);
  const judgmentRule = resolveKeyJudgmentRule({
    question: q,
    classificationIntent: classification.intent,
    factBundle,
    humanFrame,
  });
  const moduleResponse =
    classification.companion_cluster === RC_RECOGNITION_COMPANION_CLUSTER_ID
      ? buildRecognitionCompanionResponse({ question: q })
      : null;
  const runtime = await probeRuntime(q);

  return {
    question: q,
    intent: classification.intent,
    matched_rule: classification.matched_rule,
    companion_cluster: classification.companion_cluster ?? null,
    companion_cluster_signals: classification.companion_cluster_signals ?? null,
    home_brain_intent: homeBrainIntent,
    home_route: homeRoute,
    detector: {
      recognition: detectRecognitionCompanionCluster(q)?.cluster_id ?? null,
      continuity: detectContinuityCompanionCluster(q)?.cluster_id ?? null,
      premium: detectPremiumBurdenCompanionCluster(q)?.cluster_id ?? null,
      coverage: detectCoverageAnxietyCompanionCluster(q)?.cluster_id ?? null,
    },
    compose_gate: composeRecognition
      ? "recognition_companion_bridge"
      : composeContinuity
        ? "continuity_companion_bridge"
        : null,
    judgment_rule_id: judgmentRule?.id ?? null,
    tools: toolPlan.tools ?? [],
    coverage_gap_suppressed: toolPlan.coverage_gap_suppressed === true,
    module_response_preview: moduleResponse,
    response_shape: moduleResponse ? recognitionCompanionResponseShape(moduleResponse) : null,
    runtime,
  };
}

function assessParaphrase(row) {
  return {
    aligned:
      row.companion_cluster === RC_RECOGNITION_COMPANION_CLUSTER_ID &&
      row.matched_rule === "recognition_companion_cluster" &&
      row.compose_gate === "recognition_companion_bridge" &&
      row.judgment_rule_id === "recognition_companion_judgment" &&
      row.tools.length === 0 &&
      row.coverage_gap_suppressed === true &&
      !row.tools.includes("memory") &&
      !row.tools.includes("coverage_gap") &&
      !row.tools.includes("premium_stats") &&
      row.runtime.compose_mode === "recognition_companion_bridge" &&
      !row.runtime.insurance_pivot &&
      !row.runtime.memory_used_in_answer &&
      row.response_shape === "recognition_welcome",
  };
}

function assessExclude(row) {
  const noRecognition = row.companion_cluster !== RC_RECOGNITION_COMPANION_CLUSTER_ID;
  const checks = {
    "나 기억해?": () => noRecognition && row.home_brain_intent === "memory_recall_lookup",
    "기억하지?": () => noRecognition && row.home_brain_intent === "memory_recall_lookup",
    "기억해?": () => noRecognition && row.home_brain_intent === "memory_recall_lookup",
    "지난번 기억?": () => noRecognition && row.home_brain_intent === "memory_recall_lookup",
    "전에 말한 거 기억?": () =>
      noRecognition && row.companion_cluster === RC_CONTINUITY_COMPANION_CLUSTER_ID,
  };
  return { preserved: checks[row.question]?.() ?? noRecognition, no_recognition_cluster: noRecognition };
}

function assessRcSpot(row) {
  return {
    preserved:
      row.companion_cluster === RC_CONTINUITY_COMPANION_CLUSTER_ID &&
      row.compose_gate === "continuity_companion_bridge",
  };
}

function assessJcPremium(row) {
  return { preserved: row.companion_cluster === PREMIUM_BURDEN_COMPANION_CLUSTER_ID };
}

function assessJcCoverage(row) {
  return { preserved: row.companion_cluster === COVERAGE_ANXIETY_COMPANION_CLUSTER_ID };
}

function assessInsuranceExclude(row) {
  return {
    preserved:
      row.companion_cluster !== RC_RECOGNITION_COMPANION_CLUSTER_ID &&
      hasInsuranceTopicSignal(row.question),
  };
}

async function main() {
  mkdirSync(join(ROOT, "fixtures/key-judgment-validation-v1"), { recursive: true });

  const paraphraseRows = [];
  for (const q of PARAPHRASE) {
    paraphraseRows.push({ ...(await traceQuestion(q)), assessment: null });
  }
  paraphraseRows.forEach((row) => {
    row.assessment = assessParaphrase(row);
  });

  const excludeRows = [];
  for (const q of EXCLUDE) {
    const row = await traceQuestion(q);
    excludeRows.push({ ...row, assessment: assessExclude(row) });
  }

  const rcRows = [];
  for (const q of RC_CONTINUITY_SPOT) {
    const row = await traceQuestion(q);
    rcRows.push({ ...row, assessment: assessRcSpot(row) });
  }

  const jcPremiumRows = [];
  for (const q of JC_PREMIUM) {
    const row = await traceQuestion(q);
    jcPremiumRows.push({ ...row, assessment: assessJcPremium(row) });
  }

  const jcCoverageRows = [];
  for (const q of JC_COVERAGE) {
    const row = await traceQuestion(q);
    jcCoverageRows.push({ ...row, assessment: assessJcCoverage(row) });
  }

  const insuranceExcludeRows = [];
  for (const q of INSURANCE_EXCLUDE) {
    const row = await traceQuestion(q);
    insuranceExcludeRows.push({ ...row, assessment: assessInsuranceExclude(row) });
  }

  const summary = {
    paraphrase: `${paraphraseRows.filter((r) => r.assessment.aligned).length}/${PARAPHRASE.length}`,
    exclude: `${excludeRows.filter((r) => r.assessment.preserved).length}/${EXCLUDE.length}`,
    rc_continuity_spot: `${rcRows.filter((r) => r.assessment.preserved).length}/${RC_CONTINUITY_SPOT.length}`,
    jc_premium: `${jcPremiumRows.filter((r) => r.assessment.preserved).length}/${JC_PREMIUM.length}`,
    jc_coverage: `${jcCoverageRows.filter((r) => r.assessment.preserved).length}/${JC_COVERAGE.length}`,
    insurance_topic_exclude: `${insuranceExcludeRows.filter((r) => r.assessment.preserved).length}/${INSURANCE_EXCLUDE.length}`,
  };

  const payload = {
    document: "rc_recognition_companion_v1_slice_local_trace_evidence",
    slice: "RELATIONSHIP-ARC-SLICE-2-RC-RECOGNITION-COMPANION-v1",
    contract_subtitle: "Return Visit Recognition Bridge",
    mode: "local module + runtime trace · no PASS · no Production deploy",
    tom_go: "Design GO / Local EXEC GO",
    pass_declaration: "none",
    observed_at: new Date().toISOString(),
    design_ref: "rc-recognition-companion-v1-slice-design.json",
    tom_conditions: [
      "Memory lookup forbidden on recognition cluster",
      "Insurance structured forbidden on 7 paraphrases",
      "no coverage_gap / premium_stats / recommendation / memory tools",
      "RC-CONTINUITY and JC clusters preserved",
      "Memory exclude set not in recognition cluster",
    ],
    summary,
    paraphrase: paraphraseRows,
    exclude: excludeRows,
    rc_continuity_regression: rcRows,
    jc_premium_regression: jcPremiumRows,
    jc_coverage_regression: jcCoverageRows,
    insurance_topic_exclusion: insuranceExcludeRows,
    changed_files: [
      "server/intentGateLayer.js",
      "server/conversationRecognitionBridge.js",
      "server/keyJudgmentRules.js",
      "server/humanUnderstandingLoop.js",
      "server/salesDirectorKeyToolRegistry.js",
      "server/salesDirectorFormatter.js",
      "server/personalKeyTimeContinuity.js",
      "scripts/rc-recognition-companion-v1-paraphrase-trace-readonly.mjs",
    ],
    diff_summary: {
      detector: "detectRecognitionCompanionCluster + RC_RECOGNITION_COMPANION_CLUSTER_ID in intentGateLayer",
      hand: "conversationRecognitionBridge.js — welcome voice, no memory read",
      judgment: "recognition_companion_judgment in keyJudgmentRules",
      compose: "recognition_companion_bridge gate in humanUnderstandingLoop after continuity",
      tools: "empty tool plan + coverage_gap suppressed on recognition cluster",
      regression: "RC/JC detector order unchanged; continuity runs before recognition",
    },
    jerry: "STOP — local evidence only · no PASS · no Production",
  };

  writeFileSync(OUT, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Wrote ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
