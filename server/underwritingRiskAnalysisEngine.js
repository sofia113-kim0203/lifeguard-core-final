const RISK_DEFINITIONS = [
  { type: "hypertension", label: "고혈압", keywords: ["고혈압", "혈압약", "hypertension"], baseStatus: "medium", severity: "medium" },
  { type: "diabetes", label: "당뇨", keywords: ["당뇨", "당뇨약", "diabetes"], baseStatus: "high", severity: "high" },
  { type: "hyperlipidemia", label: "고지혈증", keywords: ["고지혈증", "지질", "콜레스테롤", "hyperlipidemia"], baseStatus: "medium", severity: "medium" },
  { type: "cancer_history", label: "암 이력", keywords: ["암", "cancer", "항암"], baseStatus: "high", severity: "high" },
  { type: "cardiovascular", label: "심장질환", keywords: ["심장", "심근경색", "협심증", "cardio", "heart"], baseStatus: "high", severity: "high" },
  { type: "cerebrovascular", label: "뇌혈관질환", keywords: ["뇌혈관", "뇌졸중", "뇌출혈", "cerebrovascular", "stroke"], baseStatus: "high", severity: "high" },
  { type: "surgery_history", label: "수술 이력", keywords: ["수술", "surgery"], baseStatus: "medium", severity: "medium" },
  { type: "hospitalization_history", label: "입원 이력", keywords: ["입원", "hospitalization", "hospital"], baseStatus: "medium", severity: "medium" },
  { type: "medication_history", label: "투약 이력", keywords: ["복용", "약", "medication", "medicine"], baseStatus: "medium", severity: "medium" },
  { type: "recent_diagnosis", label: "최근 진단", keywords: ["최근 진단", "진단받", "diagnosed", "diagnosis", "검진", "소견"], baseStatus: "high", severity: "high" },
  { type: "vague_health", label: "불확실 건강정보", keywords: ["아마", "같아", "모르겠", "확실하지", "maybe", "probably", "not sure", "used to"], baseStatus: "unknown", severity: "medium" },
];

const STATUS_SCORE = { none: 0, low: 5, medium: 12, high: 22, unknown: 8 };
const REVIEW_PRIORITY_RANK = { low: 0, medium: 1, high: 2 };

function normalize(value) {
  return String(value ?? "").toLowerCase();
}

function toArray(memorySnapshotOrFacts) {
  if (Array.isArray(memorySnapshotOrFacts)) return memorySnapshotOrFacts;
  if (Array.isArray(memorySnapshotOrFacts?.facts)) return memorySnapshotOrFacts.facts;
  if (Array.isArray(memorySnapshotOrFacts?.memory_facts)) return memorySnapshotOrFacts.memory_facts;
  return [];
}

function factText(fact) {
  return [fact?.fact_key, fact?.fact_type, fact?.fact_value, fact?.source_table]
    .map((value) => normalize(value))
    .join(" ");
}

function isActiveFact(fact) {
  return !fact?.superseded_at && !fact?.metadata_json?.revoked_at;
}

function isSmallTalk(fact) {
  return fact?.metadata_json?.category === "small_talk" || /날씨|점심|안녕|잡담/.test(String(fact?.fact_value ?? ""));
}

function isHealthRelevant(fact) {
  const text = factText(fact);
  return fact?.fact_type === "health" || /^health\./.test(String(fact?.fact_key ?? "")) || /고혈압|당뇨|수술|입원|복용|진단|검진|소견|심장|뇌혈관|고지혈증|암/.test(text);
}

function isDocumentFact(fact) {
  return fact?.source_table === "customer_documents" ||
    fact?.source_table === "customer_document_chunks" ||
    fact?.provenance_type === "document";
}

function evidenceBasis(facts) {
  const hasDocument = facts.some(isDocumentFact);
  const hasMemory = facts.some((fact) => !isDocumentFact(fact));
  if (hasDocument && hasMemory) return "mixed";
  if (hasDocument) return "document";
  if (hasMemory) return "memory";
  return "unknown";
}

function hasReview(fact) {
  return fact?.metadata_json?.requires_agent_review === true || fact?.requires_agent_review === true;
}

function reviewReasons(facts) {
  return Array.from(new Set(facts.flatMap((fact) => fact?.metadata_json?.review_reason ?? fact?.review_reason ?? [])));
}

function maxReviewPriority(facts) {
  return facts.reduce((current, fact) => {
    const priority = fact?.metadata_json?.review_priority ?? fact?.review_priority ?? "low";
    return REVIEW_PRIORITY_RANK[priority] > REVIEW_PRIORITY_RANK[current] ? priority : current;
  }, "low");
}

function memoryConfidence(status, facts) {
  if (facts.some((fact) => fact?.metadata_json?.memory_confidence === "low")) return "low";
  if (facts.some(hasReview)) return "medium";
  if (facts.some((fact) => evidenceBasis([fact]) === "document")) return "high";
  if (status === "unknown") return "low";
  return facts.length > 0 ? "medium" : "low";
}

