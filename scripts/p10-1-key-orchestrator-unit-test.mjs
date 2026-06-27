/**
 * P10-1 — KEY orchestrator gate + tool plan unit tests (no network).
 */
import { classifyConsultationIntent } from "../server/intentGateLayer.js";
import {
  isKeyLegacyFallbackEnabled,
  isKeyOrchestratorEnabled,
  isKeyBlockedIntent,
  planKeyTools,
  shouldUseSalesDirectorKeyOrchestrator,
  KEY_TOOLS,
} from "../server/salesDirectorKeyToolRegistry.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function testFlagDefaults() {
  const env = {};
  assert(isKeyOrchestratorEnabled(env) === false, "KEY flag default OFF");
  assert(isKeyLegacyFallbackEnabled(env) === true, "KEY legacy fallback default ON");
}

function testGateOffUsesLegacy() {
  assert(
    shouldUseSalesDirectorKeyOrchestrator({
      question: "암보장 있어?",
      customerId: "test-customer",
      env: {},
    }) === false,
    "flag OFF → gate false",
  );
}

function testGateBlockedIntent() {
  assert(
    shouldUseSalesDirectorKeyOrchestrator({
      question: "뭐 가입해야 해?",
      customerId: "test-customer",
      env: { SALES_DIRECTOR_KEY_ORCHESTRATOR: "1" },
    }) === false,
    "recommendation_request blocked",
  );
  assert(isKeyBlockedIntent("design_request") === true, "design_request blocked by default");
}

function testGateAllowlist() {
  assert(
    shouldUseSalesDirectorKeyOrchestrator({
      question: "암보장 있어?",
      customerId: "allowed-id",
      env: {
        SALES_DIRECTOR_KEY_ORCHESTRATOR: "1",
        SALES_DIRECTOR_KEY_CUSTOMER_ALLOWLIST: "allowed-id",
      },
    }) === true,
    "allowlist match passes",
  );
  assert(
    shouldUseSalesDirectorKeyOrchestrator({
      question: "암보장 있어?",
      customerId: "other-id",
      env: {
        SALES_DIRECTOR_KEY_ORCHESTRATOR: "1",
        SALES_DIRECTOR_KEY_CUSTOMER_ALLOWLIST: "allowed-id",
      },
    }) === false,
    "allowlist mismatch blocked",
  );
}

function testPlanKeyTools() {
  const premiumPlan = planKeyTools(
    { intent: "factual_lookup", lookup_sub_intent: "premium_lookup" },
    { memory: "present", policies: "present" },
    "월 보험료 얼마야?",
  );
  assert(premiumPlan.tools.includes(KEY_TOOLS.PREMIUM_STATS), "premium plan includes premium_stats");
  assert(!premiumPlan.tools.includes(KEY_TOOLS.COVERAGE_GAP), "premium plan skips gap");

  const cancerPlan = planKeyTools(
    { intent: "factual_lookup", lookup_sub_intent: "coverage_presence", lookup_category: "cancer" },
    { memory: "empty", policies: "present" },
    "암보장 있어?",
  );
  assert(cancerPlan.tools.includes(KEY_TOOLS.COVERAGE_GAP), "coverage presence includes gap");

  const premiumBurdenPlan = planKeyTools(
    { intent: "general_consultation" },
    { memory: "present", policies: "present" },
    "보험료가 부담돼",
  );
  assert(
    premiumBurdenPlan.legacy_slice === "premium_burden",
    "premium burden slice detected",
  );
  assert(
    !premiumBurdenPlan.tools.includes(KEY_TOOLS.COVERAGE_GAP),
    "premium burden suppresses coverage_gap",
  );
  assert(
    premiumBurdenPlan.tools.includes(KEY_TOOLS.PREMIUM_STATS),
    "premium burden includes premium_stats",
  );
}

