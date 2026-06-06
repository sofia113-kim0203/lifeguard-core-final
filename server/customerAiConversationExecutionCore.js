/**
 * Phase 14-9 — server-side customer AI conversation execution handler.
 * Env: ANTHROPIC_API_KEY, SUPABASE_URL/VITE_SUPABASE_URL, SUPABASE_ANON_KEY/VITE_SUPABASE_ANON_KEY
 */

import { createClient } from "@supabase/supabase-js";
import {
  handleClaudeGroundedExecutionRequest,
  readJsonBody,
  resolveSupabaseConfig,
} from "./claudeGroundedExecutionCore.js";

function createSupabaseClient(authHeader, env = process.env) {
  const { url, anonKey } = resolveSupabaseConfig(env);
  if (!url || !anonKey) {
    return null;
  }

  const token = String(authHeader ?? "").replace(/^Bearer\s+/i, "").trim();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers },
  });
}

function previewResponseText(text) {
  const value = String(text ?? "").trim();
  if (!value) return "";
  return value.length > 600 ? `${value.slice(0, 600)}…` : value;
}

function hasRealPolicyScope({ policyPdfId, carrierId }) {
  return Boolean(String(policyPdfId ?? "").trim() || String(carrierId ?? "").trim());
}

export { readJsonBody };

export function parseCustomerAiConversationExecutionBody(body) {
  if (!body || typeof body !== "object") {
    return null;
  }

  const mode = String(body.mode ?? "prepare").trim().toLowerCase();
  if (mode === "prepare") {
    const customerId = String(body.customerId ?? body.customer_id ?? "").trim();
    const conversationId = String(body.conversationId ?? body.conversation_id ?? "").trim();
    const query = String(body.query ?? "").trim();
    const policyPdfId = String(body.policyPdfId ?? body.policy_pdf_id ?? "").trim() || null;
    const carrierId = String(body.carrierId ?? body.carrier_id ?? "").trim() || null;
    const productId = String(body.productId ?? body.product_id ?? "").trim() || null;
    if (!customerId || !conversationId || !query) {
      return null;
    }
    return { mode, customerId, conversationId, query, policyPdfId, carrierId, productId };
  }

  if (mode === "execute") {
    const aiConversationRunId = String(
      body.aiConversationRunId ?? body.ai_conversation_run_id ?? "",
    ).trim();
    if (!aiConversationRunId) {
      return null;
    }
    return { mode, aiConversationRunId };
  }

  if (mode === "store") {
    const aiConversationRunId = String(
      body.aiConversationRunId ?? body.ai_conversation_run_id ?? "",
    ).trim();
    const responseText = String(body.responseText ?? body.response_text ?? "").trim();
    const responseSourceCount = Number(
      body.responseSourceCount ?? body.response_source_count ?? 0,
    );
    if (!aiConversationRunId || !responseText) {
      return null;
    }
    return {
      mode,
      aiConversationRunId,
      responseText,
      responseSourceCount: Number.isFinite(responseSourceCount) ? responseSourceCount : 0,
    };
  }

  return null;
}

export async function handlePrepareCustomerAiConversation({
  customerId,
  conversationId,
  query,
  policyPdfId = null,
  carrierId = null,
  productId = null,
  authHeader,
  env = process.env,
}) {
  const supabase = createSupabaseClient(authHeader, env);
  if (!supabase) {
    return {
      ok: false,
      reason: "SUPABASE_NOT_CONFIGURED",
      error_message: "서버 Supabase 설정이 없습니다.",
    };
  }

  const scoped = hasRealPolicyScope({ policyPdfId, carrierId });
  const rpcName = scoped
    ? "lifeguard_prepare_customer_real_policy_ai_conversation"
    : "lifeguard_prepare_customer_ai_conversation";

  const rpcArgs = scoped
    ? {
        p_customer_id: customerId,
        p_conversation_id: conversationId,
        p_policy_pdf_id: policyPdfId,
        p_carrier_id: carrierId,
        p_product_id: productId,
        p_query: query,
      }
    : {
        p_customer_id: customerId,
        p_conversation_id: conversationId,
        p_query: query,
      };

  const { data, error } = await supabase.rpc(rpcName, rpcArgs);

  if (error) {
    return {
      ok: false,
      reason: "PREPARE_RPC_FAILED",
      error_message: error.message || "AI conversation preparation failed.",
    };
  }

  return {
    ok: true,
    mode: "prepare",
    ai_conversation_run_id:
      data?.customer_ai_conversation_run_id ?? data?.ai_conversation_run_id ?? null,
    grounded_conversation_run_id: data?.grounded_conversation_run_id ?? null,
    claude_grounding_run_id: data?.claude_grounding_run_id ?? null,
    claude_execution_run_id: data?.claude_execution_run_id ?? null,
    grounding_source_count: data?.grounding_source_count ?? null,
    claude_grounding_ready: data?.claude_grounding_ready ?? null,
    execution_status: data?.execution_status ?? null,
    missing_information: Array.isArray(data?.missing_information) ? data.missing_information : [],
    raw: data,
  };
}

