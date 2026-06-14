/**
 * Advisor Brain P1 Step 2 — Single-shot reasoning responder (coverage_gap_check only).
 * Not Claude Tool Use; deterministic tools → guardrails → Claude 1회 합성.
 */
import { resolveAnthropicApiKey } from "../claudeGroundedExecutionCore.js";
import { buildCoverageGapExplanationPrompt } from "../customerCoverageGapCore.js";
import { buildStructuredMemoryProfile } from "../customerMemorySnapshot.js";
import { buildAdvisorAuditRecord, summarizeUsedEvidence } from "./advisorAuditLog.js";
import { createAdvisorBrainContext } from "./advisorBrainContext.js";
import {
  assertNoUnsupportedFact,
  buildUncertaintyNotice,
  detectContradictionBetweenPolicyCountAndGap,
} from "./advisorBrainGuardrails.js";
import { runControlledAdvisorTools } from "./advisorToolRunner.js";

const ADVISOR_BRAIN_MODEL = "claude-sonnet-4-6";
const ADVISOR_BRAIN_MAX_TOKENS = 900;

const COVERAGE_GAP_CHECK_ALLOWED_TOOLS = ["get_policies", "get_coverage_gap"];

const ADVISOR_BRAIN_EXTRA_SYSTEM_RULES = [
  "미확인 is not the same as 미보유. Never treat unknown coverage data as confirmed absence.",
  "If policies exist but gap analysis marks every category as missing, do not conclude the customer has no insurance.",
  "When rider or coverage_summary data is missing, say 특약 정보 부족 or 증권 확인 필요 instead of 미보유.",
  "Use customer-friendly Korean. Avoid exaggeration.",
  "Never assert enrollment eligibility or guaranteed claim payment without evidence in the provided JSON.",
].join(" ");

export function isAdvisorBrainEnabled(env = process.env) {
  return String(env?.ADVISOR_BRAIN_ENABLED ?? "").trim().toLowerCase() === "true";
}

export function shouldActivateAdvisorBrainForClassification(classification, env = process.env) {
  return (
    isAdvisorBrainEnabled(env) && classification?.intent === "coverage_gap_check"
  );
}

function pickToolData(toolResults, toolName) {
  return toolResults.find((result) => result.tool === toolName && result.ok)?.data ?? null;
}

function buildAdvisorBrainUserPrompt({
  question,
  policyCount,
  coverageGapResult,
  contradiction,
  uncertaintyNotice,
  structuredMemory,
}) {
  const { user: coverageGapUser } = buildCoverageGapExplanationPrompt(
    structuredMemory,
    coverageGapResult ?? { items: [], top_gaps: [], maintained_coverage: [] },
  );

  return [
    "Answer the customer's coverage gap question using only the evidence blocks below.",
    "",
    `question: ${question}`,
    `policy_count: ${policyCount}`,
    `contradiction_flag: ${Boolean(contradiction?.contradicted)}`,
    `uncertainty_notice: ${uncertaintyNotice || "(none)"}`,
    "",
    coverageGapUser,
  ].join("\n");
}

function buildAdvisorBrainSystemPrompt(structuredMemory, coverageGapResult) {
  const { system: baseSystem } = buildCoverageGapExplanationPrompt(
    structuredMemory,
    coverageGapResult ?? { items: [], top_gaps: [], maintained_coverage: [] },
  );
  return [baseSystem, ADVISOR_BRAIN_EXTRA_SYSTEM_RULES].join("\n\n");
}

async function callAdvisorBrainClaude({
  system,
  user,
  fetchImpl = fetch,
  env = process.env,
  apiKey = resolveAnthropicApiKey(env),
}) {
  if (!apiKey) {
    return { ok: false, reason: "ANTHROPIC_NOT_CONFIGURED", message: null };
  }

  const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ADVISOR_BRAIN_MODEL,
      max_tokens: ADVISOR_BRAIN_MAX_TOKENS,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!response.ok) {
    return {
      ok: false,
      reason: "CLAUDE_API_ERROR",
      message: null,
      error_message: `Claude API error (${response.status})`,
    };
  }

  const data = await response.json();
  const text = Array.isArray(data?.content)
    ? data.content
        .filter((block) => block?.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim()
    : "";

  if (!text) {
    return { ok: false, reason: "CLAUDE_EMPTY_RESPONSE", message: null };
  }

  return { ok: true, message: text, model: data?.model ?? ADVISOR_BRAIN_MODEL };
}

export function sanitizeAdvisorBrainMessage(
  message,
  { hasPremiumEvidence = false, hasCoverageEvidence = false } = {},
) {
  const original = String(message ?? "").trim();
  if (!original) return original;

  const factCheck = assertNoUnsupportedFact(original, {
    hasPremiumEvidence,
    hasCoverageEvidence,
  });
  if (factCheck.ok) return original;

  let sanitized = original;
  sanitized = sanitized.replace(/반드시\s*가입\s*가능/gi, "확인 필요");
  sanitized = sanitized.replace(/100%\s*보장/gi, "확인 필요");
  sanitized = sanitized.replace(/확실히\s*받을\s*수\s*있/gi, "확인 필요");
  sanitized = sanitized.replace(/월\s*보험료\s*[:：]?\s*[\d,]+원?/gi, "월 보험료: 미확인");
  sanitized = sanitized.replace(/보험료는\s*[\d,]+원?/gi, "보험료: 미확인");

  const recheck = assertNoUnsupportedFact(sanitized, {
    hasPremiumEvidence,
    hasCoverageEvidence,
  });
  if (!recheck.ok) {
    return `${sanitized}\n\n일부 항목은 현재 등록 정보 기준으로 미확인이며, 증권 확인이 필요합니다.`;
  }

  return sanitized;
}

