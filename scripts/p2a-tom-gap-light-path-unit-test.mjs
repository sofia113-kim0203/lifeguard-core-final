/**
 * P2a — Tom-first light path (speed skip + Tom tone) unit tests.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { handleConversationalQuestionRequest } from "../server/conversationalBackgroundAnalysisCore.js";
import { buildFactBundleFromLegacyContext } from "../server/guidanceLayer/guidanceBuilder.js";
import {
  buildTomGapLightFactBundle,
  shouldUseTomGapLightPath,
} from "../server/tomGapLightPath.js";
import { composeTomGapHoldFallback, runTomThinkingPlan, violatesTomGapVoiceChecks } from "../server/tomThinkingLoop.js";
import { buildGapEvidenceAudit } from "../server/tomEvidenceLens.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const caseCPolicies = JSON.parse(
  readFileSync(join(ROOT, "fixtures/coverage-sheet-p1-a/case-c-baseline-contract/policies.json"), "utf8"),
);

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
            payload = { data: [{ id: "doc-1" }], error: null, count: 1 };
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
  console.log("p2a-tom-gap-light-path-unit-test");
  let passed = 0;
  let failed = 0;

  if (
    await runCase("T1 light path gate — coverage_gap_check only", () => {
      assert.equal(shouldUseTomGapLightPath({ intent: "coverage_gap_check" }), true);
      assert.equal(shouldUseTomGapLightPath({ intent: "design_request" }), false);
      assert.equal(
        shouldUseTomGapLightPath({ intent: "coverage_gap_check" }, { TOM_GAP_LIGHT_PATH: "false" }),
        false,
      );
    })
  ) {
    passed += 1;
  } else {
    failed += 1;
  }

  if (
    await runCase("T2 policy data consistency — light bundle matches legacy policies", () => {
      const legacy = buildFactBundleFromLegacyContext({
        sourceContext: { policies: caseCPolicies, has_policies: true },
        snapshot: { fact_count: 8 },
        question: "암보험 부족해?",
      });
      const light = buildTomGapLightFactBundle(caseCPolicies, "암보험 부족해?");
      assert.deepEqual(light.policies, legacy.policies);
      assert.equal(light.policy_count, legacy.policy_count);
      const legacyAudit = buildGapEvidenceAudit(legacy, "암보험 부족해?");
      const lightAudit = buildGapEvidenceAudit(light, "암보험 부족해?");
      assert.deepEqual(lightAudit.fields, legacyAudit.fields);
    })
  ) {
    passed += 1;
  } else {
    failed += 1;
  }

  if (
    await runCase("T3 Tom tone — fallback opener + no 상담사 phrase", () => {
      const plan = runTomThinkingPlan({
        question: "암보험 부족해?",
        intent: "coverage_gap_check",
        factBundle: buildTomGapLightFactBundle(caseCPolicies, "암보험 부족해?"),
      });
      const text = composeTomGapHoldFallback(plan);
      assert.match(text, /잠깐 볼게요/);
      assert.match(text, /안 보여요/);
      assert.match(text, /판단 못 하겠어요/);
      assert.match(text, /같이 볼게요/);
      assert.doesNotMatch(text, /말씀드리기 어렵|318,683|4건|서류\s*1건/);
    })
  ) {
    passed += 1;
  } else {
    failed += 1;
  }

  if (
    await runCase("T4 adversarial on light audit — guard blocks judgment + amount", () => {
      const audit = buildGapEvidenceAudit(
        buildTomGapLightFactBundle(caseCPolicies, "암보험 부족해?"),
        "암보험 부족해?",
      );
      assert.equal(violatesTomGapVoiceChecks("암 보험이 확실히 부족합니다. 3,000만원 필요.", audit), "judgment_assertion");
    })
  ) {
    passed += 1;
  } else {
    failed += 1;
  }

  let fetchCount = 0;
  const blockingFetch = async () => {
    fetchCount += 1;
    throw new Error("network_blocked");
  };

  if (
    await runCase("T5 consultation E2E light path — skip heavy + latency fields", async () => {
      fetchCount = 0;
      const startedAt = Date.now();
      const result = await handleConversationalQuestionRequest({
        question: "암보험 부족해?",
        testCustomerId: "customer-test",
        adminSupabase: buildOneBrainMockSupabase(),
        fetchImpl: blockingFetch,
        env: {
          CENTRAL_BRAIN_ENABLED: "true",
          ADVISOR_BRAIN_ENABLED: "true",
          TOM_2A_GAP_VOICE: "true",
          TOM_GAP_LIGHT_PATH: "true",
        },
      });
      const elapsed = Date.now() - startedAt;
      assert.equal(result.ok, true);
      assert.equal(result.tom_gap_light_path, true);
      assert.equal(fetchCount, 0);
      assert.ok(Array.isArray(result.skipped_stages));
      assert.match(result.skipped_stages.join(","), /central_brain/);
      assert.match(result.skipped_stages.join(","), /build_conversational_answer/);
      assert.equal(typeof result.tom_turn_ms, "number");
      assert.equal(typeof result.initial_response_time_ms, "number");
      assert.ok(result.initial_response_time_ms <= elapsed + 50);
      assert.doesNotMatch(result.fast_response, /318,683|4건|서류\s*1건|고객\s*정보/);
      assert.match(result.fast_response, /잠깐 볼게요|안 보여요|같이 볼게요/);
      assert.equal(result.tom_voice_trace?.tom_ran, true);
    })
  ) {
    passed += 1;
  } else {
    failed += 1;
  }

  if (
    await runCase("T6 latency before/after — light path vs legacy path timings", async () => {
      const envBase = {
        CENTRAL_BRAIN_ENABLED: "true",
        ADVISOR_BRAIN_ENABLED: "true",
        TOM_2A_GAP_VOICE: "true",
      };
      const light = await handleConversationalQuestionRequest({
        question: "암보험 부족해?",
        testCustomerId: "customer-test",
        adminSupabase: buildOneBrainMockSupabase(),
        fetchImpl: blockingFetch,
        env: { ...envBase, TOM_GAP_LIGHT_PATH: "true" },
      });
      const legacy = await handleConversationalQuestionRequest({
        question: "암보험 부족해?",
        testCustomerId: "customer-test",
        adminSupabase: buildOneBrainMockSupabase(),
        fetchImpl: blockingFetch,
        env: { ...envBase, TOM_GAP_LIGHT_PATH: "false" },
      });
      assert.equal(light.tom_gap_light_path, true);
      assert.equal(legacy.tom_gap_light_path, undefined);
      assert.ok(light.initial_response_time_ms >= 0);
      assert.ok(legacy.initial_response_time_ms >= 0);
      console.log(
        `  latency_ms light=${light.initial_response_time_ms} legacy=${legacy.initial_response_time_ms} tom_turn_ms=${light.tom_turn_ms}`,
      );
    })
  ) {
    passed += 1;
  } else {
    failed += 1;
  }

  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
