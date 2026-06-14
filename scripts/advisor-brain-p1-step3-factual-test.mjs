/**
 * Advisor Brain P1 Step 3 — factual_lookup activation tests (no live DB / no live Claude).
 */
import assert from "node:assert/strict";
import { classifyConsultationIntent, computePremiumLookupStats } from "../server/intentGateLayer.js";
import {
  buildAdvisorBrainAnswer,
  shouldActivateAdvisorBrainForClassification,
} from "../server/advisorBrain/advisorBrainResponder.js";
import {
  ADVISOR_BRAIN_FACTUAL_MAX_TOKENS,
  buildFactualLookupUserPrompt,
  isActivatableFactualLookupClassification,
} from "../server/advisorBrain/advisorFactualLookupResponder.js";
import { resolveAllowedTools } from "../server/advisorBrain/advisorToolRegistry.js";
import { buildToolResult, DEFAULT_TOOL_EXECUTORS, runSingleAdvisorTool } from "../server/advisorBrain/advisorToolRunner.js";
import { sanitizeAdvisorBrainMessage } from "../server/advisorBrain/advisorBrainGuardrails.js";

const envOn = { ADVISOR_BRAIN_ENABLED: "true" };
const envOff = { ADVISOR_BRAIN_ENABLED: "false" };

const mockPolicies = [
  {
    id: "p1",
    insurer_name: "삼성생명",
    product_name: "종신보험",
    coverage_summary: { riders: ["A"] },
    advisor_guarded_ownership_status: "held",
    advisor_has_coverage_summary: true,
  },
  {
    id: "p2",
    insurer_name: null,
    insurer: "LegacyInsurer",
    product_name: "실손보험",
    coverage_summary: {},
    advisor_guarded_ownership_status: "미확인",
    advisor_has_coverage_summary: false,
  },
  {
    id: "p3",
    insurer_name: "한화생명",
    product_name: "암보험",
    coverage_summary: {},
    advisor_guarded_ownership_status: "미확인",
    advisor_has_coverage_summary: false,
  },
];

const mockContext = {
  customerId: "cust-1",
  policies: mockPolicies,
  policyCount: 3,
  snapshot: { customer_id: "cust-1", facts: [], memory_version: 1 },
  structuredMemory: { fact_count: 1, total_fact_count: 1, profile: { name: "테스트" } },
  unified: { policy_ids: mockPolicies.map((p) => p.id) },
  _unifiedLoaded: true,
};

const mockGap = {
  gap_score: 60,
  items: [
    { coverage_category: "cancer", current_status: "missing", gap_level: "critical" },
    { coverage_category: "medical_expense", current_status: "maintained", gap_level: "low" },
  ],
};

let capturedClaudeMaxTokens = null;

const mockClaude = async ({ maxTokens }) => {
  capturedClaudeMaxTokens = maxTokens;
  return { ok: true, message: "테스트 응답입니다." };
};

function makeToolRun(toolResults, calledTools) {
  return async () => ({
    called_tools: calledTools,
    tool_results: toolResults,
    guardrail_summary: {
      contradiction: { contradicted: false },
      uncertainty_notice: "보장 요약이 없는 계약 2건은 '미보유'가 아니라 '미확인'으로 취급합니다.",
    },
    audit_record: { storage_status: "payload_only_no_db_table" },
  });
}

// A — flag OFF → factual_lookup 비활성
{
  const classification = {
    intent: "factual_lookup",
    lookup_sub_intent: "premium_lookup",
  };
  assert.equal(shouldActivateAdvisorBrainForClassification(classification, envOff), false);
  assert.equal(isActivatableFactualLookupClassification(classification), true);
  console.log("A PASS");
}

