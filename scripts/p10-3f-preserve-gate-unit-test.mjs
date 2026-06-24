/**
 * P10-3F — coverage_presence factual preserve gate unit + SSE integration tests.
 */
import assert from "node:assert/strict";

import { classifyConsultationIntent } from "../server/intentGateLayer.js";
import { handleHomeBrainFactRequest } from "../server/homeBrainFactCore.js";
import {
  finalizeHumanSalesDirectorResponse,
  shouldPreserveFactualLookupFreeThinkingAnswer,
} from "../server/humanUnderstandingLoop.js";
import {
  hasCoveragePresenceFactualAnswer,
  isGenericHulCounselingIntro,
} from "../server/coveragePresencePreserveGate.js";
import {
  hasFreeThinkingQualities,
  violatesManualTemplate,
} from "../server/salesDirectorFreeThinking.js";

const SHORT_FACTUAL_CANCER_A =
  "관련해서는 가입된 것으로 확인돼요. 담보 범위는 이 자료만으로는 단정하기 어려워요.";
const FULL_FT_CANCER_A =
  "암 관련 가입은 보이는 편이에요. 담보 범위는 이 자료만으론 함께 짚어 보면 좋겠어요. 걱정되시면 어떤 축이 제일 걸리세요?";
const FORBIDDEN_MANUAL_A = "가입된 보험은 확인돼요. 기억해 둔 상담 내용도 참고할 수 있어요.";
const HUL_GENERIC_B =
  "보험 얘기 전에, 지금 상태부터 맞춰볼게요. 겹치는 곳은 두껍고, 비어 있는 곳은 비어 있을 가능성이 있습니다.";

const freeThinkingGate = {
  status: "p6_2b_3",
  source: "claude",
};

function preserveInput(question, rawText) {
  return {
    classificationIntent: "factual_lookup",
    question,
    rawText,
    responseSource: "sales_director_free_thinking",
    freeThinking: freeThinkingGate,
  };
}

async function runCase(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
    return true;
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    return false;
  }
}

let passed = 0;
let failed = 0;

async function record(ok) {
  if (ok) passed += 1;
  else failed += 1;
}

await record(
  await runCase("F1 hasCoveragePresenceFactualAnswer — short factual cancer A", async () => {
    assert.equal(hasFreeThinkingQualities(SHORT_FACTUAL_CANCER_A), false);
    assert.equal(violatesManualTemplate(SHORT_FACTUAL_CANCER_A), false);
    assert.equal(hasCoveragePresenceFactualAnswer(SHORT_FACTUAL_CANCER_A), true);
  }),
);

await record(
  await runCase("F2 shouldPreserve — 나는 암보장있어? short factual A", async () => {
    assert.equal(
      shouldPreserveFactualLookupFreeThinkingAnswer(
        preserveInput("나는 암보장있어?", SHORT_FACTUAL_CANCER_A),
      ),
      true,
    );
  }),
);

await record(
  await runCase("F3 shouldPreserve — 암보험 있어? short factual A", async () => {
    assert.equal(
      shouldPreserveFactualLookupFreeThinkingAnswer(
        preserveInput("암보험 있어?", SHORT_FACTUAL_CANCER_A),
      ),
      true,
    );
  }),
);

await record(
  await runCase("F4 premium_lookup — preserve gate not applied", async () => {
    const consultation = classifyConsultationIntent("내 보험료 얼마야?");
    assert.equal(consultation.lookup_sub_intent, "premium_lookup");
    assert.equal(
      shouldPreserveFactualLookupFreeThinkingAnswer(
        preserveInput("내 보험료 얼마야?", SHORT_FACTUAL_CANCER_A),
      ),
      false,
    );
  }),
);

await record(
  await runCase("F5 general_consultation — preserve gate not applied", async () => {
    const consultation = classifyConsultationIntent("보험 얘기 좀 해줘");
    assert.equal(consultation.intent, "general_consultation");
    const result = finalizeHumanSalesDirectorResponse({
      rawText: SHORT_FACTUAL_CANCER_A,
      classificationIntent: "general_consultation",
      factBundle: { question: "보험 얘기 좀 해줘", policy_count: 2, policies: [] },
      conversationContext: {
        responseSource: "sales_director_free_thinking",
        freeThinking: freeThinkingGate,
      },
    });
    assert.notEqual(result.generation_mode, "free_thinking_preserved");
    assert.match(result.text, /보험|상태|걱정|질문/);
  }),
);

await record(
  await runCase("F6 forbidden manual template — still blocked", async () => {
    assert.equal(violatesManualTemplate(FORBIDDEN_MANUAL_A), true);
    assert.equal(
      shouldPreserveFactualLookupFreeThinkingAnswer(
        preserveInput("나는 암보장있어?", FORBIDDEN_MANUAL_A),
      ),
      false,
    );
  }),
);

await record(
  await runCase("F7 full FT qualities path unchanged", async () => {
    assert.equal(hasFreeThinkingQualities(FULL_FT_CANCER_A), true);
    assert.equal(
      shouldPreserveFactualLookupFreeThinkingAnswer(
        preserveInput("나는 암보장있어?", FULL_FT_CANCER_A),
      ),
      true,
    );
  }),
);

