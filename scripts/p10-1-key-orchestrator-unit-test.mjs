/**
 * P10-1 — KEY orchestrator gate + tool plan unit tests (no network).
 */
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

function main() {
  testFlagDefaults();
  testGateOffUsesLegacy();
  testGateBlockedIntent();
  testGateAllowlist();
  testPlanKeyTools();
  console.log("P10-1 KEY orchestrator unit tests: ALL PASSED");
}

main();