// B — premium_lookup → get_policies + premium_lookup만 허용
{
  const classification = classifyConsultationIntent("내 보험료 얼마야?");
  assert.equal(classification.intent, "factual_lookup");
  assert.equal(classification.lookup_sub_intent, "premium_lookup");
  assert.deepEqual(resolveAllowedTools(classification), ["premium_lookup", "get_policies"]);

  const result = await buildAdvisorBrainAnswer({
    supabase: {},
    customerId: "cust-1",
    question: "내 보험료 얼마야?",
    classification,
    env: envOn,
    preloadedContext: mockContext,
    toolRun: makeToolRun(
      [
        buildToolResult({
          ok: true,
          tool: "premium_lookup",
          data: {
            totalCount: 3,
            premiumKnownCount: 2,
            premiumUnknownCount: 1,
            premiumTotal: 150000,
          },
        }),
        buildToolResult({
          ok: true,
          tool: "get_policies",
          data: { policies: mockPolicies, policy_count: 3 },
        }),
      ],
      ["premium_lookup", "get_policies"],
    ),
    claudeCall: mockClaude,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.used_tools, ["premium_lookup", "get_policies"]);
  assert.equal(capturedClaudeMaxTokens, ADVISOR_BRAIN_FACTUAL_MAX_TOKENS);
  console.log("B PASS");
}

// C — premiumKnownCount < totalCount → 미확인 N건 notice in prompt
{
  const classification = {
    intent: "factual_lookup",
    lookup_sub_intent: "premium_lookup",
  };
  const prompt = buildFactualLookupUserPrompt({
    question: "내 보험료 얼마야?",
    classification,
    policiesData: { policies: mockPolicies, policy_count: 3 },
    premiumData: {
      totalCount: 3,
      premiumKnownCount: 2,
      premiumUnknownCount: 1,
      premiumTotal: 150000,
    },
    gapData: null,
    uncertaintyNotice: null,
  });

  assert.match(prompt, /보험료 미확인 1건/);
  assert.match(prompt, /premiumUnknownCount": 1/);
  console.log("C PASS");
}

// D — premiumTotal 없음/0 → 금액 단정 금지 (sanitize)
{
  const dirty = "확인된 월 보험료 합계는 120,000원입니다.";
  const sanitized = sanitizeAdvisorBrainMessage(dirty, {
    hasPremiumEvidence: false,
    hasCoverageEvidence: true,
  });
  assert.match(sanitized, /미확인|확인 필요/);
  assert.doesNotMatch(sanitized, /120,?000/);

  const prompt = buildFactualLookupUserPrompt({
    question: "내 보험료 얼마야?",
    classification: { intent: "factual_lookup", lookup_sub_intent: "premium_lookup" },
    policiesData: { policies: mockPolicies, policy_count: 3 },
    premiumData: {
      totalCount: 3,
      premiumKnownCount: 0,
      premiumUnknownCount: 3,
      premiumTotal: 0,
    },
    gapData: null,
    uncertaintyNotice: null,
  });
  assert.match(prompt, /premium_amount_assertion_allowed": false/);
  assert.equal(prompt.includes('"premiumTotal": null'), true);
  console.log("D PASS");
}

// K — premium_lookup stats: resolvePositivePremium 기준 (0원/음수 제외), buildFactualLookupAnswer와 동일
{
  const premiumPolicies = [
    { id: "p1", monthly_premium: 50000, insurer_name: "A" },
    { id: "p2", monthly_premium: 0, insurer_name: "B" },
    { id: "p3", monthly_premium: -1000, insurer_name: "C" },
    { id: "p4", premium_amount: null, insurer_name: "D" },
  ];
  const expected = computePremiumLookupStats(premiumPolicies);
  assert.deepEqual(expected, {
    totalCount: 4,
    premiumKnownCount: 1,
    premiumUnknownCount: 3,
    premiumTotal: 50000,
  });

  const { result } = await runSingleAdvisorTool({
    toolName: "premium_lookup",
    allowedTools: ["premium_lookup", "get_policies"],
    calledTools: [],
    context: { policies: premiumPolicies },
    executors: DEFAULT_TOOL_EXECUTORS,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.data, expected);

  const prompt = buildFactualLookupUserPrompt({
    question: "내 보험료 얼마야?",
    classification: { intent: "factual_lookup", lookup_sub_intent: "premium_lookup" },
    policiesData: { policies: premiumPolicies, policy_count: 4 },
    premiumData: expected,
    gapData: null,
    uncertaintyNotice: null,
  });
  assert.match(prompt, /"premiumKnownCount": 1/);
  assert.match(prompt, /"premiumUnknownCount": 3/);
  assert.match(prompt, /"premiumTotal": 50000/);
  assert.match(prompt, /보험료 미확인 3건/);
  console.log("K PASS");
}

// L — coverage_presence + lookup_category=null: 일반 보장 확인 질문 명시
{
  const classification = {
    intent: "factual_lookup",
    lookup_sub_intent: "coverage_presence",
    lookup_category: null,
  };
  assert.equal(shouldActivateAdvisorBrainForClassification(classification, envOn), true);

  const prompt = buildFactualLookupUserPrompt({
    question: "보험 들어가 있나요?",
    classification,
    policiesData: { policies: mockPolicies, policy_count: 3 },
    premiumData: null,
    gapData: mockGap,
    uncertaintyNotice: null,
  });

  assert.match(prompt, /"lookup_category": null/);
  assert.match(prompt, /"lookup_category_label": null/);
  assert.match(prompt, /특정 보장명이 확인되지 않은 일반 보장 확인 질문/);
  assert.match(prompt, /미보유/);
  console.log("L PASS");
}

// E — policy_count → get_policies만 허용
{
  const classification = classifyConsultationIntent("내 보험 몇 건이야?");
  assert.equal(classification.lookup_sub_intent, "policy_count");
  assert.deepEqual(resolveAllowedTools(classification), ["get_policies"]);

  const result = await buildAdvisorBrainAnswer({
    supabase: {},
    customerId: "cust-1",
    question: "내 보험 몇 건이야?",
    classification,
    env: envOn,
    preloadedContext: mockContext,
    toolRun: makeToolRun(
      [
        buildToolResult({
          ok: true,
          tool: "get_policies",
          data: { policies: mockPolicies, policy_count: 3 },
        }),
      ],
      ["get_policies"],
    ),
    claudeCall: async () => ({
      ok: true,
      message: "현재 등록된 가입 보험은 총 3건입니다. 업로드되지 않은 증권이 있을 수 있어 추가 확인이 필요할 수 있습니다.",
    }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.used_tools, ["get_policies"]);
  console.log("E PASS");
}

// F — insurer → insurer_name만 사용
{
  const classification = classifyConsultationIntent("가입한 보험사 알려줘");
  assert.equal(classification.lookup_sub_intent, "insurer");

  const prompt = buildFactualLookupUserPrompt({
    question: "가입한 보험사 알려줘",
    classification,
    policiesData: { policies: mockPolicies, policy_count: 3 },
    premiumData: null,
    gapData: null,
    uncertaintyNotice: null,
  });

  assert.match(prompt, /삼성생명/);
  assert.match(prompt, /확인 필요/);
  assert.match(prompt, /한화생명/);
  assert.doesNotMatch(prompt, /LegacyInsurer/);
  assert.doesNotMatch(prompt, /"insurer":/);
  console.log("F PASS");
}

// G — coverage_presence → get_policies + get_coverage_gap
{
  const classification = classifyConsultationIntent("암보험 있나?");
  assert.equal(classification.lookup_sub_intent, "coverage_presence");
  assert.equal(classification.lookup_category, "cancer");
  assert.deepEqual(resolveAllowedTools(classification), ["get_policies", "get_coverage_gap"]);

  const result = await buildAdvisorBrainAnswer({
    supabase: {},
    customerId: "cust-1",
    question: "암보험 있나?",
    classification,
    env: envOn,
    preloadedContext: mockContext,
    toolRun: makeToolRun(
      [
        buildToolResult({
          ok: true,
          tool: "get_policies",
          data: { policies: mockPolicies, policy_count: 3 },
        }),
        buildToolResult({
          ok: true,
          tool: "get_coverage_gap",
          data: mockGap,
        }),
      ],
      ["get_policies", "get_coverage_gap"],
    ),
    claudeCall: async () => ({
      ok: true,
      message:
        "현재 자료로는 암보험 보유 여부가 미확인입니다. coverage_summary가 부족한 계약이 있어 증권 확인이 필요합니다.",
    }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.used_tools, ["get_policies", "get_coverage_gap"]);
  console.log("G PASS");
}

// H — lookup_category 키+label prompt 전달
{
  const classification = {
    intent: "factual_lookup",
    lookup_sub_intent: "coverage_presence",
    lookup_category: "cancer",
  };
  const prompt = buildFactualLookupUserPrompt({
    question: "암보험 있나?",
    classification,
    policiesData: { policies: mockPolicies, policy_count: 3 },
    premiumData: null,
    gapData: mockGap,
    uncertaintyNotice: null,
  });

  assert.match(prompt, /"lookup_category": "cancer"/);
  assert.match(prompt, /"lookup_category_label": "암"/);
  console.log("H PASS");
}

// I — coverage_summary 부족 시 미보유 단정 금지
{
  const classification = {
    intent: "factual_lookup",
    lookup_sub_intent: "coverage_presence",
    lookup_category: "cancer",
  };
  const prompt = buildFactualLookupUserPrompt({
    question: "암보험 있나?",
    classification,
    policiesData: { policies: mockPolicies, policy_count: 3 },
    premiumData: null,
    gapData: mockGap,
    uncertaintyNotice: "보장 요약이 없는 계약 2건은 '미보유'가 아니라 '미확인'으로 취급합니다.",
  });

  assert.match(prompt, /미보유로 단정하지 말고/);
  assert.match(prompt, /policies_without_coverage_summary_count": 2/);

  const dirty = "암보험은 미보유입니다.";
  const sanitized = sanitizeAdvisorBrainMessage(dirty, {
    hasPremiumEvidence: false,
    hasCoverageEvidence: false,
  });
  assert.match(sanitized, /미확인|증권 확인/);
  console.log("I PASS");
}

// J — coverage_gap_check Step2 회귀 PASS
{
  const mockGapAllMissing = {
    gap_score: 100,
    items: [
      { coverage_category: "cancer", current_status: "missing", gap_level: "critical" },
      { coverage_category: "medical_expense", current_status: "missing", gap_level: "critical" },
    ],
  };

  const classification = classifyConsultationIntent("암보험 부족해?");
  assert.equal(classification.intent, "coverage_gap_check");
  assert.equal(shouldActivateAdvisorBrainForClassification(classification, envOn), true);

  let coverageGapMaxTokens = null;
  const result = await buildAdvisorBrainAnswer({
    supabase: {},
    customerId: "cust-1",
    question: "암보험 부족해?",
    classification,
    env: envOn,
    preloadedContext: mockContext,
    toolRun: makeToolRun(
      [
        buildToolResult({
          ok: true,
          tool: "get_policies",
          data: { policies: mockPolicies, policy_count: 3 },
        }),
        buildToolResult({
          ok: true,
          tool: "get_coverage_gap",
          data: mockGapAllMissing,
        }),
      ],
      ["get_policies", "get_coverage_gap"],
    ),
    claudeCall: async ({ maxTokens }) => {
      coverageGapMaxTokens = maxTokens;
      return {
        ok: true,
        message:
          "등록된 보험 3건이 있으나 특약 정보가 부족합니다. 미확인 가능성이 있으며 증권 확인이 필요합니다.",
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(coverageGapMaxTokens, 900);
  assert.match(result.message, /미확인|증권|확인/);
  console.log("J PASS");
}

// factual_lookup without supported sub_intent stays inactive
{
  assert.equal(
    shouldActivateAdvisorBrainForClassification({ intent: "factual_lookup" }, envOn),
    false,
  );
  assert.equal(
    shouldActivateAdvisorBrainForClassification(
      { intent: "factual_lookup", lookup_sub_intent: "unknown_sub" },
      envOn,
    ),
    false,
  );
  console.log("EXTRA PASS — unsupported factual sub_intent inactive");
}

console.log("advisor-brain-p1-step3-factual-test: PASS");
