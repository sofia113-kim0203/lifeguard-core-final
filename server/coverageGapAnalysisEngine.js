const COVERAGE_ITEMS = [
  { type: "cancer", label: "암", keywords: ["암", "cancer", "진단비"], highPriority: true },
  { type: "brain", label: "뇌", keywords: ["뇌", "brain", "뇌혈관", "뇌졸중"], highPriority: true },
  { type: "heart", label: "심장", keywords: ["심장", "heart", "허혈", "급성심근경색"], highPriority: true },
  { type: "surgery", label: "수술", keywords: ["수술", "surgery"], highPriority: false },
  { type: "hospitalization", label: "입원", keywords: ["입원", "hospital", "hospitalization", "입원일당"], highPriority: false },
  { type: "medical_expense", label: "실손", keywords: ["실손", "medical expense", "indemnity", "실손의료비"], highPriority: true },
  { type: "death", label: "사망", keywords: ["사망", "death", "정기", "종신"], highPriority: false },
  { type: "disability", label: "장해", keywords: ["장해", "disability", "후유장해"], highPriority: false },
  { type: "driver", label: "운전자", keywords: ["운전자", "driver", "교통사고"], highPriority: false },
  { type: "dental", label: "치아", keywords: ["치아", "dental", "치과"], highPriority: false },
  { type: "dementia_care", label: "치매/간병", keywords: ["치매", "간병", "dementia", "care", "요양"], highPriority: true },
  { type: "family_protection", label: "가족 보장", keywords: ["가족", "family", "자녀", "배우자", "유족", "가족력"], highPriority: false },
  { type: "corporate_group", label: "법인/단체", keywords: ["법인", "단체", "group", "corporate", "단체보험"], highPriority: false },
];

const STATUS_SCORE = {
  missing: 12,
  insufficient: 8,
  unknown: 5,
  duplicate: 3,
  adequate: 0,
};

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

function evidenceBasis(facts) {
  const hasDocument = facts.some((fact) => fact?.source_table === "customer_documents" || fact?.source_table === "customer_document_chunks" || fact?.provenance_type === "document");
  const hasMemory = facts.length > 0;
  if (hasDocument && hasMemory) return "mixed";
  if (hasDocument) return "document";
  if (hasMemory) return "memory";
  return "unknown";
}

function hasReview(fact) {
  return fact?.metadata_json?.requires_agent_review === true || fact?.requires_agent_review === true;
}

function reviewPriority(fact) {
  return fact?.metadata_json?.review_priority ?? fact?.review_priority ?? "low";
}

function confidenceFor(status, facts) {
  if (facts.some((fact) => fact?.metadata_json?.memory_confidence === "low")) return "low";
  if (facts.some((fact) => hasReview(fact))) return "medium";
  if (status === "unknown") return "low";
  if (status === "missing") return "medium";
  return "high";
}

function matchesItem(item, fact) {
  const text = factText(fact);
  return item.keywords.some((keyword) => text.includes(normalize(keyword)));
}

function gapReasonCodesFor(status, item) {
  const codes = [];
  if (status === "missing") codes.push("memory_missing");
  else if (status === "insufficient") codes.push("memory_insufficient");
  else if (status === "adequate") codes.push("memory_adequate");
  else if (status === "duplicate") codes.push("memory_duplicate");
  else codes.push("memory_unknown");
  if (item.highPriority && (status === "missing" || status === "insufficient")) {
    codes.push("high_priority_category");
  }
  return codes;
}

function evidenceCodesFor(status, facts, requiresReview) {
  const codes = [];
  if (facts.some((fact) => fact?.metadata_json?.memory_confidence === "low")) {
    codes.push("memory_confidence_low");
  } else if (facts.some((fact) => hasReview(fact)) || status === "unknown") {
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

function classifyItem(item, facts) {
  const itemFacts = facts.filter((fact) => matchesItem(item, fact));
  const text = itemFacts.map(factText).join(" ");
  const count = itemFacts.length;
  let status = "unknown";

  if (/없|미보유|없음|부족|공백|필요/.test(text)) {
    status = text.includes("부족") ? "insufficient" : "missing";
  } else if (/중복|여러|2건|3건|복수/.test(text)) {
    status = "duplicate";
  } else if (/보유|유지|가입|충분|adequate|held/.test(text)) {
    status = "adequate";
  } else if (count >= 2) {
    status = "duplicate";
  }

  const severity = status === "missing" && item.highPriority
    ? "high"
    : status === "insufficient" && item.highPriority
      ? "high"
      : status === "missing" || status === "insufficient" || status === "duplicate"
        ? "medium"
        : "low";
  const requiresReview = itemFacts.some(hasReview) || status === "unknown" || status === "duplicate";

  return {
    coverage_type: item.type,
    status,
    severity,
    gap_reason_codes: gapReasonCodesFor(status, item),
    evidence_basis: evidenceBasis(itemFacts),
    confidence: confidenceFor(status, itemFacts),
    requires_agent_review: requiresReview,
    evidence_codes: evidenceCodesFor(status, itemFacts, requiresReview),
    evidence_fact_keys: itemFacts.map((fact) => fact.fact_key).filter(Boolean),
  };
}

function overallSeverity(gaps) {
  if (gaps.some((item) => item.severity === "high")) return "high";
  if (gaps.some((item) => item.severity === "medium")) return "medium";
  return "low";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function analyzeCoverageGaps({ customer_id = null, memory = [], generatedAt = new Date().toISOString() } = {}) {
  const facts = toArray(memory).filter(isActiveFact).filter((fact) => !isSmallTalk(fact));
  const coverage_gaps = COVERAGE_ITEMS.map((item) => classifyItem(item, facts));
  const duplicate_warnings = coverage_gaps.filter((item) => item.status === "duplicate");
  const unknown_items = coverage_gaps.filter((item) => item.status === "unknown");
  const agent_review_items = [
    ...coverage_gaps.filter((item) => item.requires_agent_review),
    ...facts
      .filter(hasReview)
      .map((fact) => ({
        fact_key: fact.fact_key,
        fact_type: fact.fact_type,
        review_status: fact.metadata_json?.review_status ?? fact.review_status ?? "pending",
        review_priority: reviewPriority(fact),
        review_reason: fact.metadata_json?.review_reason ?? fact.review_reason ?? [],
      })),
  ];

  const rawScore = coverage_gaps.reduce((sum, item) => sum + STATUS_SCORE[item.status], 0);
  const reviewPenalty = Math.min(agent_review_items.length * 2, 15);
  const gap_score = clamp(rawScore + reviewPenalty, 0, 100);

  return {
    customer_id,
    gap_score,
    overall_severity: overallSeverity(coverage_gaps),
    coverage_gaps,
    duplicate_warnings,
    unknown_items,
    agent_review_items,
    generated_at: generatedAt,
  };
}

export { COVERAGE_ITEMS };
