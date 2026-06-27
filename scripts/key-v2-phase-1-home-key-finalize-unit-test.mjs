/**
 * KEY v2 phase 1 — home KEY finalize + presence/defer compose (no network).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildKeyStructuredResponse,
  buildBasisTaggedFacts,
  buildHumanUnderstandingFrame,
  enforceKeyDeclarativeEnding,
  finalizeHumanSalesDirectorResponse,
  keyToolBrainSliceHasPolicies,
  resolveKeyFactBundlePolicyCount,
} from "../server/humanUnderstandingLoop.js";
import { resolveSalesDirectorJudgmentIntent } from "../server/salesDirectorFormatter.js";
import { extractFactBundleEvidence } from "../server/salesDirectorFormatter.js";
import { SALES_DIRECTOR_TOOL_BRAIN_SLICES } from "../server/salesDirectorToolBrain.js";
import { ONE_BRAIN_SURFACES } from "../server/oneBrainResponseLayer.js";
import { LIFEGUARD_CHAT_FALLBACK } from "../server/lifeguardChatCore.js";
import { handleHomeBrainFactRequest } from "../server/homeBrainFactCore.js";
import { runSalesDirectorLoopTurn } from "../server/salesDirectorLoop.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

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

const KEY_AUDIT_CUSTOMER_ID = "cust-v2-phase-1-empty";

function buildEmptyPoliciesMockSupabase(customerId = KEY_AUDIT_CUSTOMER_ID) {
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
          data: { id: customerId, display_name: "감사QA", memory_version: 1 },
          error: null,
        }),
        then(onFulfilled, onRejected) {
          let payload = { data: [], error: null, count: 0 };
          if (table === "active_profile_insurance_policies") {
            payload = { data: [], error: null };
          }
          if (table === "customer_memory_facts") {
            payload = { data: [], error: null, count: 0 };
          }
          if (table === "analysis_jobs") {
            payload = { data: [], error: null };
          }
          return Promise.resolve(payload).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
  };
}

function buildKeyAuditEnv(customerId = KEY_AUDIT_CUSTOMER_ID) {
  return {
    ...process.env,
    ANTHROPIC_API_KEY: "mock-key",
    SALES_DIRECTOR_KEY_ORCHESTRATOR: "1",
    SALES_DIRECTOR_KEY_CUSTOMER_ALLOWLIST: customerId,
    SALES_DIRECTOR_KEY_LEGACY_FALLBACK: "0",
  };
}

function buildKeyBundle(question, overrides = {}) {
  return {
    question,
    key_orchestrator: true,
    active_policy_count: 2,
    policy_count: 2,
    policies: [{ product_name: "암진단", policy_type: "cancer" }],
    snapshot_tool_used: true,
    premium_stats: {
      totalCount: 2,
      premiumKnownCount: 0,
      premiumUnknownCount: 2,
      premiumTotal: 0,
    },
    ...overrides,
  };
}

await record(
  await runCase("V2-1 wiring — KEY path bypasses finalizeOneBrainResponse", async () => {
    const source = readFileSync(join(ROOT, "server/homeBrainFactCore.js"), "utf8");
    const fnBlock = source.slice(
      source.indexOf("function finalizeHomeAgentResponse"),
      source.indexOf("export async function handleHomeBrainFactRequest"),
    );
    assert.match(fnBlock, /isHomeKeyOrchestratorFinalize/);
    assert.match(fnBlock, /finalizeHomeKeyOrchestratorResponse/);
    const keyIdx = fnBlock.indexOf("isHomeKeyOrchestratorFinalize");
    const oneBrainIdx = fnBlock.indexOf("finalizeOneBrainResponse");
    assert.ok(keyIdx >= 0 && oneBrainIdx >= 0 && keyIdx < oneBrainIdx);
  }),
);

await record(
  await runCase("V2-2 Scene D — presence question answers presence not adequacy", async () => {
    const question = "암보장 있어?";
    const bundle = buildKeyBundle(question, {
      tool_brain_slice: null,
      coverage_gap_used: false,
      has_stored_coverage_analysis: false,
    });
    const resolvedIntent = resolveSalesDirectorJudgmentIntent("factual_lookup", question);
    const basisTaggedFacts = buildBasisTaggedFacts(bundle, resolvedIntent);
    const humanFrame = buildHumanUnderstandingFrame({
      question,
      intent: resolvedIntent,
      surface: ONE_BRAIN_SURFACES.HOME,
      conversationContext: { classificationIntent: "factual_lookup", history: [] },
      factBundle: bundle,
      basisTaggedFacts,
    });
    const text = buildKeyStructuredResponse(humanFrame, basisTaggedFacts, bundle, {
      resolvedIntent,
    });
    assert.match(text, /가입된 보험이 있는 것은 확인돼요/);
    assert.doesNotMatch(text, /충분 여부|부족/);
  }),
);

await record(
  await runCase("V2-3 Scene D — adequacy question keeps defer judgment", async () => {
    const question = "암보험 부족해?";
    const bundle = buildKeyBundle(question, {
      coverage_gap_used: true,
      has_stored_coverage_analysis: true,
      coverage_gap_signals: ["암:미확인"],
    });
    const resolvedIntent = resolveSalesDirectorJudgmentIntent("coverage_gap_check", question);
    const basisTaggedFacts = buildBasisTaggedFacts(bundle, resolvedIntent);
    const humanFrame = buildHumanUnderstandingFrame({
      question,
      intent: resolvedIntent,
      surface: ONE_BRAIN_SURFACES.HOME,
      conversationContext: { classificationIntent: "coverage_gap_check", history: [] },
      factBundle: bundle,
      basisTaggedFacts,
    });
    const text = buildKeyStructuredResponse(humanFrame, basisTaggedFacts, bundle, {
      resolvedIntent,
    });
    assert.match(text, /단정하기 어렵|충분 여부/);
    assert.doesNotMatch(text, /가입된 보험이 있는 것은 확인돼요/);
  }),
);

await record(
  await runCase("V2-4 Scene I — empty factory ends with defer promise", async () => {
    const question = "내 보험 있어";
    const bundle = buildKeyBundle(question, {
      active_policy_count: 0,
      policy_count: 0,
      policies: [],
      tool_brain_slice: SALES_DIRECTOR_TOOL_BRAIN_SLICES.INSURANCE_PRESENCE,
    });
    const basisTaggedFacts = buildBasisTaggedFacts(bundle, null);
    const humanFrame = buildHumanUnderstandingFrame({
      question,
      intent: null,
      surface: ONE_BRAIN_SURFACES.HOME,
      conversationContext: { classificationIntent: "factual_lookup", history: [] },
      factBundle: bundle,
      basisTaggedFacts,
    });
    const text = buildKeyStructuredResponse(humanFrame, basisTaggedFacts, bundle, {
      resolvedIntent: null,
    });
    assert.match(text, /찾지 못했/);
    assert.match(text, /확인해 보고 다시 말씀드리겠습니다/);
    assert.notEqual(text, LIFEGUARD_CHAT_FALLBACK);
  }),
);

await record(
  await runCase("V2-5 KEY finalize — generation_mode key_orchestrator on empty draft", async () => {
    const finalized = finalizeHumanSalesDirectorResponse({
      question: "암보장 있어?",
      classificationIntent: "factual_lookup",
      surface: ONE_BRAIN_SURFACES.HOME,
      rawText: "",
      factBundle: buildKeyBundle("암보장 있어?", {
        tool_brain_slice: SALES_DIRECTOR_TOOL_BRAIN_SLICES.INSURANCE_PRESENCE,
      }),
      customerState: {
        question: "암보장 있어?",
        keyOrchestrator: true,
      },
      homeRoute: "casual_chat",
      responseSource: "sales_director_key",
    });
    assert.equal(finalized.generation_mode, "key_orchestrator");
    assert.ok(finalized.text.length > 20);
    assert.notEqual(finalized.text, LIFEGUARD_CHAT_FALLBACK);
  }),
);

await record(
  await runCase("V2-6 enforceKeyDeclarativeEnding — information_gap defer", async () => {
    const cleaned = enforceKeyDeclarativeEnding("테스트입니다. 말씀해 주실까요?", "information_gap");
    assert.match(cleaned, /확인해 보고 다시 말씀드리겠습니다/);
  }),
);

await record(
  await runCase("V2-7 null count + empty policies + snapshot — no false presence", async () => {
    const factBundle = {
      policies: [],
      snapshot_tool_used: true,
      tool_brain_slice: SALES_DIRECTOR_TOOL_BRAIN_SLICES.INSURANCE_PRESENCE,
      key_orchestrator: true,
    };
    assert.equal(resolveKeyFactBundlePolicyCount(factBundle), null);
    assert.equal(keyToolBrainSliceHasPolicies(factBundle), false);
    const text = buildKeyStructuredResponse({}, {}, factBundle, { resolvedIntent: null });
    assert.match(text, /등록된 가입 보험 정보를 찾지 못했어요/);
    assert.match(text, /확인해 보고 다시 말씀드리겠습니다/);
    assert.doesNotMatch(text, /가입된 보험이 있는 것은 확인돼요/);
  }),
);

await record(
  await runCase("V2-8 full request path empty — insurance_presence no false positive", async () => {
    const question = "내 보험 있어?";
    const env = buildKeyAuditEnv();
    const loop = await runSalesDirectorLoopTurn({
      userSupabase: buildEmptyPoliciesMockSupabase(),
      customerId: KEY_AUDIT_CUSTOMER_ID,
      question,
      env,
      fetchImpl: async () => new Response("", { status: 503 }),
    });
    assert.equal(loop.ok, true);
    const factBundle = loop.agentTurn?.factBundle ?? {};
    const evidence = extractFactBundleEvidence(factBundle);
    assert.equal(factBundle.tool_brain_slice, SALES_DIRECTOR_TOOL_BRAIN_SLICES.INSURANCE_PRESENCE);
    assert.equal((factBundle.policies ?? []).length, 0);
    assert.equal(keyToolBrainSliceHasPolicies(factBundle), false);

    const result = await handleHomeBrainFactRequest({
      question,
      history: [],
      userSupabase: buildEmptyPoliciesMockSupabase(),
      customerId: KEY_AUDIT_CUSTOMER_ID,
      env,
      fetchImpl: async () => new Response("", { status: 503 }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.response_source, "sales_director_key");
    assert.match(result.answerText, /등록된 가입 보험 정보를 찾지 못했어요/);
    assert.match(result.answerText, /확인해 보고 다시 말씀드리겠습니다/);
    assert.doesNotMatch(result.answerText, /가입된 보험이 있는 것은 확인돼요/);
    assert.notEqual(result.answerText, LIFEGUARD_CHAT_FALLBACK);
    assert.equal(evidence.has_policies, false);
  }),
);

console.log(
  `\nKEY v2 phase 1 home finalize: ${failed > 0 ? "FAILED" : "ALL PASSED"} (${passed}/${passed + failed})`,
);
process.exit(failed > 0 ? 1 : 0);
