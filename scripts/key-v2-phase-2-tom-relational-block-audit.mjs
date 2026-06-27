/**
 * Tom PR #151 additional audit — mixed life+insurance must NOT use key_relational.
 */
import assert from "node:assert/strict";

import { classifyConsultationIntent } from "../server/intentGateLayer.js";
import {
  buildBasisTaggedFacts,
  buildHumanUnderstandingFrame,
  finalizeHumanSalesDirectorResponse,
  generateHumanSalesDirectorResponse,
  shouldUseKeyRelationalCompose,
} from "../server/humanUnderstandingLoop.js";
import {
  resolveSalesDirectorJudgmentIntent,
  SALES_DIRECTOR_JUDGMENT_INTENTS,
} from "../server/salesDirectorFormatter.js";
import { ONE_BRAIN_SURFACES } from "../server/oneBrainResponseLayer.js";

const AUDIT_CASES = [
  {
    id: "T1",
    question: "요즘 너무 피곤한데 보험금 받을 수 있어?",
    expectedJudgment: "claim",
    notRelational: true,
    textMustNotMatch: [/피곤하시겠어요|지치신 것 같아요/],
    textShouldMatch: [/보험금|받|사고|치료|확인|범위|단정/],
  },
  {
    id: "T2",
    question: "아버지가 아픈데 암보험 부족해?",
    expectedJudgment: "adequacy",
    notRelational: true,
    textMustNotMatch: [/가족 걱정이 크시겠어요|상황부터 천천히/],
    textShouldMatch: [/암|충분|부족|단정|어렵/],
  },
  {
    id: "T3",
    question: "가족력이 걱정돼서 암보험 있어?",
    expectedJudgment: "presence",
    notRelational: true,
    textMustNotMatch: [/이야기부터 같이|천천히 맞춰/],
    textShouldMatch: [/가입|확인|있/],
  },
  {
    id: "T4",
    question: "병원비가 부담되는데 내 보험 괜찮아?",
    expectedJudgment: "adequacy",
    notRelational: true,
    textMustNotMatch: [/피곤|지치|이야기부터/],
    textShouldMatch: [/괜찮|걱정|축|범위/],
  },
  {
    id: "T5",
    question: "요즘 몸이 안 좋아서 실손 청구 가능해?",
    expectedJudgment: "claim",
    notRelational: true,
    textMustNotMatch: [/피곤하시겠어요|지치신 것 같아요/],
    textShouldMatch: [/실손|청구|사고|치료|받|범위/],
  },
];

function buildKeyBundle(question) {
  return {
    question,
    key_orchestrator: true,
    policy_count: 2,
    policies: [
      { product_name: "실손의료비", policy_type: "health" },
      { product_name: "암진단", policy_type: "cancer" },
    ],
    coverage_gap_signals: ["암:미확인", "실손:유지"],
    coverage_gap_top_concerns: ["암"],
    coverage_gap_maintained: ["실손"],
    coverage_gap_used: true,
    has_stored_coverage_analysis: true,
  };
}

function inferJudgmentKind({ question, text, resolvedIntent, classification }) {
  const q = question;
  if (/부족|충분|괜찮/.test(q) && !/(?:있(?:어|나|음|습)?|가입)/.test(q.replace(/부족|충분|괜찮/g, ""))) {
    if (/부족|충분/.test(q)) return "adequacy";
  }
  if (/괜찮/.test(q)) return "adequacy";
  if (/부족/.test(q)) return "adequacy";
  if (/(?:있(?:어|나|음|습)?|가입)/.test(q) && /암|실손|보장|보험/.test(q) && !/부족|괜찮|충분/.test(q)) {
    return "presence";
  }
  if (/받을|보험금|청구/.test(q)) return "claim";
  if (
    resolvedIntent === SALES_DIRECTOR_JUDGMENT_INTENTS.CLAIM_OPPORTUNITY ||
    resolvedIntent === SALES_DIRECTOR_JUDGMENT_INTENTS.ACCIDENT_CLAIM ||
    classification.intent === "claim_eligibility_check"
  ) {
    return "claim";
  }
  if (resolvedIntent === SALES_DIRECTOR_JUDGMENT_INTENTS.COVERAGE_JUDGMENT) {
    if (/가입된 보험이 있는 것은 확인/.test(text)) return "presence";
    return "adequacy";
  }
  return "unknown";
}

