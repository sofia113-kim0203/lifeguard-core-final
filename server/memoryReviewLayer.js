const VAGUE_MEMORY_PATTERN = /(아마|아마도|maybe|probably|I think|제 생각|같아|같아요|같은데|잘 모르|모르겠|확실하지|예전에|전에|used to|not sure|기억이 안)/i;

const HIGH_RISK_FACT_PATTERNS = [
  { reason: "health_memory_requires_review", priority: "high", pattern: /^(health\.|medical\.)|복용|병력|수술|입원|치료|고혈압|당뇨/ },
  { reason: "insurance_review_required", priority: "medium", pattern: /^insurance\.|실손|보장|담보|특약|가입|심사|청구|보험금/ },
  { reason: "underwriting_sensitive_memory", priority: "high", pattern: /가입|심사|인수|부담보|할증|거절|고지/ },
];

const REVIEW_PRIORITY_RANK = { low: 0, medium: 1, high: 2 };

function maxPriority(left = "low", right = "low") {
  return REVIEW_PRIORITY_RANK[right] > REVIEW_PRIORITY_RANK[left] ? right : left;
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function hasVagueMemoryWording(text) {
  return VAGUE_MEMORY_PATTERN.test(String(text ?? ""));
}

export function assessMemoryReviewCandidate(candidate, context = {}) {
  const factKey = String(candidate?.fact_key ?? "");
  const factType = String(candidate?.fact_type ?? "");
  const factValue = String(candidate?.fact_value ?? "");
  const sourceText = String(context.sourceText ?? "");
  const haystack = [factKey, factType, factValue, sourceText].join(" ");
  const reasons = [];
  let priority = "low";

  if (hasVagueMemoryWording(sourceText) || hasVagueMemoryWording(factValue)) {
    reasons.push("vague_customer_statement");
    priority = maxPriority(priority, "high");
  }

  for (const entry of HIGH_RISK_FACT_PATTERNS) {
    if (entry.pattern.test(haystack)) {
      reasons.push(entry.reason);
      priority = maxPriority(priority, entry.priority);
    }
  }

  if (context.conflictsWithExisting === true) {
    reasons.push("memory_conflict");
    priority = maxPriority(priority, "high");
  }

  if (context.documentBacked === true) {
    const filtered = reasons.filter((reason) => reason !== "insurance_review_required");
    return {
      requires_agent_review: filtered.length > 0,
      review_reason: unique(filtered),
      review_status: filtered.length > 0 ? "pending" : "approved",
      review_priority: filtered.length > 0 ? priority : "low",
      memory_confidence: filtered.length > 0 ? "medium" : "high",
    };
  }

  const reviewReasons = unique(reasons);
  return {
    requires_agent_review: reviewReasons.length > 0,
    review_reason: reviewReasons,
    review_status: reviewReasons.length > 0 ? "pending" : "approved",
    review_priority: reviewReasons.length > 0 ? priority : "low",
    memory_confidence: reviewReasons.includes("vague_customer_statement") ? "low" : reviewReasons.length > 0 ? "medium" : "high",
  };
}

export function addMemoryReviewMetadata(candidate, context = {}) {
  const review = assessMemoryReviewCandidate(candidate, context);
  return {
    ...candidate,
    metadata_json: {
      ...(candidate?.metadata_json ?? {}),
      ...review,
    },
  };
}

export function assessAnswerReview({ answerBasis, riskFlags = [], usedMemoryFacts = [], usedSources = [] } = {}) {
  const flags = unique(riskFlags);
  const memoryOnly = answerBasis === "memory_only";
  const hasDocument = (usedSources ?? []).length > 0;
  const sensitiveFlags = flags.filter((flag) => [
    "underwriting_possible",
    "claim_payment_possible",
    "disclosure_duty",
    "health_underwriting",
    "coverage_terms",
  ].includes(flag));

  const reasons = [];
  let priority = "low";
  if (memoryOnly && sensitiveFlags.length > 0) {
    reasons.push("memory_only_sensitive_insurance_question");
    priority = maxPriority(priority, "high");
  }
  if (!hasDocument && flags.some((flag) => ["underwriting_possible", "claim_payment_possible", "disclosure_duty", "health_underwriting"].includes(flag))) {
    reasons.push("no_document_backing_for_high_risk_answer");
    priority = maxPriority(priority, "high");
  }
  if ((usedMemoryFacts ?? []).some((fact) => fact.fact_type === "health")) {
    reasons.push("health_memory_used_in_insurance_answer");
    priority = maxPriority(priority, "high");
  }

  const reviewReasons = unique(reasons);
  return {
    requires_agent_review: reviewReasons.length > 0,
    review_reason: reviewReasons,
    review_priority: reviewReasons.length > 0 ? priority : "low",
    review_status: reviewReasons.length > 0 ? "pending" : "approved",
  };
}