/**
 * Build Advisor Brain answer for coverage_gap_check (v1: tools + 1 Claude synthesis).
 */
export async function buildAdvisorBrainAnswer({
  supabase,
  customerId,
  question,
  classification,
  env = process.env,
  fetchImpl = fetch,
  sessionId = null,
  conversationId = null,
  preloadedContext = null,
  toolRun = runControlledAdvisorTools,
  claudeCall = callAdvisorBrainClaude,
} = {}) {
  if (!supabase || !customerId || !question) {
    return { ok: false, reason: "INVALID_INPUT", message: null, used_tools: [], evidence: [], audit: null };
  }

  if (classification?.intent !== "coverage_gap_check") {
    return { ok: false, reason: "INTENT_NOT_SUPPORTED", message: null, used_tools: [], evidence: [], audit: null };
  }

  try {
    const context =
      preloadedContext ?? (await createAdvisorBrainContext({ supabase, customerId }));

    const toolRunResult = await toolRun({
      supabase,
      customerId,
      classification,
      userMessage: question,
      sessionId,
      conversationId,
      allowedToolsOverride: COVERAGE_GAP_CHECK_ALLOWED_TOOLS,
      preloadedContext: context,
      fetchImpl,
      env,
    });

    const policiesData = pickToolData(toolRunResult.tool_results, "get_policies");
    const gapData = pickToolData(toolRunResult.tool_results, "get_coverage_gap");

    if (!policiesData && !gapData) {
      return {
        ok: false,
        reason: "TOOL_RESULTS_EMPTY",
        message: null,
        used_tools: toolRunResult.called_tools ?? [],
        evidence: [],
        audit: toolRunResult.audit_record ?? null,
      };
    }

    const policyCount = policiesData?.policy_count ?? context.policyCount ?? 0;
    const coverageGapResult = gapData ?? null;
    const structuredMemory =
      context.structuredMemory ??
      (context.snapshot ? buildStructuredMemoryProfile(context.snapshot) : { fact_count: 0 });

    const contradiction = detectContradictionBetweenPolicyCountAndGap({
      policyCount,
      coverageGapResult,
    });

    const uncertaintyNotice =
      toolRunResult.guardrail_summary?.uncertainty_notice ??
      buildUncertaintyNotice({
        contradictions: [contradiction],
        unknownItems: (policiesData?.policies ?? []).filter(
          (policy) => policy.advisor_guarded_ownership_status === "미확인",
        ),
        toolFailures: toolRunResult.tool_results.filter((result) => !result.ok),
      });

    const system = buildAdvisorBrainSystemPrompt(structuredMemory, coverageGapResult);
    const user = buildAdvisorBrainUserPrompt({
      question,
      policyCount,
      coverageGapResult,
      contradiction,
      uncertaintyNotice,
      structuredMemory,
    });

    const claudeResult = await claudeCall({ system, user, fetchImpl, env });
    if (!claudeResult.ok || !claudeResult.message) {
      return {
        ok: false,
        reason: claudeResult.reason ?? "CLAUDE_SYNTHESIS_FAILED",
        message: null,
        used_tools: toolRunResult.called_tools ?? [],
        evidence: summarizeUsedEvidence(toolRunResult.tool_results),
        audit: buildAdvisorAuditRecord({
          customerId,
          sessionId,
          conversationId,
          userMessage: question,
          classification,
          allowedTools: COVERAGE_GAP_CHECK_ALLOWED_TOOLS,
          toolResults: toolRunResult.tool_results,
          guardrailSummary: {
            ...toolRunResult.guardrail_summary,
            contradiction,
            uncertainty_notice: uncertaintyNotice,
          },
          finalCustomerText: null,
        }),
      };
    }

    const hasPremiumEvidence = Boolean(
      toolRunResult.tool_results.some(
        (result) => result.tool === "premium_lookup" && result.ok && result.data?.premiumKnownCount > 0,
      ),
    );
    const hasCoverageEvidence = Boolean(coverageGapResult?.items?.length);

    const sanitizedMessage = sanitizeAdvisorBrainMessage(claudeResult.message, {
      hasPremiumEvidence,
      hasCoverageEvidence,
    });

    const audit = buildAdvisorAuditRecord({
      customerId,
      sessionId,
      conversationId,
      userMessage: question,
      classification,
      allowedTools: COVERAGE_GAP_CHECK_ALLOWED_TOOLS,
      toolResults: toolRunResult.tool_results,
      guardrailSummary: {
        ...toolRunResult.guardrail_summary,
        contradiction,
        uncertainty_notice: uncertaintyNotice,
        unsupported_fact_sanitized: sanitizedMessage !== claudeResult.message,
      },
      finalCustomerText: sanitizedMessage,
    });

    return {
      ok: true,
      message: sanitizedMessage,
      used_tools: toolRunResult.called_tools ?? [],
      evidence: summarizeUsedEvidence(toolRunResult.tool_results),
      audit,
      guardrail_summary: {
        contradiction,
        uncertainty_notice: uncertaintyNotice,
      },
    };
  } catch (error) {
    return {
      ok: false,
      reason: "ADVISOR_BRAIN_FAILED",
      message: null,
      error_message: error instanceof Error ? error.message : "advisor_brain_failed",
      used_tools: [],
      evidence: [],
      audit: null,
    };
  }
}
