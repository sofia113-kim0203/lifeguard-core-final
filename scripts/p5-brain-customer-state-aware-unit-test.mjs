/**
 * P5-BRAIN — customer state aware home brain unit tests (mock fixtures only).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  buildRecentConversationSummary,
  formatCustomerContextBlock,
} from "../server/buildCustomerContextBundle.js";
import { applyHomeInventoryHardGuard } from "../server/homeBrainFactCore.js";
import {
  matchP5BrainPilotQuestion,
  P5_BRAIN_PILOT_KEYS,
} from "../server/p5BrainPilotQuestions.js";
import { composeP5BrainStateAwareAnswer, resolveP5BrainPilotAnswer } from "../server/p5BrainStateAwareAnswer.js";
import { violatesHomeInventoryDump } from "../server/tomThinkingLoop.js";

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

const mockPolicies = [
  {
    id: "p1",
    insurer_name: "삼성화재",
    product_name: "실손",
    monthly_premium: 116568,
    policy_type: "health",
  },
  {
    id: "p2",
    insurer_name: "현대해상",
    product_name: "종합",
    monthly_premium: 35560,
    policy_type: "life",
  },
  {
    id: "p3",
    insurer_name: "DB손보",
    product_name: "암보험",
    monthly_premium: 166555,
    policy_type: "cancer",
  },
];

const mockBundle = {
  customerId: "cust-1",
  profile: { display_name: "진우" },
  policies: mockPolicies,
  documents: [{ original_filename: "보장내역서.pdf", ingest_status: "ready" }],
  documentCount: 2,
  memoryFacts: [{ fact_key: "insurance.goal", fact_value: "보험료 부담", fact_type: "preference" }],
  memoryFactCount: 1,
  recentConversation: buildRecentConversationSummary([
    {
      role: "user",
      message: "보험료 너무 비싼가?",
      metadata_json: { phase: "lifeguard-home-chat", session_id: "s1", source: "lifeguard_home_chat" },
      created_at: "2026-06-17T10:00:00.000Z",
    },
    {
      role: "assistant",
      message: "총 보험료는 검증이 필요해요.",
      metadata_json: { phase: "lifeguard-home-chat", session_id: "s1", source: "lifeguard_home_chat" },
      created_at: "2026-06-17T10:00:01.000Z",
    },
    {
      role: "user",
      message: "보장분석도 해줘",
      metadata_json: { phase: "lifeguard-home-chat", session_id: "s1", source: "lifeguard_home_chat" },
      created_at: "2026-06-17T10:05:00.000Z",
    },
  ]),
};

async function main() {
  console.log("p5-brain-customer-state-aware-unit-test");
  let passed = 0;
  let failed = 0;

  if (
    await runCase("T1 pilot matcher — 5 pilot questions", () => {
      assert.equal(matchP5BrainPilotQuestion("보험료 너무 비싼가?"), P5_BRAIN_PILOT_KEYS.PREMIUM_BURDEN);
      assert.equal(matchP5BrainPilotQuestion("암보험 부족한가?"), P5_BRAIN_PILOT_KEYS.CANCER_COVERAGE);
      assert.equal(matchP5BrainPilotQuestion("내 보험 분석해줘"), P5_BRAIN_PILOT_KEYS.INSURANCE_ANALYSIS);
      assert.equal(
        matchP5BrainPilotQuestion("지난번 이야기 이어서 하자"),
        P5_BRAIN_PILOT_KEYS.CONTINUE_CONVERSATION,
      );
      assert.equal(
        matchP5BrainPilotQuestion("내 문서에 암 관련 내용 있어?"),
        P5_BRAIN_PILOT_KEYS.DOCUMENT_CANCER_CONTENT,
      );
      assert.equal(matchP5BrainPilotQuestion("분당에서 가족이랑 갈 만한 곳 추천해줘"), null);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("T2 premium burden — existence only, no unverified totals", () => {
      const result = composeP5BrainStateAwareAnswer(
        P5_BRAIN_PILOT_KEYS.PREMIUM_BURDEN,
        "보험료 너무 비싼가?",
        mockBundle,
      );
      assert.equal(result.ok, true);
      assert.match(result.text, /가입된 보험이 있는 것은 확인돼요/);
      assert.match(result.text, /총 보험료는 현재 검증이 필요합니다/);
      assert.match(result.text, /총액 때문인지, 최근 인상 때문인지/);
      assert.doesNotMatch(result.text, /318,683|4건|월\s*보험료/);
      assert.doesNotMatch(result.text, /얼마 내시는지/);
      assert.equal(violatesHomeInventoryDump(result.text), false);
      assert.equal(violatesHomeInventoryDump(applyHomeInventoryHardGuard(result.text)), false);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("T3 continue conversation — uses recent topics", () => {
      const result = composeP5BrainStateAwareAnswer(
        P5_BRAIN_PILOT_KEYS.CONTINUE_CONVERSATION,
        "지난번 이야기 이어서 하자",
        mockBundle,
      );
      assert.equal(result.ok, true);
      assert.match(result.text, /최근에는/);
      assert.match(result.text, /보험료/);
      assert.doesNotMatch(result.text, /무슨 이야기/);
      assert.equal(violatesHomeInventoryDump(result.text), false);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("T4 insurance analysis — existence without inventory dump", () => {
      const result = composeP5BrainStateAwareAnswer(
        P5_BRAIN_PILOT_KEYS.INSURANCE_ANALYSIS,
        "내 보험 분석해줘",
        mockBundle,
      );
      assert.equal(result.ok, true);
      assert.match(result.text, /가입된 보험과 업로드된 문서가 확인돼요/);
      assert.doesNotMatch(result.text, /\d+\s*건/);
      assert.equal(violatesHomeInventoryDump(result.text), false);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("T5 context block — presence flags only", () => {
      const block = formatCustomerContextBlock(mockBundle);
      assert.match(block, /\[현재 고객 상태\]/);
      assert.match(block, /보험: 가입 정보 있음/);
      assert.match(block, /문서: 업로드 있음/);
      assert.match(block, /기억: 저장된 정보 있음/);
      assert.match(block, /최근 대화: 있음/);
      assert.doesNotMatch(block, /318,683|월\s*\d|보험:\s*\d+건/);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("T6 wiring — homeAgentTom never falls through on pilot match", () => {
      const tom = readFileSync(join(ROOT, "server/homeAgentTom.js"), "utf8");
      assert.match(tom, /buildCustomerContextBundle/);
      assert.match(tom, /matchP5BrainPilotQuestion/);
      assert.match(tom, /resolveP5BrainPilotAnswer/);
      assert.match(tom, /p5_brain_customer_state/);
      assert.match(tom, /p5_brain_state_guarded/);
      assert.match(tom, /isP5BrainResponseSource|p5_brain_customer_state/);
      const core = readFileSync(join(ROOT, "server/homeBrainFactCore.js"), "utf8");
      assert.match(core, /isP5BrainResponseSource\(responseSource\)/);
      assert.doesNotMatch(
        tom,
        /composeP5BrainStateAwareAnswer[\s\S]*if \(stateAnswer\.ok && stateAnswer\.text\)/,
      );
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("T7 guarded premium — no policies still returns P5 answer", () => {
      const emptyBundle = {
        ...mockBundle,
        policies: [],
        documents: [],
        documentCount: 0,
      };
      const answer = resolveP5BrainPilotAnswer(
        P5_BRAIN_PILOT_KEYS.PREMIUM_BURDEN,
        "보험료 비싼가",
        emptyBundle,
      );
      assert.equal(answer.guarded, true);
      assert.match(answer.text, /확인되는 가입 보험이 없어요/);
      assert.doesNotMatch(answer.text, /얼마 내시|318,683|4건/);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("T8 document cancer — existence-only copy", () => {
      const withDocs = resolveP5BrainPilotAnswer(
        P5_BRAIN_PILOT_KEYS.DOCUMENT_CANCER_CONTENT,
        "내 문서에 암 관련 내용 있어?",
        mockBundle,
      );
      assert.match(withDocs.text, /업로드된 문서가 있는 것은 확인돼요/);
      assert.match(withDocs.text, /문서 내용 확인이 필요합니다/);

      const noDocs = resolveP5BrainPilotAnswer(
        P5_BRAIN_PILOT_KEYS.DOCUMENT_CANCER_CONTENT,
        "내 문서에 암 관련 내용 있어?",
        { ...mockBundle, documents: [], documentCount: 0 },
      );
      assert.equal(noDocs.guarded, true);
      assert.match(noDocs.text, /업로드 문서가 없어 판단할 수 없습니다/);
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
