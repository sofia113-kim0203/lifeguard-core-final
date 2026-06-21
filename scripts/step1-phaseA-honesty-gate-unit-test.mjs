/**
 * Step 1 Phase A — honesty / guidance gate unit tests (deterministic).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { analyzeCoverageGaps } from "../server/coverageGapAnalysisEngine.js";
import {
  runCentralBrainTurn,
} from "../server/centralBrain/centralBrainOrchestrator.js";
import { loadCentralBrainEvidence } from "../server/centralBrain/centralBrainEvidenceLoader.js";
import { routeCentralBrain, planCentralBrainEvidence } from "../server/centralBrain/index.js";
import {
  PHASE_A_LEGACY_JUDGMENT_STOPGAP,
  buildConversationalAnswer,
  isPhaseAJudgmentLegacyIntent,
} from "../server/fastResponseLayer.js";
import { computePremiumLookupStats, buildFactualLookupAnswer } from "../server/intentGateLayer.js";
import { buildClaimFastResponse } from "../server/claimBridgeLayer.js";
import { composeHomeBrainFactAnswer } from "../server/homeBrainFactCore.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function createNetworkBlockingFetch() {
  return async (url) => {
    throw new Error(
      `PHASE_A_TEST_NETWORK_BLOCKED: outbound fetch is forbidden (${String(url ?? "unknown-url")})`,
    );
  };
}

const nativeFetch = globalThis.fetch;
const networkBlockingFetch = createNetworkBlockingFetch();

const caseCPolicies = JSON.parse(
  readFileSync(join(ROOT, "fixtures/coverage-sheet-p1-a/case-c-baseline-contract/policies.json"), "utf8"),
);

const unifiedFixture = {
  profile: { display_name: "테스트" },
  policies: caseCPolicies,
  policy_count: caseCPolicies.length,
  memory_status: "ready",
  memory_fact_count: 12,
};

function buildPhaseAMockSupabase(policies = caseCPolicies) {
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
        in() {
          return chain;
        },
        order() {
          return chain;
        },
        limit() {
          return chain;
        },
        maybeSingle: async () => {
          if (table === "customer_profiles") {
            return { data: { id: "customer-test", display_name: "테스트" }, error: null };
          }
          if (table === "profile_health") {
            return { data: null, error: null };
          }
          return { data: null, error: null };
        },
        then(onFulfilled, onRejected) {
          let payload = { data: [], error: null, count: 0 };
          if (table === "active_profile_insurance_policies") {
            payload = { data: policies, error: null };
          }
          if (table === "customer_memory_facts") {
            payload = { data: [], error: null };
          }
          if (table === "customer_documents") {
            payload = { data: [], error: null, count: 0 };
          }
          return Promise.resolve(payload).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
  };
}

async function runCase(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
    return true;
  } catch (error) {
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function main() {
  globalThis.fetch = networkBlockingFetch;
  try {
  console.log("step1-phaseA-honesty-gate-unit-test");
  let passed = 0;
  let failed = 0;

  if (
    await runCase("T1 D1 highPriority zero evidence stays unknown (no false missing)", () => {
      const result = analyzeCoverageGaps({ customer_id: "universal", memory: [] });
      const cancer = result.coverage_gaps.find((item) => item.coverage_type === "cancer");
      const brain = result.coverage_gaps.find((item) => item.coverage_type === "brain");
      const medical = result.coverage_gaps.find((item) => item.coverage_type === "medical_expense");

      assert.equal(cancer?.status, "unknown");
      assert.equal(brain?.status, "unknown");
      assert.equal(medical?.status, "unknown");

      const falseMissing = result.coverage_gaps.filter((item) => item.status === "missing");
      assert.equal(falseMissing.length, 0);
    })
  ) {
    passed += 1;
  } else {
    failed += 1;
  }

  if (
    await runCase("T2 partial evidence returns guidance template and keeps premium line", async () => {
      const route = routeCentralBrain({
        question: "암보험 부족해?",
        env: { CENTRAL_BRAIN_ENABLED: "true", ADVISOR_BRAIN_ENABLED: "true" },
      });
      assert.equal(route.central_mode, "coverage_gap_reason");

      const plan = planCentralBrainEvidence({ route });
      const bundle = await loadCentralBrainEvidence({
        supabase: buildPhaseAMockSupabase(),
        customerId: "customer-test",
        plan,
        memorySnapshot: { facts: [], fact_count: 0, memory_version: 1 },
        cachePayload: null,
        conversationHistory: [],
        jobLoader: async () => null,
      });
      assert.equal(bundle.sufficiency, "partial");
      assert.equal(computePremiumLookupStats(caseCPolicies).premiumTotal, 318683);

      const result = await runCentralBrainTurn({
        question: "암보험 부족해?",
        supabase: buildPhaseAMockSupabase(),
        customerId: "customer-test",
        env: {
          CENTRAL_BRAIN_ENABLED: "true",
          ADVISOR_BRAIN_ENABLED: "true",
        },
        fetchImpl: networkBlockingFetch,
        jobLoader: async () => null,
        memorySnapshot: { facts: [], fact_count: 0, memory_version: 1 },
        cachePayload: null,
        conversationHistory: [],
      });

      assert.equal(result.activated, true);
      assert.equal(result.reason, "PARTIAL_EVIDENCE_GUIDANCE");
      assert.match(result.message, /318,683원/);
      assert.match(result.message, /다만 암 보장금액은 아직 확인되지 않았습니다/);
      assert.match(result.message, /보장금액을 확인해야 판단할 수 있습니다/);
      assert.doesNotMatch(result.message, /반드시|확실히 부족|부족합니다|없습니다/);
    })
  ) {
    passed += 1;
  } else {
    failed += 1;
  }

  if (
    await runCase(
      "T3 legacy judgment intents use stopgap; factual/claim/policy/premium preserved",
      async () => {
        assert.equal(isPhaseAJudgmentLegacyIntent({ intent: "design_request" }, "보험 설계해줘"), true);
        assert.equal(
          isPhaseAJudgmentLegacyIntent({ intent: "recommendation_request" }, "뭐 가입해야 해?"),
          true,
        );
        assert.equal(
          isPhaseAJudgmentLegacyIntent({ intent: "recommendation_request" }, "왜 암을 추천했어?"),
          false,
        );
        assert.equal(
          isPhaseAJudgmentLegacyIntent({ intent: "general_consultation" }, "내 보험 괜찮아?"),
          true,
        );
        assert.equal(isPhaseAJudgmentLegacyIntent({ intent: "factual_lookup" }, "내 보험료 얼마야?"), false);

        const designAnswer = await buildConversationalAnswer({
          question: "보험 설계해줘",
          memorySnapshot: { facts: [], fact_count: 0 },
          intentGate: { intent: "design_request" },
          fetchImpl: networkBlockingFetch,
          env: {},
        });
        assert.equal(designAnswer, PHASE_A_LEGACY_JUDGMENT_STOPGAP);

        const policies = [
          {
            id: "fixture-premium-001",
            insurer_name: "한화생명",
            monthly_premium: 166555,
            product_name: "테스트",
          },
        ];
        const workingContext = {
          snapshot: { facts: [], fact_count: 0 },
          sourceContext: { policies, has_policies: true },
          policies,
        };
        const factual = buildFactualLookupAnswer("내 보험료 얼마야?", workingContext, {
          intent: "factual_lookup",
          lookup_sub_intent: "premium_lookup",
        });
        assert.match(factual, /166,555원/);

        const claim = buildClaimFastResponse("골절 보험금 받을 수 있어?", workingContext, {
          intent: "claim_eligibility_check",
        });
        assert.match(claim, /청구|보험금|확인/);

        const premiumHome = composeHomeBrainFactAnswer(unifiedFixture, "내 보험료 얼마야?");
        assert.equal(premiumHome.intent, "premium_lookup");
        assert.match(premiumHome.answerText, /318,683원/);
      },
    )
  ) {
    passed += 1;
  } else {
    failed += 1;
  }

  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  } finally {
    globalThis.fetch = nativeFetch;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
