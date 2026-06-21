/**
 * Phase 2-A — Tom Voice (cancer gap, Case C) — Stein 5 checks + adversarial safety.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { handleConversationalQuestionRequest } from "../server/conversationalBackgroundAnalysisCore.js";
import {
  buildGapEvidenceAudit,
  EVIDENCE_STATUS,
  formatTomRegulatedEvidenceBlock,
} from "../server/tomEvidenceLens.js";
import {
  composeTomGapHoldFallback,
  composeTomThinkingDecision,
  passesSteinTomGapVoiceChecks,
  runTomThinkingPlan,
  runTomThinkingTurn,
  shouldRunTom2AGapVoice,
  violatesTomGapVoiceChecks,
} from "../server/tomThinkingLoop.js";
import { ONE_BRAIN_SURFACES } from "../server/oneBrainResponseLayer.js";
import { buildFactBundleFromLegacyContext } from "../server/guidanceLayer/guidanceBuilder.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const caseCPolicies = JSON.parse(
  readFileSync(join(ROOT, "fixtures/coverage-sheet-p1-a/case-c-baseline-contract/policies.json"), "utf8"),
);

function buildCaseCFactBundle(question = "암보험 부족해?") {
  return buildFactBundleFromLegacyContext({
    sourceContext: { policies: caseCPolicies, has_policies: true },
    snapshot: { facts: [], fact_count: 0, memory_version: 1 },
    question,
  });
}

function createTomMockFetch(responseText) {
  let lastBody = null;
  const fetchImpl = async (url, init) => {
    lastBody = JSON.parse(String(init?.body ?? "{}"));
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () =>
        JSON.stringify({
          id: "msg-test",
          model: "claude-test",
          content: [{ type: "text", text: responseText }],
        }),
    };
  };
  return {
    fetchImpl,
    getLastBody: () => lastBody,
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
  console.log("tom-2a-gap-voice-unit-test");
  let passed = 0;
  let failed = 0;

  const factBundle = buildCaseCFactBundle();
  const audit = buildGapEvidenceAudit(factBundle, "암보험 부족해?");

  if (
    await runCase("T1 Case C audit — cancer amounts stay unknown", () => {
      assert.equal(audit.judgment_ready, false);
      const amountFields = audit.fields.filter((field) => /benefit/.test(field.id));
      assert.ok(amountFields.length >= 3);
      for (const field of amountFields) {
        assert.equal(field.status, EVIDENCE_STATUS.UNKNOWN);
      }
    })
  ) {
    passed += 1;
  } else {
    failed += 1;
  }

  if (
    await runCase("T2 regulated snippet — no inventory dump fields", () => {
      const block = formatTomRegulatedEvidenceBlock(audit);
      assert.match(block, /status=unknown/);
      assert.doesNotMatch(block, /318,683|31만8천|현재\s*\d+\s*건|premium_stats|월\s*보험료/);
    })
  ) {
    passed += 1;
  } else {
    failed += 1;
  }

  if (
    await runCase("T3 adversarial LLM judgment — FAIL then fallback PASS", async () => {
      const mock = createTomMockFetch("암 보험이 확실히 부족합니다. 3,000만원은 필요합니다.");
      const plan = runTomThinkingPlan({ question: "암보험 부족해?", intent: "coverage_gap_check" });
      plan.audit = audit;
      assert.equal(violatesTomGapVoiceChecks("암 보험이 확실히 부족합니다.", audit), "judgment_assertion");

      const turn = await runTomThinkingTurn({
        question: "암보험 부족해?",
        intent: "coverage_gap_check",
        factBundle,
        fetchImpl: mock.fetchImpl,
        env: { ANTHROPIC_API_KEY: "test-key", TOM_2A_GAP_VOICE: "true" },
      });
      assert.equal(turn.violation, "judgment_assertion");
      assert.doesNotMatch(turn.text, /부족합니다|3,000만원|확실히 부족/);
      assert.match(turn.text, /필요|보류|확인되지|보이|보장내역서/);
      const stein = passesSteinTomGapVoiceChecks(turn.text, audit, { question: "암보험 부족해?" });
      assert.equal(stein.ok, true, stein.check ?? "stein_failed");
    })
  ) {
    passed += 1;
  } else {
    failed += 1;
  }

  if (
    await runCase("T4 adversarial safe LLM — hold + next document PASS", async () => {
      const mock = createTomMockFetch(
        "아직 암 진단비 금액이 자료에 안 보여요. 먼저 진단비 금액 확인이 필요하고, 보장내역서 추가 페이지를 주시면 부족한지 바로 확인해 드릴게요.",
      );
      const turn = await runTomThinkingTurn({
        question: "암보험 부족해?",
        intent: "coverage_gap_check",
        factBundle,
        fetchImpl: mock.fetchImpl,
        env: { ANTHROPIC_API_KEY: "test-key", TOM_2A_GAP_VOICE: "true" },
      });
      assert.equal(turn.violation, null);
      const body = mock.getLastBody();
      const userMsg = body.messages.at(-1)?.content ?? "";
      assert.match(userMsg, /Tom decision/);
      assert.match(userMsg, /Tom evidence audit/);
      assert.doesNotMatch(userMsg, /318,683|현재 4건|premium_stats|memory_fact_count/);
      const stein = passesSteinTomGapVoiceChecks(turn.text, audit, { question: "암보험 부족해?" });
      assert.equal(stein.ok, true, stein.check ?? "stein_failed");
    })
  ) {
    passed += 1;
  } else {
    failed += 1;
  }

  if (
    await runCase("T5 E2E Case C — Tom fallback, no inventory (fetch 0, no API key)", async () => {
      let fetchCount = 0;
      const blockingFetch = async () => {
        fetchCount += 1;
        throw new Error("network_blocked");
      };
      const result = await handleConversationalQuestionRequest({
        question: "암보험 부족해?",
        testCustomerId: "customer-test",
        adminSupabase: buildOneBrainMockSupabase(),
        fetchImpl: blockingFetch,
        env: {
          CENTRAL_BRAIN_ENABLED: "false",
          ADVISOR_BRAIN_ENABLED: "false",
          TOM_2A_GAP_VOICE: "true",
        },
      });
      assert.equal(result.ok, true);
      assert.equal(fetchCount, 0);
      assert.doesNotMatch(result.fast_response, /318,683|31만8천|현재 4건의 보험|등록된 서류|등록된 고객 정보/);
      assert.doesNotMatch(result.fast_response, /부족합니다|충분합니다|확실히 부족/);
      assert.match(result.fast_response, /필요|보류|보이|보장내역서/);
      const stein = passesSteinTomGapVoiceChecks(result.fast_response, audit, { question: "암보험 부족해?" });
      assert.equal(stein.ok, true, stein.check ?? "stein_failed");
    })
  ) {
    passed += 1;
  } else {
    failed += 1;
  }

  if (
    await runCase("T6 scope gate — consultation coverage_gap_check only", () => {
      assert.equal(
        shouldRunTom2AGapVoice({ intent: "coverage_gap_check" }, "암보험 부족해?", ONE_BRAIN_SURFACES.HOME),
        false,
      );
      assert.equal(
        shouldRunTom2AGapVoice({ intent: "coverage_gap_check" }, "암보험 부족해?", ONE_BRAIN_SURFACES.CONSULTATION),
        true,
      );
      assert.equal(
        shouldRunTom2AGapVoice({ intent: "design_request" }, "보험 설계해줘", ONE_BRAIN_SURFACES.CONSULTATION),
        false,
      );
    })
  ) {
    passed += 1;
  } else {
    failed += 1;
  }

  if (
    await runCase("T7 Tom decision + fallback — needs-first hold", () => {
      const plan = runTomThinkingPlan({
        question: "암보험 부족해?",
        intent: "coverage_gap_check",
        factBundle,
      });
      const decision = composeTomThinkingDecision(plan);
      assert.match(decision, /step2_required_before_answer/);
      assert.match(decision, /HOLD/);
      const text = composeTomGapHoldFallback(plan);
      assert.match(text.split(/[.!?]/)[0], /부족|필요|확인/);
      assert.doesNotMatch(text, /318,683|4건/);
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
