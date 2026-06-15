#!/usr/bin/env node
/**
 * P2 Central Brain Step1 — read-only orchestrator tests (no live DB / no live Claude).
 */
import assert from "node:assert/strict";
import { classifyConsultationIntent } from "../server/intentGateLayer.js";
import {
  isCentralBrainActive,
  mergeConversationMetadata,
  planCentralBrainEvidence,
  routeCentralBrain,
  resolveCentralBrainMode,
} from "../server/centralBrain/index.js";
import {
  detectInternalNameLeak,
  normalizeCentralBrainResponse,
} from "../server/centralBrain/centralBrainResponseNormalizer.js";
import {
  buildReadOnlyToolRunFromBundle,
  loadCentralBrainEvidence,
} from "../server/centralBrain/centralBrainEvidenceLoader.js";
import { routeThroughCentralBrain, runCentralBrainTurn } from "../server/centralBrain/centralBrainOrchestrator.js";
import { mapJobResultsToAnalysisPanels } from "../src/lib/analysisPanelJobUtils.js";

const envOff = { CENTRAL_BRAIN_ENABLED: "false", ADVISOR_BRAIN_ENABLED: "false" };
const envCentralOnAdvisorOff = { CENTRAL_BRAIN_ENABLED: "true", ADVISOR_BRAIN_ENABLED: "false" };
const envBothOn = { CENTRAL_BRAIN_ENABLED: "true", ADVISOR_BRAIN_ENABLED: "true" };

const mockJob = {
  id: "job-cb-1",
  status: "completed",
  customer_id: "cust-cb-1",
  result_json: {
    coverage_gap: {
      gap_score: 70,
      items: [{ coverage_label: "뇌혈관", gap_level: "critical" }],
      top_gaps: [{ coverage_label: "뇌혈관", gap_level: "critical" }],
    },
    underwriting_risk: { items: [] },
    recommendation: {
      customer_visible_top2: [
        { recommendation_rank: 1, coverage_label: "뇌혈관", reason: "보강 검토" },
      ],
    },
  },
};

const mockPanels = mapJobResultsToAnalysisPanels(mockJob);
const mockJobLoader = async () => mockJob;

let engineCalls = 0;
const blockingImport = {
  async loadCoverageAnalysisContext() {
    engineCalls += 1;
    throw new Error("live_engine_should_not_run");
  },
};

// A — CENTRAL OFF → inactive
{
  assert.equal(isCentralBrainActive(envOff), false);
  const route = routeCentralBrain({ question: "암보험 부족해?", env: envOff });
  assert.equal(route.active, false);
  assert.equal(route.response_lane, "legacy");
  console.log("A PASS");
}

// B — CENTRAL ON + ADVISOR OFF → fail-safe OFF
{
  assert.equal(isCentralBrainActive(envCentralOnAdvisorOff), false);
  const route = routeCentralBrain({ question: "암보험 부족해?", env: envCentralOnAdvisorOff });
  assert.equal(route.active, false);
  assert.equal(route.fail_safe_off, true);
  console.log("B PASS");
}

// C — mode routing
{
  assert.equal(resolveCentralBrainMode(classifyConsultationIntent("암보험 부족해?"), "암보험 부족해?"), "coverage_gap_reason");
  assert.equal(
    resolveCentralBrainMode(classifyConsultationIntent("내 보험료 얼마야?"), "내 보험료 얼마야?"),
    "factual_lookup",
  );
  assert.equal(
    resolveCentralBrainMode(classifyConsultationIntent("추천 근거가 뭐야?"), "추천 근거가 뭐야?"),
    "recommendation_reason",
  );
  assert.equal(
    resolveCentralBrainMode(classifyConsultationIntent("보험 더 들어야 해?"), "보험 더 들어야 해?"),
    "advisor_conversation",
  );
  const route = routeCentralBrain({ question: "암보험 부족해?", env: envBothOn });
  assert.equal(route.central_mode, "coverage_gap_reason");
  assert.equal(route.response_lane, "central_brain");
  console.log("C PASS");
}

// D — general_consultation → legacy lane
{
  const route = routeCentralBrain({ question: "보험 구조를 전반적으로 점검해줘", env: envBothOn });
  assert.equal(route.classification.intent, "general_consultation");
  assert.equal(route.central_mode, null);
  assert.equal(route.response_lane, "legacy");
  console.log("D PASS");
}

