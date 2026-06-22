/**
 * P3 v4 — Agent Tom home (internal routing + gap tool + inventory guard + UI contract).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  applyHomeInventoryHardGuard,
  handleHomeBrainFactRequest,
  HOME_HIGH_STAKES_DEFER_MESSAGE,
} from "../server/homeBrainFactCore.js";
import {
  resolveTomInternalRoute,
  TOM_INTERNAL_ROUTES,
  INSURANCE_DEFER_WITHOUT_TOOL_MESSAGE,
} from "../server/homeAgentTom.js";
import { violatesHomeInventoryDump, INVENTORY_DUMP_PATTERNS } from "../server/tomThinkingLoop.js";
import {
  buildGuidanceResponse,
  buildFactBundleFromLegacyContext,
  GUIDANCE_INTENTS,
} from "../server/guidanceLayer/guidanceBuilder.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const caseCPolicies = JSON.parse(
  readFileSync(join(ROOT, "fixtures/coverage-sheet-p1-a/case-c-baseline-contract/policies.json"), "utf8"),
);

function buildHomeMockSupabase(policies = caseCPolicies) {
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
            return { data: { id: "customer-test", display_name: "테스트", memory_version: 1 }, error: null };
          }
          return { data: null, error: null };
        },
        then(onFulfilled, onRejected) {
          let payload = { data: [], error: null, count: 0 };
          if (table === "active_profile_insurance_policies") {
            payload = { data: policies, error: null };
          }
          if (table === "customer_memory_facts") {
            payload = { data: [{ id: "m1" }], error: null };
          }
          if (table === "customer_documents") {
            payload = { data: [{ id: "doc-1" }], error: null, count: 1 };
          }
          if (table === "customer_analysis_cache") {
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
  console.log("p3-home-tom-unit-test");
  let passed = 0;
  let failed = 0;

  if (
    await runCase("T1 Tom internal route — gap tool / defer / chat", () => {
      assert.equal(resolveTomInternalRoute("암보험 부족해?"), TOM_INTERNAL_ROUTES.GAP_TOOL);
      assert.equal(resolveTomInternalRoute("상속세 얼마야?"), TOM_INTERNAL_ROUTES.DEFER);
      assert.equal(resolveTomInternalRoute("분당 맛집 알려줘"), TOM_INTERNAL_ROUTES.CHAT);
      assert.equal(resolveTomInternalRoute("내 보험료 얼마야?"), TOM_INTERNAL_ROUTES.DEFER);
    })
  ) {
    passed += 1;
  } else {
    failed += 1;
  }

  if (
    await runCase("T2 inventory guard — blocks 4건 / 318,683 dump patterns", () => {
      assert.equal(violatesHomeInventoryDump("현재 4건의 보험은 확인됩니다."), true);
      assert.equal(violatesHomeInventoryDump("월 보험료 318,683원"), true);
      assert.doesNotMatch(
        applyHomeInventoryHardGuard("현재 4건의 보험은 확인됩니다. 월 보험료 318,683원"),
        /4건|318,683/,
      );
      assert.equal(INVENTORY_DUMP_PATTERNS.length >= 6, true);
    })
  ) {
    passed += 1;
  } else {
    failed += 1;
  }

  if (
    await runCase("T3 guidance dump blocked on home guard", () => {
      const bundle = buildFactBundleFromLegacyContext({
        sourceContext: { policies: caseCPolicies, has_policies: true },
        snapshot: { fact_count: 8 },
        question: "암보험 부족해?",
      });
      const guidance = buildGuidanceResponse(GUIDANCE_INTENTS.GAP, bundle, { question: "암보험 부족해?" });
      assert.match(guidance, /318,683|4건/);
      const guarded = applyHomeInventoryHardGuard(guidance);
      assert.doesNotMatch(guarded, /318,683|4건|서류\s*1건|고객\s*정보/);
    })
  ) {
    passed += 1;
  } else {
    failed += 1;
  }

  const blockingFetch = async () => {
    throw new Error("network_blocked");
  };

  if (
    await runCase("T4 E2E gap — Tom calls gap_audit tool only", async () => {
      const result = await handleHomeBrainFactRequest({
        userSupabase: buildHomeMockSupabase(),
        customerId: "customer-test",
        question: "암보험 부족해?",
        fetchImpl: blockingFetch,
        env: { TOM_2A_GAP_VOICE: "true", TOM_GAP_LIGHT_PATH: "true" },
      });
      assert.equal(result.ok, true);
      assert.equal(result.agent, "home_agent_tom");
      assert.equal(result.tom_internal_route, TOM_INTERNAL_ROUTES.GAP_TOOL);
      assert.equal(result.tool_used, "gap_audit");
      assert.doesNotMatch(result.answerText, /318,683|4건|서류\s*1건|고객\s*정보/);
      assert.match(result.answerText, /잠깐|안 보여|같이|판단 못|보장내역서/);
    })
  ) {
    passed += 1;
  } else {
    failed += 1;
  }

  if (
    await runCase("T5 E2E defer — 상속세, no invented numbers", async () => {
      const result = await handleHomeBrainFactRequest({
        userSupabase: buildHomeMockSupabase(),
        customerId: "customer-test",
        question: "상속세 얼마야?",
        fetchImpl: blockingFetch,
        env: {},
      });
      assert.equal(result.tom_internal_route, TOM_INTERNAL_ROUTES.DEFER);
      assert.equal(result.tool_used, null);
      assert.equal(result.answerText, HOME_HIGH_STAKES_DEFER_MESSAGE);
      assert.doesNotMatch(result.answerText, /[\d,]+원|4건|318,683|보장분석|Gap/i);
    })
  ) {
    passed += 1;
  } else {
    failed += 1;
  }

  if (
    await runCase("T6 E2E chat — casual path, no inventory", async () => {
      const result = await handleHomeBrainFactRequest({
        userSupabase: buildHomeMockSupabase(),
        customerId: "customer-test",
        question: "분당 맛집 알려줘",
        fetchImpl: blockingFetch,
        env: {},
      });
      assert.equal(result.tom_internal_route, TOM_INTERNAL_ROUTES.CHAT);
      assert.equal(result.tool_used, null);
      assert.doesNotMatch(result.answerText, /318,683|4건|서류\s*1건|고객\s*정보|AI\s*상담실|필요하시면\s*보험\s*상담/i);
      assert.ok(result.answerText.length > 0);
    })
  ) {
    passed += 1;
  } else {
    failed += 1;
  }

  if (
    await runCase("T7 insurance factual without tool — defer not chat", async () => {
      const result = await handleHomeBrainFactRequest({
        userSupabase: buildHomeMockSupabase(),
        customerId: "customer-test",
        question: "내 보험료 얼마야?",
        fetchImpl: blockingFetch,
        env: {},
      });
      assert.equal(result.tom_internal_route, TOM_INTERNAL_ROUTES.DEFER);
      assert.equal(result.answerText, INSURANCE_DEFER_WITHOUT_TOOL_MESSAGE);
    })
  ) {
    passed += 1;
  } else {
    failed += 1;
  }

  if (
    await runCase("T8 UI — LIFEGUARD chat, Tom customer exposure 0", () => {
      const chat = readFileSync(join(ROOT, "src/components/LifeguardHomeChat.jsx"), "utf8");
      const panel = readFileSync(join(ROOT, "src/components/CustomerHomePanel.jsx"), "utf8");
      assert.match(chat, /LIFEGUARD/);
      assert.match(chat, /당신의 보험 파트너/);
      assert.match(chat, /무엇이든 편하게 물어보세요/);
      assert.match(chat, /#0d9488/);
      assert.doesNotMatch(chat, />\s*Tom\s*</);
      assert.match(panel, /LifeguardHomeChat/);
      assert.doesNotMatch(panel, /PolicyExplorerSection|StatusPill/);
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
