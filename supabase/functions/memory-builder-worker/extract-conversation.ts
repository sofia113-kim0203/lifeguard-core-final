import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { CONVERSATION_EXTRACTOR_VERSION } from "./config.ts";
import type { CandidateFact } from "./types.ts";

type ConversationMessage = {
  id: string;
  content: string;
  created_at: string;
};

type ConversationExtractResult = {
  facts: CandidateFact[];
  skipped: boolean;
  skip_reason?: string;
};

const REQUIRED_CONSENTS = ["ai_consultation", "memory_retention"] as const;
const MAX_MESSAGES = 20;
const VAGUE_MEMORY_PATTERN = /(아마|아마도|maybe|probably|I think|제 생각|같아|같아요|같은데|잘 모르|모르겠|확실하지|예전에|전에|used to|not sure|기억이 안)/i;

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function reviewPriority(current: "low" | "medium" | "high", next: "low" | "medium" | "high"): "low" | "medium" | "high" {
  const rank = { low: 0, medium: 1, high: 2 };
  return rank[next] > rank[current] ? next : current;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function buildReviewMetadata(params: {
  factKey: string;
  factType: CandidateFact["fact_type"];
  factValue: string;
  sourceText: string;
  conflictsWithExisting?: boolean;
}): Record<string, unknown> {
  const reasons: string[] = [];
  let priority: "low" | "medium" | "high" = "low";
  const haystack = `${params.factKey} ${params.factType} ${params.factValue} ${params.sourceText}`;

  if (VAGUE_MEMORY_PATTERN.test(params.sourceText) || VAGUE_MEMORY_PATTERN.test(params.factValue)) {
    reasons.push("vague_customer_statement");
    priority = reviewPriority(priority, "high");
  }

  if (params.factType === "health" || /복용|병력|수술|입원|치료|고혈압|당뇨/.test(haystack)) {
    reasons.push("health_memory_requires_review");
    priority = reviewPriority(priority, "high");
  }

  if (/insurance\.|실손|보장|담보|특약|가입|심사|청구|보험금/.test(haystack)) {
    reasons.push("insurance_review_required");
    priority = reviewPriority(priority, "medium");
  }

  if (params.conflictsWithExisting) {
    reasons.push("memory_conflict");
    priority = reviewPriority(priority, "high");
  }

  const reviewReason = unique(reasons);
  return {
    requires_agent_review: reviewReason.length > 0,
    review_reason: reviewReason,
    review_status: reviewReason.length > 0 ? "pending" : "approved",
    review_priority: reviewReason.length > 0 ? priority : "low",
    memory_confidence: reviewReason.includes("vague_customer_statement") ? "low" : reviewReason.length > 0 ? "medium" : "high",
  };
}

function buildMetadata(params: {
  sourceRecordId: string;
  category: string;
  pattern: string;
  review: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    consent_type: "ai_consultation",
    secondary_consent_type: "memory_retention",
    source_table: "consultation_messages",
    source_record_id: params.sourceRecordId,
    extractor_version: CONVERSATION_EXTRACTOR_VERSION,
    extractor_scope: "conversation",
    category: params.category,
    pattern: params.pattern,
    no_llm_generated: true,
    no_raw_transcript: true,
    ...params.review,
  };
}

function fact(params: {
  customerId: string;
  key: string;
  value: string;
  type: CandidateFact["fact_type"];
  importance: CandidateFact["importance"];
  sourceRecordId: string;
  category: string;
  pattern: string;
  sourceText: string;
}): CandidateFact {
  return {
    customer_id: params.customerId,
    fact_key: params.key,
    fact_value: params.value,
    fact_type: params.type,
    importance: params.importance,
    source_table: "consultation_messages",
    source_record_id: params.sourceRecordId,
    confidence: 1.0,
    metadata_json: buildMetadata({
      sourceRecordId: params.sourceRecordId,
      category: params.category,
      pattern: params.pattern,
      review: buildReviewMetadata({
        factKey: params.key,
        factType: params.type,
        factValue: params.value,
        sourceText: params.sourceText,
      }),
    }),
  };
}

async function hasRequiredConsent(admin: SupabaseClient, customerId: string): Promise<{ ok: boolean; missing?: string }> {
  for (const consentType of REQUIRED_CONSENTS) {
    const { data, error } = await admin.rpc("lifeguard_has_consent", {
      p_customer_id: customerId,
      p_consent_type: consentType,
    });
    if (error || data !== true) return { ok: false, missing: consentType };
  }
  return { ok: true };
}

function setLatest(facts: Map<string, CandidateFact>, candidate: CandidateFact): void {
  if (!facts.has(candidate.fact_key)) facts.set(candidate.fact_key, candidate);
}

function extractBudget(text: string): string | null {
  const match = text.match(/(?:보험료|월\s*보험료).{0,16}?(\d{1,3})\s*만?원\s*(?:이하|까지|정도|원함|희망|생각)/);
  if (!match) return null;
  return `월 보험료 ${match[1]}만원 이하를 선호합니다.`;
}

function extractMedication(text: string): string | null {
  if (/고혈압.{0,14}(약|치료제).{0,14}(먹|복용|먹었|복용했)|혈압약.{0,14}(먹|복용|먹었|복용했)/.test(text)) {
    return "고객은 혈압약을 복용 중이라고 명시했습니다.";
  }
  if (/당뇨.{0,14}(약|치료제).{0,14}(먹|복용|먹었|복용했)|당뇨약.{0,14}(먹|복용|먹었|복용했)/.test(text)) {
    return "고객은 당뇨약을 복용 중이라고 명시했습니다.";
  }
  return null;
}

function extractFactsFromMessage(customerId: string, message: ConversationMessage): CandidateFact[] {
  const text = cleanText(message.content);
  const facts: CandidateFact[] = [];
  const budget = extractBudget(text);
  if (budget) {
    facts.push(fact({
      customerId,
      key: "preference.monthly_budget",
      value: budget,
      type: "preference",
      importance: "high",
      sourceRecordId: message.id,
      category: "preference",
      pattern: "monthly_budget",
      sourceText: text,
    }));
  }

  if (/실손.{0,12}(유지|계속|남겨|가져가)/.test(text)) {
    facts.push(fact({
      customerId,
      key: "preference.keep_indemnity",
      value: "고객은 실손보험을 유지하고 싶다고 명시했습니다.",
      type: "preference",
      importance: "high",
      sourceRecordId: message.id,
      category: "preference",
      pattern: "keep_indemnity",
      sourceText: text,
    }));
  }

  if (/은퇴.{0,20}(걱정|불안|고민)|노후.{0,20}(걱정|불안|고민)/.test(text)) {
    facts.push(fact({
      customerId,
      key: "concern.retirement",
      value: "고객은 은퇴 또는 노후 준비를 걱정한다고 명시했습니다.",
      type: "risk",
      importance: "medium",
      sourceRecordId: message.id,
      category: "concern",
      pattern: "retirement_concern",
      sourceText: text,
    }));
  }

  if (/은퇴.{0,20}(준비|목표|계획|하고 싶)|노후.{0,20}(준비|목표|계획|하고 싶)/.test(text)) {
    facts.push(fact({
      customerId,
      key: "goal.retirement_preparation",
      value: "고객은 은퇴 또는 노후 준비를 상담 목표로 명시했습니다.",
      type: "preference",
      importance: "medium",
      sourceRecordId: message.id,
      category: "goal",
      pattern: "retirement_goal",
      sourceText: text,
    }));
  }

  const medication = extractMedication(text);
  if (medication) {
    facts.push(fact({
      customerId,
      key: "health.medication.summary",
      value: medication,
      type: "health",
      importance: "critical",
      sourceRecordId: message.id,
      category: "explicit_health",
      pattern: "medication_statement",
      sourceText: text,
    }));
  }

  return facts;
}

function buildConsultationSummary(customerId: string, facts: CandidateFact[]): CandidateFact | null {
  if (facts.length === 0) return null;
  const sourceRecordId = facts[0].source_record_id;
  const categories = Array.from(new Set(facts.map((row) => String(row.metadata_json.category))));
  const labels = categories.map((category) => {
    if (category === "preference") return "선호";
    if (category === "goal") return "목표";
    if (category === "concern") return "우려";
    if (category === "explicit_health") return "명시 건강정보";
    return category;
  });
  return fact({
    customerId,
    key: "consultation.latest_summary",
    value: `최근 상담에서 고객은 ${labels.join(", ")}를 명시했습니다.`,
    type: "preference",
    importance: "low",
    sourceRecordId,
    category: "consultation",
    pattern: "latest_summary",
    sourceText: facts.map((row) => row.fact_value).join(" "),
  });
}


async function markMemoryConflicts(
  admin: SupabaseClient,
  customerId: string,
  facts: CandidateFact[],
): Promise<CandidateFact[]> {
  if (facts.length === 0) return facts;

  const { data, error } = await admin
    .from("customer_memory_facts")
    .select("fact_key, fact_value")
    .eq("customer_id", customerId)
    .in("fact_key", facts.map((row) => row.fact_key))
    .is("superseded_at", null);

  if (error) {
    throw new Error(`conversation_memory_conflict_lookup_failed: ${error.message}`);
  }

  const existingByKey = new Map((data ?? []).map((row) => [row.fact_key, row.fact_value]));
  return facts.map((candidate) => {
    const existingValue = existingByKey.get(candidate.fact_key);
    if (!existingValue || existingValue === candidate.fact_value) return candidate;

    const reviewReason = unique([
      ...((candidate.metadata_json.review_reason as string[] | undefined) ?? []),
      "memory_conflict",
    ]);
    return {
      ...candidate,
      metadata_json: {
        ...candidate.metadata_json,
        requires_agent_review: true,
        review_reason: reviewReason,
        review_status: "pending",
        review_priority: "high",
        memory_confidence: "low",
      },
    };
  });
}

export async function extractConversationFacts(
  admin: SupabaseClient,
  customerId: string,
): Promise<ConversationExtractResult> {
  const consent = await hasRequiredConsent(admin, customerId);
  if (!consent.ok) {
    return {
      facts: [],
      skipped: true,
      skip_reason: `consent_missing:${consent.missing}`,
    };
  }

  const { data, error } = await admin
    .from("consultation_messages")
    .select("id, content, created_at")
    .eq("customer_id", customerId)
    .eq("role", "user")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(MAX_MESSAGES);

  if (error) {
    throw new Error(`conversation_messages_lookup_failed: ${error.message}`);
  }

  const byKey = new Map<string, CandidateFact>();
  for (const message of (data ?? []) as ConversationMessage[]) {
    for (const candidate of extractFactsFromMessage(customerId, message)) {
      setLatest(byKey, candidate);
    }
  }

  const facts = await markMemoryConflicts(admin, customerId, Array.from(byKey.values()));
  const summary = buildConsultationSummary(customerId, facts);
  if (summary) facts.push(summary);

  return { facts, skipped: false };
}
