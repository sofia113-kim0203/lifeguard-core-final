/**
 * P11-2D — Tool Brain → KEY absorption unit tests (no network).
 */
import assert from "node:assert/strict";

import {
  planKeyTools,
  runKeyTools,
  KEY_TOOLS,
} from "../server/salesDirectorKeyToolRegistry.js";
import {
  buildKeyStructuredResponse,
  buildBasisTaggedFacts,
  buildHumanUnderstandingFrame,
  finalizeHumanSalesDirectorResponse,
  generateHumanSalesDirectorResponse,
  KEY_QUESTION_ENDING_RE,
} from "../server/humanUnderstandingLoop.js";
import {
  detectFalseAssertions,
  resolveSalesDirectorJudgmentIntent,
} from "../server/salesDirectorFormatter.js";
import { SALES_DIRECTOR_TOOL_BRAIN_SLICES } from "../server/salesDirectorToolBrain.js";
import { ONE_BRAIN_SURFACES } from "../server/oneBrainResponseLayer.js";

const POLICIES = [
  { product_name: "실손의료비", policy_type: "health", monthly_premium: 50000 },
  { product_name: "암진단", policy_type: "cancer", monthly_premium: 80000 },
];

function buildLoadedContext({ policies = true, memory = false } = {}) {
  return {
    policies: policies ? "present" : "empty",
    memory: memory ? "present" : "empty",
  };
}

function buildBundle(question, options = {}) {
  const {
    policies = POLICIES,
    memoryFactCount = 0,
    tool_brain_slice = null,
    snapshot_tool_used = policies.length > 0,
    premium_stats = {
      totalCount: policies.length,
      premiumKnownCount: policies.every((p) => p.monthly_premium > 0) ? policies.length : 0,
      premiumUnknownCount: policies.length > 0 && !policies.every((p) => p.monthly_premium > 0) ? policies.length : 0,
      premiumTotal: policies.reduce((sum, p) => sum + (p.monthly_premium ?? 0), 0),
    },
    ...rest
  } = options;

  return {
    question,
    policy_count: policies.length,
    policies,
    memory_fact_count: memoryFactCount,
    key_orchestrator: true,
    tool_brain_slice,
    tool_brain_absorbed: Boolean(tool_brain_slice),
    snapshot_tool_used,
    memory_tool_used: memoryFactCount > 0,
    premium_stats,
    coverage_gap_used: false,
    ...rest,
  };
}

function composeToolBrainKey(question, options = {}) {
  const slice =
    options.tool_brain_slice ??
    (question.includes("보험료")
      ? SALES_DIRECTOR_TOOL_BRAIN_SLICES.PREMIUM_BURDEN
      : SALES_DIRECTOR_TOOL_BRAIN_SLICES.INSURANCE_PRESENCE);
  const bundle = buildBundle(question, { ...options, tool_brain_slice: slice });
  const classificationIntent = "factual_lookup";
  const resolvedIntent =
    resolveSalesDirectorJudgmentIntent(classificationIntent, question) ?? null;
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
    factBundle: bundle,
    intent: resolvedIntent,
  });

  return { ...generated, bundle, humanFrame, basisTaggedFacts, resolvedIntent };
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
  await runCase("P11-2D-1 insurance_presence plan — snapshot + memory, no gap", async () => {
    const plan = planKeyTools(
      { intent: "factual_lookup", lookup_sub_intent: "policy_count" },
      buildLoadedContext({ memory: true }),
      "내 보험 있어",
    );
    assert.equal(plan.legacy_slice, SALES_DIRECTOR_TOOL_BRAIN_SLICES.INSURANCE_PRESENCE);
    assert.ok(plan.tools.includes(KEY_TOOLS.SNAPSHOT));
    assert.ok(plan.tools.includes(KEY_TOOLS.MEMORY));
    assert.ok(!plan.tools.includes(KEY_TOOLS.COVERAGE_GAP));
    assert.equal(plan.coverage_gap_suppressed, true);
  }),
);

