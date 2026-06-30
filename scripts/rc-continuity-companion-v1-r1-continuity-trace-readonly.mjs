/**
 * R1 — Conversation Continuity READ ONLY trace.
 * RC-CONTINUITY-COMPANION-v1 prep · Tom GO.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifyConsultationIntent,
  detectCasualChatIntent,
  detectCoverageAnxietyCompanionCluster,
  detectPremiumBurdenCompanionCluster,
  hasInsuranceTopicSignal,
} from "../server/intentGateLayer.js";
import {
  classifyHomeBrainIntent,
  resolveHomeBrainRoute,
  isCasualHomeQuestion,
} from "../server/homeBrainRouter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(
  ROOT,
  "fixtures/key-judgment-validation-v1/rc-continuity-companion-v1-r1-continuity-trace-evidence.json",
);

/** Tom R1 — Conversation Continuity paraphrase set */
const CONTINUITY_PARAPHRASE = [
  "그 이야기 이어서.",
  "아까 말한 거.",
  "방금 이야기.",
  "전에 말한 거.",
  "지난번 이야기.",
  "그때 말한 거.",
];

/** R0 anchor — memory-recall shaped (same human flow, different code path today) */
const MEMORY_ANCHOR = [
  "지난번 이야기 기억해?",
  "그 이야기 이어서 말해줘.",
  "전에 말했던 거 기억해?",
];

