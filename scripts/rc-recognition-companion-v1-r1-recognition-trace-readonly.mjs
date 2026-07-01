/**
 * R1 — Return Recognition READ ONLY trace.
 * RC-RECOGNITION-COMPANION-v1 · Tom Contract GO / R1 GO.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifyConsultationIntent,
  detectCasualChatIntent,
  detectContinuityCompanionCluster,
  detectCoverageAnxietyCompanionCluster,
  detectPremiumBurdenCompanionCluster,
  hasInsuranceTopicSignal,
} from "../server/intentGateLayer.js";
import {
  classifyHomeBrainIntent,
  resolveHomeBrainRoute,
  isCasualHomeQuestion,
} from "../server/homeBrainRouter.js";
import {
  matchKeyConversationPattern,
  resolveKeySocialConversationPattern,
} from "../server/keyConversationPatterns.js";
import { resolveKeyJudgmentRule } from "../server/keyJudgmentRules.js";
import { handleHomeBrainFactRequest } from "../server/homeBrainFactCore.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(
  ROOT,
  "fixtures/key-judgment-validation-v1/rc-recognition-companion-v1-r1-recognition-trace-evidence.json",
);

const RECOGNITION_PARAPHRASE = [
  "오랜만이야",
  "다시 왔어",
  "또 왔어",
  "오늘도 왔어",
  "또 보네",
  "다시 왔네",
  "왔어",
];

const EXCLUDE_SET = [
  "나 기억해?",
  "기억하지?",
  "기억해?",
  "지난번 기억?",
  "전에 말한 거 기억?",
];

const REGRESSION_ANCHORS = {
  jc_premium_burden: "보험료가 너무 부담돼요",
  jc_coverage_anxiety: "내 보험 괜찮을까?",
  rc_continuity: "그 이야기 이어서.",
  insurance_exclude: "오랜만이야. 보험료부터 볼까요?",
};

function normalizeQuestion(question = "") {
  return String(question ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function memoryRecallHeuristic(q) {
  const text = normalizeQuestion(q);
  if (/^기억(?:해|나)\??$/.test(text)) return true;
  if (/뭐라고\s*(?:했|말)/.test(text)) return true;
  if (!/기억/.test(text)) return false;
  return (
    /(?:지난번|저번|전에|예전|이previous).{0,12}(?:이야기|얘기|말|상담|걱정|기억)/.test(text) ||
    /(?:기억|기억해|기억나).{0,12}(?:지난|저번|전에|예전|이previous|걱정)/.test(text)
  );
}

function recognitionSignals(q) {
  const text = normalizeQuestion(q);
  const signals = [];
  if (/오랜만/.test(text)) signals.push("reunion_time_gap");
  if (/다시\s*왔/.test(text)) signals.push("return_explicit");
  if (/또\s*(?:왔|보네)/.test(text)) signals.push("repeat_visit");
  if (/오늘도\s*왔/.test(text)) signals.push("same_day_return");
  if (/^왔(?:어|네)?$/.test(text)) signals.push("bare_arrival");
  if (/기억/.test(text)) signals.push("memory_lexeme");
  return signals;
}

function wouldHitRecognitionClusterCandidate(q) {
  const text = normalizeQuestion(q);
  if (/기억(?:해|나|하)/.test(text)) return { hit: false, reason: "memory_lexeme_excluded" };
  if (hasInsuranceTopicSignal(text)) return { hit: false, reason: "insurance_topic_excluded" };
  if (detectPremiumBurdenCompanionCluster(text)) return { hit: false, reason: "jc_premium_preserved" };
  if (detectCoverageAnxietyCompanionCluster(text)) return { hit: false, reason: "jc_coverage_preserved" };
  if (detectContinuityCompanionCluster(text)) return { hit: false, reason: "rc_continuity_preserved" };

  const reunionPattern = matchKeyConversationPattern(text);
  if (reunionPattern?.id === "relationship_reunion") {
    return { hit: true, reason: "relationship_reunion_pattern_today" };
  }

  const returnVisit =
    /^다시\s*왔(?:어|네)?$/.test(text) ||
    /^또\s*왔(?:어|네)?$/.test(text) ||
    /^오늘도\s*왔(?:어|네)?$/.test(text) ||
    /^또\s*보네$/.test(text) ||
    /^왔(?:어|네)?$/.test(text);

  if (returnVisit) {
    return { hit: true, reason: "return_visit_paraphrase_contract_in_scope" };
  }

  return { hit: false, reason: "no_recognition_cluster_today" };
}

function inferRecognitionAxis(row) {
  const q = normalizeQuestion(row.question);
  if (row.home_brain_intent === "memory_recall_lookup" || memoryRecallHeuristic(q)) {
    return { axis: "Memory", reason: "memory_recall_route" };
  }
  if (row.classification.companion_cluster === "JC-PREMIUM-BURDEN-v1") {
    return { axis: "Trust-JC1", reason: "premium_burden_cluster" };
  }
  if (row.classification.companion_cluster === "JC-COVERAGE-ANXIETY-v1") {
    return { axis: "Trust-JC2", reason: "coverage_anxiety_cluster" };
  }
  if (row.classification.companion_cluster === "RC-CONTINUITY-COMPANION-v1") {
    return { axis: "Relationship-RC1", reason: "continuity_cluster" };
  }
  if (row.conversation_pattern?.id === "relationship_reunion") {
    return { axis: "Recognition", reason: "relationship_reunion_pattern" };
  }
  if (row.runtime?.insurance_pivot) {
    return { axis: "Insurance", reason: "insurance_structured_compose" };
  }
  if (row.classification.intent === "casual_chat") {
    return { axis: "Companion", reason: "casual_chat_without_recognition_pattern" };
  }
  return { axis: "Ambiguous", reason: "unclassified" };
}

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
          data: { id: "cust-rc-reco-r1", display_name: "QA", memory_version: 1 },
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
    customerId: "cust-rc-reco-r1",
    env: {
      ...process.env,
      SALES_DIRECTOR_KEY_ORCHESTRATOR: "1",
      SALES_DIRECTOR_KEY_CUSTOMER_ALLOWLIST: "cust-rc-reco-r1",
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
    response_source: result.response_source ?? null,
    compose_mode: kct.compose_mode ?? null,
    conversation_pattern_id: kct.conversation_pattern_id ?? null,
    insurance_pivot: /보험|가입|보장|실손|보험료|점검|확인된|담보|한도|걱정되는\s*축/.test(answer),
    memory_used_in_answer: /저장|기억|맥락|확인된\s*기억/.test(answer),
  };
}

async function traceQuestion(question) {
  const classification = classifyConsultationIntent(question);
  const casualDetect = detectCasualChatIntent(question);
  const homeBrainIntent = classifyHomeBrainIntent(question);
  const homeRoute = resolveHomeBrainRoute(question, classification);
  const pattern = matchKeyConversationPattern(question);
  const social = resolveKeySocialConversationPattern(question);
  const judgment = resolveKeyJudgmentRule({
    question,
    classificationIntent: classification.intent,
    factBundle: {
      companion_cluster: classification.companion_cluster ?? null,
      memory_facts: [{ fact_key: "worry", fact_value: "보험료 부담" }],
      memory_fact_count: 1,
      policies: [{ product_name: "실손" }],
      policy_count: 1,
    },
  });
  const clusterCandidate = wouldHitRecognitionClusterCandidate(question);
  const runtime = await probeRuntime(question);

  const row = {
    question,
    recognition_signals: recognitionSignals(question),
    classification: {
      intent: classification.intent,
      matched_rule: classification.matched_rule ?? null,
      companion_cluster: classification.companion_cluster ?? null,
    },
    casual_detect: casualDetect?.matched_rule ?? null,
    home_brain_intent: homeBrainIntent,
    home_route: homeRoute,
    is_casual_home: isCasualHomeQuestion(question, classification),
    insurance_topic_signal: hasInsuranceTopicSignal(question),
    memory_recall_heuristic: memoryRecallHeuristic(question),
    conversation_pattern: pattern
      ? { id: pattern.id, scene: pattern.scene, compose_mode: pattern.compose_mode }
      : null,
    social_preview: social?.text?.slice(0, 120) ?? null,
    judgment_rule: judgment ? { id: judgment.id } : null,
    recognition_cluster_candidate: clusterCandidate,
    runtime,
    companion_cluster_detect: {
      premium: detectPremiumBurdenCompanionCluster(question)?.cluster_id ?? null,
      coverage_anxiety: detectCoverageAnxietyCompanionCluster(question)?.cluster_id ?? null,
      continuity: detectContinuityCompanionCluster(question)?.cluster_id ?? null,
    },
  };
  row.recognition_axis = inferRecognitionAxis(row);
  return row;
}

function assessUnifiedFlow(rows) {
  const axes = new Set(rows.map((r) => r.recognition_axis.axis));
  return { unified: axes.size === 1, axis_set: [...axes], split: axes.size > 1 };
}

async function main() {
  mkdirSync(join(ROOT, "fixtures/key-judgment-validation-v1"), { recursive: true });

  const paraphrase = [];
  for (const q of RECOGNITION_PARAPHRASE) {
    paraphrase.push(await traceQuestion(q));
  }

  const excludes = [];
  for (const q of EXCLUDE_SET) {
    excludes.push(await traceQuestion(q));
  }

  const regression = {};
  for (const [key, q] of Object.entries(REGRESSION_ANCHORS)) {
    regression[key] = await traceQuestion(q);
  }

  const paraphraseFlow = assessUnifiedFlow(paraphrase);
  const insurancePivots = paraphrase.filter((r) => r.runtime.insurance_pivot);
  const recognitionHits = paraphrase.filter((r) => r.recognition_axis.axis === "Recognition");
  const excludeClusterHits = excludes.filter((r) => r.recognition_cluster_candidate.hit);

  const payload = {
    document: "rc_recognition_companion_v1_r1_recognition_trace_evidence",
    arc: "RELATIONSHIP-ARC-SLICE-2-RECOGNITION",
    contract_id: "RC-RECOGNITION-COMPANION-v1",
    gate: "R1-RETURN-RECOGNITION",
    mode: "READ ONLY · no implementation · no PASS",
    tom_go: "Contract GO / R1 READ ONLY GO",
    pass_declaration: "none",
    observed_at: new Date().toISOString(),
    upstream_refs: [
      "rc-recognition-companion-v1-slice-contract.json",
      "rc-recognition-companion-v1-r0-trace-readonly-evidence.json",
    ],
    slice_goal: "고객의 재방문을 자연스럽게 맞이하는 사람 — unified across 7 paraphrases",
    recognition_paraphrase: {
      questions: RECOGNITION_PARAPHRASE,
      traces: paraphrase,
      flow: paraphraseFlow,
    },
    exclude_verification: {
      questions: EXCLUDE_SET,
      traces: excludes,
      must_not_hit_recognition_cluster: excludeClusterHits.length === 0,
      exclude_cluster_hits: excludeClusterHits.map((r) => r.question),
    },
    regression_anchors: regression,
    summary_table: paraphrase.map((r) => ({
      question: r.question,
      intent: r.classification.intent,
      home_route: r.home_route,
      axis: r.recognition_axis.axis,
      compose_mode: r.runtime.compose_mode,
      pattern_id: r.conversation_pattern?.id ?? null,
      cluster_candidate: r.recognition_cluster_candidate.hit,
      insurance_pivot: r.runtime.insurance_pivot,
    })),
    audit_findings: {},
    cross_cutting_observations: [],
    next_step: "Tom R1 audit → slice design (not EXEC)",
    jerry: "STOP — R1 evidence only",
  };

  const obs = [];

  if (paraphraseFlow.split) {
    obs.push(
      `R1 SPLIT: 7 recognition paraphrases span ${paraphraseFlow.axis_set.join(" + ")} — not one unified Recognition flow`,
    );
  }

  if (recognitionHits.length === 1 && paraphrase.length === 7) {
    obs.push(`Only "${recognitionHits[0]?.question ?? "?"}" lands Recognition axis today — 6/7 miss`);
  }

  if (insurancePivots.length) {
    obs.push(
      `Insurance pivot on ${insurancePivots.length}/7 in-scope: ${insurancePivots.map((r) => r.question).join(", ")}`,
    );
  }

  const intentSplit = new Set(paraphrase.map((r) => r.classification.intent));
  if (intentSplit.size > 1) {
    obs.push(`Intent split within 7: ${[...intentSplit].join(", ")}`);
  }

  const composeSplit = new Set(paraphrase.map((r) => r.runtime.compose_mode).filter(Boolean));
  if (composeSplit.size > 1) {
    obs.push(`Compose split: ${[...composeSplit].join(", ")}`);
  }

  if (excludeClusterHits.length) {
    obs.push(`EXCLUDE VIOLATION (candidate): ${excludeClusterHits.map((r) => r.question).join(", ")}`);
  } else {
    obs.push("Exclude set: no phrase would hit recognition cluster candidate (Memory/insurance correctly excluded)");
  }

  const reg = regression;
  if (reg.jc_premium_burden.classification.companion_cluster === "JC-PREMIUM-BURDEN-v1") {
    obs.push("Regression OK: JC-PREMIUM-BURDEN-v1 unchanged on anchor phrase");
  } else {
    obs.push("Regression WARN: JC-PREMIUM-BURDEN anchor cluster miss — design must preserve");
  }
  if (reg.jc_coverage_anxiety.classification.companion_cluster === "JC-COVERAGE-ANXIETY-v1") {
    obs.push("Regression OK: JC-COVERAGE-ANXIETY-v1 unchanged on anchor phrase");
  } else {
    obs.push("Regression WARN: JC-COVERAGE-ANXIETY anchor cluster miss");
  }
  if (reg.rc_continuity.classification.companion_cluster === "RC-CONTINUITY-COMPANION-v1") {
    obs.push("Regression OK: RC-CONTINUITY-COMPANION-v1 unchanged on anchor phrase");
  } else {
    obs.push("Regression WARN: RC-CONTINUITY anchor cluster miss");
  }
  if (reg.insurance_exclude.runtime.insurance_pivot || hasInsuranceTopicSignal(reg.insurance_exclude.question)) {
    obs.push('Exclude OK: "오랜만이야. 보험료부터 볼까요?" carries insurance — must not enter Recognition cluster');
  }

  payload.audit_findings = {
    paraphrase_axis_split: paraphraseFlow.split,
    paraphrase_axes: paraphraseFlow.axis_set,
    recognition_axis_count: recognitionHits.length,
    insurance_pivot_count: insurancePivots.length,
    exclude_cluster_clean: excludeClusterHits.length === 0,
    jc_rc_regression_preserved:
      reg.jc_premium_burden.classification.companion_cluster === "JC-PREMIUM-BURDEN-v1" &&
      reg.jc_coverage_anxiety.classification.companion_cluster === "JC-COVERAGE-ANXIETY-v1" &&
      reg.rc_continuity.classification.companion_cluster === "RC-CONTINUITY-COMPANION-v1",
    tom_r1_conclusion:
      paraphraseFlow.split
        ? "Return Recognition NOT unified — 7 paraphrases split Recognition/Insurance/Companion; relationship_reunion seed only on 오랜만이야 — RC-RECOGNITION-COMPANION-v1 cluster expansion warranted"
        : "Unexpected unified flow — verify before design",
  };

  payload.cross_cutting_observations = obs;

  writeFileSync(OUT, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify(payload.summary_table, null, 2));
  console.log(JSON.stringify(payload.audit_findings, null, 2));
  console.log(JSON.stringify(payload.exclude_verification, null, 2));
  console.log(`Wrote ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
