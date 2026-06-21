/**
 * P3 — Home = Tom (routing + inventory hard guard + UI contract).
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
  HOME_BRAIN_ROUTES,
  hasHighStakesSignal,
  isCasualHomeQuestion,
  resolveHomeBrainRoute,
} from "../server/homeBrainRouter.js";
import { violatesHomeInventoryDump, INVENTORY_DUMP_PATTERNS } from "../server/tomThinkingLoop.js";
import { buildGuidanceResponse, buildFactBundleFromLegacyContext, GUIDANCE_INTENTS } from "../server/guidanceLayer/guidanceBuilder.js";

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
    await runCase("T1 route — gap / defer / casual", () => {
      assert.equal(resolveHomeBrainRoute("암보험 부족해?"), HOME_BRAIN_ROUTES.GAP_GROUNDED);
      assert.equal(resolveHomeBrainRoute("상속세 얼마야?"), HOME_BRAIN_ROUTES.HIGH_STAKES_DEFER);
      assert.equal(resolveHomeBrainRoute("분당 맛집 알려줘"), HOME_BRAIN_ROUTES.CASUAL_CHAT);
      assert.equal(resolveHomeBrainRoute("내 보험료 얼마야?"), HOME_BRAIN_ROUTES.FACTUAL_GROUNDED);
      assert.equal(hasHighStakesSignal("상속세 얼마야?"), true);
      assert.equal(isCasualHomeQuestion("분당 맛집 알려줘"), true);
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
      assert.equal(violatesHomeInventoryDump("등록된 서류 1건"), true);
      assert.equal(
        applyHomeInventoryHardGuard("현재 4건의 보험은 확인됩니다. 월 보험료 318,683원"),
        applyHomeInventoryHardGuard("현재 4건의 보험은 확인됩니다. 월 보험료 318,683원"),
      );
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
    await runCase("T4 E2E gap — grounded Tom, no inventory", async () => {
      const result = await handleHomeBrainFactRequest({
        userSupabase: buildHomeMockSupabase(),
        customerId: "customer-test",
        question: "암보험 부족해?",
        fetchImpl: blockingFetch,
        env: { TOM_2A_GAP_VOICE: "true", TOM_GAP_LIGHT_PATH: "true" },
      });
      assert.equal(result.ok, true);
      assert.equal(result.home_route, HOME_BRAIN_ROUTES.GAP_GROUNDED);
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
      assert.equal(result.home_route, HOME_BRAIN_ROUTES.HIGH_STAKES_DEFER);
      assert.equal(result.answerText, HOME_HIGH_STAKES_DEFER_MESSAGE);
      assert.doesNotMatch(result.answerText, /[\d,]+원|4건|318,683/);
    })
  ) {
    passed += 1;
  } else {
    failed += 1;
  }

  if (
    await runCase("T6 E2E casual — no inventory dump", async () => {
      const result = await handleHomeBrainFactRequest({
        userSupabase: buildHomeMockSupabase(),
        customerId: "customer-test",
        question: "분당 맛집 알려줘",
        fetchImpl: blockingFetch,
        env: {},
      });
      assert.equal(result.home_route, HOME_BRAIN_ROUTES.CASUAL_CHAT);
      assert.doesNotMatch(result.answerText, /318,683|4건|서류\s*1건|고객\s*정보|AI\s*상담실/);
      assert.ok(result.answerText.length > 0);
    })
  ) {
    passed += 1;
  } else {
    failed += 1;
  }

  if (
    await runCase("T7 UI — Tom center copy in home components", () => {
      const entry = readFileSync(join(ROOT, "src/components/AdvisorBrainEntry.jsx"), "utf8");
      const panel = readFileSync(join(ROOT, "src/components/CustomerHomePanel.jsx"), "utf8");
      assert.match(entry, /Tom/);
      assert.match(entry, /보험 관련 궁금한 점을 편하게 물어보세요/);
      assert.match(entry, /분당 맛집 알려줘/);
      assert.match(panel, /AdvisorBrainEntry/);
      assert.match(panel, /보조 정보/);
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
