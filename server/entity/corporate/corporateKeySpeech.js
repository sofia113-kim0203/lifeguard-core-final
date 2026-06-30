/**
 * Corporate KEY speech — same KEY, company-aware answers from corp-key-compose-v1.
 * Principle 15: trusts Recommendation contract · not Panel labels.
 */
import { SALES_DIRECTOR_JUDGMENT_INTENTS } from "../../salesDirectorFormatter.js";

const GENERIC_FILLER_RE = /확인된 범위 안에서만 조심스럽게|걱정되는 축부터 차례로 짚어 보면 됩니다/;

function normalizeQuestion(question = "") {
  return String(question ?? "").replace(/\s+/g, " ").trim();
}

export function classifyCorporateJourneyPhase(question = "") {
  const q = normalizeQuestion(question);
  if (!q || /^(안녕|반가|하이|hello)/i.test(q)) return "relationship";
  if (/앞으로도|평생|계속\s*같이|함께\s*보면|맡기|파트너/.test(q)) return "lifetime_partner";
  if (/내년|늘면|인원.*늘|headcount|성장|확장|커지/.test(q)) return "future_with_company";
  if (/단체보험|회사.*보험|법인.*보험|우리 회사.*상태/.test(q)) return "corporate_status";
  if (/직원.*(보장|부족)|보장.*부족|부족한|취약|gap/i.test(q)) return "coverage_gap";
  if (/뭐부터|우선|먼저|순서/.test(q)) return "recommendation";
  if (/아까|이어|방금|말한/.test(q)) return "continuity";
  return "general_corporate";
}

function pickItems(keyCompose = {}) {
  const rec = keyCompose.recommendation ?? {};
  return {
    priority: rec.priority_items ?? [],
    maintain: rec.maintain_items ?? [],
    deferred: rec.deferred_items ?? [],
    summary: rec.summary ?? {},
  };
}

function joinLabels(items = [], limit = 2) {
  const labels = items.map((row) => row.label).filter(Boolean).slice(0, limit);
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  return `${labels[0]}과 ${labels[1]}`;
}

function lastAssistantExcerpt(history = []) {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const row = history[i];
    if (row?.role === "assistant" && String(row.content ?? "").trim()) {
      return String(row.content).replace(/\s+/g, " ").trim();
    }
  }
  return "";
}

/**
 * Compose customer-facing speech — KEY voice · no engine leak · no generic filler.
 */
