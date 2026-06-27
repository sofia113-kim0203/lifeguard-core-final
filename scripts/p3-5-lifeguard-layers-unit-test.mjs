/**
 * P3.5 — 4-layer separation + conversation unit tests.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  APP_ROLES,
  BACKOFFICE_ROUTE_TABLE,
  canAccessPath,
  getRedirectPathForRole,
  isBackofficePath,
} from "../src/lib/appRouting.js";
import { evaluateAppRouteGate } from "../server/appRoleGate.js";
import {
  applyLifeguardCustomerOutputGuard,
  violatesEngineTermLeak,
  violatesDeflectionPhrase,
} from "../server/lifeguardOutputGuard.js";
import { LIFEGUARD_CHAT_FALLBACK } from "../server/lifeguardChatCore.js";
import { handleHomeBrainFactRequest } from "../server/homeBrainFactCore.js";
import { resolveTomInternalRoute, TOM_INTERNAL_ROUTES } from "../server/homeAgentTom.js";
import { HOME_HIGH_STAKES_DEFER_MESSAGE } from "../server/homeBrainRouter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

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

function buildMockSupabase({ role = "customer", policies = [] } = {}) {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: "user-1", email: "t@test.com" } }, error: null }),
    },
    from(table) {
      const chain = {
        select() {
          return chain;
        },
        eq() {
          return chain;
        },
        maybeSingle: async () => {
          if (table === "users") return { data: { role }, error: null };
          if (table === "customer_profiles") {
            return { data: { id: "customer-test", display_name: "테스트" }, error: null };
          }
          return { data: null, error: null };
        },
        then(onFulfilled, onRejected) {
          let payload = { data: [], error: null };
          if (table === "active_profile_insurance_policies") payload = { data: policies, error: null };
          return Promise.resolve(payload).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
  };
}

async function main() {
  console.log("p3-5-lifeguard-layers-unit-test");
  let passed = 0;
  let failed = 0;

  if (
    await runCase("T1 Phase 0 — role field exists in routing table", () => {
      assert.equal(BACKOFFICE_ROUTE_TABLE.length >= 7, true);
      assert.equal(canAccessPath("/admin", APP_ROLES.CUSTOMER), false);
      assert.equal(canAccessPath("/admin", APP_ROLES.ADMIN), true);
      assert.equal(canAccessPath("/agent", APP_ROLES.AGENT), true);
      assert.equal(canAccessPath("/", APP_ROLES.CUSTOMER), true);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("T2 server route gate — customer blocked from /admin", async () => {
      const gate = await evaluateAppRouteGate({
        userSupabase: buildMockSupabase({ role: "customer" }),
        pathname: "/admin",
      });
      assert.equal(gate.ok, true);
      assert.equal(gate.allowed, false);
      assert.equal(gate.redirect, "/");
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("T3 output guard — engine terms + deflection blocked", () => {
      assert.equal(violatesEngineTermLeak("보장분석 결과를 보면"), true);
      assert.equal(violatesEngineTermLeak("추천엔진이 말하길"), true);
      assert.equal(violatesDeflectionPhrase("필요하시면 보험 상담도 도와드릴게요"), true);
      assert.doesNotMatch(applyLifeguardCustomerOutputGuard("Gap audit says 부족"), /Gap|보장분석/);
      assert.doesNotMatch(
        applyLifeguardCustomerOutputGuard("필요하시면 보험 상담도 도와드릴게요"),
        /보험\s*상담/,
      );
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("T4 chat fallback — no deflection phrase", () => {
      assert.doesNotMatch(LIFEGUARD_CHAT_FALLBACK, /필요하시면\s*보험\s*상담/);
      assert.doesNotMatch(LIFEGUARD_CHAT_FALLBACK, /AI\s*상담실/);
    })
  ) {
    passed += 1;
  } else failed += 1;

  const blockingFetch = async () => {
    throw new Error("network_blocked");
  };

  if (
    await runCase("T5 Tom internal — identity + casual + defer + gap tool", async () => {
      assert.equal(resolveTomInternalRoute("너 누구야?"), TOM_INTERNAL_ROUTES.CHAT);
      assert.equal(resolveTomInternalRoute("분당 맛집 알려줘"), TOM_INTERNAL_ROUTES.CHAT);
      assert.equal(resolveTomInternalRoute("상속세 얼마야?"), TOM_INTERNAL_ROUTES.DEFER);
      assert.equal(resolveTomInternalRoute("암보험 부족해?"), TOM_INTERNAL_ROUTES.GAP_TOOL);

      const defer = await handleHomeBrainFactRequest({
        userSupabase: buildMockSupabase(),
        customerId: "customer-test",
        question: "상속세 얼마야?",
        fetchImpl: blockingFetch,
      });
      assert.equal(defer.answerText, HOME_HIGH_STAKES_DEFER_MESSAGE);
      assert.doesNotMatch(defer.answerText, /[\d,]+원/);

      const chat = await handleHomeBrainFactRequest({
        userSupabase: buildMockSupabase(),
        customerId: "customer-test",
        question: "분당 맛집 알려줘",
        fetchImpl: blockingFetch,
      });
      assert.equal(chat.tom_internal_route, TOM_INTERNAL_ROUTES.CHAT);
      assert.doesNotMatch(chat.answerText, /필요하시면\s*보험\s*상담|보장분석|Gap/i);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("T6 UI — customer shell + LIFEGUARD only layer", () => {
      const app = readFileSync(join(ROOT, "src/App.jsx"), "utf8");
      const chat = readFileSync(join(ROOT, "src/components/LifeguardHomeChat.jsx"), "utf8");
      assert.match(app, /CustomerLifeguardShell/);
      assert.match(app, /APP_ROLES\.CUSTOMER/);
      assert.match(chat, /설정/);
      assert.match(chat, /분당에서 가족이랑 갈 만한 곳 추천해줘/);
      assert.match(chat, /buildLifeguardHomeGreeting|LG\.serif/);
      assert.doesNotMatch(chat, />\s*Tom\s*</);
      assert.equal(isBackofficePath("/customer-analysis"), true);
      assert.equal(getRedirectPathForRole("/admin", APP_ROLES.CUSTOMER), "/");
    })
  ) {
    passed += 1;
  } else failed += 1;

  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
