/**
 * Advisor Brain P1 — Structured audit payload (no DB migration in this PR).
 */

export function summarizeToolResults(toolResults = []) {
  return (toolResults ?? []).map((result) => ({
    tool: result.tool,
    ok: Boolean(result.ok),
    confidence: result.confidence ?? "unknown",
    source: result.source ?? null,
    error: result.error ?? null,
    has_data: result.data != null,
  }));
}

export function summarizeUsedEvidence(toolResults = []) {
  const evidence = [];

  for (const result of toolResults ?? []) {
    if (!result?.ok || !result.data) continue;

    if (result.tool === "get_policies") {
      evidence.push({
        type: "policies",
        policy_count: result.data.policy_count ?? result.data.policies?.length ?? 0,
      });
    }
    if (result.tool === "premium_lookup") {
      evidence.push({
        type: "premium_stats",
        total_count: result.data.totalCount ?? null,
        premium_known_count: result.data.premiumKnownCount ?? null,
      });
    }
    if (result.tool === "get_customer_memory") {
      evidence.push({
        type: "customer_memory",
        fact_count: result.data.fact_count ?? result.data.total_fact_count ?? null,
      });
    }
    if (result.tool === "get_coverage_gap") {
      evidence.push({
        type: "coverage_gap",
        gap_score: result.data.gap_score ?? null,
        item_count: result.data.items?.length ?? 0,
      });
    }
    if (result.tool === "get_underwriting") {
      evidence.push({
        type: "underwriting",
        risk_score: result.data.risk_score ?? null,
      });
    }
    if (result.tool === "search_policy_terms") {
      evidence.push({
        type: "policy_terms_rag",
        rag_row_count: result.data.rag_row_count ?? 0,
        context_used: result.data.context_used ?? false,
      });
    }
  }

  return evidence;
}

/**
 * Build audit record for downstream persistence (future PR).
 */
export function buildAdvisorAuditRecord({
  customerId,
  sessionId = null,
  conversationId = null,
  userMessage = "",
  classification = {},
  allowedTools = [],
  toolResults = [],
  guardrailSummary = {},
  finalCustomerText = null,
  createdAt = new Date().toISOString(),
} = {}) {
  return {
    customer_id: customerId,
    session_id: sessionId,
    conversation_id: conversationId,
    user_message: String(userMessage ?? ""),
    selected_intent: classification.intent ?? null,
    lookup_sub_intent: classification.lookup_sub_intent ?? null,
    allowed_tools: [...(allowedTools ?? [])],
    called_tools: (toolResults ?? []).map((r) => r.tool),
    tool_result_status: summarizeToolResults(toolResults),
    used_evidence_summary: summarizeUsedEvidence(toolResults),
    guardrail_summary: guardrailSummary,
    final_customer_text: finalCustomerText,
    created_at: createdAt,
    storage_status: "payload_only_no_db_table",
  };
}
