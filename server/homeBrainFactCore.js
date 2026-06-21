/**
 * P2-A — Home Advisor Brain fact lookup (JWT/RLS read-only, deterministic).
 */
import {
  classifyConsultationIntent,
  computePremiumLookupStats,
} from "./intentGateLayer.js";
import { loadUnifiedCustomerState } from "./unifiedCustomerState.js";
import {
  finalizeOneBrainResponse,
  ONE_BRAIN_SURFACES,
} from "./oneBrainResponseLayer.js";
import { buildFactBundleFromUnified } from "./guidanceLayer/guidanceBuilder.js";

export const HOME_BRAIN_UNSUPPORTED_MESSAGE =
  "더 자세한 분석은 AI 상담실에서 진행할 수 있습니다.";

export const HOME_BRAIN_SUPPORTED_INTENTS = new Set([
  "premium_lookup",
  "policy_count",
  "insurer_lookup",
  "premium_unknown_lookup",
  "memory_recall_lookup",
]);

const BLOCKED_CLASSIFICATION_INTENTS = new Set([
  "coverage_gap_check",
  "coverage_review_request",
  "recommendation_request",
  "design_request",
  "claim_eligibility_check",
  "policy_detail",
]);

const PREMIUM_LOOKUP_SIGNAL = /보험료|월\s*납입?|월납|월\s*보험료|납입\s*보험료|보험료\s*합계/;
const PREMIUM_UNKNOWN_SIGNAL = /보험료\s*미확인|미확인\s*건|미확인\s*보험료/;
const MEMORY_RECALL_SIGNAL = /(기억|remember)/i;
const POLICY_COUNT_SIGNAL =
  /보험\s*(총\s*)?건수|몇\s*건|몇\s*개|가입\s*보험\s*수|보유\s*보험|내\s*보험(?!\s*(?:료|에))/;
const INSURER_LOOKUP_SIGNAL = /가입한\s*보험사|어느\s*보험사|보험사는|어떤\s*보험사/;

function normalizeQuestion(question) {
  return String(question ?? "").replace(/\s+/g, " ").trim();
}

