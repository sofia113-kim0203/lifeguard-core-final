/**
 * Phase 27 — Customer-facing conversational tone helpers.
 * Friendly, professional Korean insurance advisor style.
 */
import { buildDesignPanelNextSteps } from "../src/lib/designPanelKeyVoice.js";

function findFact(facts, keyPart) {
  return (facts ?? []).find((fact) => String(fact.fact_key ?? "").includes(keyPart));
}

function uniqueLabels(items, key = "coverage_label") {
  return Array.from(new Set((items ?? []).map((item) => item?.[key]).filter(Boolean)));
}

function joinLabels(labels) {
  const list = labels.filter(Boolean);
  if (list.length === 0) return "";
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]}과 ${list[1]}`;
  return `${list.slice(0, -1).join(", ")}과 ${list[list.length - 1]}`;
}

export const ADVISOR_TONE_SYSTEM_RULES = [
  "You are a LIFEGUARD customer insurance consultation assistant.",
  "Write in polite, warm, professional Korean — like an experienced insurance advisor speaking to a customer.",
  "Rules:",
  "- 3 to 8 sentences total. Maximum 800 Korean characters.",
  "- Start with the customer's actual situation (existing insurance, health memory, coverage status).",
  "- The first 1-2 sentences MUST directly answer the customer's literal question before any analysis context.",
  "- Answer the customer's specific question first, then add relevant context only if the intent requires it.",
  "- When Memory facts exist, reference them naturally (e.g. 복용 이력, 가입 보험).",
  "- End with one clear, actionable next step the customer can take.",
  "- Use conversational Korean. No markdown headings, bullet lists, or bold text.",
  "- Do NOT use raw engine terms: risk_score, gap_score, category codes, JSON field names, 'Top 2', 'Memory N건'.",
  "- Do NOT say '보장 공백 우선 항목은 X입니다' — instead explain naturally what is missing and why it matters.",
  "- Do not invent insurers, products, premiums, or approval/decline decisions.",
].join(" ");

export function detectDirectAnswerIntent(question = "") {
  const text = String(question).trim();
  if (/보험료|월\s*납입?|월납|월\s*보험료|납입\s*보험료|보험료\s*합계/.test(text)) return "premium_lookup";
  if (/보험\s*(총\s*)?건수|몇\s*건|가입\s*보험\s*수|보유\s*보험|내\s*보험(?!\s*(?:료|에))/.test(text)) return "policy_count";
  if (/가입한\s*보험사|어느\s*보험사|보험사는/.test(text)) return "insurer";
  if (/복용\s*중인\s*약|먹는\s*약|복용약|약은/.test(text)) return "medication";
  if (/지급조건|약관|보장내용|청구\s*조건/.test(text)) return "policy_terms";
  return null;
}

/** Align with UnifiedCustomerState / dashboard: all non-deleted maintained policies. */
export function resolvePolicyCountFromSummary(sourceSummary = {}) {
  if (sourceSummary.active_policy_count != null) {
    return Number(sourceSummary.active_policy_count);
  }
  if (sourceSummary.policy_count != null) {
    return Number(sourceSummary.policy_count);
  }
  return null;
}

function hasSsotPolicyCount(policyCount) {
  return typeof policyCount === "number" && policyCount > 0;
}

export function resolveUnifiedPolicyView(workingContext = {}) {
  const sourceSummary = workingContext.sourceSummary ?? {};
  const sourceContext = workingContext.sourceContext ?? {};
  const policies = sourceSummary.insurance?.length
    ? sourceSummary.insurance
    : sourceContext.policies ?? [];

  const policyCount = resolvePolicyCountFromSummary(sourceSummary);

  const policyDescriptions = policies
    .map((policy) => {
      const insurer = policy.insurer ?? policy.insurer_name ?? "";
      const product = policy.product ?? policy.product_name ?? "";
      return `${insurer} ${product}`.trim();
    })
    .filter(Boolean);

  return { policies, policyCount, policyDescriptions };
}

export function extractCustomerSituation(workingContext = {}) {
  const snapshot = workingContext.snapshot ?? {};
  const facts = snapshot.facts ?? [];
  const sourceSummary = workingContext.sourceSummary ?? {};
  const { policyCount, policyDescriptions } = resolveUnifiedPolicyView(workingContext);

  const customerName =
    findFact(facts, "profile.name")?.fact_value?.trim() ||
    snapshot.profile?.display_name ||
    sourceSummary.profile?.name ||
    null;
  const customerLabel = customerName ? `${customerName}님` : "고객님";

  const medication =
    findFact(facts, "health.medication")?.fact_value?.trim() ||
    sourceSummary.health?.medication ||
    null;

  const keepLabels = uniqueLabels(
    workingContext.recommendationResult?.keep_existing ??
      workingContext.designBundle?.customer_visible_design?.keep_existing_coverages?.map((label) => ({
        coverage_label: label,
      })),
  );

  const gapLabels = uniqueLabels(workingContext.coverageGapResult?.top_gaps);
  const recommendLabels = uniqueLabels(workingContext.recommendationResult?.customer_visible_top2);
  const maintainedLabels = uniqueLabels(workingContext.coverageGapResult?.maintained_coverage);

  const uwNotes = (workingContext.underwritingResult?.likely_surcharge ?? [])
    .slice(0, 2)
    .map((item) => item.review_step_code ?? (item.uw_reason_codes ?? []).join(","))
    .filter(Boolean);

  return {
    customerLabel,
    medication,
    policyCount,
    policyDescriptions,
    keepLabels: keepLabels.length ? keepLabels : maintainedLabels,
    gapLabels,
    recommendLabels,
    uwNotes,
    designPriorityLabel: (workingContext.designBundle?.customer_visible_design?.priority_coverages ?? [])[0] ?? null,
    nextActions: buildDesignPanelNextSteps(
      workingContext.designBundle?.customer_visible_design ?? {},
    ).slice(0, 2),
  };
}

export function buildCustomerFacingContext(workingContext = {}) {
  const situation = extractCustomerSituation(workingContext);
  const lines = [];

  if (hasSsotPolicyCount(situation.policyCount)) {
    if (situation.policyDescriptions.length) {
      lines.push(
        `현재 ${situation.customerLabel}께서는 ${situation.policyDescriptions.join(", ")} ${situation.policyCount}건을 보유하고 계십니다.`,
      );
    } else {
      lines.push(
        `현재 ${situation.customerLabel}께서는 등록된 보험이 ${situation.policyCount}건 확인됩니다.`,
      );
    }
  }

  if (situation.medication) {
    lines.push(`건강 정보에 ${situation.medication} 이력이 기록되어 있어, 신규 가입 시 심사에서 추가 확인이 필요할 수 있습니다.`);
  }

  if (situation.keepLabels.length) {
    lines.push(`기존 ${joinLabels(situation.keepLabels)} 보장은 현재 상태에서 유지하시는 것이 좋습니다.`);
  }

  if (situation.gapLabels.length) {
    lines.push(
      `다만 ${joinLabels(situation.gapLabels)} 관련 보장이 부족한 상태로 확인되어, 보완 검토가 필요합니다.`,
    );
  }

  if (situation.uwNotes.length) {
    lines.push(situation.uwNotes[0]);
  }

  if (situation.recommendLabels.length) {
    lines.push(`우선 ${joinLabels(situation.recommendLabels)} 보장부터 검토해 보시는 것을 추천드립니다.`);
  }

  if (situation.nextActions.length) {
    lines.push(`다음 단계로는 ${situation.nextActions[0]}을(를) 진행해 보시면 좋겠습니다.`);
  }

  return {
    customer_label: situation.customerLabel,
    situation_summary: lines,
    medication: situation.medication,
    policy_count: situation.policyCount,
    policy_descriptions: situation.policyDescriptions,
    gap_labels: situation.gapLabels,
    recommend_labels: situation.recommendLabels,
    keep_labels: situation.keepLabels,
  };
}

export function buildDirectFactualAnswer(question, workingContext = {}) {
  const intent = detectDirectAnswerIntent(question);
  if (!intent) return null;

  const situation = extractCustomerSituation(workingContext);
  const { customerLabel } = situation;

  if (intent === "policy_count") {
    if (hasSsotPolicyCount(situation.policyCount)) {
      const countLine = situation.policyDescriptions.length
        ? `${customerLabel}, 현재 등록된 가입 보험은 ${situation.policyDescriptions.join(", ")} 포함 총 ${situation.policyCount}건입니다.`
        : `${customerLabel}, 현재 등록된 가입 보험은 총 ${situation.policyCount}건 확인됩니다.`;
      return [
        countLine,
        situation.keepLabels.length
          ? `특히 ${joinLabels(situation.keepLabels)} 보장은 유지하시면서 다른 부족한 보장을 점검해 보시는 것이 좋습니다.`
          : "보유 보험을 기준으로 부족한 보장이 있는지 함께 살펴보겠습니다.",
        situation.gapLabels.length
          ? `현재 ${joinLabels(situation.gapLabels)} 관련 보장 보완을 검토해 보시는 것을 추천드립니다.`
          : "추가로 궁금하신 보장이 있으시면 말씀해 주세요.",
      ]
        .filter(Boolean)
        .join(" ");
    }
    return `${customerLabel}, 현재 시스템에 등록된 가입 보험 정보를 찾지 못했습니다. 고객 분석 화면에서 보험 정보를 저장해 주시면 정확히 안내해 드리겠습니다.`;
  }

  if (intent === "insurer") {
    if (situation.policyDescriptions.length) {
      const insurers = Array.from(
        new Set(
          (workingContext.sourceSummary?.insurance ?? workingContext.sourceContext?.policies ?? [])
            .map((p) => p.insurer ?? p.insurer_name)
            .filter(Boolean),
        ),
      );
      return [
        `${customerLabel}, 현재 가입하신 보험사는 ${joinLabels(insurers)}입니다.`,
        situation.policyDescriptions.length
          ? `보유 상품은 ${situation.policyDescriptions.join(", ")}입니다.`
          : null,
        situation.gapLabels.length
          ? `기존 보험은 유지하시면서 ${joinLabels(situation.gapLabels)} 보장 보완을 함께 검토해 보시면 좋겠습니다.`
          : "추가로 보장 점검이 필요하시면 말씀해 주세요.",
      ]
        .filter(Boolean)
        .join(" ");
    }
    return `${customerLabel}, 현재 등록된 보험사 정보를 확인하지 못했습니다. 고객 분석 화면의 보험 정보를 확인해 주시면 바로 안내해 드리겠습니다.`;
  }

  if (intent === "medication") {
    if (situation.medication) {
      return [
        `${customerLabel}, 현재 기록된 복용 정보는 ${situation.medication}입니다.`,
        "이 정보는 신규 보험 가입 시 건강 고지와 인수 심사에서 참고될 수 있으니, 정확한 복용 이력을 함께 확인해 주시면 좋겠습니다.",
        situation.recommendLabels.length
          ? `보장 준비와 함께 ${joinLabels(situation.recommendLabels)} 관련 상담을 진행해 보시는 것을 추천드립니다.`
          : "추가 복용 약이나 병력이 있으시면 알려주시면 더 정확히 안내해 드리겠습니다.",
      ].join(" ");
    }
    return `${customerLabel}, 현재 복용 약 정보가 Memory에 기록되어 있지 않습니다. 복용 중인 약이 있으시면 알려주시면 보험 설계와 심사 안내에 반영해 드리겠습니다.`;
  }

  if (intent === "policy_terms") {
    return [
      `${customerLabel}, 암진단비 지급 조건은 가입하신 보험 약관에 따라 달라집니다.`,
      "일반적으로 암 진단 확정 시 진단서 제출 후 지급 여부가 결정되지만, 대기기간·면책·갱신 조건은 상품마다 다릅니다.",
      "정확한 지급 조건은 보유하신 약관 원문을 기준으로 확인하시고, 필요하시면 담당 설계사와 함께 검토해 보시는 것을 추천드립니다.",
    ].join(" ");
  }

  return null;
}

export function buildAdvisorStyleFallback(question, workingContext = {}) {
  const direct = buildDirectFactualAnswer(question, workingContext);
  if (direct) return direct.slice(0, 800);

  const context = buildCustomerFacingContext(workingContext);
  const { customer_label: customerLabel } = context;

  const parts = [`${customerLabel}, 질문해 주신 내용을 고객님의 현재 보장 상황과 함께 정리해 드리겠습니다.`];

  if (context.situation_summary.length) {
    parts.push(...context.situation_summary.slice(0, 4));
  } else {
    parts.push("현재 등록된 고객 정보를 바탕으로 보장 상태를 점검하고 있습니다.");
  }

  if (context.recommend_labels?.length) {
    parts.push(`우선 ${joinLabels(context.recommend_labels)} 보장부터 검토해 보시는 것을 추천드립니다.`);
  } else if (context.gap_labels?.length) {
    parts.push(`${joinLabels(context.gap_labels)} 관련 보장 보완을 먼저 살펴보시면 좋겠습니다.`);
  }

  parts.push("더 자세한 항목별 설명은 AI 보험 추천 화면에서도 함께 확인하실 수 있습니다.");

  return parts.join(" ").slice(0, 800);
}