function testCoverageGapUtilizationSlices() {
  const cases = [
    {
      label: "J04",
      question: "내 보험 부족한 부분 있어?",
      expectIntent: "coverage_gap_check",
    },
    {
      label: "J05",
      question: "암 보장 괜찮아?",
      expectIntent: "coverage_gap_check",
    },
    {
      label: "J06",
      question: "뭐가 빠져 있는지 알려줘.",
      expectIntent: "coverage_gap_check",
    },
  ];

  for (const { label, question, expectIntent } of cases) {
    const classification = classifyConsultationIntent(question);
    assert(classification.intent === expectIntent, `${label} intent is ${expectIntent}`);
    const plan = planKeyTools(classification, { memory: "present", policies: "present" }, question);
    assert(plan.tools.includes(KEY_TOOLS.COVERAGE_GAP), `${label} plan includes coverage_gap`);
  }
}

function testUnderwritingUtilizationSlice() {
  const j07Question = "고혈압 있는데 가입 가능해?";
  const j07Classification = classifyConsultationIntent(j07Question);
  assert(
    j07Classification.intent === "underwriting_bound_check",
    "J07 intent is underwriting_bound_check",
  );
  const j07Plan = planKeyTools(
    j07Classification,
    { memory: "present", policies: "present" },
    j07Question,
  );
  assert(j07Plan.tools.includes(KEY_TOOLS.UNDERWRITING), "J07 plan includes underwriting");

  const j08Classification = classifyConsultationIntent("건강 상태 때문에 거절될까?");
  assert(
    j08Classification.intent === "underwriting_bound_check",
    "J08 intent is underwriting_bound_check",
  );

  const recommendClassification = classifyConsultationIntent("뭐가 부족해?");
  assert(
    recommendClassification.intent === "recommendation_request",
    "recommendation-shaped gap question stays recommendation_request",
  );

  const j04Classification = classifyConsultationIntent("내 보험 부족한 부분 있어?");
  assert(
    j04Classification.intent === "coverage_gap_check",
    "J04 stays coverage_gap_check after underwriting intent added",
  );
}

function testRecommendationUtilizationSlice() {
  const j10Question = "지금 뭐부터 추가하면 좋을까?";
  const j10Classification = classifyConsultationIntent(j10Question);
  assert(
    j10Classification.intent === "recommendation_priority_check",
    "J10 intent is recommendation_priority_check",
  );
  const j10Plan = planKeyTools(
    j10Classification,
    { memory: "present", policies: "present" },
    j10Question,
  );
  assert(j10Plan.tools.includes(KEY_TOOLS.RECOMMENDATION), "J10 plan includes recommendation");
  assert(!j10Plan.tools.includes(KEY_TOOLS.COVERAGE_GAP), "J10 v1 skips coverage_gap co-tool");

  const j11Classification = classifyConsultationIntent("나한테 필요한 보험 추천해줘.");
  assert(
    j11Classification.intent === "recommendation_request",
    "J11 stays recommendation_request",
  );
  assert(
    shouldUseSalesDirectorKeyOrchestrator({
      question: "나한테 필요한 보험 추천해줘.",
      customerId: "test-customer",
      consultationIntent: j11Classification,
      env: { SALES_DIRECTOR_KEY_ORCHESTRATOR: "1" },
    }) === false,
    "J11 KEY orchestrator remains blocked",
  );

  const j12Classification = classifyConsultationIntent("보장 보완 어디부터 하면 돼?");
  assert(
    j12Classification.intent === "recommendation_request",
    "J12 stays recommendation_request",
  );
}

function main() {
  testFlagDefaults();
  testGateOffUsesLegacy();
  testGateBlockedIntent();
  testGateAllowlist();
  testPlanKeyTools();
  testCoverageGapUtilizationSlices();
  testUnderwritingUtilizationSlice();
  testRecommendationUtilizationSlice();
  console.log("P10-1 KEY orchestrator unit tests: ALL PASSED");
}

main();