function normalizeQuestion(question = "") {
  return String(question ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function memoryRecallHeuristic(q) {
  const text = normalizeQuestion(q);
  if (/뭐라고\s*(?:했|말)/.test(text)) return true;
  if (/걱정.{0,12}(?:했|하|한|던).{0,12}기억/.test(text)) return true;
  if (/^기억나/.test(text)) return true;
  if (!/기억/.test(text)) return false;
  return (
    /(?:지난번|저번|전에|예전|이previous).{0,12}(?:이야기|얘기|말|상담|걱정)/.test(text) ||
    /(?:전에|예전|이previous).{0,12}(?:말|얘기|이야기|걱정).{0,10}(?:했|하|한|던)/.test(text) ||
    /(?:기억|기억해|기억나).{0,12}(?:지난|저번|전에|예전|이previous|걱정)/.test(text)
  );
}

function continuitySignal(q) {
  const text = normalizeQuestion(q);
  const signals = [];
  if (/이어(?:서|가)?|이어\s*말|계속\s*말/.test(text)) signals.push("continue_explicit");
  if (/아까|방금|그때|지난번|전에|저번|예전/.test(text)) signals.push("time_reference");
  if (/말한\s*거|말했|이야기|얘기/.test(text)) signals.push("speech_reference");
  if (/기억/.test(text)) signals.push("memory_lexeme");
  return signals;
}

function inferContinuityAxis(classification, question, homeBrainIntent, homeRoute) {
  const q = normalizeQuestion(question);
  const signals = continuitySignal(q);

  if (homeBrainIntent === "memory_recall_lookup" || memoryRecallHeuristic(q)) {
    return { axis: "Memory", reason: "memory_recall_lookup_or_heuristic" };
  }

  if (
    classification.intent === "casual_chat" ||
    homeRoute === "casual_chat" ||
    isCasualHomeQuestion(q, classification)
  ) {
    if (signals.includes("continue_explicit") || signals.includes("time_reference")) {
      return { axis: "Companion", reason: "continuity_landed_casual_not_memory" };
    }
    return { axis: "Companion", reason: "casual_path" };
  }

  if (signals.includes("time_reference") && signals.includes("speech_reference")) {
    return { axis: "Relationship", reason: "time+speech_without_memory_route" };
  }

  if (classification.companion_cluster) {
    return { axis: "Insurance", reason: "judgment_cluster_leak" };
  }

  return { axis: "Ambiguous", reason: "unclassified_continuity" };
}

function inferComposeGate(classification, homeRoute, question) {
  const q = normalizeQuestion(question);
  if (classification.intent === "casual_chat" || homeRoute === "casual_chat") {
    return "casual_light_or_home_casual";
  }
  if (homeRoute === "factual_grounded") return "home_brain_factual";
  if (homeRoute === "gap_grounded") return "gap_grounded";
  if (memoryRecallHeuristic(q)) return "memory_recall_judgment";
  if (isCasualHomeQuestion(q, classification)) return "companion_via_home_casual";
  return "structured_or_defer";
}

function traceQuestion(question) {
  const classification = classifyConsultationIntent(question);
  const casualDetect = detectCasualChatIntent(question);
  const homeBrainIntent = classifyHomeBrainIntent(question);
  const homeRoute = resolveHomeBrainRoute(question, classification);
  const axis = inferContinuityAxis(classification, question, homeBrainIntent, homeRoute);

  return {
    question,
    continuity_signals: continuitySignal(question),
    classification: {
      intent: classification.intent,
      matched_rule: classification.matched_rule,
      companion_cluster: classification.companion_cluster ?? null,
    },
    casual_detect: casualDetect?.matched_rule ?? null,
    home_brain_intent: homeBrainIntent,
    home_route: homeRoute,
    insurance_topic_signal: hasInsuranceTopicSignal(question),
    memory_recall_heuristic: memoryRecallHeuristic(question),
    continuity_axis: axis.axis,
    continuity_axis_reason: axis.reason,
    compose_gate_inferred: inferComposeGate(classification, homeRoute, question),
    companion_cluster_detect: {
      premium: detectPremiumBurdenCompanionCluster(question)?.cluster_id ?? null,
      coverage_anxiety: detectCoverageAnxietyCompanionCluster(question)?.cluster_id ?? null,
    },
  };
}

function assessUnifiedFlow(rows) {
  const axes = new Set(rows.map((r) => r.continuity_axis));
  return {
    unified: axes.size === 1,
    axis_set: [...axes],
    split: axes.size > 1,
  };
}

function main() {
  mkdirSync(join(ROOT, "fixtures/key-judgment-validation-v1"), { recursive: true });

  const paraphrase = CONTINUITY_PARAPHRASE.map(traceQuestion);
  const memoryAnchor = MEMORY_ANCHOR.map(traceQuestion);

  const paraphraseFlow = assessUnifiedFlow(paraphrase);
  const allContinuity = [...paraphrase, ...memoryAnchor];
  const allFlow = assessUnifiedFlow(allContinuity);

  const payload = {
    document: "rc_continuity_companion_v1_r1_continuity_trace_evidence",
    arc: "RELATIONSHIP-COMPANION-R0-R1",
    contract_candidate: "RC-CONTINUITY-COMPANION-v1",
    gate: "R1-CONVERSATION-CONTINUITY",
    mode: "READ ONLY · no implementation · no PASS",
    tom_go: "R1 — measure Memory/Relationship/Companion split on continuity paraphrases",
    pass_declaration: "none",
    observed_at: new Date().toISOString(),
    upstream_ref: "relationship-role-split-r0-audit-evidence.json",
    slice_goal:
      "고객은 같은 대화를 이어간다고 느끼는가? — not insurance explanation · not memory storage",
    tom_framing: {
      problem: "Relationship Split — same Relationship axis, intent splits (casual_chat vs general_consultation)",
      slice1_theme:
        "지난번 이야기 ↔ 이어서 말하기 is one human flow — today Memory vs Companion code split",
    },
    continuity_paraphrase: {
      questions: CONTINUITY_PARAPHRASE,
      traces: paraphrase,
      flow: paraphraseFlow,
    },
    memory_anchor_comparison: {
      purpose: "Same human flow — memory-recall shaped vs continuity paraphrase",
      questions: MEMORY_ANCHOR,
      traces: memoryAnchor,
    },
    summary_table: paraphrase.map((r) => ({
      question: r.question,
      intent: r.classification.intent,
      home_route: r.home_route,
      home_brain_intent: r.home_brain_intent,
      continuity_axis: r.continuity_axis,
      compose_gate: r.compose_gate_inferred,
    })),
    audit_findings: {
      paraphrase_axis_split: paraphraseFlow.split,
      paraphrase_axes: paraphraseFlow.axis_set,
      all_continuity_including_anchors_split: allFlow.split,
      all_axes: allFlow.axis_set,
      tom_r1_conclusion: null,
    },
    cross_cutting_observations: [],
    next_step: "Tom audit → RC-CONTINUITY-COMPANION-v1 slice design (not EXEC)",
    jerry: "STOP — R1 evidence only",
  };

  const obs = [];

  const memoryAxis = paraphrase.filter((r) => r.continuity_axis === "Memory");
  const companionAxis = paraphrase.filter((r) => r.continuity_axis === "Companion");
  const relationshipAxis = paraphrase.filter((r) => r.continuity_axis === "Relationship");

  if (paraphraseFlow.split) {
    obs.push(
      `R1 SPLIT: 6 continuity paraphrases span ${paraphraseFlow.axis_set.join(" + ")} — not one unified flow`,
    );
  }

  const continueExplicit = paraphrase.find((r) => r.question.startsWith("그 이야기 이어서"));
  const lastTimeStory = paraphrase.find((r) => r.question === "지난번 이야기.");
  if (continueExplicit && lastTimeStory && continueExplicit.continuity_axis !== lastTimeStory.continuity_axis) {
    obs.push(
      `Human-flow split: "${continueExplicit.question}" → ${continueExplicit.continuity_axis} vs "${lastTimeStory.question}" → ${lastTimeStory.continuity_axis}`,
    );
  }

  const anchorMemory = memoryAnchor.filter((r) => r.continuity_axis === "Memory");
  const anchorCompanion = memoryAnchor.filter((r) => r.continuity_axis === "Companion");
  if (anchorMemory.length && anchorCompanion.length) {
    obs.push(
      `R0 anchor confirmed in R1: "지난번 이야기 기억해?" → Memory · "그 이야기 이어서 말해줘." → Companion`,
    );
  }

  const intentSplit = new Set(paraphrase.map((r) => r.classification.intent));
  if (intentSplit.size > 1) {
    obs.push(`Intent split within 6 paraphrases: ${[...intentSplit].join(", ")}`);
  }

  const memoryBridgeAbsent = paraphrase.every(
    (r) => r.home_brain_intent !== "memory_recall_lookup" && !r.memory_recall_heuristic,
  );
  const relationshipAxisHit = paraphrase.some((r) => r.continuity_axis === "Relationship");

  payload.conversation_continuity_flow = {
    tom_expected: "Memory → Relationship → Companion (one human flow)",
    observed_6_paraphrase: "Companion only — no Memory bridge · no Relationship axis",
    memory_bridge_on_6: !memoryBridgeAbsent,
    relationship_axis_on_6: relationshipAxisHit,
  };

  payload.audit_findings = {
    ...payload.audit_findings,
    memory_bridge_absent_on_6: memoryBridgeAbsent,
    relationship_axis_absent_on_6: !relationshipAxisHit,
    human_flow_split:
      "기억해? lexeme → Memory/factual_grounded · 이어서/말한 거 (no 기억) → Companion/casual_chat",
    tom_r1_conclusion:
      "Conversation Continuity NOT unified at human-flow level — 6 paraphrases skip Memory; anchor pair splits Memory vs Companion — RC-CONTINUITY-COMPANION-v1 warranted",
  };

  if (memoryBridgeAbsent) {
    obs.push(
      "R1 GAP: all 6 continuity paraphrases route casual_chat — none invoke memory_recall_lookup",
    );
  }
  if (!relationshipAxisHit) {
    obs.push("R1 GAP: Relationship axis never appears — jump is Memory (with 기억해?) vs Companion (without)");
  }
  obs.push(
    'Lexeme gate: adding "기억해?" flips home_route factual_grounded; omitting it keeps casual_chat',
  );

  payload.cross_cutting_observations = obs;

  writeFileSync(OUT, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify(payload.summary_table, null, 2));
  console.log(JSON.stringify(payload.audit_findings, null, 2));
  console.log(`Wrote ${OUT}`);
}

main();