await record(
  await runCase("P11-2D-2 premium_burden plan — snapshot + premium_stats, no gap", async () => {
    const plan = planKeyTools(
      { intent: "general_consultation" },
      buildLoadedContext(),
      "보험료가 부담돼",
    );
    assert.equal(plan.legacy_slice, SALES_DIRECTOR_TOOL_BRAIN_SLICES.PREMIUM_BURDEN);
    assert.ok(plan.tools.includes(KEY_TOOLS.PREMIUM_STATS));
    assert.ok(!plan.tools.includes(KEY_TOOLS.COVERAGE_GAP));
    assert.equal(plan.coverage_gap_suppressed, true);
  }),
);

await record(
  await runCase("P11-2D-3 runKeyTools premium_burden — coverage_gap_used false", async () => {
    const plan = planKeyTools(
      { intent: "general_consultation" },
      buildLoadedContext(),
      "보험료 너무 비싸",
    );
    const toolRun = await runKeyTools({
      plan,
      customerContextBundle: { policies: POLICIES, memoryFactCount: 0 },
      loadedContext: buildLoadedContext(),
    });
    assert.equal(toolRun.ok, true);
    assert.equal(toolRun.coverage_gap_used, false);
    assert.ok(toolRun.tools_called.includes(KEY_TOOLS.PREMIUM_STATS));
  }),
);

await record(
  await runCase("P11-2D-4 내 보험 있어 — fixed slots + presence confirmation", async () => {
    const { text, key_compose_trace, bundle } = composeToolBrainKey("내 보험 있어");
    assert.equal(key_compose_trace.compose_mode, "tool_brain_fixed_slots");
    assert.equal(key_compose_trace.absorbed_slice, SALES_DIRECTOR_TOOL_BRAIN_SLICES.INSURANCE_PRESENCE);
    assert.match(text, /가입된 보험이 있는 것은 확인돼요/);
    assert.doesNotMatch(text, KEY_QUESTION_ENDING_RE);
    assert.equal(detectFalseAssertions(text, bundle), false);
  }),
);

await record(
  await runCase("P11-2D-5 보험 가입했어? — insurance_presence fixed slots", async () => {
    const { text, key_compose_trace } = composeToolBrainKey("보험 가입했어?");
    assert.equal(key_compose_trace.compose_mode, "tool_brain_fixed_slots");
    assert.match(text, /가입된 보험이 있는 것은 확인돼요/);
  }),
);

await record(
  await runCase("P11-2D-6 보험료가 부담돼 — premium fixed slots, no gap evidence", async () => {
    const { text, key_compose_trace, bundle } = composeToolBrainKey("보험료가 부담돼", {
      tool_brain_slice: SALES_DIRECTOR_TOOL_BRAIN_SLICES.PREMIUM_BURDEN,
    });
    assert.equal(key_compose_trace.compose_mode, "tool_brain_fixed_slots");
    assert.match(text, /보험료 부담|월 보험료/);
    assert.doesNotMatch(text, /부족 신호/);
    assert.equal(bundle.coverage_gap_used, false);
  }),
);

await record(
  await runCase("P11-2D-7 보험료 너무 비싸 — premium unknown path", async () => {
    const { text, key_compose_trace } = composeToolBrainKey("보험료 너무 비싸", {
      tool_brain_slice: SALES_DIRECTOR_TOOL_BRAIN_SLICES.PREMIUM_BURDEN,
      premium_stats: {
        totalCount: 2,
        premiumKnownCount: 0,
        premiumUnknownCount: 2,
        premiumTotal: 0,
      },
    });
    assert.equal(key_compose_trace.compose_mode, "tool_brain_fixed_slots");
    assert.match(text, /가입된 보험이 있는 것은 확인돼요/);
    assert.match(text, /검증이 필요/);
  }),
);

