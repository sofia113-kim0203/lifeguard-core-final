/**
 * P5-BRAIN FIX — live-path integration tests (shared JWT loader + no pilot fallthrough).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  buildCustomerContextBundle,
  buildMergedRecentConversationSummary,
  compareCustomerExistenceFlags,
} from "../server/buildCustomerContextBundle.js";
import { runHomeAgentTomTurn } from "../server/homeAgentTom.js";
import { matchP5BrainPilotQuestion, P5_BRAIN_PILOT_KEYS } from "../server/p5BrainPilotQuestions.js";
import { resolveP5BrainPilotAnswer } from "../server/p5BrainStateAwareAnswer.js";
import { loadUnifiedCustomerState } from "../server/unifiedCustomerState.js";
import { violatesHomeInventoryDump } from "../server/tomThinkingLoop.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const mockPolicies = [
  {
    id: "p1",
    insurer_name: "삼성화재",
    product_name: "실손",
    monthly_premium: 116568,
    policy_type: "health",
  },
];

function buildJwtPathMockSupabase({
  policies = mockPolicies,
  documents = [{ id: "doc-1", original_filename: "보장내역서.pdf", ingest_status: "ready" }],
  documentCount = 1,
  conversationRows = [],
  memoryFacts = [{ id: "m1", fact_key: "insurance.goal", fact_value: "보험료" }],
} = {}) {
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
        order() {
          return chain;
        },
        limit() {
          return chain;
        },
        maybeSingle: async () => {
          if (table === "customer_profiles") {
            return { data: { id: "cust-jwt", display_name: "QA", memory_version: 1 }, error: null };
          }
          if (table === "profile_health") {
            return { data: null, error: null };
          }
          return { data: null, error: null };
        },
        then(onFulfilled, onRejected) {
          let payload = { data: [], error: null, count: 0 };
          if (table === "active_profile_insurance_policies") {
            payload = { data: policies, error: null };
          }
          if (table === "customer_memory_facts") {
            payload = { data: memoryFacts, error: null };
          }
          if (table === "customer_documents") {
            payload = { data: documents, error: null, count: documentCount };
          }
          if (table === "customer_conversations") {
            payload = { data: conversationRows, error: null };
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
  console.log("p5-brain-live-path-integration-test");
  let passed = 0;
  let failed = 0;

  if (
    await runCase("I1 unified-state API loads via userSupabase JWT path", () => {
      const source = readFileSync(join(ROOT, "api/customer-unified-state.js"), "utf8");
      assert.match(source, /loadUnifiedCustomerState\(userSupabase,\s*resolved\.customerId/);
      assert.doesNotMatch(
        source,
        /loadUnifiedCustomerState\(adminSupabase,\s*resolved\.customerId/,
      );
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("I2 sidebar/brain existence flags match on same JWT loader", async () => {
      const supabase = buildJwtPathMockSupabase();
      const unified = await loadUnifiedCustomerState(supabase, "cust-jwt");
      const bundle = await buildCustomerContextBundle(supabase, "cust-jwt");
      const flags = compareCustomerExistenceFlags(unified, bundle);
      assert.equal(flags.policiesMatch, true, "policy existence mismatch");
      assert.equal(flags.documentsMatch, true, "document existence mismatch");
      assert.equal(flags.unified.hasPolicies, true);
      assert.equal(flags.bundle.hasPolicies, true);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("I3 pilot premium — no Claude fallthrough when policies empty", async () => {
      const supabase = buildJwtPathMockSupabase({ policies: [], documents: [], documentCount: 0 });
      let llmCalled = false;
      const turn = await runHomeAgentTomTurn({
        question: "보험료 비싼가",
        history: [],
        userSupabase: supabase,
        customerId: "cust-jwt",
        fetchImpl: async () => {
          llmCalled = true;
          throw new Error("LLM should not be called for pilot question");
        },
      });
      assert.equal(llmCalled, false);
      assert.equal(turn.responseSource, "p5_brain_state_guarded");
      assert.match(turn.text, /확인되는 가입 보험이 없어요/);
      assert.doesNotMatch(turn.text, /얼마 내시|318,683|4건/);
      assert.equal(violatesHomeInventoryDump(turn.text), false);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("I4 continue — request history merged without DB rows", async () => {
      const supabase = buildJwtPathMockSupabase({ conversationRows: [] });
      const history = [
        { role: "user", content: "보험료 너무 비싼가?" },
        { role: "assistant", content: "검증이 필요해요." },
      ];
      const turn = await runHomeAgentTomTurn({
        question: "지난번 대화 이어서 하자",
        history,
        userSupabase: supabase,
        customerId: "cust-jwt",
        fetchImpl: async () => {
          throw new Error("LLM should not be called");
        },
      });
      assert.match(turn.responseSource, /^p5_brain_/);
      assert.match(turn.text, /최근에는/);
      assert.match(turn.text, /보험료/);
      assert.doesNotMatch(turn.text, /기억하지 못|무슨 이야기/);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("I5 document cancer pilot — existence-only response", async () => {
      assert.equal(
        matchP5BrainPilotQuestion("내 문서에 암 관련 내용 있어?"),
        P5_BRAIN_PILOT_KEYS.DOCUMENT_CANCER_CONTENT,
      );

      const withDocs = buildJwtPathMockSupabase();
      const withDocTurn = await runHomeAgentTomTurn({
        question: "내 문서에 암 관련 내용 있어?",
        history: [],
        userSupabase: withDocs,
        customerId: "cust-jwt",
        fetchImpl: async () => {
          throw new Error("LLM should not be called");
        },
      });
      assert.equal(withDocTurn.responseSource, "p5_brain_customer_state");
      assert.match(withDocTurn.text, /업로드된 문서가 있는 것은 확인돼요/);
      assert.match(withDocTurn.text, /문서 내용 확인이 필요합니다/);

      const noDocs = buildJwtPathMockSupabase({ documents: [], documentCount: 0 });
      const noDocTurn = await runHomeAgentTomTurn({
        question: "내 문서에 암 관련 내용 있어?",
        history: [],
        userSupabase: noDocs,
        customerId: "cust-jwt",
        fetchImpl: async () => {
          throw new Error("LLM should not be called");
        },
      });
      assert.equal(noDocTurn.responseSource, "p5_brain_state_guarded");
      assert.match(noDocTurn.text, /업로드 문서가 없어 판단할 수 없습니다/);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("I6 merged history helper — request-only session counts as history", () => {
      const summary = buildMergedRecentConversationSummary([], [
        { role: "user", content: "보험료 부담돼" },
      ]);
      assert.equal(summary.hasHistory, true);
      assert.match(summary.topics.join(","), /보험료/);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("I7 resolveP5BrainPilotAnswer — premium with policies stays unguarded", () => {
      const bundle = {
        policies: mockPolicies,
        documents: [],
        documentCount: 0,
        recentConversation: { hasHistory: false, topics: [], latestUserMessages: [] },
      };
      const answer = resolveP5BrainPilotAnswer(
        P5_BRAIN_PILOT_KEYS.PREMIUM_BURDEN,
        "보험료 비싼가",
        bundle,
      );
      assert.equal(answer.guarded, false);
      assert.match(answer.text, /가입된 보험이 있는 것은 확인돼요/);
      assert.doesNotMatch(answer.text, /얼마 내시/);
    })
  ) {
    passed += 1;
  } else failed += 1;

  if (
    await runCase("I8 Q3 finalize — P5 continue text survives handleHomeBrainFactRequest", async () => {
      const { handleHomeBrainFactRequest } = await import("../server/homeBrainFactCore.js");
      const supabase = buildJwtPathMockSupabase({ conversationRows: [] });
      const result = await handleHomeBrainFactRequest({
        question: "지난번 대화 이어서 하자",
        history: [
          { role: "user", content: "보험료 너무 비싼가?" },
          { role: "assistant", content: "총 보험료는 검증이 필요해요." },
          { role: "user", content: "보장 분석도 해줘" },
        ],
        userSupabase: supabase,
        customerId: "cust-jwt",
        fetchImpl: async () => {
          throw new Error("LLM should not be called");
        },
      });
      assert.equal(result.response_source, "p5_brain_customer_state");
      assert.match(result.answerText, /최근에는/);
      assert.match(result.answerText, /보장분석/);
      assert.match(result.answerText, /이어서 보고 싶으세요/);
      assert.doesNotMatch(result.answerText, /말씀드리기 어려워요|기억하지 못|얼마 내세요|가입 내역에 접근/);
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
