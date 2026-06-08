import { supabase } from "./supabase.js";
import { loadCustomerDashboardData } from "./customerDashboard.js";
import { askCustomerPersonalizedQuestion } from "./customerPersonalizedQa.js";
import { toCustomerErrorMessage } from "./uiLocale.js";

export const CONVERSATION_ROLES = ["user", "assistant", "system"];

const DEFAULT_LIMIT = 100;

export function normalizeConversationMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    customerId: row.customer_id,
    role: row.role,
    message: row.message,
    metadata: row.metadata_json ?? {},
    createdAt: row.created_at,
  };
}

export async function resolveCustomerId(authUser) {
  const dashboard = await loadCustomerDashboardData(authUser);
  if (!dashboard.customerId) {
    throw new Error("고객 프로필을 찾을 수 없습니다.");
  }
  return dashboard.customerId;
}

export async function loadCustomerConversations(authUser, { limit = DEFAULT_LIMIT } = {}) {
  const customerId = await resolveCustomerId(authUser);

  const { data, error } = await supabase
    .from("customer_conversations")
    .select("id, customer_id, role, message, metadata_json, created_at")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(toCustomerErrorMessage(error, "대화 기록을 불러오지 못했습니다."));
  }

  return (data ?? []).map(normalizeConversationMessage);
}

async function insertConversationMessage(customerId, { role, message, metadata = {} }) {
  const trimmed = message?.trim();
  if (!trimmed) {
    throw new Error("메시지를 입력해 주세요.");
  }

  if (!CONVERSATION_ROLES.includes(role)) {
    throw new Error("유효하지 않은 대화 역할입니다.");
  }

  const { data, error } = await supabase
    .from("customer_conversations")
    .insert({
      customer_id: customerId,
      role,
      message: trimmed,
      metadata_json: metadata,
    })
    .select("id, customer_id, role, message, metadata_json, created_at")
    .single();

  if (error) {
    throw new Error(toCustomerErrorMessage(error, "메시지를 저장하지 못했습니다."));
  }

  return normalizeConversationMessage(data);
}

export async function sendCustomerConversationMessage(authUser, message) {
  const customerId = await resolveCustomerId(authUser);

  const userMessage = await insertConversationMessage(customerId, {
    role: "user",
    message,
    metadata: { source: "customer_dashboard", phase: "phase26-1a" },
  });

  const qaResult = await askCustomerPersonalizedQuestion({ question: message });

  const assistantMetadata = {
    source: "customer_personalized_qa",
    phase: "phase26-1a",
    policy_pdf_id: qaResult?.policyPdfId ?? null,
    knowledge_document_id: qaResult?.knowledgeDocumentId ?? null,
    ingest_status: qaResult?.ingestStatus ?? null,
    used_sources: qaResult?.usedSources ?? [],
    context_used: qaResult?.contextUsed ?? false,
    insufficient_context: qaResult?.insufficientContext ?? false,
    rag_row_count: qaResult?.ragRowCount ?? 0,
    blocked: qaResult?.blocked ?? false,
    reason: qaResult?.reason ?? null,
    model_name: qaResult?.modelName ?? null,
    provider: qaResult?.provider ?? null,
    claude_skipped: qaResult?.claudeSkipped ?? false,
    memory_used: qaResult?.memoryUsed ?? false,
    memory_version: qaResult?.memoryVersion ?? 0,
    used_memory_facts: qaResult?.usedMemoryFacts ?? [],
    personalized: qaResult?.personalized ?? true,
  };

  const assistantText =
    qaResult?.answer?.trim() || "약관 Q&A 응답을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.";

  const assistantMessage = await insertConversationMessage(customerId, {
    role: "assistant",
    message: assistantText,
    metadata: assistantMetadata,
  });

  return { userMessage, assistantMessage, qaResult };
}
