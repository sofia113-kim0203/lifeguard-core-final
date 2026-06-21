/**
 * Step 1-B-1 — Shared Guidance Builder + CB gap path (deterministic).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { runCentralBrainTurn } from "../server/centralBrain/centralBrainOrchestrator.js";
import {
  buildGapGuidance,
  buildGuidanceResponse,
  GUIDANCE_INTENTS,
} from "../server/guidanceLayer/guidanceBuilder.js";
import {
  PHASE_A_LEGACY_JUDGMENT_STOPGAP,
  buildConversationalAnswer,
} from "../server/fastResponseLayer.js";
import { buildFactualLookupAnswer, buildPolicyDetailAnswer } from "../server/intentGateLayer.js";
import { buildClaimFastResponse } from "../server/claimBridgeLayer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function createNetworkBlockingFetch() {
  return async (url) => {
    throw new Error(
      `PHASE_B1_TEST_NETWORK_BLOCKED: outbound fetch is forbidden (${String(url ?? "unknown-url")})`,
    );
  };
}

const nativeFetch = globalThis.fetch;
const networkBlockingFetch = createNetworkBlockingFetch();

const caseCPolicies = JSON.parse(
  readFileSync(join(ROOT, "fixtures/coverage-sheet-p1-a/case-c-baseline-contract/policies.json"), "utf8"),
);

function buildPhaseB1MockSupabase(policies = caseCPolicies) {
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
    console.log("step1-B1-guidance-builder-unit-test");
    let passed = 0;
    let failed = 0;

    if (
      await runCase('T1 gap partial "암보험 부족해?" → 3-element guidance', async () => {
        const result = await runCentralBrainTurn({
          question: "암보험 부족해?",
          supabase: buildPhaseB1MockSupabase(),
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

        assert.equal(result.reason, "PARTIAL_EVIDENCE_GUIDANCE");
        assert.match(result.message, /현재 4건의 보험은 확인됩니다/);
        assert.match(result.message, /318,683원/);
        assert.match(result.message, /다만 암 보장금액은 아직 확인되지 않았습니다/);
        assert.match(result.message, /암보험이 부족한지는 보장금액을 확인해야 판단할 수 있습니다/);
        assert.match(result.message, /보장내역서를 분석하면 암·뇌·심장 보장을 바로 평가해 드릴게요/);
        assert.doesNotMatch(result.message, /AI 상담실|다른 메뉴|이동해|redirect/i);
        assert.doesNotMatch(result.message, /모르겠습니다|알 수 없습니다/);
        assert.doesNotMatch(result.message, /부족합니다|없습니다|확실히 부족|반드시 부족/);
      })
    ) {
      passed += 1;
    } else {
      failed += 1;
    }

    if (
      await runCase("T2 whitelist — confirmed-facts slot has no judgment tokens", () => {
        const guidance = buildGapGuidance({
          policy_count: 4,
          document_count: 0,
          premium_stats: {
            totalCount: 4,
            premiumKnownCount: 3,
            premiumTotal: 318683,
            premiumUnknownCount: 1,
          },
          memory_fact_count: 0,
          policies: caseCPolicies,
          question: "암보험 부족해?",
        });

        const confirmedSlot = guidance.confirmedFacts;
        assert.doesNotMatch(confirmedSlot, /부족|충분|괜찮|adequate|missing|gap_score|추천|설계|판정/);
        assert.match(confirmedSlot, /4건의 보험은 확인됩니다/);
      })
    ) {
      passed += 1;
    } else {
      failed += 1;
    }

    if (
      await runCase("T3 preserve factual/claim/policy_detail and legacy stopgap", async () => {
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

        const policyDetail = buildPolicyDetailAnswer("내 보험 알려줘", workingContext);
        assert.match(policyDetail, /166,555|한화생명|총 1건/);
      })
    ) {
      passed += 1;
    } else {
      failed += 1;
    }

    if (
      await runCase("T4 network block — guidance builder is deterministic (no fetch)", () => {
        const message = buildGuidanceResponse(GUIDANCE_INTENTS.GAP, {
          policy_count: 2,
          premium_stats: null,
          policies: [],
          question: "암보험 부족해?",
        });
        assert.match(message, /다만 암 보장금액/);
      })
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
