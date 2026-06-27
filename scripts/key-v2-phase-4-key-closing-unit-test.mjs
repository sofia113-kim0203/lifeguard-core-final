/**
 * KEY v2 phase 4 — closing compose (Order 0.5 Scene J).
 */
import assert from "node:assert/strict";

import {
  buildBasisTaggedFacts,
  buildHumanUnderstandingFrame,
  finalizeHumanSalesDirectorResponse,
  generateHumanSalesDirectorResponse,
  isKeyClosingTurn,
  buildKeyClosingResponse,
  matchKeyConversationPattern,
} from "../server/humanUnderstandingLoop.js";
import { resolveSalesDirectorJudgmentIntent } from "../server/salesDirectorFormatter.js";
import { ONE_BRAIN_SURFACES } from "../server/oneBrainResponseLayer.js";

const INSURANCE_FILLER_RE = /확인된 범위|담보|걱정되는 축/;

function buildKeyBundle(question, overrides = {}) {
  return {
    question,
    key_orchestrator: true,
    policy_count: 2,
    policies: [{ product_name: "실손", policy_type: "health" }],
    ...overrides,
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
  await runCase("V2-C1 isKeyClosingTurn — goodnight yes, insurance no", async () => {
    assert.equal(isKeyClosingTurn("잘 자요"), true);
    assert.equal(isKeyClosingTurn("좋은 밤 되세요"), true);
    assert.equal(isKeyClosingTurn("내일 봐요"), true);
    assert.equal(isKeyClosingTurn("암보험 있어?"), false);
    assert.equal(isKeyClosingTurn("보험 확인하고 잘 자요"), false);
  }),
);

await record(
  await runCase("V2-C2 buildKeyClosingResponse — warm close, no insurance", async () => {
    const text = buildKeyClosingResponse("잘 자요");
    assert.match(text, /쉬|밤|내일/);
    assert.doesNotMatch(text, INSURANCE_FILLER_RE);
  }),
);

await record(
  await runCase("V2-C3 generateHuman — key_closing compose_mode", async () => {
    const question = "잘 자요";
    const bundle = buildKeyBundle(question);
    const classificationIntent = "general_consultation";
    const resolvedIntent = resolveSalesDirectorJudgmentIntent(classificationIntent, question);
    const basisTaggedFacts = buildBasisTaggedFacts(bundle, resolvedIntent);
    const humanFrame = buildHumanUnderstandingFrame({
      question,
      intent: resolvedIntent,
      surface: ONE_BRAIN_SURFACES.HOME,
      conversationContext: { classificationIntent, history: [] },
      factBundle: bundle,
      basisTaggedFacts,
    });

    const generated = generateHumanSalesDirectorResponse({
      humanFrame,
      basisTaggedFacts,
      guardrails: { generation_mode: "key_orchestrator" },
      question,
      intent: resolvedIntent,
      factBundle: bundle,
      classificationIntent,
    });

    assert.equal(generated.key_compose_trace?.compose_mode, "key_closing");
    assert.doesNotMatch(generated.text, INSURANCE_FILLER_RE);
  }),
);

await record(
  await runCase("V2-C4 finalizeHuman full path — goodnight", async () => {
    const question = "좋은 밤 되세요";
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "general_consultation",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildKeyBundle(question),
      customerState: { question, keyOrchestrator: true },
      homeRoute: "insurance",
    });

    assert.equal(finalized.key_compose_trace?.compose_mode, "key_closing");
    assert.match(finalized.text, /쉬|밤|내일/);
  }),
);

await record(
  await runCase("V2-C5 analysis status regression — not closing", async () => {
    const question = "분석 끝났어?";
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "general_consultation",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildKeyBundle(question, {
        has_stored_coverage_analysis: true,
        coverage_gap_used: true,
      }),
      customerState: { question, keyOrchestrator: true },
    });
    assert.equal(finalized.key_compose_trace?.compose_mode, "key_analysis_status");
  }),
);

await record(
  await runCase("V2-C6 fatigue relational regression", async () => {
    const question = "요즘 너무 피곤해요";
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "casual_chat",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildKeyBundle(question),
      customerState: { question, keyOrchestrator: true },
      homeRoute: "casual_chat",
    });
    assert.equal(finalized.key_compose_trace?.compose_mode, "key_relational");
  }),
);

/** Tom PR #153 preview checklist */
const TOM_CLOSING_PREVIEW_CASES = [
  { id: "V2-C7", question: "보험 확인하고 잘 자요", mode: "key_structured" },
  { id: "V2-C8", question: "보험은 내일 이야기하고 잘게요", mode: "key_closing" },
];

for (const tomCase of TOM_CLOSING_PREVIEW_CASES) {
  await record(
    await runCase(`${tomCase.id} Tom preview — ${tomCase.question}`, async () => {
      const { question, mode } = tomCase;
      const finalized = finalizeHumanSalesDirectorResponse({
        question,
        classificationIntent: "general_consultation",
        surface: ONE_BRAIN_SURFACES.HOME,
        factBundle: buildKeyBundle(question),
        customerState: { question, keyOrchestrator: true },
      });
      assert.equal(finalized.key_compose_trace?.compose_mode, mode);
      if (mode === "key_closing") {
        assert.doesNotMatch(finalized.text, INSURANCE_FILLER_RE);
      }
      if (question === "보험은 내일 이야기하고 잘게요") {
        assert.equal(
          finalized.key_compose_trace?.conversation_pattern_id,
          "closing_defer_insurance_to_later",
        );
      }
      if (question === "잘 자요") {
        assert.equal(finalized.key_compose_trace?.conversation_pattern_id, "closing_goodnight");
      }
    }),
  );
}

await record(
  await runCase("V2-C9 conversation pattern library — defer vs action", async () => {
    assert.equal(
      matchKeyConversationPattern("보험은 내일 이야기하고 잘게요")?.id,
      "closing_defer_insurance_to_later",
    );
    assert.equal(matchKeyConversationPattern("보험 확인하고 잘 자요"), null);
  }),
);

console.log(
  `\nKEY v2 phase 4 closing: ${failed > 0 ? "FAILED" : "ALL PASSED"} (${passed}/${passed + failed})`,
);
process.exit(failed > 0 ? 1 : 0);