export async function handleExecuteCustomerAiConversation({
  aiConversationRunId,
  authHeader,
  fetchImpl = fetch,
  env = process.env,
}) {
  const supabase = createSupabaseClient(authHeader, env);
  if (!supabase) {
    return {
      ok: false,
      reason: "SUPABASE_NOT_CONFIGURED",
      error_message: "서버 Supabase 설정이 없습니다.",
    };
  }

  const { data: runRow, error: runError } = await supabase
    .from("customer_ai_conversation_runs")
    .select(
      "id, customer_id, conversation_id, query, execution_status, claude_execution_run_id, response_status, missing_information",
    )
    .eq("id", aiConversationRunId)
    .maybeSingle();

  if (runError) {
    return {
      ok: false,
      reason: "RUN_LOAD_FAILED",
      error_message: runError.message,
    };
  }

  if (!runRow) {
    return {
      ok: false,
      reason: "RUN_NOT_FOUND",
      error_message: "Customer AI conversation run not found.",
    };
  }

  if (!runRow.claude_execution_run_id) {
    return {
      ok: false,
      reason: "CLAUDE_EXECUTION_RUN_MISSING",
      error_message: "Claude execution run is not linked to this AI conversation run.",
    };
  }

  const executionResult = await handleClaudeGroundedExecutionRequest({
    claudeExecutionRunId: runRow.claude_execution_run_id,
    authHeader,
    fetchImpl,
    env,
  });

  if (!executionResult.ok) {
    return {
      ok: false,
      mode: "execute",
      ai_conversation_run_id: aiConversationRunId,
      claude_execution_run_id: runRow.claude_execution_run_id,
      execution_status: executionResult.execution_status ?? "failed",
      response_preview: executionResult.response_preview ?? {},
      error_message: executionResult.error_message ?? "Claude execution failed.",
      reason: executionResult.reason ?? "EXECUTION_FAILED",
    };
  }

  const answer =
    executionResult.response_preview?.answer_preview ??
    executionResult.response_preview?.answer ??
    "";
  const sourceCount = Number(executionResult.response_preview?.source_count ?? 0);

  let stored;
  if (answer) {
    const { data: storeData, error: storeError } = await supabase.rpc(
      "lifeguard_store_customer_ai_response",
      {
        p_ai_conversation_run_id: aiConversationRunId,
        p_response_text: answer,
        p_response_source_count: sourceCount,
      },
    );

    if (storeError) {
      return {
        ok: false,
        mode: "execute",
        ai_conversation_run_id: aiConversationRunId,
        claude_execution_run_id: runRow.claude_execution_run_id,
        execution_status: executionResult.execution_status ?? "completed",
        response_preview: executionResult.response_preview ?? {},
        error_message: storeError.message || "Failed to store customer AI response.",
        reason: "STORE_RESPONSE_FAILED",
      };
    }

    stored = storeData;
  }

  return {
    ok: true,
    mode: "execute",
    ai_conversation_run_id: aiConversationRunId,
    claude_execution_run_id: runRow.claude_execution_run_id,
    execution_status: stored ? "completed" : executionResult.execution_status ?? "completed",
    response_preview: {
      ...executionResult.response_preview,
      answer_preview: previewResponseText(answer),
    },
    ai_response_id: stored?.ai_response_id ?? null,
    response_status: stored?.response_status ?? null,
    error_message: null,
  };
}

export async function handleStoreCustomerAiResponse({
  aiConversationRunId,
  responseText,
  responseSourceCount,
  authHeader,
  env = process.env,
}) {
  const supabase = createSupabaseClient(authHeader, env);
  if (!supabase) {
    return {
      ok: false,
      reason: "SUPABASE_NOT_CONFIGURED",
      error_message: "서버 Supabase 설정이 없습니다.",
    };
  }

  const { data, error } = await supabase.rpc("lifeguard_store_customer_ai_response", {
    p_ai_conversation_run_id: aiConversationRunId,
    p_response_text: responseText,
    p_response_source_count: responseSourceCount,
  });

  if (error) {
    return {
      ok: false,
      reason: "STORE_RPC_FAILED",
      error_message: error.message || "Failed to store customer AI response.",
    };
  }

  return {
    ok: true,
    mode: "store",
    ai_response_id: data?.ai_response_id ?? null,
    ai_conversation_run_id: data?.ai_conversation_run_id ?? aiConversationRunId,
    response_status: data?.response_status ?? null,
    response_preview: previewResponseText(responseText),
    raw: data,
  };
}
