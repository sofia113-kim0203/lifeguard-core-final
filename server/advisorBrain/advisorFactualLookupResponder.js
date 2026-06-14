/**
 * Advisor Brain P1 Step 3 — factual_lookup reasoning (tools → guardrails → Claude 1회, max_tokens 500).
 */
import { LOOKUP_CATEGORIES } from "../intentGateLayer.js";
import { buildAdvisorAuditRecord, summarizeUsedEvidence } from "./advisorAuditLog.js";
import { createAdvisorBrainContext } from "./advisorBrainContext.js";
import { buildUncertaintyNotice, sanitizeAdvisorBrainMessage } from "./advisorBrainGuardrails.js";
import { resolveAllowedTools } from "./advisorToolRegistry.js";
import { runControlledAdvisorTools } from "./advisorToolRunner.js";

export const FACTUAL_LOOKUP_ACTIVATABLE_SUB_INTENTS = new Set([
  "premium_lookup",
  "policy_count",
  "insurer",
  "coverage_presence",
]);

export const ADVISOR_BRAIN_FACTUAL_MAX_TOKENS = 500;

const FACTUAL_LOOKUP_SYSTEM_RULES = [
  "Answer factual lookup questions using ONLY the evidence JSON below.",
  "Keep answers short and direct in customer-friendly Korean (1-3 short paragraphs).",
  "미확인 is not the same as 미보유. Never treat missing or incomplete data as confirmed absence.",
  "Never assert premium amounts unless premiumTotal in evidence is a positive number.",
  "If premiumKnownCount is less than totalCount, explicitly mention how many contracts have unknown premium.",
  "For insurer answers, use insurer_name only. If insurer_name is null, say 확인 필요. Never use an insurer field.",
  "For coverage_presence, use lookup_category key and lookup_category_label. If policies exist but coverage_summary is incomplete, say 미확인 or 증권 확인 필요 — never 단정적으로 미보유.",
  "If lookup_category is null for coverage_presence, treat it as a general coverage check without a specific category name. Never conclude 미보유.",
  "Never assert enrollment eligibility or guaranteed claim payment without evidence.",
].join(" ");

export function isActivatableFactualLookupClassification(classification = {}) {
  return (
    classification.intent === "factual_lookup" &&
    FACTUAL_LOOKUP_ACTIVATABLE_SUB_INTENTS.has(classification.lookup_sub_intent)
  );
}

function pickToolData(toolResults, toolName) {
  return toolResults.find((result) => result.tool === toolName && result.ok)?.data ?? null;
}

function resolveLookupCategoryMeta(classification = {}) {
  const key = classification.lookup_category ?? null;
  const config = key ? LOOKUP_CATEGORIES[key] : null;
  return {
    lookup_category: key,
    lookup_category_label: config?.label ?? null,
  };
}

function buildInsurerSafePolicies(policies = []) {
  return policies.map((policy, index) => ({
    index: index + 1,
    insurer_name: policy.insurer_name ?? null,
    product_name: policy.product_name ?? null,
    advisor_guarded_ownership_status: policy.advisor_guarded_ownership_status ?? null,
    advisor_has_coverage_summary: policy.advisor_has_coverage_summary ?? null,
  }));
}

function buildPremiumEvidenceBlock(premiumData = null) {
  if (!premiumData) return null;

  const totalCount = Number(premiumData.totalCount ?? 0);
  const premiumKnownCount = Number(premiumData.premiumKnownCount ?? 0);
  const premiumUnknownCount = Number(premiumData.premiumUnknownCount ?? Math.max(0, totalCount - premiumKnownCount));
  const premiumTotal = Number(premiumData.premiumTotal ?? 0);

  return {
    totalCount,
    premiumKnownCount,
    premiumUnknownCount,
    premiumTotal: premiumTotal > 0 ? premiumTotal : null,
    premium_amount_assertion_allowed: premiumKnownCount > 0 && premiumTotal > 0,
    unknown_premium_notice:
      premiumKnownCount < totalCount && totalCount > 0
        ? `보험료 미확인 ${premiumUnknownCount}건`
        : null,
  };
}