function matchesDefinition(definition, fact) {
  const text = factText(fact);
  return definition.keywords.some((keyword) => text.includes(normalize(keyword)));
}

function healthRiskReasonCodes(definition, status, facts) {
  const codes = [];
  if (facts.length === 0) codes.push("health_memory_missing");
  else codes.push("health_memory_present");
  if (status === "unknown") codes.push("health_signal_uncertain");
  if (status === "high") codes.push("high_severity_health_risk");
  if (status === "medium") codes.push("elevated_health_risk");
  if (status === "low") codes.push("low_severity_health_risk");
  if (facts.some(hasReview)) codes.push("requires_agent_review");
  if (definition.type === "vague_health" && status === "unknown") codes.push("vague_health_signal");
  return codes;
}

function evidenceCodesForRisk(status, facts, requiresReview) {
  const codes = [];
  if (facts.some((fact) => fact?.metadata_json?.memory_confidence === "low")) {
    codes.push("memory_confidence_low");
  } else if (facts.some(hasReview) || status === "unknown") {
    codes.push("memory_confidence_medium");
  } else {
    codes.push("memory_confidence_high");
  }
  if (requiresReview) codes.push("requires_agent_review");
  const basis = evidenceBasis(facts);
  if (basis === "document") codes.push("evidence_basis_document");
  else if (basis === "memory") codes.push("evidence_basis_memory");
  else if (basis === "mixed") codes.push("evidence_basis_mixed");
  return codes;
}

function classifyRisk(definition, facts) {
  const matched = facts.filter((fact) => matchesDefinition(definition, fact));
  let status = matched.length > 0 ? definition.baseStatus : "none";
  if (matched.some((fact) => hasReview(fact) && (fact?.metadata_json?.memory_confidence === "low" || fact?.metadata_json?.review_reason?.includes("vague_customer_statement")))) {
    status = status === "none" ? "unknown" : status;
  }
  if (definition.type === "vague_health" && matched.length > 0) status = "unknown";

  const requiresAgentReview = matched.some(hasReview) || ["medium", "high", "unknown"].includes(status);
  return {
    risk_type: definition.type,
    status,
    severity: matched.length > 0 ? definition.severity : "low",
    health_risk_reason_codes: healthRiskReasonCodes(definition, status, matched),
    evidence_basis: evidenceBasis(matched),
    confidence: memoryConfidence(status, matched),
    requires_agent_review: requiresAgentReview,
    review_reason: reviewReasons(matched),
    evidence_codes: evidenceCodesForRisk(status, matched, requiresAgentReview),
    evidence_fact_keys: matched.map((fact) => fact.fact_key).filter(Boolean),
  };
}

function riskLevel(items) {
  if (items.some((item) => item.status === "high" || item.severity === "high")) return "high";
  if (items.some((item) => item.status === "medium" || item.status === "unknown")) return "medium";
  if (items.some((item) => item.status === "low")) return "low";
  return "unknown";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function analyzeUnderwritingRisk({ customer_id = null, memory = [], generatedAt = new Date().toISOString() } = {}) {
  const facts = toArray(memory).filter(isActiveFact).filter((fact) => !isSmallTalk(fact)).filter(isHealthRelevant);
  const health_risk_items = RISK_DEFINITIONS.map((definition) => classifyRisk(definition, facts));
  const unknown_items = health_risk_items.filter((item) => item.status === "unknown");
  const agent_review_items = [
    ...health_risk_items.filter((item) => item.requires_agent_review && item.evidence_fact_keys.length > 0),
    ...facts
      .filter(hasReview)
      .map((fact) => ({
        fact_key: fact.fact_key,
        fact_type: fact.fact_type,
        review_status: fact.metadata_json?.review_status ?? fact.review_status ?? "pending",
        review_priority: fact.metadata_json?.review_priority ?? fact.review_priority ?? "low",
        review_reason: fact.metadata_json?.review_reason ?? fact.review_reason ?? [],
      })),
  ];

  const rawScore = health_risk_items.reduce((sum, item) => sum + STATUS_SCORE[item.status], 0);
  const reviewPenalty = Math.min(agent_review_items.reduce((sum, item) => sum + (REVIEW_PRIORITY_RANK[item.review_priority] ?? 1), 0), 20);
  const risk_score = clamp(rawScore + reviewPenalty, 0, 100);

  return {
    customer_id,
    risk_score,
    underwriting_risk_level: riskLevel(health_risk_items),
    risk_flags: health_risk_items.filter((item) => item.status !== "none").map((item) => item.risk_type),
    health_risk_items,
    unknown_items,
    agent_review_items,
    generated_at: generatedAt,
  };
}

export { RISK_DEFINITIONS };