export function composeCorporateKeySpeech({
  question = "",
  history = [],
  keyCompose = {},
  displayName = null,
} = {}) {
  const phase = classifyCorporateJourneyPhase(question);
  const { priority, maintain, deferred } = pickItems(keyCompose);
  const companyRef = displayName ? `${displayName} ` : "회사 ";

  switch (phase) {
    case "relationship":
      return {
        text: "반갑습니다. 천천히 맞춰가면 됩니다.",
        phase,
        speech_source: "corporate_key_same_greeting",
      };

    case "corporate_status": {
      const group =
        maintain.find((row) => row.item === "group_insurance") ?? maintain[0] ?? priority[0];
      if (group) {
        const actionWord =
          group.action === "maintain" ? "유지 중" : group.action === "priority" ? "우선 점검" : "함께 볼";
        return {
          text: `${companyRef}단체보험은 ${group.label} 쪽을 ${actionWord}으로 이해하고 있어요. 저장된 회사 자료 기준으로 말씀드린 거예요. 더 세부적인 담보는 같이 짚어보면 됩니다.`,
          phase,
          speech_source: "corporate_key_compose_maintain",
          compose_items_used: [group.item],
        };
      }
      return {
        text: `${companyRef}보험 구조는 아직 저장된 분석이 충분하지 않아요. 지금 있는 자료부터 같이 정리해 드릴게요.`,
        phase,
        speech_source: "corporate_key_honest_absence",
      };
    }

    case "coverage_gap": {
      const inspect = priority.length ? priority : deferred.filter((row) => row.action !== "maintain");
      if (inspect.length) {
        const labels = joinLabels(inspect, 3);
        return {
          text: `직원 보장 쪽에서는 ${labels} 축을 먼저 같이 보는 게 맞아 보여요. 회사 자료 기준으로 짚은 거고, 세부 한도까지는 함께 확인하면 됩니다.`,
          phase,
          speech_source: "corporate_key_compose_gap",
          compose_items_used: inspect.slice(0, 3).map((row) => row.item),
        };
      }
      return {
        text: `지금 회사 자료만으로는 직원 보장이 충분한지 단정하긴 어려워요. 걱정되는 축부터 하나씩 짚어 보면 됩니다.`,
        phase,
        speech_source: "corporate_key_honest_defer",
      };
    }

    case "recommendation": {
      if (priority.length) {
        const first = priority[0];
        const second = priority[1];
        const tail = second ? ` 그다음은 ${second.label} 쪽이에요.` : "";
        return {
          text: `${companyRef}지금은 ${first.label}부터 보는 게 좋겠어요.${tail} 저장된 회사 분석 기준으로 말씀드린 거예요.`,
          phase,
          speech_source: "corporate_key_compose_priority",
          compose_items_used: priority.slice(0, 2).map((row) => row.item),
        };
      }
      if (maintain.length) {
        return {
          text: `${companyRef}우선은 ${maintain[0].label} 유지 상태부터 같이 확인하는 게 좋겠어요.`,
          phase,
          speech_source: "corporate_key_compose_maintain_fallback",
          compose_items_used: [maintain[0].item],
        };
      }
      return {
        text: `우선순위를 정하려면 회사 자료를 조금 더 확인해야 해요. 걱정되는 축부터 말씀해 주시면 같이 정리할게요.`,
        phase,
        speech_source: "corporate_key_honest_defer",
      };
    }

    case "continuity": {
      const prior = lastAssistantExcerpt(history);
      if (prior && !GENERIC_FILLER_RE.test(prior)) {
        return {
          text: `아까 말씀드린 ${prior.slice(0, 48)}… 흐름 그대로 이어갈게요. 회사가 바뀔 때마다 같이 보면 되니, 편하게 이어가 주세요.`,
          phase,
          speech_source: "corporate_key_continuity_from_history",
        };
      }
      if (priority.length) {
        const first = priority[0];
        return {
          text: `아까 우선 ${first.label}부터 보자고 했던 부분이에요. ${first.reason ? `${first.reason} ` : ""}이어서 같이 보면 됩니다.`,
          phase,
          speech_source: "corporate_key_continuity_from_compose",
          compose_items_used: [first.item],
        };
      }
      return {
        text: `아까 이야기한 회사 보장 흐름 그대로 이어갈게요. 앞으로도 변할 때마다 같이 짚어 드릴게요.`,
        phase,
        speech_source: "corporate_key_continuity_generic",
      };
    }

    case "future_with_company": {
      const anchor =
        maintain.find((row) => row.item === "group_insurance") ?? maintain[0] ?? priority[0];
      const anchorHint = anchor?.label ? `${anchor.label} 흐름을 기준으로, ` : "";
      return {
        text: `${companyRef}직원이 늘어나면 보장도 같이 짚어봐야 해요. ${anchorHint}변할 때마다 한 번씩 같이 보면 됩니다. 숫자부터 단정하진 않을게요 — 흐름부터 맞춰 가요.`,
        phase,
        speech_source: "corporate_key_future_with_rep",
        compose_items_used: anchor ? [anchor.item] : [],
      };
    }

    case "lifetime_partner": {
      return {
        text: `네, 앞으로도 회사가 바뀔 때마다 이 흐름으로 같이 보면 돼요. 한 번만 보고 끝내지 않고, 대표님 편에서 계속 짚어 드릴게요.`,
        phase,
        speech_source: "corporate_key_lifetime_partner_invite",
      };
    }

    default:
      return {
        text: `${companyRef}보험 이야기는 저장된 회사 자료 기준으로 같이 보면 됩니다. 지금 가장 걸리는 부분부터 말씀해 주세요.`,
        phase,
        speech_source: "corporate_key_general",
      };
  }
}

export function buildCorporateKeyAgentTurn({ question, history, keyCompose, displayName }) {
  const speech = composeCorporateKeySpeech({ question, history, keyCompose, displayName });
  return {
    text: speech.text,
    consultationIntent: { intent: "general_consultation" },
    tomInternalRoute: null,
    toolUsed: null,
    responseSource: "sales_director_key",
    factBundle: {
      question,
      key_orchestrator: true,
      corporate_key_speech: true,
      corporate_journey_phase: speech.phase,
      corporate_speech_source: speech.speech_source,
      compose_items_used: speech.compose_items_used ?? [],
      judgment_intent: SALES_DIRECTOR_JUDGMENT_INTENTS.GENERAL,
    },
    tomGapVoiceHandled: false,
    trace: {
      agent: "corporate_key_speech_v1",
      compose_route: "corp-key-compose-v1",
      tool_used: null,
      tom_ran: false,
    },
  };
}
