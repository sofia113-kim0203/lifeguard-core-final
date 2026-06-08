import { supabase } from "./supabase.js";

const ROUTE_PATH = "/api/policy-terms-qa";

function mapServerError(payload, status) {
  if (payload?.error_message) return payload.error_message;
  if (payload?.reason === "OPENAI_NOT_CONFIGURED") {
    return "서버에 OpenAI API 키가 설정되지 않았습니다.";
  }
  if (payload?.reason === "ANTHROPIC_NOT_CONFIGURED") {
    return "서버에 Claude API 키가 설정되지 않았습니다.";
  }
  if (payload?.reason === "INVALID_BODY") return "요청 본문이 올바르지 않습니다.";
  if (payload?.reason === "UNAUTHORIZED") return "로그인이 필요합니다.";
  if (status === 404) {
    return "약관 Q&A API 경로를 찾을 수 없습니다. 서버 라우트 배포를 확인해 주세요.";
  }
  return "약관 Q&A를 처리하지 못했습니다.";
}

export function normalizePolicyTermsQaResponse(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  return {
    ok: data.ok ?? false,
    blocked: data.blocked ?? false,
    reason: data.reason ?? null,
    question: data.question ?? null,
    answer: data.answer ?? null,
    usedSources: Array.isArray(data.used_sources) ? data.used_sources : [],
    contextUsed: data.context_used ?? false,
    insufficientContext: data.insufficient_context ?? false,
    ragRowCount: data.rag_row_count ?? 0,
    policyPdfId: data.policy_pdf_id ?? null,
    knowledgeDocumentId: data.knowledge_document_id ?? null,
    ingestStatus: data.ingest_status ?? null,
    modelName: data.model_name ?? null,
    provider: data.provider ?? null,
    claudeSkipped: data.claude_skipped ?? false,
    raw: data,
  };
}

export async function askPolicyTermsQuestion({
  question,
  policyPdfId = null,
  knowledgeDocumentId = null,
  mode = "execute",
}) {
  const headers = { "Content-Type": "application/json" };
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const response = await fetch(ROUTE_PATH, {
    method: "POST",
    headers,
    body: JSON.stringify({
      question,
      mode,
      policy_pdf_id: policyPdfId,
      knowledge_document_id: knowledgeDocumentId,
    }),
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok || payload.ok === false) {
    throw new Error(mapServerError(payload, response.status));
  }

  return normalizePolicyTermsQaResponse(payload);
}