// E — planner forbids live engines
{
  const route = routeCentralBrain({ question: "암보험 부족해?", env: envBothOn });
  const plan = planCentralBrainEvidence({ route, memoryVersion: 1 });
  assert.equal(plan.use_live_engines, false);
  assert.equal(plan.read_only, true);
  assert.ok(plan.rationale.some((line) => line.includes("no_live")));
  console.log("E PASS");
}

// F — job skip planned
{
  const route = routeCentralBrain({ question: "보험 더 들어야 해?", env: envBothOn });
  const plan = planCentralBrainEvidence({ route });
  assert.equal(plan.skip_analysis_job, true);
  console.log("F PASS");
}

// G — metadata merge preserves existing keys
{
  const merged = mergeConversationMetadata(
    { source: "customer_dashboard", phase: "phase26-2a", memory_version: 3 },
    { phase: "central-brain-p2", central_brain_mode: "advisor_conversation", memory_version: 3 },
  );
  assert.equal(merged.source, "customer_dashboard");
  assert.equal(merged.phase, "central-brain-p2");
  assert.equal(merged.memory_version, 3);
  assert.equal(merged.central_brain_mode, "advisor_conversation");
  console.log("G PASS");
}

// H — internal name leak stripped
{
  const raw = "Tom said Coverage Gap Engine score 80. Advisor Brain recommends A상품.";
  const normalized = normalizeCentralBrainResponse(raw);
  assert.equal(detectInternalNameLeak(normalized).length, 0);
  assert.match(normalized, /80/);
  console.log("H PASS");
}

// I — Voice entry uses same orchestrator path
{
  const mockClaude = async () => ({
    ok: true,
    message: "현재 확인된 자료 기준으로 뇌혈관 보장을 먼저 살펴보시면 좋겠습니다.",
  });

  const mockSupabase = {
    from() {
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
        maybeSingle: async () => ({ data: mockJob, error: null }),
      };
      return chain;
    },
  };

  const voiceResult = await routeThroughCentralBrain({
    transcript: "암보험 부족한가요",
    inputChannel: "voice",
    question: "암보험 부족한가요",
    supabase: mockSupabase,
    customerId: "cust-cb-1",
    env: envBothOn,
    jobLoader: mockJobLoader,
    claudeCall: mockClaude,
    memorySnapshot: { facts: [], memory_version: 1, fact_count: 0 },
    cachePayload: { cache_status: "ready" },
    conversationHistory: [],
  });

  const textResult = await runCentralBrainTurn({
    question: "암보험 부족한가요",
    supabase: mockSupabase,
    customerId: "cust-cb-1",
    env: envBothOn,
    jobLoader: mockJobLoader,
    claudeCall: mockClaude,
    memorySnapshot: { facts: [], memory_version: 1, fact_count: 0 },
    cachePayload: { cache_status: "ready" },
    conversationHistory: [],
  });

  assert.equal(voiceResult.activated, true);
  assert.equal(textResult.activated, true);
  assert.equal(voiceResult.central_brain_mode, textResult.central_brain_mode);
  assert.equal(voiceResult.skip_analysis_job, true);
  assert.equal(voiceResult.live_engines_executed, false);
  console.log("I PASS");
}

// J — read-only tool run does not invoke live engines
{
  const bundle = {
    data: {
      stored_panels: mockPanels,
      stored_job: mockJob,
      premium_stats: { totalCount: 2, premiumKnownCount: 0, premiumUnknownCount: 2, premiumTotal: 0 },
    },
  };
  const readOnlyToolRun = buildReadOnlyToolRunFromBundle(bundle);
  const toolRunResult = await readOnlyToolRun({
    classification: classifyConsultationIntent("암보험 부족해?"),
    preloadedContext: {
      policies: [{ id: "p1", insurer_name: "테스트보험" }],
      policyCount: 1,
      snapshot: { facts: [], memory_version: 1 },
      structuredMemory: { fact_count: 0 },
    },
  });
  assert.ok(toolRunResult.tool_results.some((row) => row.tool === "get_coverage_gap"));
  assert.equal(toolRunResult.guardrail_summary.live_engine_bypass, true);
  assert.equal(engineCalls, 0);
  console.log("J PASS");
}

console.log("central-brain-p2-step1-test: PASS");
