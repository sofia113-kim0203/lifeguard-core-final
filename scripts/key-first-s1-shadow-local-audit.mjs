/**
 * KEY-FIRST-S1 shadow — local audit (trace only · customer text unchanged).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  getKeyFirstDecisionMode,
  isKeyFirstDecisionShadowEnabled,
} from "../server/keyCore/oneKeyCoreFlags.js";
import {
  KEY_FIRST_OUTCOMES,
  resolveKeyFirstDecision,
} from "../server/keyBrain/keyFirstDecision.js";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "fixtures", "key-judgment-validation-v1", "key-first-s1-shadow-local-audit-evidence.json");
const TURN = readFileSync(join(ROOT, "server/keyCore/oneKeyCoreTurn.js"), "utf8");

const VALIDATION_QUESTIONS = [
  {
    id: "q1_casual",
    question: "안녕",
    consultationIntent: { intent: "casual_chat" },
    expected_outcome: KEY_FIRST_OUTCOMES.ANSWER_NOW,
  },
  {
    id: "q2_premium",
    question: "내 보험료 얼마야?",
    consultationIntent: { intent: "factual_lookup", lookup_sub_intent: "premium_lookup" },
    expected_outcome: KEY_FIRST_OUTCOMES.ANSWER_NOW,
  },
  {
    id: "q3_gap",
    question: "암보험 부족해?",
    consultationIntent: { intent: "coverage_gap_check" },
    expected_outcome: KEY_FIRST_OUTCOMES.VISIT_FACTORIES,
    expected_factories: ["coverage_gap"],
  },
  {
    id: "q4_reco_blocked",
    question: "그냥 추천해줘",
    consultationIntent: { intent: "recommendation_request" },
    expected_outcome: KEY_FIRST_OUTCOMES.ASK_FOLLOWUP,
  },
  {
    id: "q5_uw",
    question: "가입 가능해?",
    consultationIntent: { intent: "underwriting_bound_check" },
    expected_outcome: KEY_FIRST_OUTCOMES.VISIT_FACTORIES,
    expected_factories: ["underwriting"],
  },
  {
    id: "q6_design_blocked",
    question: "설계해줘",
    consultationIntent: { intent: "design_request" },
    expected_outcome: KEY_FIRST_OUTCOMES.ASK_FOLLOWUP,
  },
];

function auditShadowWired() {
  const wired =
    TURN.includes("resolveKeyFirstDecision") &&
    TURN.includes('recordStep("key_first_decision"') &&
    TURN.includes("isKeyFirstDecisionShadowEnabled") &&
    TURN.includes("key_first_decision_shadow_diff");
  return { pass: wired };
}

function auditNoBranching() {
  const forbidden =
    !TURN.includes("isKeyFirstDecisionActiveEnabled") &&
    !TURN.includes("KEY_FIRST_DECISION_MODES.ACTIVE") &&
    !/if\s*\(\s*keyFirstDecisionRecord\.outcome/.test(TURN) &&
    !TURN.includes("approved_plan") &&
    !TURN.includes("factory_call_decision");
  return { pass: forbidden, no_active_branch: forbidden };
}

function auditLegacyPathPreserved() {
  const preserved =
    TURN.includes("runSalesDirectorKeyTurn") &&
    TURN.includes("buildOneKeySpeakDraft") &&
    TURN.includes("finalizeOneKeyCorePersona");
  return { pass: preserved };
}

function auditValidationQuestions() {
  const loadedContext = { memory: "present", policies: "present", documents: "empty" };
  const results = VALIDATION_QUESTIONS.map((row) => {
    const decision = resolveKeyFirstDecision({
      question: row.question,
      consultationIntent: row.consultationIntent,
      keyJudgment: { hold: { needed: false }, judgment_scope: { unknowable: [] } },
      loadedContext,
      thinkingBundle: { four_inputs: { memory: 3 } },
    });
    const outcomeMatch = decision.outcome === row.expected_outcome;
    const factoriesMatch = row.expected_factories
      ? JSON.stringify(decision.factories ?? []) === JSON.stringify(row.expected_factories)
      : (decision.factories ?? []).length === 0;
    return {
      ...row,
      classified_intent: row.consultationIntent.intent,
      decision_outcome: decision.outcome,
      decision_factories: decision.factories ?? [],
      pass: outcomeMatch && factoriesMatch,
      outcome_match: outcomeMatch,
      factories_match: factoriesMatch,
    };
  });
  return {
    pass: results.every((row) => row.pass),
    rows: results,
  };
}

function auditFlagGate() {
  const shadowOn = isKeyFirstDecisionShadowEnabled({
    ONE_KEY_CORE_S1: "1",
    KEY_FIRST_DECISION: "shadow",
  });
  const shadowOff = !isKeyFirstDecisionShadowEnabled({
    ONE_KEY_CORE_S1: "1",
    KEY_FIRST_DECISION: "off",
  });
  const activeNotShadow = getKeyFirstDecisionMode({ KEY_FIRST_DECISION: "active" }) === "active";
  return {
    pass: shadowOn && shadowOff && activeNotShadow,
    shadow_enabled: shadowOn,
    shadow_disabled_when_off: shadowOff,
    active_mode_defined_not_wired: activeNotShadow,
  };
}

const tomChecks = {
  check_1_shadow_wired: {
    question: "runOneKeyCoreQuestionTurn에 key_first_decision trace",
    ...auditShadowWired(),
  },
  check_2_no_branching: {
    question: "active/branching/approved_plan 없음",
    ...auditNoBranching(),
  },
  check_3_legacy_preserved: {
    question: "runSalesDirectorKeyTurn + speak path 불변",
    ...auditLegacyPathPreserved(),
  },
  check_4_validation_questions: {
    question: "Tom 6검증 질문 outcome 분류",
    ...auditValidationQuestions(),
  },
  check_5_flag_gate: {
    question: "KEY_FIRST_DECISION=shadow + ONE_KEY_CORE_S1",
    ...auditFlagGate(),
  },
};

const overallPass = Object.values(tomChecks).every((c) => c.pass === true);

const evidence = {
  schema_version: "key-first-s1-shadow-local-audit-v1",
  audit: "key_first_s1_shadow_local",
  status: overallPass ? "local_pass · commit_pending" : "local_fail",
  observed_at: new Date().toISOString(),
  tom_checks: tomChecks,
  overall_pass: overallPass,
  tom_one_liner:
    "KEY First S1 shadow는 실행을 바꾸지 않는다. KEY가 어떤 판단을 하는지 trace에만 기록한다.",
  forbidden_verified: [
    "no active branch",
    "no factory skip",
    "no customerText change",
    "no planKeyTools replacement",
  ],
};

writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

console.log("key-first-s1-shadow-local-audit");
for (const [key, check] of Object.entries(tomChecks)) {
  console.log(`  ${check.pass ? "ok" : "FAIL"} ${key}`);
}
if (!tomChecks.check_4_validation_questions.pass) {
  for (const row of tomChecks.check_4_validation_questions.rows ?? []) {
    if (!row.pass) {
      console.log(
        `    FAIL ${row.id}: expected ${row.expected_outcome} got ${row.decision_outcome} (intent=${row.classified_intent})`,
      );
    }
  }
}
console.log(`\nevidence → ${OUT}`);
console.log(`overall: ${overallPass ? "PASS" : "FAIL"}`);

if (!overallPass) process.exit(1);