function joinLabels(labels) {
  const list = (labels ?? []).filter(Boolean);
  if (list.length === 0) return "";
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]}과 ${list[1]}`;
  return `${list.slice(0, -1).join(", ")}과 ${list[list.length - 1]}`;
}

export function classifyHomeBrainIntent(question = "") {
  const text = normalizeQuestion(question);
  if (!text) return "unsupported";

  const classification = classifyConsultationIntent(text);
  if (BLOCKED_CLASSIFICATION_INTENTS.has(classification.intent)) {
    return "unsupported";
  }

  if (MEMORY_RECALL_SIGNAL.test(text) && /(정보|나|내|기억|저|알)/.test(text)) {
    return "memory_recall_lookup";
  }
  if (PREMIUM_UNKNOWN_SIGNAL.test(text)) {
    return "premium_unknown_lookup";
  }
  if (PREMIUM_LOOKUP_SIGNAL.test(text)) {
    return "premium_lookup";
  }
  if (POLICY_COUNT_SIGNAL.test(text)) {
    return "policy_count";
  }
  if (INSURER_LOOKUP_SIGNAL.test(text)) {
    return "insurer_lookup";
  }

  return "unsupported";
}

export function buildHomeBrainFactsUsed(unified, stats) {
  return {
    portfolioSource: "unified_state.policies",
    totalCount: stats.totalCount,
    premiumKnownCount: stats.premiumKnownCount,
    premiumUnknownCount: stats.premiumUnknownCount,
    premiumTotal: stats.premiumTotal,
    memoryStatus: unified?.memory_status ?? null,
    memoryFactCount: unified?.memory_fact_count ?? 0,
  };
}

function customerLabel(unified) {
  const name = unified?.profile?.display_name;
  return name ? `${name}님` : "고객님";
}

export function formatHomeBrainAnswer(intent, unified, stats) {
  const label = customerLabel(unified);

  if (stats.totalCount === 0 && intent !== "memory_recall_lookup") {
    return `${label}, 현재 등록된 가입 보험 정보를 찾지 못했습니다. 고객 분석 화면에서 보험 정보를 저장해 주시면 정확히 안내해 드리겠습니다.`;
  }

  switch (intent) {
    case "premium_lookup": {
      if (stats.premiumKnownCount === 0) {
        return `${label}, 현재 등록된 보험 ${stats.totalCount}건 중 월 보험료가 확인된 계약은 없습니다.`;
      }
      const lines = [
        `현재 확인 가능한 월 보험료는 ${stats.premiumTotal.toLocaleString("ko-KR")}원입니다.`,
      ];
      if (stats.premiumUnknownCount > 0) {
        lines.push(
          `${stats.premiumKnownCount}건이 합산되었고, 보험료 미확인 ${stats.premiumUnknownCount}건이 있습니다.`,
        );
      } else {
        lines.push(`${stats.premiumKnownCount}건이 합산되었습니다.`);
      }
      return lines.join("\n");
    }
    case "policy_count":
      return `${label}, 현재 등록된 가입 보험은 ${stats.totalCount}건입니다.`;
    case "insurer_lookup": {
      const insurers = Array.from(
        new Set((unified?.policies ?? []).map((policy) => policy.insurer_name).filter(Boolean)),
      );
      if (!insurers.length) {
        return `${label}, 현재 등록된 보험사 정보를 확인하지 못했습니다.`;
      }
      return `${label}, 현재 가입하신 보험사는 ${joinLabels(insurers)}입니다.`;
    }
    case "premium_unknown_lookup":
      if (stats.premiumUnknownCount === 0) {
        return `${label}, 현재 등록된 보험 ${stats.totalCount}건 모두 월 보험료가 확인되었습니다.`;
      }
      return `${label}, 보험료 미확인 ${stats.premiumUnknownCount}건이 있습니다.`;
    case "memory_recall_lookup": {
      const factCount = unified?.memory_fact_count ?? 0;
      const status = unified?.memory_status ?? "ready";
      if (factCount > 0) {
        return `${label}, ${factCount}개의 고객 정보를 기억하고 있습니다.`;
      }
      if (status === "degraded") {
        return `${label}, 고객 정보를 일부만 기억하고 있습니다.`;
      }
      if (status === "failed") {
        return `${label}, 고객 정보 기억을 최근에 갱신하지 못했습니다.`;
      }
      return `${label}, 아직 기억할 고객 정보가 충분하지 않습니다.`;
    }
    default:
      return HOME_BRAIN_UNSUPPORTED_MESSAGE;
  }
}

export function composeHomeBrainFactAnswer(unified, question) {
  const intent = classifyHomeBrainIntent(question);
  if (!HOME_BRAIN_SUPPORTED_INTENTS.has(intent)) {
    return {
      ok: true,
      answerText: HOME_BRAIN_UNSUPPORTED_MESSAGE,
      intent: "unsupported",
      factsUsed: buildHomeBrainFactsUsed(unified ?? {}, {
        totalCount: unified?.policy_count ?? unified?.policies?.length ?? 0,
        premiumKnownCount: 0,
        premiumUnknownCount: 0,
        premiumTotal: 0,
      }),
    };
  }

  const policies = unified?.policies ?? [];
  const stats = computePremiumLookupStats(policies);
  return {
    ok: true,
    answerText: formatHomeBrainAnswer(intent, unified, stats),
    intent,
    factsUsed: buildHomeBrainFactsUsed(unified, stats),
  };
}

export async function handleHomeBrainFactRequest({ userSupabase, customerId, question }) {
  const trimmedQuestion = normalizeQuestion(question);
  if (!trimmedQuestion) {
    return {
      ok: false,
      reason: "INVALID_BODY",
      error_message: "질문을 입력해 주세요.",
    };
  }
  if (!userSupabase || !customerId) {
    return {
      ok: false,
      reason: "UNAUTHORIZED",
      error_message: "Authentication required.",
    };
  }

  const unified = await loadUnifiedCustomerState(userSupabase, customerId);
  const composed = composeHomeBrainFactAnswer(unified, trimmedQuestion);
  const consultationIntent = classifyConsultationIntent(trimmedQuestion);
  const factBundle = buildFactBundleFromUnified(unified, trimmedQuestion);
  const answerText = finalizeOneBrainResponse({
    text: composed.answerText,
    question: trimmedQuestion,
    intent: consultationIntent.intent,
    surface: ONE_BRAIN_SURFACES.HOME,
    factBundle,
    homeBrainIntent: composed.intent,
  });
  return { ...composed, answerText };
}