function buildCoveragePresenceEvidenceBlock({
  classification,
  policiesData,
  gapData,
}) {
  const categoryMeta = resolveLookupCategoryMeta(classification);
  const policies = policiesData?.policies ?? [];
  const policiesWithoutSummary = policies.filter((policy) => policy.advisor_has_coverage_summary === false);

  const gapItems = Array.isArray(gapData?.items) ? gapData.items : [];
  const categoryGapItem = categoryMeta.lookup_category
    ? gapItems.find((item) => item.coverage_category === categoryMeta.lookup_category)
    : null;

  return {
    ...categoryMeta,
    general_coverage_presence_notice:
      categoryMeta.lookup_category == null
        ? "특정 보장명이 확인되지 않은 일반 보장 확인 질문입니다. 특정 카테고리를 단정하지 말고 미확인 또는 증권 확인 필요로 안내하세요."
        : null,
    policy_count: policiesData?.policy_count ?? policies.length,
    policies_without_coverage_summary_count: policiesWithoutSummary.length,
    incomplete_summary_notice:
      (policiesData?.policy_count ?? 0) > 0 && policiesWithoutSummary.length > 0
        ? "일부 계약은 coverage_summary가 부족하여 미보유로 단정하지 말고 미확인/증권 확인 필요로 안내"
        : null,
    category_gap_item: categoryGapItem,
    gap_items: gapItems,
  };
}

export function buildFactualLookupSystemPrompt() {
  return FACTUAL_LOOKUP_SYSTEM_RULES;
}

export function buildFactualLookupUserPrompt({
  question,
  classification,
  policiesData,
  premiumData,
  gapData,
  uncertaintyNotice,
}) {
  const subIntent = classification.lookup_sub_intent ?? null;
  const blocks = [
    "Answer the customer's factual lookup question using only the evidence blocks below.",
    "",
    `question: ${question}`,
    `intent: factual_lookup`,
    `lookup_sub_intent: ${subIntent}`,
    `uncertainty_notice: ${uncertaintyNotice || "(none)"}`,
    "",
  ];

  if (subIntent === "premium_lookup") {
    blocks.push("premium_evidence:");
    blocks.push(JSON.stringify(buildPremiumEvidenceBlock(premiumData), null, 2));
    blocks.push("");
    blocks.push("policies_evidence:");
    blocks.push(
      JSON.stringify(
        {
          policy_count: policiesData?.policy_count ?? 0,
          policies: buildInsurerSafePolicies(policiesData?.policies ?? []),
        },
        null,
        2,
      ),
    );
  } else if (subIntent === "policy_count") {
    blocks.push("policy_count_evidence:");
    blocks.push(
      JSON.stringify(
        {
          policy_count: policiesData?.policy_count ?? 0,
          policies: buildInsurerSafePolicies(policiesData?.policies ?? []),
          upload_gap_notice:
            "업로드되지 않은 증권이 있을 수 있으므로 계약 수를 단정할 때 조심스럽게 안내",
        },
        null,
        2,
      ),
    );
  } else if (subIntent === "insurer") {
    blocks.push("insurer_evidence:");
    blocks.push(
      JSON.stringify(
        {
          policy_count: policiesData?.policy_count ?? 0,
          insurers: Array.from(
            new Set(
              (policiesData?.policies ?? []).map((policy) => policy.insurer_name ?? "확인 필요"),
            ),
          ),
          policies: buildInsurerSafePolicies(policiesData?.policies ?? []),
        },
        null,
        2,
      ),
    );
  } else if (subIntent === "coverage_presence") {
    blocks.push("coverage_presence_evidence:");
    blocks.push(
      JSON.stringify(
        buildCoveragePresenceEvidenceBlock({
          classification,
          policiesData,
          gapData,
        }),
        null,
        2,
      ),
    );
    blocks.push("");
    blocks.push("policies_evidence:");
    blocks.push(
      JSON.stringify(
        {
          policy_count: policiesData?.policy_count ?? 0,
          policies: buildInsurerSafePolicies(policiesData?.policies ?? []),
        },
        null,
        2,
      ),
    );
  }

  return blocks.join("\n");
}

