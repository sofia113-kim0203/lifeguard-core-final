/**
 * P5-BRAIN — read-only Customer Context Bundle from existing tables/views only.
 */
import { loadCustomerMemorySnapshot } from "./customerMemorySnapshot.js";
import { loadRawCustomerRecords } from "./unifiedCustomerState.js";
import { resolvePolicyPremium } from "../src/lib/resolvePolicyPremium.js";
import {
  LIFEGUARD_HOME_CHAT_PHASE,
  LIFEGUARD_HOME_CHAT_SOURCE,
} from "../src/lib/lifeguardChatSessionCore.js";

const RECENT_CONVERSATION_SCAN_LIMIT = 80;

function isLifeguardHomeChatRow(row) {
  const metadata = row?.metadata_json ?? {};
  if (!metadata.session_id) return false;
  return metadata.phase === LIFEGUARD_HOME_CHAT_PHASE || metadata.source === LIFEGUARD_HOME_CHAT_SOURCE;
}

async function loadRecentLifeguardConversationRows(supabase, customerId) {
  const { data, error } = await supabase
    .from("customer_conversations")
    .select("id, role, message, metadata_json, created_at")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(RECENT_CONVERSATION_SCAN_LIMIT);

  if (error) {
    throw new Error(`recent_conversation_lookup_failed: ${error.message}`);
  }

  return (data ?? []).filter(isLifeguardHomeChatRow);
}

function extractTopicsFromMessages(messages = []) {
  const text = messages.join(" ");
  const topics = [];
  if (/보험료|납입|비싼|프리미엄/.test(text)) topics.push("보험료");
  if (/보장|분석|갭|부족|공백/.test(text)) topics.push("보장분석");
  if (/암/.test(text)) topics.push("암보장");
  return topics;
}

export function buildRecentConversationSummary(rows = []) {
  const sorted = [...rows].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  const userMessages = sorted.filter((row) => row.role === "user").slice(0, 8);
  const latestUserMessages = userMessages.map((row) => String(row.message ?? "").trim()).filter(Boolean);

  return {
    hasHistory: latestUserMessages.length > 0,
    topics: extractTopicsFromMessages(latestUserMessages),
    latestUserMessages,
    messageCount: sorted.length,
  };
}

export function formatCustomerContextBlock(bundle) {
  if (!bundle) return "";

  const lines = ["[현재 고객 상태]"];

  const policyCount = bundle.policies?.length ?? 0;
  if (policyCount > 0) {
    lines.push(`보험: ${policyCount}건`);
    for (const policy of bundle.policies.slice(0, 8)) {
      const premium =
        policy.monthly_premium != null
          ? `월 ${Number(policy.monthly_premium).toLocaleString("ko-KR")}원`
          : "보험료 미확인";
      lines.push(`- ${policy.insurer_name ?? "보험사"} / ${policy.product_name ?? "상품"} (${premium})`);
    }
  } else {
    lines.push("보험: 등록 정보 없음");
  }

  const docCount = bundle.documentCount ?? bundle.documents?.length ?? 0;
  if (docCount > 0) {
    lines.push(`문서: ${docCount}건`);
    for (const doc of (bundle.documents ?? []).slice(0, 5)) {
      lines.push(`- ${doc.original_filename ?? "문서"} (${doc.ingest_status ?? "상태 미확인"})`);
    }
  } else {
    lines.push("문서: 없음");
  }

  const memoryFacts = bundle.memoryFacts ?? [];
  if (memoryFacts.length > 0) {
    lines.push(`기억: ${memoryFacts.length}건`);
    for (const fact of memoryFacts.slice(0, 5)) {
      lines.push(`- ${fact.fact_key}: ${fact.fact_value}`);
    }
  } else {
    lines.push("기억: 없음");
  }

  const recent = bundle.recentConversation ?? {};
  if (recent.hasHistory) {
    lines.push(`최근 대화: ${recent.latestUserMessages?.slice(0, 3).join(" / ") ?? "있음"}`);
  } else {
    lines.push("최근 대화: 없음");
  }

  return lines.join("\n");
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} customerId
 */
export async function buildCustomerContextBundle(supabase, customerId) {
  if (!supabase) throw new Error("supabase_required");
  if (!customerId) throw new Error("customer_id_required");

  const [raw, snapshot, conversationRows] = await Promise.all([
    loadRawCustomerRecords(supabase, customerId),
    loadCustomerMemorySnapshot(supabase, customerId),
    loadRecentLifeguardConversationRows(supabase, customerId),
  ]);

  const policies = (raw.policies ?? []).map((policy) => ({
    ...policy,
    monthly_premium: resolvePolicyPremium(policy),
  }));

  const memoryFacts = snapshot?.facts ?? [];

  return {
    customerId,
    profile: raw.profile ?? null,
    policies,
    documents: raw.documents ?? [],
    documentCount: raw.document_count ?? 0,
    memoryFacts,
    memoryFactCount: snapshot?.fact_count ?? memoryFacts.length,
    recentConversation: buildRecentConversationSummary(conversationRows),
  };
}
