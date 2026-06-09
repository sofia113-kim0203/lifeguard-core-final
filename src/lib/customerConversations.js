import { supabase } from "./supabase.js";
import { loadCustomerDashboardData } from "./customerDashboard.js";
import { sendConversationalQuestion } from "./customerConversationalAnalysis.js";
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

export async function sendCustomerConversationMessage(authUser, message, { onAnalysisJob } = {}) {
  const conversationalResult = await sendConversationalQuestion({
    question: message,
    autoProcess: false,
  });

  if (typeof onAnalysisJob === "function") {
    onAnalysisJob({
      analysisJobId: conversationalResult.analysisJobId,
      analysisJob: conversationalResult.analysisJob,
      initialResponseTimeMs: conversationalResult.initialResponseTimeMs,
    });
  }

  const customerId = await resolveCustomerId(authUser);
  const { data, error } = await supabase
    .from("customer_conversations")
    .select("id, customer_id, role, message, metadata_json, created_at")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(2);

  if (error) {
    throw new Error(toCustomerErrorMessage(error, "대화 기록을 불러오지 못했습니다."));
  }

  const rows = (data ?? []).map(normalizeConversationMessage).reverse();
  const userMessage = rows.find((row) => row.role === "user") ?? null;
  const assistantMessage = rows.find((row) => row.role === "assistant") ?? null;

  return {
    userMessage,
    assistantMessage,
    conversationalResult,
    analysisJobId: conversationalResult.analysisJobId,
    initialResponseTimeMs: conversationalResult.initialResponseTimeMs,
  };
}
