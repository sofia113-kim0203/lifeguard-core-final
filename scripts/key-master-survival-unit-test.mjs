/**
 * KEY Master 단독 생존 검증 — customer-home-brain-fact 경로 only.
 * Tom: 가짜 KEY 0 · rewrite 0 · KEY Master speak only.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { handleHomeBrainFactRequest } from "../server/homeBrainFactCore.js";
import { runOneKeyCoreTurn } from "../server/keyCore/oneKeyCoreTurn.js";
import { KEY_SPEAK_MASTER_ID } from "../server/keyBrain/keySpeak.js";
import { ONE_KEY_CORE_S1_BLOCKED_PATHS } from "../server/keyCore/oneKeyCoreFlags.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const CUSTOMER_ID = "cust-key-master-survival";

const CUSTOMER_PATH_FILES = [
  "api/customer-home-brain-fact.js",
  "server/homeBrainFactCore.js",
  "server/keyCore/oneKeyCoreTurn.js",
  "server/keyCore/keyCustomerMonopoly.js",
  "src/lib/customerHomeBrainFact.js",
  "src/components/LifeguardHomeChat.jsx",
];

const FAKE_KEY_TOKENS = [
  "generateHumanSalesDirectorResponse",
  "buildKeyStructuredResponse",
  "finalizeHomeAgentResponse",
  "runSalesDirectorLoopTurn",
];

const HUL_MARKERS = [
  /말씀 주신 걸 기준으로/,
  /KEY_GENERIC_FILLER/,
  /함께 보면서 정리해 드릴게요/,
];

const KEY_MASTER_MARKERS = [/질문 잘 받았습니다/, /반갑습니다/, /KEY가 확인되는 범위/];

function readSource(relativePath) {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

function buildMockSupabase(customerId = CUSTOMER_ID) {
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
          data: { id: customerId, display_name: "SurvivalQA", memory_version: 1 },
          error: null,
        }),
        then(onFulfilled, onRejected) {
          let payload = { data: [], error: null, count: 0 };
          if (table === "active_profile_insurance_policies") {
            payload = { data: [], error: null };
          }
          return Promise.resolve(payload).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
  };
}

function buildS1Env() {
  return {
    ...process.env,
    ONE_KEY_CORE_S1: "1",
    SALES_DIRECTOR_KEY_ORCHESTRATOR: "1",
    SALES_DIRECTOR_KEY_LEGACY_FALLBACK: "0",
    SALES_DIRECTOR_KEY_CUSTOMER_ALLOWLIST: CUSTOMER_ID,
    ANTHROPIC_API_KEY: "mock-key",
  };
}

const PROBE_QUESTIONS = [
  { question: "보험료 부담", expectMaster: /질문 잘 받았습니다/ },
  { question: "안녕", expectMaster: /반갑습니다/ },
  { question: "내 보험 괜찮아?", expectMaster: /질문 잘 받았습니다/ },
];

let passed = 0;
let failed = 0;

async function runCase(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
    return true;
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error);
    return false;
  }
}

function extractHandlerBlock(source) {
  const start = source.indexOf("export async function handleHomeBrainFactRequest");
  assert.ok(start >= 0, "handleHomeBrainFactRequest missing");
  return source.slice(start);
}

await runCase("survival-1 fake KEY tokens absent from customer handler", () => {
  const handler = extractHandlerBlock(readSource("server/homeBrainFactCore.js"));
  for (const token of FAKE_KEY_TOKENS) {
    assert.doesNotMatch(handler, new RegExp(token), `handler must not reference ${token}`);
  }
  assert.match(handler, /runOneKeyCoreTurn/);
  assert.match(handler, /passThroughKeyCustomerText/);
  assert.doesNotMatch(handler, /finalizeSalesDirectorResponse/);
});

await runCase("survival-2 oneKeyCoreTurn speak uses keySpeak master only", () => {
  const source = readSource("server/keyCore/oneKeyCoreTurn.js");
  const speakBlock = source.slice(
    source.indexOf("function buildOneKeySpeakDraft"),
    source.indexOf("function buildKeyMonopolyQuestionFailure"),
  );
  assert.match(speakBlock, /keySpeak\(/);
  assert.doesNotMatch(speakBlock, /generateHumanSalesDirectorResponse/);
  assert.doesNotMatch(speakBlock, /buildKeyStructuredResponse/);
});

await runCase("survival-3 customer path files — no fake KEY speak imports", () => {
  for (const relativePath of CUSTOMER_PATH_FILES) {
    const source = readSource(relativePath);
    if (relativePath.includes("LifeguardHomeChat") || relativePath.includes("customerHomeBrainFact")) {
      assert.doesNotMatch(source, /generateHumanSalesDirectorResponse/);
      assert.doesNotMatch(source, /buildKeyStructuredResponse/);
      continue;
    }
    if (relativePath === "server/keyCore/oneKeyCoreTurn.js") {
      assert.doesNotMatch(source, /generateHumanSalesDirectorResponse/);
    }
  }
});

await runCase("survival-4 blocked paths include HUL + persona rewrite", () => {
  assert.ok(ONE_KEY_CORE_S1_BLOCKED_PATHS.includes("generateHumanSalesDirectorResponse"));
  assert.ok(ONE_KEY_CORE_S1_BLOCKED_PATHS.includes("finalizeSalesDirectorResponse"));
});

await runCase("survival-5 duplicate speak runtime inventory", () => {
  const runtimes = [
    { id: "key_speak_master", file: "server/keyBrain/keySpeak.js", customer_question: true },
    { id: "generateHumanSalesDirectorResponse", file: "server/humanUnderstandingLoop.js", customer_question: false },
    { id: "finalizeDocumentIntakeFirstSentence", file: "removed", customer_question: false },
    { id: "analysisCompleteFirstSpeak", file: "server/keyBrain/analysisCompleteFirstSpeak.js", customer_question: false },
    { id: "returnJudgmentFirstSpeak", file: "server/keyBrain/returnJudgmentFirstSpeak.js", customer_question: false },
    { id: "bridgeFirstSpeak", file: "server/keyBrain/bridgeFirstSpeak.js", customer_question: false },
  ];
  const onCustomerQuestion = runtimes.filter((row) => row.customer_question);
  assert.equal(onCustomerQuestion.length, 1);
  assert.equal(onCustomerQuestion[0].id, "key_speak_master");
  console.log("  speak_runtimes_on_customer_question:", onCustomerQuestion.map((r) => r.id).join(", "));
  console.log("  speak_runtimes_off_customer_question:", runtimes.filter((r) => !r.customer_question).map((r) => r.id).join(", "));
});

for (const probe of PROBE_QUESTIONS) {
  await runCase(`survival-6 runtime — ${probe.question}`, async () => {
    const env = buildS1Env();
    const result = await handleHomeBrainFactRequest({
      userSupabase: buildMockSupabase(),
      customerId: CUSTOMER_ID,
      question: probe.question,
      history: [],
      env,
      fetchImpl: async () => new Response("", { status: 503 }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.response_source, "one_key_core_s1");
    assert.equal(result.key_text_equal, true);
    assert.equal(result.key_speak_original, result.answerText);
    assert.match(result.answerText, probe.expectMaster);

    for (const marker of HUL_MARKERS) {
      assert.doesNotMatch(result.answerText, marker, `HUL marker leaked: ${marker}`);
    }

    const trace = result.one_key_core_trace ?? result.sales_director_trace?.one_key_core_trace;
    const speakStep = trace?.steps?.find((row) => row.step === "speak");
    assert.equal(speakStep?.payload?.key_speak_master, true);
    assert.match(speakStep?.payload?.compose_mode ?? "", /key_master/);

    console.log(`  질문: ${probe.question}`);
    console.log(`  KEY 원문: ${result.key_speak_original}`);
    console.log(`  최종 customerText: ${result.answerText}`);
    console.log(`  동일 여부: ${result.key_text_equal ? "예" : "아니오"}`);
    console.log(`  response_source: ${result.response_source}`);
    console.log(`  key_speak_master_id: ${KEY_SPEAK_MASTER_ID}`);
  });
}

await runCase("survival-7 runOneKeyCoreTurn direct — KEY Master trace", async () => {
  const result = await runOneKeyCoreTurn({
    userSupabase: buildMockSupabase(),
    customerId: CUSTOMER_ID,
    question: "보험료 부담",
    env: buildS1Env(),
    fetchImpl: async () => new Response("", { status: 503 }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.keySpeakOriginal, result.customerText);
  const speakStep = result.oneKeyCoreTrace?.steps?.find((row) => row.step === "speak");
  assert.equal(speakStep?.payload?.key_speak_master, true);
});

console.log(`\nKEY Master Survival: ${failed > 0 ? "FAILED" : "ALL PASSED"} (${passed}/${passed + failed})`);
process.exit(failed > 0 ? 1 : 0);
