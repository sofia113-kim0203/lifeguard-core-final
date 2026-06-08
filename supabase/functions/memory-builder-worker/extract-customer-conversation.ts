import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { CUSTOMER_CONVERSATION_EXTRACTOR_VERSION } from "./config.ts";
import type { CandidateFact } from "./types.ts";
import { truncate } from "./utils.ts";

type ConversationRow = {
  id: string;
  message: string;
  created_at: string;
};

const REQUIRED_CONSENTS = ["ai_consultation", "memory_retention"] as const;
const MAX_MESSAGES = 30;

const CHITCHAT_PATTERNS = [
  /^안녕/,
  /^반갑/,
  /^하이$/,
  /^hello$/i,
  /^thanks?$/i,
  /^감사/,
  /^고마워/,
  /^수고/,
  /^잘\s*가/,
  /^bye$/i,
  /^ㅎㅇ/,
];

const INSURANCE_FACT_PATTERNS = [
  /보험|실손|암|담보|특약|가입|보장|보험료|예산|병력|약|복용|고지|가족|은퇴|노후|청구|해지|변경/,
];

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isChitchat(text: string): boolean {
  const normalized = cleanText(text);
  if (!normalized) return true;
  if (normalized.length <= 8 && CHITCHAT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }
  return false;
}

function isInsuranceRelevant(text: string): boolean {
  return INSURANCE_FACT_PATTERNS.some((pattern) => pattern.test(text));
}

function buildMetadata(params: {
  sourceRecordId: string;
  category: string;
  pattern: string;
}): Record<string, unknown> {
  return {
    consent_type: "ai_consultation",
    secondary_consent_type: "memory_retention",
    source_table: "customer_conversations",
    source_record_id: params.sourceRecordId,
    extractor_version: CUSTOMER_CONVERSATION_EXTRACTOR_VERSION,
    extractor_scope: "customer_conversation",
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
    source_table: "customer_conversations",
    source_record_id: params.sourceRecordId,
    confidence: 1.0,
    metadata_json: buildMetadata({
      sourceRecordId: params.sourceRecordId,
      category: params.category,
      pattern: params.pattern,
    }),
  };
}

async function hasRequiredConsent(
  admin: SupabaseClient,
  customerId: string,
): Promise<{ ok: boolean; missing?: string }> {
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
  const match = text.match(/(?:보험료|월\s*보험료|예산).{0,16}?(\d{1,3})\s*만?원/);
  if (!match) return null;
  return `월 보험 예산 ${match[1]}만원`;
}

function extractMedication(text: string): string | null {
  if (/혈압약|고혈압.{0,8}(약|치료)/.test(text)) return "혈압약 복용";
  if (/당뇨.{0,8}(약|치료)|당뇨약/.test(text)) return "당뇨약 복용";
  return null;
}

function extractFactsFromMessage(customerId: string, row: ConversationRow): CandidateFact[] {
  const text = cleanText(row.message);
  if (isChitchat(text) || !isInsuranceRelevant(text)) return [];

  const facts: CandidateFact[] = [];
  const budget = extractBudget(text);
  if (budget) {
    facts.push(fact({
      customerId,
      key: "preference.monthly_budget",
      value: budget,
      type: "preference",
      importance: "high",
      sourceRecordId: row.id,
      category: "preference",
      pattern: "monthly_budget",
    }));
  }

  if (/실손.{0,12}(유지|가입|보유|있)/.test(text)) {
    facts.push(fact({
      customerId,
      key: "insurance.indemnity.held",
      value: "실손보험 보유/유지 의사",
      type: "insurance",
      importance: "high",
      sourceRecordId: row.id,
      category: "insurance",
      pattern: "indemnity_intent",
    }));
  }

  if (/암보험|암\s*진단|암보장/.test(text)) {
    facts.push(fact({
      customerId,
      key: "preference.cancer_coverage_interest",
      value: "암보험/암진단비 관심",
      type: "preference",
      importance: "medium",
      sourceRecordId: row.id,
      category: "goal",
      pattern: "cancer_interest",
    }));
  }

  if (/가족력|부모.{0,8}(암|당뇨|고혈압)|가족.{0,8}병력/.test(text)) {
    facts.push(fact({
      customerId,
      key: "health.family_history.summary",
      value: truncate(text, 120),
      type: "health",
      importance: "high",
      sourceRecordId: row.id,
      category: "health",
      pattern: "family_history",
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
      sourceRecordId: row.id,
      category: "health",
      pattern: "medication_statement",
    }));
  }

  if (/보장.{0,8}(부족|걱정)|담보.{0,8}부족/.test(text)) {
    facts.push(fact({
      customerId,
      key: "concern.coverage_gap",
      value: "보장 부족 우려",
      type: "risk",
      importance: "high",
      sourceRecordId: row.id,
      category: "concern",
      pattern: "coverage_gap",
    }));
  }

  if (/가입.{0,8}(의사|하고 싶|희망)|보험.{0,8}가입/.test(text)) {
    facts.push(fact({
      customerId,
      key: "preference.enrollment_intent",
      value: "보험 가입 의사",
      type: "preference",
      importance: "high",
      sourceRecordId: row.id,
      category: "goal",
      pattern: "enrollment_intent",
    }));
  }

  if (/해지|변경|갈아타|리모델링/.test(text)) {
    facts.push(fact({
      customerId,
      key: "preference.policy_change_request",
      value: truncate(text, 100),
      type: "preference",
      importance: "medium",
      sourceRecordId: row.id,
      category: "preference",
      pattern: "policy_change",
    }));
  }

  return facts;
}

export async function extractCustomerConversationFacts(
  admin: SupabaseClient,
  customerId: string,
): Promise<{ facts: CandidateFact[]; skipped: boolean; skip_reason?: string }> {
  const consent = await hasRequiredConsent(admin, customerId);
  if (!consent.ok) {
    return {
      facts: [],
      skipped: true,
      skip_reason: `consent_missing:${consent.missing}`,
    };
  }

  const { data, error } = await admin
    .from("customer_conversations")
    .select("id, message, created_at")
    .eq("customer_id", customerId)
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(MAX_MESSAGES);

  if (error) {
    throw new Error(`customer_conversations_lookup_failed: ${error.message}`);
  }

  const byKey = new Map<string, CandidateFact>();
  for (const row of (data ?? []) as ConversationRow[]) {
    for (const candidate of extractFactsFromMessage(customerId, row)) {
      setLatest(byKey, candidate);
    }
  }

  return { facts: Array.from(byKey.values()), skipped: false };
}
