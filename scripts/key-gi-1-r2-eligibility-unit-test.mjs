/**
 * KEY-GI-1 R2 — generalKnowledgeEligibility unit tests (no API).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { classifyConsultationIntent } from "../server/intentGateLayer.js";
import { resolveHomeBrainRoute, isCasualHomeQuestion } from "../server/homeBrainRouter.js";
import {
  hasGeneralKnowledgeIntent,
  isGeneralKnowledgeEligible,
  hasInsuranceConsultationIntent,
} from "../server/generalKnowledgeEligibility.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const BANK = JSON.parse(
  readFileSync(join(ROOT, "fixtures/key-judgment-validation-v1/gi-1-regression-bank-v1.json"), "utf8"),
);

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
  console.log("key-gi-1-r2-eligibility-unit-test");
  let passed = 0;
  let failed = 0;

  const cases = [
    ["T1 travel recommend is GK not insurance intent", () => {
      const q = "강원도 여행 추천해줘";
      const c = classifyConsultationIntent(q);
      assert.equal(c.intent, "general_consultation");
      assert.equal(c.matched_rule, "general_knowledge_eligible");
      assert.equal(c.general_knowledge, true);
    }],
    ["T2 food recommend is GK", () => {
      const q = "분당 맛집 추천";
      const c = classifyConsultationIntent(q);
      assert.equal(c.matched_rule, "general_knowledge_eligible");
    }],
    ["T3 health 줄이 is GK not insurance", () => {
      const q = "고혈압 줄이는 생활";
      assert.equal(hasInsuranceConsultationIntent(q), false);
      assert.equal(isGeneralKnowledgeEligible(q), true);
      const c = classifyConsultationIntent(q);
      assert.equal(c.matched_rule, "general_knowledge_eligible");
    }],
    ["T4 Tom — lose weight is GK", () => {
      const q = "살을 빼려면?";
      assert.equal(isGeneralKnowledgeEligible(q), true);
      assert.equal(classifyConsultationIntent(q).general_knowledge, true);
    }],
    ["T5 Tom — weight affects premium is insurance", () => {
      const q = "살을 빼면 보험료가 내려가?";
      assert.equal(hasInsuranceConsultationIntent(q), true);
      assert.equal(isGeneralKnowledgeEligible(q), false);
      assert.notEqual(classifyConsultationIntent(q).matched_rule, "general_knowledge_eligible");
    }],
    ["T6 insurance recommend stays insurance", () => {
      const q = "뭐 가입해야 해";
      const c = classifyConsultationIntent(q);
      assert.equal(c.intent, "recommendation_request");
    }],
    ["T7 INS-07 no casual home leak", () => {
      const q = "암 진단비 얼마나 필요해";
      const c = classifyConsultationIntent(q);
      assert.equal(isCasualHomeQuestion(q, c), false);
    }],
    ["T8 science 몇 개 not policy count route", () => {
      const q = "태양계 행성 몇 개야";
      const c = classifyConsultationIntent(q);
      assert.equal(c.matched_rule, "general_knowledge_eligible");
      assert.equal(resolveHomeBrainRoute(q, c), "casual_chat");
    }],
    ["T10 Tom spot GK samples", () => {
      const spots = [
        "유럽 배낭여행 준비물 알려줘.",
        "주식 ETF가 뭐야?",
        "초등학생 공부 습관 알려줘.",
        "감기랑 독감 차이가 뭐야?",
        "양자컴퓨터가 뭐야?",
      ];
      for (const q of spots) {
        const c = classifyConsultationIntent(q);
        assert.equal(c.general_knowledge, true, q);
      }
    }],
    ["T11 Tom spot insurance health-word guard", () => {
      const spots = [
        "실손보험에서 다이어트 치료는 보장돼?",
        "건강검진 결과가 보험 가입에 영향 있어?",
      ];
      for (const q of spots) {
        const c = classifyConsultationIntent(q);
        assert.notEqual(c.matched_rule, "general_knowledge_eligible", q);
        assert.equal(isGeneralKnowledgeEligible(q, c), false, q);
        assert.equal(isCasualHomeQuestion(q, c), false, q);
      }
    }],
    ["T12 Tom Live QA coverage gap — 4 re-route to GK", () => {
      const gaps = [
        "하루 물 얼마나 마셔야 해",
        "코딩 배우려면 뭐부터",
        "행복이란 뭐라고 생각해?",
        "자유의지가 있다고 볼 수 있을까?",
      ];
      for (const q of gaps) {
        const c = classifyConsultationIntent(q);
        assert.equal(c.matched_rule, "general_knowledge_eligible", q);
        assert.equal(c.general_knowledge, true, q);
        assert.equal(isGeneralKnowledgeEligible(q, c), true, q);
        assert.equal(resolveHomeBrainRoute(q, c), "casual_chat", q);
      }
    }],
  ];

  for (const [name, fn] of cases) {
    if (await runCase(name, fn)) passed += 1;
    else failed += 1;
  }

  let gkInsuranceMis = 0;
  for (const domain of Object.values(BANK.general_knowledge_90)) {
    for (const item of domain) {
      const c = classifyConsultationIntent(item.q);
      if (c.intent !== "general_consultation" || !c.general_knowledge) {
        if (!["general_consultation", "casual_chat"].includes(c.intent)) gkInsuranceMis += 1;
      }
    }
  }
  for (const item of BANK.insurance_regression_20) {
    const c = classifyConsultationIntent(item.q);
    if (c.general_knowledge) gkInsuranceMis += 1;
  }

  if (
    await runCase("T9 bank GK corpus no insurance intent", () => {
      assert.equal(gkInsuranceMis, 0);
    })
  ) {
    passed += 1;
  } else {
    failed += 1;
  }

  console.log(JSON.stringify({ passed, failed, ok: failed === 0 }));
  process.exit(failed === 0 ? 0 : 1);
}

main();
