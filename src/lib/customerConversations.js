import { supabase } from "./supabase.js";
import { loadCustomerDashboardData } from "./customerDashboard.js";
import { sendConversationalQuestion } from "./customerConversationalAnalysis.js";
import { toCustomerErrorMessage } from "./uiLocale.js";

export const CONVERSATION_ROLES = ["user", "assistant", "system"];
export const CONVERSATION_LOAD_TIMEOUT_MS = 12_000;

const DEFAULT_LIMIT = 100;

async function ensureAuthSessionReady() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session?.access_token) {
    throw new Error("로그인이 필요합니다.");
  }
  return data.session;
}

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

/** Deduplicate by message id; sort oldest → newest for chat display. */
export function dedupeMessagesById(rows) {
  const byId = new Map();
  for (const row of rows ?? []) {
    if (!row?.id) continue;
    byId.set(row.id, row);
  }
  return Array.from(byId.values()).sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

/**
 * Phase 30-B — Hide phase26-2a-fast when phase26-2a-result exists for the same job.
 * DB rows unchanged; display-only filter.
 */
export function filterMessagesForDisplay(rows) {
  const deduped = dedupeMessagesById(rows);
  const resultJobIds = new Set(
    deduped
      .filter(
        (row) =>
          row?.metadata?.phase === "phase26-2a-result" &&
          row?.metadata?.analysis_job_id,
      )
      .map((row) => String(row.metadata.analysis_job_id)),
  );

  return deduped.filter((row) => {
    if (row?.metadata?.phase !== "phase26-2a-fast") return true;
    const jobId = row?.metadata?.analysis_job_id;
    if (!jobId) return true;
    return !resultJobIds.has(String(jobId));
  });
}

export async function resolveCustomerId(authUser, knownCustomerId = null) {
  if (knownCustomerId) return knownCustomerId;
  const dashboard = await loadCustomerDashboardData(authUser);
  if (!dashboard.customerId) {
    throw new Error("고객 프로필을 찾을 수 없습니다.");
  }
  return dashboard.customerId;
}

async function insertConversationMessage(customerId, { role, message, metadata = {} }) {
  const { data, error } = await supabase
    .from("customer_conversations")
    .insert({
      customer_id: customerId,
      role,
      message: String(message ?? "").trim(),
      metadata_json: metadata,
    })
    .select("id, customer_id, role, message, metadata_json, created_at")
    .single();

  if (error) {
    throw new Error(toCustomerErrorMessage(error, "대화 메시지를 저장하지 못했습니다."));
  }
  return normalizeConversationMessage(data);
}

export async function loadCustomerConversations(
  authUser,
  { limit = DEFAULT_LIMIT, customerId: knownCustomerId = null } = {},
) {
  await ensureAuthSessionReady();
  const customerId = await resolveCustomerId(authUser, knownCustomerId);

  const { data, error } = await supabase
    .from("customer_conversations")
    .select("id, customer_id, role, message, metadata_json, created_at")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(toCustomerErrorMessage(error, "대화 기록을 불러오지 못했습니다."));
  }

  return dedupeMessagesById((data ?? []).map(normalizeConversationMessage));
}

export async function sendCustomerConversationMessage(
  authUser,
  message,
  { onAnalysisJob, customerId: knownCustomerId = null } = {},
) {
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

  const customerId = await resolveCustomerId(authUser, knownCustomerId);
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

export async function postCustomerSystemMessage(
  authUser,
  message,
  metadata = {},
  { customerId: knownCustomerId = null } = {},
) {
  const customerId = await resolveCustomerId(authUser, knownCustomerId);
  return insertConversationMessage(customerId, {
    role: "system",
    message,
    metadata: { source: "customer_session", phase: "phase28-1b", ...metadata },
  });
}