const results = [];

for (const auditCase of AUDIT_CASES) {
  const { question } = auditCase;
  const bundle = buildKeyBundle(question);
  const classification = classifyConsultationIntent(question);
  const classificationIntent = classification.intent;
  const resolvedIntent = resolveSalesDirectorJudgmentIntent(classificationIntent, question);
  const basisTaggedFacts = buildBasisTaggedFacts(bundle, resolvedIntent);
  const humanFrame = buildHumanUnderstandingFrame({
    question,
    intent: resolvedIntent,
    surface: ONE_BRAIN_SURFACES.HOME,
    conversationContext: { classificationIntent, history: [] },
    factBundle: bundle,
    basisTaggedFacts,
  });

  const relational = shouldUseKeyRelationalCompose({
    question,
    classificationIntent,
    factBundle: bundle,
    humanFrame,
  });

  const generated = generateHumanSalesDirectorResponse({
    humanFrame,
    basisTaggedFacts,
    guardrails: { generation_mode: "key_orchestrator" },
    question,
    intent: resolvedIntent,
    factBundle: bundle,
    classificationIntent,
  });

  const finalized = finalizeHumanSalesDirectorResponse({
    question,
    classificationIntent,
    surface: ONE_BRAIN_SURFACES.HOME,
    factBundle: bundle,
    customerState: { question, keyOrchestrator: true },
    homeRoute: classificationIntent === "casual_chat" ? "casual_chat" : "insurance",
  });

  const composeMode = generated.key_compose_trace?.compose_mode;
  const text = finalized.text;
  const judgmentKind = inferJudgmentKind({
    question,
    text,
    resolvedIntent,
    classification,
  });

  const row = {
    id: auditCase.id,
    question,
    classificationIntent,
    lookup_sub_intent: classification.lookup_sub_intent ?? null,
    resolvedIntent,
    shouldUseKeyRelationalCompose: relational,
    compose_mode: composeMode,
    judgmentKind,
    expectedJudgment: auditCase.expectedJudgment,
    text_preview: text.slice(0, 160),
  };

  results.push(row);

  try {
    assert.equal(relational, false, `${auditCase.id} shouldUseKeyRelationalCompose must be false`);
    assert.notEqual(composeMode, "key_relational", `${auditCase.id} compose_mode must not be key_relational`);
    assert.equal(generated.generation_mode, "key_orchestrator");
    assert.equal(finalized.generation_mode, "key_orchestrator");
    for (const re of auditCase.textMustNotMatch) {
      assert.doesNotMatch(text, re, `${auditCase.id} must not sound purely relational`);
    }
    const matchedExpected = auditCase.textShouldMatch.some((re) => re.test(text));
    assert.ok(matchedExpected, `${auditCase.id} must retain insurance judgment signal in text`);
    console.log(`PASS ${auditCase.id} ${question}`);
    console.log(`     relational=${relational} compose_mode=${composeMode} judgment=${judgmentKind}`);
    console.log(`     text: ${text.slice(0, 120)}...`);
  } catch (error) {
    console.error(`FAIL ${auditCase.id} ${question}`);
    console.error(error.message);
    process.exitCode = 1;
  }
}

console.log("\n--- Tom relational block audit summary ---");
console.log(JSON.stringify(results, null, 2));

if (process.exitCode) {
  console.error("\nTom relational block audit: FAILED");
} else {
  console.log("\nTom relational block audit: ALL PASSED (5/5)");
}
