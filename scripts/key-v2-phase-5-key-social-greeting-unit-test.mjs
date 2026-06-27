/**
 * KEY v2 phase 5 — social greeting/thanks (Order 0.5 Scene A).
 */
import assert from "node:assert/strict";

import {
  buildBasisTaggedFacts,
  buildHumanUnderstandingFrame,
  finalizeHumanSalesDirectorResponse,
  generateHumanSalesDirectorResponse,
  matchKeyConversationPattern,
} from "../server/humanUnderstandingLoop.js";
import { resolveSalesDirectorJudgmentIntent } from "../server/salesDirectorFormatter.js";
import { ONE_BRAIN_SURFACES } from "../server/oneBrainResponseLayer.js";

const INSURANCE_MENTION_RE = /보험|보장|암|실손|담보/;

function buildKeyBundle(question) {
  return {
    question,
    key_orchestrator: true,
    policy_count: 2,
    policies: [{ product_name: "실손", policy_type: "health" }],
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
  await runCase("V2-S1 greeting pattern — no insurance mention", async () => {
    const question = "안녕하세요";
    const pattern = matchKeyConversationPattern(question);
    assert.equal(pattern?.id, "greeting_welcome");
    assert.equal(pattern?.scene, "A");
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "casual_chat",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildKeyBundle(question),
      customerState: { question, keyOrchestrator: true },
      homeRoute: "casual_chat",
    });
    assert.equal(finalized.key_compose_trace?.compose_mode, "key_social");
    assert.equal(finalized.key_compose_trace?.conversation_pattern_id, "greeting_welcome");
    assert.doesNotMatch(finalized.text, INSURANCE_MENTION_RE);
    assert.match(finalized.text, /안녕|반갑|편하|천천히/);
  }),
);

await record(
  await runCase("V2-S2 thanks pattern — no insurance push", async () => {
    const question = "고마워요";
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "casual_chat",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildKeyBundle(question),
      customerState: { question, keyOrchestrator: true },
      homeRoute: "casual_chat",
    });
    assert.equal(finalized.key_compose_trace?.compose_mode, "key_social");
    assert.equal(finalized.key_compose_trace?.conversation_pattern_id, "thanks_acknowledgment");
    assert.doesNotMatch(finalized.text, INSURANCE_MENTION_RE);
    assert.doesNotMatch(finalized.text, /걱정이 하나 더/);
  }),
);

await record(
  await runCase("V2-S3 insurance greeting stays structured — not social", async () => {
    const question = "안녕, 내 보험 괜찮아?";
    assert.equal(matchKeyConversationPattern(question), null);
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "general_consultation",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildKeyBundle(question),
      customerState: { question, keyOrchestrator: true },
    });
    assert.notEqual(finalized.key_compose_trace?.compose_mode, "key_social");
  }),
);

await record(
  await runCase("V2-S4 fatigue still relational — regression", async () => {
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

await record(
  await runCase("V2-S5 closing regression — goodnight", async () => {
    const question = "잘 자요";
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "general_consultation",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildKeyBundle(question),
      customerState: { question, keyOrchestrator: true },
    });
    assert.equal(finalized.key_compose_trace?.compose_mode, "key_closing");
  }),
);

/** Tom PR #154 preview — mixed turns must not be hijacked by social patterns */
await record(
  await runCase("V2-S6 Tom preview — greeting + insurance stays structured", async () => {
    const question = "안녕하세요. 보험 하나만 물어볼게요.";
    assert.equal(matchKeyConversationPattern(question), null);
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "general_consultation",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildKeyBundle(question),
      customerState: { question, keyOrchestrator: true },
    });
    assert.notEqual(finalized.key_compose_trace?.compose_mode, "key_social");
    assert.equal(finalized.key_compose_trace?.conversation_pattern_id, null);
  }),
);

await record(
  await runCase("V2-S7 Tom preview — thanks + premium not social", async () => {
    const question = "고마워요. 그런데 보험료가 부담돼요.";
    assert.equal(matchKeyConversationPattern(question), null);
    const finalized = finalizeHumanSalesDirectorResponse({
      question,
      classificationIntent: "factual_lookup",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: {
        ...buildKeyBundle(question),
        premium_stats: {
          totalCount: 2,
          premiumKnownCount: 0,
          premiumUnknownCount: 2,
          premiumTotal: 0,
        },
      },
      customerState: { question, keyOrchestrator: true },
    });
    assert.equal(finalized.key_compose_trace?.compose_mode, "key_structured");
    assert.equal(finalized.key_compose_trace?.conversation_pattern_id, null);
    assert.match(finalized.text, /보험료|무거운 계약|부담/);
  }),
);

console.log(
  `\nKEY v2 phase 5 social: ${failed > 0 ? "FAILED" : "ALL PASSED"} (${passed}/${passed + failed})`,
);
process.exit(failed > 0 ? 1 : 0);
