/**
 * GAP-03 — Recommendation Entry Slice unit tests (classifier-only).
 */
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyConsultationIntent } from "../server/intentGateLayer.js";
import {
  isKeyBlockedIntent,
  planKeyTools,
  shouldUseSalesDirectorKeyOrchestrator,
  KEY_TOOLS,
} from "../server/salesDirectorKeyToolRegistry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "fixtures/key-judgment-validation-v1/recommendation-entry-slice-evidence.json");

const KEY_ENV = { SALES_DIRECTOR_KEY_ORCHESTRATOR: "1" };
const CUSTOMER_ID = "00000000-0000-4000-8000-000000000001";

function expectEntry(question, matchedRule = "recommendation_entry_check") {
  const c = classifyConsultationIntent(question);
  assert.equal(c.intent, "recommendation_priority_check", `${question} → KEY rec path`);
  assert.equal(c.matched_rule, matchedRule, `${question} → ${matchedRule}`);
  assert.equal(isKeyBlockedIntent(c.intent), false);
  assert.equal(
    shouldUseSalesDirectorKeyOrchestrator({
      question,
      customerId: CUSTOMER_ID,
      consultationIntent: c,
      env: KEY_ENV,
    }),
    true,
    `${question} → KEY orchestrator ON`,
  );
  const plan = planKeyTools(c, { memory: "present", policies: "present" }, question);
  assert(plan.tools.includes(KEY_TOOLS.RECOMMENDATION), `${question} → recommendation tool`);
  return c;
}

function expectBlockedRequest(question) {
  const c = classifyConsultationIntent(question);
  assert.equal(c.intent, "recommendation_request", `${question} stays blocked request`);
  assert.equal(isKeyBlockedIntent("recommendation_request"), true);
  assert.equal(
    shouldUseSalesDirectorKeyOrchestrator({
      question,
      customerId: CUSTOMER_ID,
      consultationIntent: c,
      env: KEY_ENV,
    }),
    false,
  );
  return c;
}

function testTomEntryUtterances() {
  expectEntry("추천해줘");
  expectEntry("추천해줘.");
  expectEntry("뭐 가입하면 돼?");
  expectEntry("뭐가 제일 급해?");
  expectEntry("어떤 보험부터 봐야 해?");
  expectEntry("나한테 필요한 보험 추천해줘.");
  expectEntry("보장 보완 어디부터 하면 돼?", "recommendation_entry_check");
  expectEntry("보험 추천해줘");
}

function testJ10Regression() {
  expectEntry("지금 뭐부터 추가하면 좋을까?", "recommendation_priority_check");
}

function testGuardStays() {
  expectBlockedRequest("뭐가 부족해?");
  expectBlockedRequest("상품 추천해줘");
  expectBlockedRequest("보험사 추천해줘");
  expectBlockedRequest("왜 1위로 추천했어?");
  assert.equal(classifyConsultationIntent("가입 설계 추천해줘").intent, "design_request");
}

function testGeneralKnowledgeNotStolen() {
  const c = classifyConsultationIntent("강원도 여행 추천해줘");
  assert.equal(c.intent, "general_consultation");
  assert.equal(c.matched_rule, "general_knowledge_eligible");
}

function testGapAndUwUnchanged() {
  assert.equal(classifyConsultationIntent("내 보험 부족한 부분 있어?").intent, "coverage_gap_check");
  assert.equal(classifyConsultationIntent("고혈압 있는데 가입 가능해?").intent, "underwriting_bound_check");
}

function buildEvidence() {
  const cases = [
    { id: "GAP03-01", question: "추천해줘.", expect: "recommendation_priority_check", rule: "recommendation_entry_check" },
    { id: "GAP03-02", question: "뭐 가입하면 돼?", expect: "recommendation_priority_check", rule: "recommendation_entry_check" },
    { id: "GAP03-03", question: "뭐가 제일 급해?", expect: "recommendation_priority_check", rule: "recommendation_entry_check" },
    { id: "GAP03-04", question: "어떤 보험부터 봐야 해?", expect: "recommendation_priority_check", rule: "recommendation_entry_check" },
    { id: "J11", question: "나한테 필요한 보험 추천해줘.", expect: "recommendation_priority_check", rule: "recommendation_entry_check" },
    { id: "J12", question: "보장 보완 어디부터 하면 돼?", expect: "recommendation_priority_check", rule: "recommendation_entry_check" },
    { id: "J10", question: "지금 뭐부터 추가하면 좋을까?", expect: "recommendation_priority_check", rule: "recommendation_priority_check" },
    { id: "GUARD-01", question: "뭐가 부족해?", expect: "recommendation_request", rule: "recommendation_request" },
    { id: "GUARD-02", question: "상품 추천해줘", expect: "recommendation_request", rule: "recommendation_request" },
    { id: "GK-01", question: "강원도 여행 추천해줘", expect: "general_consultation", rule: "general_knowledge_eligible" },
  ];
  const results = cases.map(({ id, question, expect, rule }) => {
    const c = classifyConsultationIntent(question);
    return {
      id,
      question,
      expected_intent: expect,
      expected_rule: rule,
      actual_intent: c.intent,
      matched_rule: c.matched_rule,
      pass: c.intent === expect && c.matched_rule === rule,
    };
  });
  return {
    slice: "recommendation_entry_gap03_v1",
    tom_design: "Reclassify entry utterances to recommendation_priority_check; guard stays for other recommendation_request",
    observed_at: new Date().toISOString(),
    file_touch: ["server/intentGateLayer.js"],
    all_pass: results.every((r) => r.pass),
    results,
  };
}

function main() {
  testTomEntryUtterances();
  testJ10Regression();
  testGuardStays();
  testGeneralKnowledgeNotStolen();
  testGapAndUwUnchanged();

  const evidence = buildEvidence();
  assert.equal(evidence.all_pass, true);

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log("Recommendation Entry Slice unit tests: ALL PASSED");
  console.log(`Evidence: ${OUT}`);
}

main();