await record(
  await runCase("P11-2D-8 no-policy customer — no false presence", async () => {
    const bundle = buildBundle("내 보험 있어", {
      policies: [],
      tool_brain_slice: SALES_DIRECTOR_TOOL_BRAIN_SLICES.INSURANCE_PRESENCE,
      snapshot_tool_used: true,
      premium_stats: { totalCount: 0, premiumKnownCount: 0, premiumUnknownCount: 0, premiumTotal: 0 },
    });
    const basisTaggedFacts = buildBasisTaggedFacts(bundle, null);
    const humanFrame = buildHumanUnderstandingFrame({
      question: "내 보험 있어",
      intent: null,
      surface: ONE_BRAIN_SURFACES.HOME,
      conversationContext: { classificationIntent: "factual_lookup", history: [] },
      factBundle: bundle,
      basisTaggedFacts,
    });
    const text = buildKeyStructuredResponse(humanFrame, basisTaggedFacts, bundle, {
      resolvedIntent: null,
    });
    assert.doesNotMatch(text, /확인돼요/);
    assert.match(text, /등록된 가입 보험|찾지 못했/);
    assert.equal(detectFalseAssertions(text, bundle), false);
  }),
);

await record(
  await runCase("P11-2D-9 finalizeHuman KEY path — compose_mode tool_brain_fixed_slots", async () => {
    const finalized = finalizeHumanSalesDirectorResponse({
      question: "내 보험 있어",
      classificationIntent: "factual_lookup",
      surface: ONE_BRAIN_SURFACES.HOME,
      factBundle: buildBundle("내 보험 있어", {
        tool_brain_slice: SALES_DIRECTOR_TOOL_BRAIN_SLICES.INSURANCE_PRESENCE,
      }),
      customerState: {
        question: "내 보험 있어",
        keyOrchestrator: true,
      },
      homeRoute: "casual_chat",
    });
    assert.equal(finalized.generation_mode, "key_orchestrator");
    assert.equal(finalized.key_compose_trace.compose_mode, "tool_brain_fixed_slots");
    assert.equal(finalized.key_compose_trace.called, true);
  }),
);

await record(
  await runCase("P11-2D-10 non-tool-brain KEY — generic compose unchanged", async () => {
    const bundle = buildBundle("암보장 있어?", {
      tool_brain_slice: null,
      tool_brain_absorbed: false,
      coverage_gap_used: true,
      has_stored_coverage_analysis: true,
      coverage_gap_signals: ["암:미확인"],
    });
    const resolvedIntent = resolveSalesDirectorJudgmentIntent("factual_lookup", "암보장 있어?");
    const basisTaggedFacts = buildBasisTaggedFacts(bundle, resolvedIntent);
    const humanFrame = buildHumanUnderstandingFrame({
      question: "암보장 있어?",
      intent: resolvedIntent,
      surface: ONE_BRAIN_SURFACES.HOME,
      conversationContext: { classificationIntent: "factual_lookup", history: [] },
      factBundle: bundle,
      basisTaggedFacts,
    });
    const generated = generateHumanSalesDirectorResponse({
      humanFrame,
      basisTaggedFacts,
      guardrails: { generation_mode: "key_orchestrator" },
      factBundle: bundle,
      intent: resolvedIntent,
    });
    assert.equal(generated.key_compose_trace.compose_mode, "key_structured");
    assert.notEqual(generated.key_compose_trace.compose_mode, "tool_brain_fixed_slots");
    assert.match(generated.text, /가입된 보험이 있는 것은 확인돼요/);
    assert.doesNotMatch(generated.text, /충분 여부/);
  }),
);

console.log(
  `\nP11-2D Tool Brain KEY absorption: ${failed > 0 ? "FAILED" : "ALL PASSED"} (${passed}/${passed + failed})`,
);
process.exit(failed > 0 ? 1 : 0);
