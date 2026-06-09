/**
 * Phase 27 — Customer-facing conversational tone helpers.
 * Friendly, professional Korean insurance advisor style.
 */

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

function parsePolicySummaryFact(factValue) {
  const text = String(factValue ?? "").trim();
  const match = text.match(/^([^/]+)\/([^(,\n]+)/);
  if (!match) return null;
  return {
    insurer: match[1].trim(),
    product: match[2].trim(),
  };
}

function buildPolicyFactLookup(facts) {
  const lookup = new Map();
  for (const fact of facts ?? []) {
    const key = String(fact.fact_key ?? "");
    if (!key.startsWith("insurance.policy.") || !key.endsWith(".summary")) continue;
    const policyId = key.slice("insurance.policy.".length, -".summary".length);
    lookup.set(policyId, fact.fact_value);
  }
  return lookup;
}

function normalizePolicyRow(policy, factLookup) {
  let insurer = policy.insurer_name ?? policy.insurer ?? null;
  let product = policy.product_name ?? policy.product ?? null;

  if ((!insurer || !product) && policy.id && factLookup.has(policy.id)) {
    const parsed = parsePolicySummaryFact(factLookup.get(policy.id));
    if (parsed) {
      insurer = insurer || parsed.insurer;
      product = product || parsed.product;
    }
  }

  return {
    ...policy,
    insurer_name: insurer,
    product_name: product,
    insurer,
    product,
  };
}

export function getFullPolicies(workingContext = {}) {
  const policies =
    workingContext.sourceContext?.policies ??
    workingContext.sourceSummary?.insurance ??
    [];
  const facts = workingContext.snapshot?.facts ?? [];
  const factLookup = buildPolicyFactLookup(facts);
  return (policies ?? []).map((policy) => normalizePolicyRow(policy, factLookup));
}

export function getPolicyCountFromContext(workingContext = {}) {
  const facts = workingContext.snapshot?.facts ?? [];
  const countFact = facts.find((fact) => fact.fact_key === "insurance.policy.count");
  const fromMemory = Number(countFact?.fact_value);
  if (Number.isFinite(fromMemory) && fromMemory > 0) return fromMemory;

  const policies = getFullPolicies(workingContext).filter(
    (policy) => policy.is_active !== false,
  );
  return policies.length;
}

export function getNamedPolicyDescriptions(workingContext = {}) {
  return getFullPolicies(workingContext)
    .filter((policy) => policy.is_active !== false)
    .map((policy) => {
      const insurer = String(policy.insurer ?? policy.insurer_name ?? "").trim();
      const product = String(policy.product ?? policy.product_name ?? "").trim();
      if (!insurer || !product) return "";
      return `${insurer} ${product}`;
    })
    .filter(Boolean);
}

export function getUniqueInsurers(workingContext = {}) {
  return Array.from(
    new Set(
      getFullPolicies(workingContext)
        .filter((policy) => policy.is_active !== false)
        .map((policy) => String(policy.insurer ?? policy.insurer_name ?? "").trim())
        .filter(Boolean),
    ),
  );
}

export const ADVISOR_TONE_SYSTEM_RULES = [
  "You are a LIFEGUARD customer insurance consultation assistant.",
  "Write in polite, warm, professional Korean — like an experienced insurance advisor speaking to a customer.",
  "Rules:",
  "- 3 to 8 sentences total. Maximum 800 Korean characters.",
  "- Start with the customer's actual situation (existing insurance, health memory, coverage status).",
  "- Answer the customer's specific question first, then add relevant context.",
  "- When Memory facts exist, reference them naturally (e.g. 복용 이력, 가입 보험).",
  "- End with one clear, actionable next step the customer can take.",
  "- Use conversational Korean. No markdown headings, bullet lists, or bold text.",
  "- Do NOT use raw engine terms: risk_score, gap_score, category codes, JSON field names, 'Top 2', 'Memory N건'.",
  "- Do NOT say '보장 공백 우선 항목은 X입니다' — instead explain naturally what is missing and why it matters.",
  "- Do not invent insurers, products, premiums, or approval/decline decisions.",
].join(" ");

export function detectDirectAnswerIntent(question = "") {
  const text = String(question).trim();
  if (/보험\s*(총\s*)?건수|몇\s*건|가입\s*보험\s*수|보유\s*보험/.test(text)) return "policy_count";
  if (/가입한\s*보험사|어느\s*보험사|보험사는/.test(text)) return "insurer";
  if (/가입한\s*보험은|보유\s*보험은|가입\s*보험은/.test(text)) return "policy_list";
  if (/복용\s*중인\s*약|먹는\s*약|복용약|약은/.test(text)) return "medication";
  if (/지급조건|약관|보장내용|청구\s*조건/.test(text)) return "policy_terms";
  return null;
}

export function extractCustomerSituation(workingContext = {}) {
  const snapshot = workingContext.snapshot ?? {};
  const facts = snapshot.facts ?? [];
  const sourceSummary = workingContext.sourceSummary ?? {};

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

  const policyDescriptions = getNamedPolicyDescriptions(workingContext);
  const policyCount = getPolicyCountFromContext(workingContext);
  const uniqueInsurers = getUniqueInsurers(workingContext);

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
    .map((item) => item.reason)
    .filter(Boolean);

  return {
    customerLabel,
    medication,
    policyCount,
    policyDescriptions,
    uniqueInsurers,
    keepLabels: keepLabels.length ? keepLabels : maintainedLabels,
    gapLabels,
    recommendLabels,
    uwNotes,
    designTitle: workingContext.designBundle?.customer_visible_design?.design_title ?? null,
    nextActions: (workingContext.designBundle?.customer_visible_design?.next_actions ?? []).slice(0, 2),
  };
}

export function buildCustomerFacingContext(workingContext = {}) {
  const situation = extractCustomerSituation(workingContext);
  const lines = [];

  if (situation.policyCount > 0) {
    if (situation.policyDescriptions.length) {
      lines.push(
        `현재 ${situation.customerLabel}께서는 ${situation.policyDescriptions.join(", ")} 포함 총 ${situation.policyCount}건을 보유하고 계십니다.`,
      );
    } else {
      lines.push(`현재 ${situation.customerLabel}께서는 등록된 보험이 ${situation.policyCount}건 확인됩니다.`);
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
    if (situation.policyCount > 0) {
      return [
        `${customerLabel}, 현재 등록된 가입 보험은 총 ${situation.policyCount}건입니다.`,
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
    if (situation.uniqueInsurers.length) {
      return [
        `${customerLabel}, 현재 가입하신 보험사는 ${joinLabels(situation.uniqueInsurers)}입니다.`,
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

  if (intent === "policy_list") {
    if (situation.policyDescriptions.length) {
      return [
        `${customerLabel}, 현재 가입하신 보험은 ${situation.policyDescriptions.join(", ")}입니다.`,
        `총 ${situation.policyCount}건이 등록되어 있습니다.`,
        situation.gapLabels.length
          ? `${joinLabels(situation.gapLabels)} 관련 보장 보완도 함께 검토해 보시면 좋겠습니다.`
          : "추가로 궁금하신 보장이 있으시면 말씀해 주세요.",
      ]
        .filter(Boolean)
        .join(" ");
    }
    return `${customerLabel}, 현재 등록된 가입 보험 상품 정보를 확인하지 못했습니다. 고객 분석 화면의 보험 정보를 확인해 주시면 바로 안내해 드리겠습니다.`;
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