await record(
  await runCase("F10 HUL generic intro — preserve blocked", async () => {
    assert.equal(isGenericHulCounselingIntro(HUL_GENERIC_B), true);
    assert.equal(hasCoveragePresenceFactualAnswer(HUL_GENERIC_B), false);
    assert.equal(
      shouldPreserveFactualLookupFreeThinkingAnswer(
        preserveInput("나는 암보장있어?", HUL_GENERIC_B),
      ),
      false,
    );
  }),
);

await record(
  await runCase("F11 내 보험 괜찮아? — coverage_presence exception not applied", async () => {
    const consultation = classifyConsultationIntent("내 보험 괜찮아?");
    assert.notEqual(consultation.lookup_sub_intent, "coverage_presence");
    assert.equal(
      shouldPreserveFactualLookupFreeThinkingAnswer({
        classificationIntent: consultation.intent,
        question: "내 보험 괜찮아?",
        rawText: SHORT_FACTUAL_CANCER_A,
        responseSource: "sales_director_free_thinking",
        freeThinking: freeThinkingGate,
      }),
      false,
    );
    const result = finalizeHumanSalesDirectorResponse({
      rawText: SHORT_FACTUAL_CANCER_A,
      classificationIntent: consultation.intent,
      factBundle: { question: "내 보험 괜찮아?", policy_count: 2, policies: [] },
      conversationContext: {
        responseSource: "sales_director_free_thinking",
        freeThinking: freeThinkingGate,
      },
    });
    assert.notEqual(result.generation_mode, "free_thinking_preserved");
  }),
);

function buildMockSupabase() {
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
        maybeSingle: async () => ({
          data: { id: "cust-p10-3f", display_name: "QA", memory_version: 1 },
          error: null,
        }),
        then(onFulfilled, onRejected) {
          let payload = { data: [], error: null, count: 0 };
          if (table === "active_profile_insurance_policies") {
            payload = {
              data: [
                { product_name: "암진단", policy_type: "cancer", monthly_premium: 38000 },
                { product_name: "실손의료비", policy_type: "health", monthly_premium: 45000 },
              ],
              error: null,
            };
          }
          if (table === "customer_memory_facts") {
            payload = {
              data: [{ fact_key: "goal", fact_value: "보험 확인" }],
              error: null,
              count: 1,
            };
          }
          if (table === "analysis_jobs") {
            payload = {
              data: [
                {
                  id: "j1",
                  status: "completed",
                  result_json: {
                    coverage_gap: {
                      items: [
                        { coverage_type: "cancer", current_status: "held", coverage_label: "암" },
                        { coverage_type: "medical_expense", current_status: "held", coverage_label: "실손" },
                      ],
                    },
                  },
                },
              ],
              error: null,
            };
          }
          return Promise.resolve(payload).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
  };
}

function mockClaudeFetch(answerText) {
  const parts = answerText.match(/.{1,24}/gs) ?? [answerText];
  const sseBody = parts
    .map(
      (part) =>
        `event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":${JSON.stringify(part)}}}\n\n`,
    )
    .join("");
  return async () =>
    new Response(sseBody, { status: 200, headers: { "content-type": "text/event-stream" } });
}

async function traceCoverageQuestion(question, claudeAnswer) {
  const events = [];
  const streamHandlers = {
    _emitted: false,
    onDelta(text) {
      streamHandlers._emitted = true;
      events.push({ type: "delta", preview: String(text).slice(0, 80) });
    },
    onReplace(text) {
      events.push({ type: "replace", preview: String(text).slice(0, 80) });
    },
  };

  const result = await handleHomeBrainFactRequest({
    question,
    history: [],
    userSupabase: buildMockSupabase(),
    customerId: "cust-p10-3f",
    env: { ...process.env, ANTHROPIC_API_KEY: "mock-key" },
    fetchImpl: mockClaudeFetch(claudeAnswer),
    requestStartedAt: Date.now(),
    streamHandlers,
  });

  return {
    question,
    replace_count: events.filter((e) => e.type === "replace").length,
    answerText: String(result.answerText ?? ""),
    preserve_gate: result.sales_director_trace?.p10_3e_preserve_gate ?? null,
    generation_mode: result.sales_director_judgment_audit?.generation_mode ?? null,
  };
}

await record(
  await runCase("F8 SSE — 나는 암보장있어? no replace on short factual A", async () => {
    const trace = await traceCoverageQuestion("나는 암보장있어?", SHORT_FACTUAL_CANCER_A);
    assert.equal(trace.replace_count, 0);
    assert.equal(trace.answerText, SHORT_FACTUAL_CANCER_A);
    assert.equal(trace.preserve_gate?.shouldPreserveFactualLookupFreeThinkingAnswer, true);
    assert.equal(trace.preserve_gate?.preserve_path, "coverage_presence_factual");
    assert.doesNotMatch(trace.answerText, /^보험 얘기 전에/);
  }),
);

await record(
  await runCase("F9 SSE — 암보험 있어? no replace on short factual A", async () => {
    const trace = await traceCoverageQuestion("암보험 있어?", SHORT_FACTUAL_CANCER_A);
    assert.equal(trace.replace_count, 0);
    assert.equal(trace.answerText, SHORT_FACTUAL_CANCER_A);
  }),
);

console.log(`\nP10-3F preserve gate: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
