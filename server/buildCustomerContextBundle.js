/**
 * P5-BRAIN / P6-1 — read-only customer context via CustomerContextSnapshot.
 */
import {
  loadCustomerContextSnapshot,
  snapshotToContextBundle,
} from "./customerContextSnapshot.js";
import {
  buildMergedRecentConversationSummary,
  buildRecentConversationSummary,
} from "./customerConversationHistory.js";

export {
  buildMergedRecentConversationSummary,
  buildRecentConversationSummary,
} from "./customerConversationHistory.js";

export function compareCustomerExistenceFlags(unifiedState, bundle) {
  const unifiedHasPolicies = (unifiedState?.policies?.length ?? unifiedState?.policy_count ?? 0) > 0;
  const bundleHasPolicies = (bundle?.policies?.length ?? 0) > 0;
  const unifiedHasDocuments =
    (unifiedState?.document_count ?? 0) > 0 || (unifiedState?.documents?.length ?? 0) > 0;
  const bundleHasDocuments =
    (bundle?.documentCount ?? 0) > 0 || (bundle?.documents?.length ?? 0) > 0;

  return {
    policiesMatch: unifiedHasPolicies === bundleHasPolicies,
    documentsMatch: unifiedHasDocuments === bundleHasDocuments,
    unified: { hasPolicies: unifiedHasPolicies, hasDocuments: unifiedHasDocuments },
    bundle: { hasPolicies: bundleHasPolicies, hasDocuments: bundleHasDocuments },
  };
}

export function formatCustomerContextBlock(bundle) {
  if (!bundle) return "";

  const lines = ["[현재 고객 상태]"];

  if ((bundle.policies?.length ?? 0) > 0) {
    lines.push("보험: 가입 정보 있음");
  } else {
    lines.push("보험: 없음");
  }

  if ((bundle.documentCount ?? 0) > 0 || (bundle.documents ?? []).length > 0) {
    lines.push("문서: 업로드 있음");
  } else {
    lines.push("문서: 없음");
  }

  const memoryFacts = bundle.memoryFacts ?? [];
  if (memoryFacts.length > 0) {
    lines.push("기억: 저장된 정보 있음");
  } else {
    lines.push("기억: 없음");
  }

  const recent = bundle.recentConversation ?? {};
  if (recent.hasHistory) {
    const excerpt = recent.latestUserMessageExcerpt ?? recent.latestUserMessages?.[0] ?? null;
    lines.push(excerpt ? `최근 대화: 있음 (${excerpt.slice(0, 40)})` : "최근 대화: 있음");
  } else {
    lines.push("최근 대화: 없음");
  }

  return lines.join("\n");
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} customerId
 * @param {{ requestHistory?: Array<{ role?: string, content?: string, message?: string }> }} [options]
 */
export async function buildCustomerContextBundle(supabase, customerId, { requestHistory = [] } = {}) {
  const snapshot = await loadCustomerContextSnapshot(supabase, customerId, { requestHistory });
  return snapshotToContextBundle(snapshot);
}
