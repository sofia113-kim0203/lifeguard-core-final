/**
 * P2-A — Home Brain fact unit + G7 safety checks.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  HOME_HIGH_STAKES_DEFER_MESSAGE,
  classifyHomeBrainIntent,
  composeHomeBrainFactAnswer,
} from "../server/homeBrainFactCore.js";

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

test("unsupported intents return unsupported classification", () => {
  assert.equal(classifyHomeBrainIntent("보장 공백 있어?"), "unsupported");
  assert.equal(classifyHomeBrainIntent("보험 추천해줘"), "unsupported");
  assert.equal(classifyHomeBrainIntent("보험 설계해줘"), "unsupported");
});

test("premium_lookup uses Tom-safe copy without inventory dump patterns", () => {
  const result = composeHomeBrainFactAnswer(unifiedFixture, "내 보험료 얼마야?");
  assert.equal(result.ok, true);
  assert.equal(result.intent, "premium_lookup");
  assert.equal(result.factsUsed.premiumTotal, caseCExpected.premiumTotal);
  assert.match(result.answerText, /318683원/);
  assert.doesNotMatch(result.answerText, /318,683|월\s*보험료|현재\s*\d+\s*건의\s*보험/);
});

test("unsupported question returns honest defer copy", () => {
  const result = composeHomeBrainFactAnswer(unifiedFixture, "보험 추천해줘");
  assert.equal(result.intent, "unsupported");
  assert.equal(result.answerText, HOME_HIGH_STAKES_DEFER_MESSAGE);
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
  const agentSource = readFileSync(join(ROOT, "server/homeAgentTom.js"), "utf8");
  assert.match(apiSource, /requireCustomerAuth\(userSupabase\)/);
  assert.match(agentSource, /loadRawCustomerRecords\(userSupabase,\s*customerId\)/);
  assert.doesNotMatch(apiSource, /createServiceRoleSupabaseClient|SERVICE_ROLE|adminSupabase/);
});

test("forbidden service-role / write / LLM imports absent", () => {
  const files = [
    "api/customer-home-brain-fact.js",
    "server/homeBrainFactCore.js",
    "server/homeAgentTom.js",
    "src/lib/customerHomeBrainFact.js",
    "src/components/LifeguardHomeChat.jsx",
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
  ];
  for (const relativePath of files) {
    const source = readFileSync(join(ROOT, relativePath), "utf8");
    for (const token of banned) {
      assert.doesNotMatch(source, new RegExp(token), `${relativePath} must not reference ${token}`);
    }
    assert.doesNotMatch(source, /\.(insert|update|upsert|delete)\(/i, `${relativePath} must not write`);
  }
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
