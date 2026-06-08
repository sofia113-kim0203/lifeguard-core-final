import { supabase } from "./supabase.js";

const ROUTE_PATH = "/api/customer-personalized-qa";

function mapServerError(payload, status) {
  if (payload?.error_message) return payload.error_message;
  if (payload?.reason === "UNAUTHORIZED") return "로그인이 필요합니다.";
  if (payload?.reason === "ANTHROPIC_NOT_CONFIGURED") return "서버에 Claude API 키가 설정되지 않았습니다.";
  if (status === 404) return "맞춤형 Q&A API 경로를 찾을 수 없습니다.";
  return "맞춤형 보험 답변을 처리하지 못했습니다.";
}

export async function askCustomerPersonalizedQuestion({ question, mode = "execute" } = {}) {
  const trimmed = String(question ?? "").trim();
  if (!trimmed) throw new Error("질문을 입력해 주세요.");

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData?.session?.access_token) {
    throw new Error("로그인이 필요합니다.");
  }

  const response = await fetch(ROUTE_PATH, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionData.session.access_token}`,
    },
    body: JSON.stringify({ question: trimmed, mode }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok && !payload?.blocked) {
    throw new Error(mapServerError(payload, response.status));
  }

  return {
    ok: payload.ok ?? false,
    blocked: payload.blocked ?? false,
    reason: payload.reason ?? null,
    question: payload.question ?? trimmed,
    answer: payload.answer ?? null,
    usedMemoryFacts: Array.isArray(payload.used_memory_facts) ? payload.used_memory_facts : [],
    memoryUsed: payload.memory_used ?? false,
    memoryVersion: payload.memory_version ?? 0,
    usedSources: Array.isArray(payload.used_sources) ? payload.used_sources : [],
    contextUsed: payload.context_used ?? false,
    insufficientContext: payload.insufficient_context ?? false,
    ragRowCount: payload.rag_row_count ?? 0,
    policyPdfId: payload.policy_pdf_id ?? null,
    knowledgeDocumentId: payload.knowledge_document_id ?? null,
    ingestStatus: payload.ingest_status ?? null,
    modelName: payload.model_name ?? null,
    provider: payload.provider ?? null,
    personalized: payload.personalized ?? true,
  };
}
