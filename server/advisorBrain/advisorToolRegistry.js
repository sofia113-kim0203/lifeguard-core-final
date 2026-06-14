/**
 * Advisor Brain P1 — Tool registry and intent-aware allowlist.
 * Does not activate Advisor Brain or alter existing customer response paths.
 */

export const ADVISOR_TOOL_NAMES = [
  "get_policies",
  "premium_lookup",
  "get_customer_memory",
  "get_coverage_gap",
  "get_underwriting",
  "search_policy_terms",
];

export const P2_BLOCKED_INTENTS = new Set(["recommendation_request", "design_request"]);

const TOOL_DEFINITIONS = {
  get_policies: {
    tool: "get_policies",
    description: "Load customer policy list from unified state (single load per turn).",
    source: "unified_customer_state",
  },
  premium_lookup: {
    tool: "premium_lookup",
    description: "Summarize premium-known vs premium-unknown policies.",
    source: "policy_explorer_stats",
  },
  get_customer_memory: {
    tool: "get_customer_memory",
    description: "Structured customer memory profile from snapshot.",
    source: "customer_memory_snapshot",
  },
  get_coverage_gap: {
    tool: "get_coverage_gap",
    description: "Coverage gap engine result (data only, no Claude).",
    source: "coverage_gap_engine",
  },
  get_underwriting: {
    tool: "get_underwriting",
    description: "Underwriting risk engine result (data only, no Claude).",
    source: "underwriting_engine",
  },
  search_policy_terms: {
    tool: "search_policy_terms",
    description: "Policy terms RAG retrieval (evidence only, no Claude answer).",
    source: "policy_terms_rag",
  },
};

export function getToolDefinition(toolName) {
  return TOOL_DEFINITIONS[toolName] ?? null;
}

export function listRegisteredTools() {
  return ADVISOR_TOOL_NAMES.map((name) => ({ ...TOOL_DEFINITIONS[name] }));
}

/**
 * Resolve allowed tools for a classifyConsultationIntent() result.
 * Reuses existing intent + lookup_sub_intent only — no new intents.
 */
export function resolveAllowedTools(classification = {}) {
  const intent = classification.intent ?? "general_consultation";
  const subIntent = classification.lookup_sub_intent ?? null;

  if (intent === "casual_chat") return [];
  if (P2_BLOCKED_INTENTS.has(intent)) return [];

  if (intent === "factual_lookup") {
    if (subIntent === "premium_lookup") return ["premium_lookup", "get_policies"];
    if (subIntent === "policy_count" || subIntent === "insurer") return ["get_policies"];
    if (subIntent === "coverage_presence") return ["get_policies", "get_coverage_gap"];
    return ["get_policies"];
  }

  if (intent === "policy_detail") return ["get_policies", "search_policy_terms"];
  if (intent === "coverage_gap_check" || intent === "coverage_review_request") {
    return ["get_policies", "get_coverage_gap"];
  }
  if (intent === "general_consultation") {
    return ["get_policies", "get_customer_memory", "get_coverage_gap"];
  }
  if (intent === "claim_eligibility_check") {
    return ["get_customer_memory", "get_policies", "search_policy_terms"];
  }

  return [];
}

export function isRegisteredTool(toolName) {
  return ADVISOR_TOOL_NAMES.includes(toolName);
}
