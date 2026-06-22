/**
 * P4-A — LIFEGUARD Customer First unit tests (mock fixtures only, no live DB).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  APP_ROLES,
  canAccessPath,
  getRedirectPathForRole,
} from "../src/lib/appRouting.js";
import { evaluateAppRouteGate } from "../server/appRoleGate.js";
import {
  resolveTomInternalRoute,
  TOM_INTERNAL_ROUTES,
} from "../server/homeAgentTom.js";
import {
  hasHighStakesSignal,
  isConversationalInsuranceBridgeQuestion,
} from "../server/homeBrainRouter.js";
import {
  applyLifeguardCustomerOutputGuard,
  violatesDeflectionPhrase,
  violatesEngineTermLeak,
} from "../server/lifeguardOutputGuard.js";
import { LIFEGUARD_CHAT_FALLBACK } from "../server/lifeguardChatCore.js";
import { handleHomeBrainFactRequest } from "../server/homeBrainFactCore.js";

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

function buildMockSupabase({ role = "customer" } = {}) {
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
            return { data: { id: "customer-test", display_name: "진우" }, error: null };
          }
          return { data: null, error: null };
        },
        then(onFulfilled, onRejected) {
          return Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
  };
}

async function main() {
  console.log("p4-a-lifeguard-customer-first-unit-test");
  let passed = 0;
  let failed = 0;

  if (
    await runCase("T1 customer UI — LIFEGUARD partner copy + example chips", () => {
      const chat = readFileSync(join(ROOT, "src/components/LifeguardHomeChat.jsx"), "utf8");
      assert.match(chat, /당신의 보험 파트너/);
      assert.match(chat, /안녕하세요 \$\{displayName\}님/);
      assert.match(chat, /오늘은 무엇을 도와드릴까요/);
      assert.match(chat, /분당에서 가족이랑 갈 만한 곳 추천해줘/);
      assert.match(chat, /대장 선종 제거했는데 보험금 받을 수 있나/);
      assert.doesNotMatch(chat, /고객분석|AI상담실|설계사데스크|관리자/);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("T2 RBAC — customer blocked from backoffice paths", () => {
      assert.equal(canAccessPath("/admin", APP_ROLES.CUSTOMER), false);
      assert.equal(canAccessPath("/customer-analysis", APP_ROLES.CUSTOMER), false);
      assert.equal(getRedirectPathForRole("/admin", APP_ROLES.CUSTOMER), "/");
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("T3 deflection guard — expanded FAIL phrases blocked", () => {
      assert.equal(violatesDeflectionPhrase("보험 상담도 가능합니다"), true);
      assert.equal(violatesDeflectionPhrase("보험 이야기 해볼까요?"), true);
      assert.equal(violatesDeflectionPhrase("필요하시면 보험 상담도 도와드릴게요"), true);
      assert.doesNotMatch(
        applyLifeguardCustomerOutputGuard("보험 상담도 가능합니다"),
        /보험\s*상담/,
      );
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("T4 engine term guard — customer-facing names blocked", () => {
      assert.equal(violatesEngineTermLeak("Coverage Gap 결과"), true);
      assert.equal(violatesEngineTermLeak("Recommendation Engine"), true);
      assert.equal(violatesEngineTermLeak("보험 분석 엔진"), true);
      assert.doesNotMatch(applyLifeguardCustomerOutputGuard("Coverage Gap says 부족"), /Gap|Coverage/i);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("T5 routing — casual vs bridge vs gap vs high-stakes", () => {
      assert.equal(resolveTomInternalRoute("분당에서 가족이랑 갈 만한 곳 추천해줘"), TOM_INTERNAL_ROUTES.CHAT);
      assert.equal(resolveTomInternalRoute("암보험 부족한가?"), TOM_INTERNAL_ROUTES.GAP_TOOL);
      assert.equal(
        resolveTomInternalRoute("대장 선종 제거했는데 보험금 받을 수 있나?"),
        TOM_INTERNAL_ROUTES.CHAT,
      );
      assert.equal(resolveTomInternalRoute("입원했어"), TOM_INTERNAL_ROUTES.CHAT);
      assert.equal(resolveTomInternalRoute("상속세 얼마야?"), TOM_INTERNAL_ROUTES.DEFER);
      assert.equal(isConversationalInsuranceBridgeQuestion("보험료 너무 비싼가?"), true);
      assert.equal(hasHighStakesSignal("상속세 얼마야?"), true);
    })
  ) {
    passed += 1;
  } else failed += 1;

  const blockingFetch = async () => {
    throw new Error("network_blocked");
  };

  if (
    await runCase("T6 chat mock — casual + bridge without deflection (no live LLM)", async () => {
      const casual = await handleHomeBrainFactRequest({
        userSupabase: buildMockSupabase(),
        customerId: "customer-test",
        question: "분당 맛집 알려줘",
        fetchImpl: blockingFetch,
      });
      assert.equal(casual.tom_internal_route, TOM_INTERNAL_ROUTES.CHAT);
      assert.doesNotMatch(casual.answerText, /보험\s*상담|보험\s*이야기|Coverage\s*Gap/i);

      const bridge = await handleHomeBrainFactRequest({
        userSupabase: buildMockSupabase(),
        customerId: "customer-test",
        question: "대장 선종 제거했는데 보험금 받을 수 있나?",
        fetchImpl: blockingFetch,
      });
      assert.equal(bridge.tom_internal_route, TOM_INTERNAL_ROUTES.CHAT);
      assert.doesNotMatch(bridge.answerText, /보험\s*상담도\s*가능|필요하시면\s*보험/i);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("T7 fallbacks — no deflection in LIFEGUARD_CHAT_FALLBACK", () => {
      assert.doesNotMatch(LIFEGUARD_CHAT_FALLBACK, /필요하시면\s*보험\s*상담|보험\s*상담도\s*가능/i);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("T8 server route gate — customer /admin redirect", async () => {
      const gate = await evaluateAppRouteGate({
        userSupabase: buildMockSupabase({ role: "customer" }),
        pathname: "/admin",
      });
      assert.equal(gate.allowed, false);
      assert.equal(gate.redirect, "/");
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
