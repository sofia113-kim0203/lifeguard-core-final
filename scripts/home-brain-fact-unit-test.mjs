/**
 * P2-A — Home Brain fact unit + G7 safety checks.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  HOME_BRAIN_UNSUPPORTED_MESSAGE,
  classifyHomeBrainIntent,
  composeHomeBrainFactAnswer,
} from "../server/homeBrainFactCore.js";
import { computePremiumLookupStats } from "../server/intentGateLayer.js";
import { buildPremiumDistributionStats } from "../server/premiumDistributionStats.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function loadJson(relativePath) {
  return JSON.parse(readFileSync(join(ROOT, relativePath), "utf8"));
}

function runCase(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
    return true;
  } catch (error) {
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  if (runCase(name, fn)) passed += 1;
  else failed += 1;
}

const caseCPolicies = loadJson("fixtures/coverage-sheet-p1-a/case-c-baseline-contract/policies.json");
const caseCExpected = loadJson("fixtures/coverage-sheet-p1-a/case-c-baseline-contract/expected.json");

const unifiedFixture = {
  profile: { display_name: "테스트" },
  policies: caseCPolicies,
  policy_count: caseCPolicies.length,
  memory_status: "ready",
  memory_fact_count: 12,
};

console.log("home-brain-fact-unit-test");

test("classifyHomeBrainIntent maps five supported intents", () => {
  assert.equal(classifyHomeBrainIntent("내 보험료 얼마야?"), "premium_lookup");
  assert.equal(classifyHomeBrainIntent("보험 몇 개 가입돼 있어?"), "policy_count");
  assert.equal(classifyHomeBrainIntent("어느 보험사 가입돼 있어?"), "insurer_lookup");
  assert.equal(classifyHomeBrainIntent("보험료 미확인 건 있어?"), "premium_unknown_lookup");
  assert.equal(classifyHomeBrainIntent("나를 기억하고 있어?"), "memory_recall_lookup");
});

test("T1 premium_distribution intent classification (5 questions)", () => {
  const questions = [
    "보험료 구조 보여줘",
    "보험료 분포 보여줘",
    "보험료 차트로 보여줘",
    "어느 보험사가 제일 커?",
    "보험료 비중 알려줘",
  ];
  for (const question of questions) {
    assert.equal(classifyHomeBrainIntent(question), "premium_distribution", question);
  }
});

test("T2-T7 premium_distribution golden stats and renderPayload (case-c)", () => {
  const distribution = buildPremiumDistributionStats(caseCPolicies);
  assert.equal(distribution.premiumTotal, 318683);
  assert.equal(distribution.premiumKnownCount, 3);
  assert.equal(distribution.premiumUnknownCount, 1);

  const byInsurer = Object.fromEntries(
    distribution.insurers.map((item) => [item.insurer, item]),
  );
  assert.equal(byInsurer["한화생명"].premium, 166555);
  assert.equal(byInsurer["삼성화재"].premium, 116568);
  assert.equal(byInsurer["현대해상"].premium, 35560);

  assert.equal(distribution.topInsurer.insurer, "한화생명");
  assert.equal(byInsurer["한화생명"].sharePct, 52.3);
  assert.equal(byInsurer["삼성화재"].sharePct, 36.6);
  assert.equal(byInsurer["현대해상"].sharePct, 11.2);
  const shareSum = distribution.insurers.reduce((sum, item) => sum + item.sharePct, 0);
  assert.ok(shareSum + 1e-9 >= 99.9 && shareSum - 1e-9 <= 100.1, `sharePct sum=${shareSum}`);

  const unavailable = distribution.unavailablePolicies.find((item) => item.insurer === "DB손보");
  assert.ok(unavailable, "DB손보 unavailable");
  assert.equal(unavailable.reason, "보험료미제공");
  assert.equal(unavailable.policyCount, 1);

  const result = composeHomeBrainFactAnswer(unifiedFixture, "보험료 분포 보여줘");
  assert.equal(result.intent, "premium_distribution");
  assert.equal(result.factsUsed.topInsurer.insurer, "한화생명");
  assert.equal(result.renderPayload.type, "premium_distribution");
  assert.equal(result.renderPayload.chart.kind, "insurer_premium_bar");
  assert.equal(result.renderPayload.chart.data.length, 3);
  assert.equal(
    result.renderPayload.chart.data.some((item) => item.insurer === "DB손보"),
    false,
  );
  assert.equal(
    result.renderPayload.unavailable.some(
      (item) => item.insurer === "DB손보" && item.reason === "보험료미제공",
    ),
    true,
  );
});

test("T8 premium_lookup regression keeps Copy B", () => {
  const result = composeHomeBrainFactAnswer(unifiedFixture, "내 보험료 얼마야?");
  assert.equal(result.intent, "premium_lookup");
  assert.match(result.answerText, /현재 확인 가능한 월 보험료는 318,683원입니다/);
  assert.match(result.answerText, /3건이 합산되었고, 보험료 미확인 1건이 있습니다/);
  assert.equal(result.renderPayload, undefined);
});

test("T9 distribution totals match computePremiumLookupStats", () => {
  const distribution = buildPremiumDistributionStats(caseCPolicies);
  const lookup = computePremiumLookupStats(caseCPolicies);
  assert.equal(distribution.premiumTotal, lookup.premiumTotal);
  assert.equal(distribution.premiumKnownCount, lookup.premiumKnownCount);
  assert.equal(distribution.premiumUnknownCount, lookup.premiumUnknownCount);
});

test("unsupported intents return unsupported classification", () => {
  assert.equal(classifyHomeBrainIntent("보장 공백 있어?"), "unsupported");
  assert.equal(classifyHomeBrainIntent("보험 추천해줘"), "unsupported");
  assert.equal(classifyHomeBrainIntent("보험 설계해줘"), "unsupported");
});

test("premium_lookup uses copy B and P1-A case-c stats", () => {
  const result = composeHomeBrainFactAnswer(unifiedFixture, "내 보험료 얼마야?");
  assert.equal(result.ok, true);
  assert.equal(result.intent, "premium_lookup");
  assert.equal(result.factsUsed.premiumTotal, caseCExpected.premiumTotal);
  assert.equal(result.factsUsed.premiumKnownCount, caseCExpected.premiumKnownCount);
  assert.equal(result.factsUsed.premiumUnknownCount, caseCExpected.premiumUnknownCount);
  assert.equal(result.factsUsed.totalCount, caseCExpected.totalCount);
  assert.equal(result.factsUsed.portfolioSource, "unified_state.policies");
  assert.match(result.answerText, /현재 확인 가능한 월 보험료는 318,683원입니다/);
  assert.match(result.answerText, /3건이 합산되었고, 보험료 미확인 1건이 있습니다/);
});

test("unsupported question returns AI 상담실 redirect copy", () => {
  const result = composeHomeBrainFactAnswer(unifiedFixture, "보험 추천해줘");
  assert.equal(result.intent, "unsupported");
  assert.equal(result.answerText, HOME_BRAIN_UNSUPPORTED_MESSAGE);
});

test("G7-1 own customer data lookup succeeds (deterministic compose)", () => {
  const result = composeHomeBrainFactAnswer(unifiedFixture, "내 보험료 얼마야?");
  assert.equal(result.ok, true);
  assert.equal(result.intent, "premium_lookup");
  assert.equal(result.factsUsed.premiumTotal, 318683);
  assert.equal(result.factsUsed.portfolioSource, "unified_state.policies");
});

test("G7-2 API ignores request body customerId (static)", () => {
  const apiSource = readFileSync(join(ROOT, "api/customer-home-brain-fact.js"), "utf8");
  const coreSource = readFileSync(join(ROOT, "server/homeBrainFactCore.js"), "utf8");

  assert.match(apiSource, /customerId:\s*resolved\.customerId/);
  assert.doesNotMatch(apiSource, /body\?\.(customer_id|customerId)/);
  assert.doesNotMatch(coreSource, /body\?\.(customer_id|customerId)/);
});

test("G7-3 foreign customerId cannot override auth customerId (static + handler contract)", () => {
  const apiSource = readFileSync(join(ROOT, "api/customer-home-brain-fact.js"), "utf8");
  const coreSource = readFileSync(join(ROOT, "server/homeBrainFactCore.js"), "utf8");
  assert.match(apiSource, /requireCustomerAuth\(userSupabase\)/);
  assert.match(coreSource, /loadUnifiedCustomerState\(userSupabase,\s*customerId\)/);
  assert.doesNotMatch(apiSource, /createServiceRoleSupabaseClient|SERVICE_ROLE|adminSupabase/);
});

function stripSourceComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

test("forbidden service-role / write / LLM imports absent", () => {
  const files = [
    "api/customer-home-brain-fact.js",
    "server/homeBrainFactCore.js",
    "server/premiumDistributionStats.js",
    "src/lib/customerHomeBrainFact.js",
    "src/components/AdvisorBrainEntry.jsx",
  ];
  const banned = [
    "createServiceRoleSupabaseClient",
    "SUPABASE_SERVICE_ROLE_KEY",
    "adminSupabase",
    "loadCustomerMemoryOnLogin",
    "waitUntil",
    "analysis_jobs",
    "conversation_messages",
    "insurance_portfolios",
    "body.customerId",
    "body.customer_id",
    "Claude",
    "Anthropic",
    "LLM",
  ];
  for (const relativePath of files) {
    const source = readFileSync(join(ROOT, relativePath), "utf8");
    const codeOnly = stripSourceComments(source);
    for (const token of banned) {
      assert.doesNotMatch(codeOnly, new RegExp(token), `${relativePath} must not reference ${token}`);
    }
    assert.doesNotMatch(codeOnly, /\.(insert|update|upsert|delete)\(/i, `${relativePath} must not write`);
    assert.doesNotMatch(codeOnly, /\brpc\s*\(/i, `${relativePath} must not call rpc`);
  }
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
