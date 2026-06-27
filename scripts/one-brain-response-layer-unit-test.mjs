/**
 * Phase 1 — One Brain Response Layer (deterministic, network-blocked E2E).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { handleConversationalQuestionRequest } from "../server/conversationalBackgroundAnalysisCore.js";
import {
  finalizeOneBrainResponse,
  ONE_BRAIN_SURFACES,
  sanitizeOneBrainCustomerText,
  shouldDeferLegacyLlmForOneBrain,
} from "../server/oneBrainResponseLayer.js";
import { buildConversationalAnswer } from "../server/fastResponseLayer.js";
import { buildFactualLookupAnswer } from "../server/intentGateLayer.js";
import { composeHomeBrainFactAnswer } from "../server/homeBrainFactCore.js";
import { buildFactBundleFromLegacyContext, buildFactBundleFromUnified } from "../server/guidanceLayer/guidanceBuilder.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

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

function createFetchCounter() {
  let count = 0;
  const blockingFetch = async (url) => {
    count += 1;
    throw new Error(
      `ONE_BRAIN_TEST_NETWORK_BLOCKED: outbound fetch forbidden (${String(url ?? "unknown-url")})`,
    );
  };
  return {
    fetch: blockingFetch,
    getCount: () => count,
    reset: () => {
      count = 0;
    },
  };
}

function buildOneBrainMockSupabase(policies = caseCPolicies) {
  return {
    from(table) {
      const chain = {
        insert() {
          return chain;
        },
        update() {
          return chain;
        },
        upsert() {
          return chain;
        },
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
            return { data: { id: "customer-test", display_name: "테스트", memory_version: 1 }, error: null };
          }
          if (table === "profile_health") {
            return { data: null, error: null };
          }
          return { data: null, error: null };
        },
        single: async () => ({
          data: {
            id: `row-${table}-${Date.now()}`,
            customer_id: "customer-test",
            status: "queued",
            timing_metrics: {},
            stages_completed: [],
            result_json: {},
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          error: null,
        }),
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
          if (table === "customer_analysis_cache") {
            payload = { data: [], error: null };
          }
          if (table === "conversation_messages") {
            payload = { data: [], error: null };
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
  const nativeFetch = globalThis.fetch;
  const fetchCounter = createFetchCounter();
  globalThis.fetch = fetchCounter.fetch;

  try {
    console.log("one-brain-response-layer-unit-test");
    let passed = 0;
    let failed = 0;

    if (
      await runCase("T1 P0 — CB OFF gap: legacy defer fetch 0, Tom voice (no inventory)", async () => {
        fetchCounter.reset();
        assert.equal(shouldDeferLegacyLlmForOneBrain({ intent: "coverage_gap_check" }, "암보험 부족해?"), true);

        const legacyRaw = await buildConversationalAnswer({
          question: "암보험 부족해?",
          memorySnapshot: { facts: [], fact_count: 0, memory_version: 1 },
          sourceContext: { policies: caseCPolicies, has_policies: true },
          intentGate: { intent: "coverage_gap_check" },
          fetchImpl: fetchCounter.fetch,
          env: {
            CENTRAL_BRAIN_ENABLED: "false",
            ADVISOR_BRAIN_ENABLED: "false",
          },
        });
        assert.equal(legacyRaw, "");
        assert.equal(fetchCounter.getCount(), 0);

        const result = await handleConversationalQuestionRequest({
          question: "암보험 부족해?",
          testCustomerId: "customer-test",
          adminSupabase: buildOneBrainMockSupabase(),
          fetchImpl: fetchCounter.fetch,
          env: {
            CENTRAL_BRAIN_ENABLED: "false",
            ADVISOR_BRAIN_ENABLED: "false",
            TOM_2A_GAP_VOICE: "true",
          },
        });

        assert.equal(result.ok, true);
        assert.equal(fetchCounter.getCount(), 0);
        assert.doesNotMatch(result.fast_response, /318,683|31만8천|현재 4건의 보험|등록된 서류|등록된 고객 정보/);
        assert.doesNotMatch(result.fast_response, /부족합니다|확실히 부족|반드시 부족|충분합니다/);
        assert.match(result.fast_response, /잠깐|안 보여|같이|판단 못|보장내역서/);
        assert.doesNotMatch(result.fast_response, /AI 상담실|다른 메뉴|redirect/i);
      })
    ) {
      passed += 1;
    } else {
      failed += 1;
    }

    if (
      await runCase("T2 CB ON gap — Tom voice at finalize (no inventory template)", async () => {
        fetchCounter.reset();
        const result = await handleConversationalQuestionRequest({
          question: "암보험 부족해?",
          testCustomerId: "customer-test",
          adminSupabase: buildOneBrainMockSupabase(),
          fetchImpl: fetchCounter.fetch,
          env: {
            CENTRAL_BRAIN_ENABLED: "true",
            ADVISOR_BRAIN_ENABLED: "false",
            TOM_2A_GAP_VOICE: "true",
          },
        });
        assert.equal(result.ok, true);
        assert.equal(fetchCounter.getCount(), 0);
        assert.doesNotMatch(result.fast_response, /318,683|현재 4건의 보험/);
        assert.match(result.fast_response, /잠깐|안 보여|같이|판단 못|보장내역서/);
      })
    ) {
      passed += 1;
    } else {
      failed += 1;
    }

    if (
      await runCase("T3 verified passthrough — premium factual + home premium preserved", async () => {
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
        const finalizedFactual = finalizeOneBrainResponse({
          text: factual,
          question: "내 보험료 얼마야?",
          intent: "factual_lookup",
          surface: ONE_BRAIN_SURFACES.CONSULTATION,
          factBundle: buildFactBundleFromLegacyContext({
            sourceContext: workingContext.sourceContext,
            snapshot: workingContext.snapshot,
            question: "내 보험료 얼마야?",
          }),
        });
        assert.match(finalizedFactual, /166,555원/);

        const composed = composeHomeBrainFactAnswer(unifiedFixture, "내 보험료 얼마야?");
        const finalizedHome = finalizeOneBrainResponse({
          text: composed.answerText,
          question: "내 보험료 얼마야?",
          intent: "factual_lookup",
          surface: ONE_BRAIN_SURFACES.HOME,
          factBundle: buildFactBundleFromUnified(unifiedFixture, "내 보험료 얼마야?"),
          homeBrainIntent: composed.intent,
          homeRoute: "factual_grounded",
        });
        assert.match(finalizedHome, /318683원/);
        assert.doesNotMatch(finalizedHome, /318,683|월\s*보험료|4건의\s*보험/);
      })
    ) {
      passed += 1;
    } else {
      failed += 1;
    }

    if (
      await runCase("T4 home unsupported gap — no guidance inventory dump on HOME", () => {
        const composed = composeHomeBrainFactAnswer(unifiedFixture, "암보험 부족해?");
        assert.equal(composed.intent, "unsupported");
        const finalized = finalizeOneBrainResponse({
          text: composed.answerText,
          question: "암보험 부족해?",
          intent: "coverage_gap_check",
          surface: ONE_BRAIN_SURFACES.HOME,
          factBundle: buildFactBundleFromUnified(unifiedFixture, "암보험 부족해?"),
          homeBrainIntent: composed.intent,
          homeRoute: "high_stakes_defer",
        });
        assert.doesNotMatch(finalized, /AI 상담실|318,683|4건|서류\s*1건/);
        assert.match(finalized, /전문가|확인/);
      })
    ) {
      passed += 1;
    } else {
      failed += 1;
    }

    if (
      await runCase("T5 sanitizer — redirect stripped, ungrounded premium masked", () => {
        const sanitized = sanitizeOneBrainCustomerText(
          "더 자세한 분석은 AI 상담실에서 진행할 수 있습니다. 월 보험료: 999,999원",
          { policy_count: 0, policies: [], premium_stats: { premiumKnownCount: 0 } },
        );
        assert.doesNotMatch(sanitized, /AI 상담실/);
        assert.match(sanitized, /월 보험료: 미확인/);
      })
    ) {
      passed += 1;
    } else {
      failed += 1;
    }

    if (
      await runCase("T6 design_request — legacy defer + finalize guidance (fetch 0)", async () => {
        fetchCounter.reset();
        const legacyRaw = await buildConversationalAnswer({
          question: "보험 설계해줘",
          memorySnapshot: { facts: [], fact_count: 0 },
          intentGate: { intent: "design_request" },
          fetchImpl: fetchCounter.fetch,
          env: {},
        });
        assert.equal(legacyRaw, "");
        assert.equal(fetchCounter.getCount(), 0);

        const finalized = finalizeOneBrainResponse({
          text: legacyRaw,
          question: "보험 설계해줘",
          intent: "design_request",
          surface: ONE_BRAIN_SURFACES.CONSULTATION,
          factBundle: { policy_count: 0, policies: [], question: "보험 설계해줘" },
        });
        assert.match(finalized, /설계|분석|확인/);
        assert.doesNotMatch(finalized, /AI 상담실|redirect/i);
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
