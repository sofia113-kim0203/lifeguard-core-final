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

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function buildMetadata(params: {
  sourceRecordId: string;
  category: string;
  pattern: string;
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
  if (/고혈압.{0,8}(약|치료제).{0,8}(먹|복용)|혈압약.{0,8}(먹|복용)/.test(text)) {
    return "고객은 혈압약을 복용 중이라고 명시했습니다.";
  }
  if (/당뇨.{0,8}(약|치료제).{0,8}(먹|복용)|당뇨약.{0,8}(먹|복용)/.test(text)) {
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

  const facts = Array.from(byKey.values());
  const summary = buildConsultationSummary(customerId, facts);
  if (summary) facts.push(summary);

  return { facts, skipped: false };
}