function hasMinimumFactualEvidence(classification, { policiesData, premiumData, gapData }) {
  const subIntent = classification.lookup_sub_intent;

  if (subIntent === "premium_lookup") {
    return Boolean(policiesData || premiumData);
  }
  if (subIntent === "policy_count" || subIntent === "insurer") {
    return Boolean(policiesData);
  }
  if (subIntent === "coverage_presence") {
    return Boolean(policiesData || gapData);
  }
  return false;
}

function resolveFactualSanitizeFlags({ classification, premiumData, gapData, policiesData }) {
  const premiumBlock = buildPremiumEvidenceBlock(premiumData);
  const hasPremiumEvidence = Boolean(premiumBlock?.premium_amount_assertion_allowed);

  let hasCoverageEvidence = Boolean(policiesData);
  if (classification.lookup_sub_intent === "coverage_presence") {
    hasCoverageEvidence =
      Boolean(gapData?.items?.length) ||
      Boolean((policiesData?.policies ?? []).some((policy) => policy.advisor_has_coverage_summary));
  }

  return { hasPremiumEvidence, hasCoverageEvidence };
}

/**
 * Build Advisor Brain answer for factual_lookup sub-intents (premium_lookup, policy_count, insurer, coverage_presence).
 */
export async function buildFactualLookupAdvisorBrainAnswer({
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
  claudeCall,
} = {}) {
  const allowedTools = resolveAllowedTools(classification);

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
      preloadedContext: context,
      fetchImpl,
      env,
    });

    const policiesData = pickToolData(toolRunResult.tool_results, "get_policies");
    const premiumData = pickToolData(toolRunResult.tool_results, "premium_lookup");
    const gapData = pickToolData(toolRunResult.tool_results, "get_coverage_gap");

    if (!hasMinimumFactualEvidence(classification, { policiesData, premiumData, gapData })) {
      return {
        ok: false,
        reason: "TOOL_RESULTS_EMPTY",
        message: null,
        used_tools: toolRunResult.called_tools ?? [],
        evidence: [],
        audit: toolRunResult.audit_record ?? null,
      };
    }

    const uncertaintyNotice =
      toolRunResult.guardrail_summary?.uncertainty_notice ??
      buildUncertaintyNotice({
        contradictions: [toolRunResult.guardrail_summary?.contradiction].filter(Boolean),
        unknownItems: (policiesData?.policies ?? []).filter(
          (policy) => policy.advisor_guarded_ownership_status === "미확인",
        ),
        toolFailures: toolRunResult.tool_results.filter((result) => !result.ok),
      });

    const system = buildFactualLookupSystemPrompt();
    const user = buildFactualLookupUserPrompt({
      question,
      classification,
      policiesData,
      premiumData,
      gapData,
      uncertaintyNotice,
    });

    const claudeResult = await claudeCall({
      system,
      user,
      maxTokens: ADVISOR_BRAIN_FACTUAL_MAX_TOKENS,
      fetchImpl,
      env,
    });

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
          allowedTools,
          toolResults: toolRunResult.tool_results,
          guardrailSummary: toolRunResult.guardrail_summary,
          finalCustomerText: null,
        }),
      };
    }

    const sanitizeFlags = resolveFactualSanitizeFlags({
      classification,
      premiumData,
      gapData,
      policiesData,
    });

    const sanitizedMessage = sanitizeAdvisorBrainMessage(claudeResult.message, sanitizeFlags);

    const audit = buildAdvisorAuditRecord({
      customerId,
      sessionId,
      conversationId,
      userMessage: question,
      classification,
      allowedTools,
      toolResults: toolRunResult.tool_results,
      guardrailSummary: {
        ...toolRunResult.guardrail_summary,
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
      guardrail_summary: toolRunResult.guardrail_summary ?? null,
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
