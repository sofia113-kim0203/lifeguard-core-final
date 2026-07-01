/**
 * KEY Judgment Rule Library
 *
 * Each entry is a judgment habit — not an ad-hoc if branch.
 * kind: judgment_rule — customer intent needs insurance judgment (not relational turn-taking).
 */
import { SALES_DIRECTOR_JUDGMENT_INTENTS } from "./salesDirectorFormatter.js";
import {
  classifyConsultationIntent,
  PREMIUM_BURDEN_COMPANION_CLUSTER_ID,
  COVERAGE_ANXIETY_COMPANION_CLUSTER_ID,
  RC_CONTINUITY_COMPANION_CLUSTER_ID,
} from "./intentGateLayer.js";
import { buildContinuityCompanionJudgment } from "./conversationContinuityBridge.js";
import { detectClaimTopic, findRelevantPolicies } from "./claimBridgeLayer.js";
import { abstractMemoryThemes } from "./salesDirectorPersona.js";

function normalizeQuestion(question = "") {
  return String(question ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(text = "") {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function resolvePolicyCountFromBundle(factBundle = {}) {
  if (typeof factBundle.policy_count === "number") return factBundle.policy_count;
  if (typeof factBundle.active_policy_count === "number") return factBundle.active_policy_count;
  if (Array.isArray(factBundle.policies)) return factBundle.policies.length;
  return 0;
}

function joinInsurerLabels(labels = []) {
  const list = labels.filter(Boolean);
  if (list.length === 0) return "";
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]}과 ${list[1]}`;
  return `${list.slice(0, -1).join(", ")}과 ${list[list.length - 1]}`;
}

function joinCoverageLabels(labels = []) {
  const list = labels.filter(Boolean);
  if (list.length === 0) return "";
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]}과 ${list[1]}`;
  return list.join(", ");
}

function resolveInsurerNamesFromBundle(factBundle = {}) {
  return Array.from(
    new Set((factBundle.policies ?? []).map((policy) => policy.insurer_name).filter(Boolean)),
  );
}

function resolveProductNamesFromBundle(factBundle = {}) {
  return Array.from(
    new Set(
      (factBundle.policies ?? [])
        .map((policy) => policy.product_name ?? policy.product ?? "")
        .filter(Boolean),
    ),
  );
}

function resolvePolicyStartDate(policy = {}) {
  return policy.effective_from ?? policy.contract_date ?? policy.start_date ?? null;
}

function formatKoreanJoinDate(raw) {
  if (raw == null || raw === "") return null;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}년 ${parsed.getMonth() + 1}월 ${parsed.getDate()}일`;
  }
  const text = String(raw).trim();
  return /\d{4}/.test(text) ? text : null;
}

function resolvePolicyJoinEntriesFromBundle(factBundle = {}) {
  return (factBundle.policies ?? [])
    .map((policy) => {
      const date = formatKoreanJoinDate(resolvePolicyStartDate(policy));
      if (!date) return null;
      return {
        label: policy.product_name ?? policy.product ?? "",
        date,
      };
    })
    .filter(Boolean);
}

function describePolicyJoinDates(entries = []) {
  if (entries.length === 0) return "";
  if (entries.length === 1) {
    const { label, date } = entries[0];
    if (label) return `${label} 가입일은 ${date}이에요.`;
    return `확인된 가입일은 ${date}이에요.`;
  }
  const labeled = entries.filter((entry) => entry.label);
  if (labeled.length === entries.length) {
    if (labeled.length === 2) {
      return `${labeled[0].label}은 ${labeled[0].date}에, ${labeled[1].label}은 ${labeled[1].date}에 가입하셨어요.`;
    }
    const phrase = labeled.map((entry) => `${entry.label}은 ${entry.date}`).join(", ");
    return `${phrase}에 가입하셨어요.`;
  }
  const uniqueDates = Array.from(new Set(entries.map((entry) => entry.date)));
  if (uniqueDates.length === 1) return `확인된 가입일은 ${uniqueDates[0]}이에요.`;
  return `확인된 가입일은 ${joinInsurerLabels(uniqueDates)}입니다.`;
}

function extractCoverageRiderLabel(item) {
  if (typeof item === "string") {
    const text = String(item).trim();
    return text || null;
  }
  if (item && typeof item === "object") {
    const label = String(
      item.normalized_name ?? item.name ?? item.rider_name ?? item.label ?? item.coverage_line ?? "",
    ).trim();
    return label || null;
  }
  return null;
}

function resolveCoverageLabelsFromBundle(factBundle = {}) {
  const riderLabels = [];
  for (const policy of factBundle.policies ?? []) {
    const riders = policy.coverage_summary?.riders;
    if (!Array.isArray(riders)) continue;
    for (const item of riders) {
      const label = extractCoverageRiderLabel(item);
      if (label) riderLabels.push(label);
    }
  }
  const uniqueRiders = Array.from(new Set(riderLabels));
  if (uniqueRiders.length > 0) return uniqueRiders;
  return resolveProductNamesFromBundle(factBundle);
}

function isCoveragePresenceOnlyQuestion(q = "") {
  if (/부족|충분|괜찮|모자|공백|갭/.test(q)) return false;
  if (/(?:어떤|무슨)\s*보장/.test(q)) return false;
  if (/보장이\s*(?:뭐|무엇)/.test(q)) return false;
  if (/(?:내|가입)\s*보장\s*(?:뭐|무엇|어떤)/.test(q)) return false;
  return /(?:암|실손|운전자|뇌|심)[^\n]{0,12}(?:보장|담보|보험)?[^\n]{0,10}(?:있(?:어|나|음|습)?|가입|들어|보유|돼|되어)/.test(
    q,
  );
}

function isClaimReceiveEligibilityQuestion(q = "") {
  if (/청구/.test(q) && !/(?:받을|보험금|나올|사고)/.test(q)) return false;
  if (/(?:얼마|몇\s*(?:만|원)).{0,12}(?:받|지급)/.test(q)) return false;
  if (/언제.{0,12}(?:받|지급|들어)/.test(q)) return false;
  if (/(?:무슨|어떤)\s*서류/.test(q)) return false;
  return /(?:받을(?:\s*수|\s*거)?|보험금|나올|사고)/.test(q);
}

function buildClaimReceiveEligibilityJudgment({ factBundle = {}, question = "" } = {}) {
  const q = normalizeQuestion(question || factBundle.question || "");
  const policies = factBundle.policies ?? [];
  const count = resolvePolicyCountFromBundle(factBundle);
  const topic = detectClaimTopic(q);
  const policyMatch = findRelevantPolicies(policies, topic);

  if (count === 0 && policies.length === 0) {
    return "지금은 등록된 가입 보험 정보를 찾지 못했어요.";
  }

  if (topic.topicKey) {
    if (policyMatch.found) {
      const names = Array.from(
        new Set(policyMatch.matched_policies.map((policy) => policy.product).filter(Boolean)),
      );
      const productPhrase = names.length > 0 ? joinInsurerLabels(names) : "가입 보험";
      return `${productPhrase} 쪽 담보는 확인돼요. ${topic.label}로 지급 가능한지는 약관과 진단 내용을 함께 봐야 합니다.`;
    }
    return `지금 자료만으로는 ${topic.label} 관련 담보가 확인되지 않았어요.`;
  }

  const policyTotal = count > 0 ? count : policies.length;
  return `가입된 보험은 ${policyTotal}개 확인돼요. 어떤 사고·치료였는지에 따라 열려 있는 축이 달라집니다.`;
}

function isClaimFilingQuestion(q = "") {
  if (!/청구/.test(q)) return false;
  if (/(?:무슨|어떤)\s*서류/.test(q)) return false;
  if (/(?:얼마|몇\s*(?:만|원)).{0,12}(?:받|지급|나)/.test(q)) return false;
  if (/언제.{0,12}(?:받|지급|들어|나)/.test(q)) return false;
  return true;
}

function buildClaimFilingJudgment({ factBundle = {}, question = "" } = {}) {
  const q = normalizeQuestion(question || factBundle.question || "");
  const policies = factBundle.policies ?? [];
  const count = resolvePolicyCountFromBundle(factBundle);
  const topic = detectClaimTopic(q);
  const policyMatch = findRelevantPolicies(policies, topic);
  const topicLabel = topic.label ?? "해당";

  if (count === 0 && policies.length === 0) {
    return "지금은 등록된 가입 보험 정보를 찾지 못했어요.";
  }

  if (topic.topicKey && policyMatch.found) {
    const names = Array.from(
      new Set(policyMatch.matched_policies.map((policy) => policy.product).filter(Boolean)),
    );
    const productPhrase = names.length > 0 ? joinInsurerLabels(names) : "가입 보험";
    return `${productPhrase} 쪽 담보는 확인돼요. ${topicLabel} 청구는 약관과 필요 서류를 함께 보면서 차근차근 확인할 수 있습니다.`;
  }

  if (topic.topicKey && !policyMatch.found) {
    return `지금 자료만으로는 ${topicLabel} 관련 청구 축이 확인되지 않았어요.`;
  }

  const policyTotal = count > 0 ? count : policies.length;
  return `가입된 보험은 ${policyTotal}개 확인돼요. 어떤 사고·치료인지 알려주시면 청구 가능 축부터 함께 확인할 수 있습니다.`;
}

function isClaimDocumentsQuestion(q = "") {
  return (
    /(?:무슨|어떤)\s*서류/.test(q) ||
    /서류.{0,8}(?:뭐|무엇|필요|준비|챙)/.test(q) ||
    /(?:필요|준비|제출).{0,8}서류/.test(q)
  );
}

function buildClaimDocumentsJudgment({ factBundle = {}, question = "" } = {}) {
  const q = normalizeQuestion(question || factBundle.question || "");
  const topic = detectClaimTopic(q);
  const docs = topic.documents ?? ["진단서", "의료비 영수증"];
  const docPhrase = joinCoverageLabels(docs);

  if (topic.topicKey) {
    return `${topic.label} 청구 검토에는 보통 ${docPhrase} 등이 필요해요.`;
  }

  const policies = factBundle.policies ?? [];
  const count = resolvePolicyCountFromBundle(factBundle);
  if (count === 0 && policies.length === 0) {
    return "지금은 등록된 가입 보험 정보를 찾지 못했어요.";
  }

  return `청구 검토에는 보통 ${docPhrase} 등이 필요해요.`;
}

function isMemoryRecallQuestion(q = "") {
  if (/^기억(?:해|나)\??$/.test(q)) return true;
  if (/뭐라고\s*(?:했|말)/.test(q)) return true;
  if (/걱정.{0,12}(?:했|하|한|던).{0,12}기억/.test(q)) return true;
  if (!/기억/.test(q)) return false;
  return (
    /(?:지난번|저번|전에|예전|이전).{0,12}(?:이야기|얘기|말|상담|걱정)/.test(q) ||
    /(?:전에|예전|이전).{0,12}(?:말|얘기|이야기|걱정).{0,10}(?:했|하|한|던)/.test(q) ||
    /(?:기억|기억해|기억나).{0,12}(?:지난|저번|전에|예전|이전|걱정)/.test(q) ||
    (/뭐라고\s*(?:했|말)/.test(q) && /기억/.test(q))
  );
}

function resolveMemoryFactsFromBundle(factBundle = {}) {
  const facts = factBundle.memory_facts ?? factBundle.memoryFacts ?? [];
  if (!Array.isArray(facts)) return [];
  return facts.filter((fact) => fact && (fact.fact_key || fact.fact_value || fact.value));
}

const SPECIFIC_MEMORY_THEMES = new Set(["보험료 부담", "암 관련 걱정", "보장 걱정"]);

function resolveMemoryConfidenceLevel(facts = []) {
  if (facts.length === 0) return "none";
  const themes = abstractMemoryThemes(facts, null, 2);
  if (themes.some((theme) => SPECIFIC_MEMORY_THEMES.has(theme))) {
    return "confirmed";
  }
  return "theme_only";
}

function buildMemoryRecallJudgment({ factBundle = {}, question = "" } = {}) {
  const facts = resolveMemoryFactsFromBundle(factBundle);
  const count =
    typeof factBundle.memory_fact_count === "number"
      ? factBundle.memory_fact_count
      : facts.length;

  if (facts.length === 0 || count === 0) {
    return "지금은 확인된 기억이 없어요.";
  }

  const level = resolveMemoryConfidenceLevel(facts);
  const themes = abstractMemoryThemes(facts, null, 2);

  if (level === "confirmed") {
    if (themes.length === 1) {
      return `저장해 둔 상담 맥락이 확인돼요. ${themes[0]} 쪽으로 이어서 이해하고 있어요.`;
    }
    return `저장해 둔 상담 맥락이 확인돼요. ${joinCoverageLabels(themes)} 쪽으로 이어서 이해하고 있어요.`;
  }

  const theme = themes[0] ?? "";
  if (theme && theme !== "상담 맥락") {
    return `${theme} 쪽을 걱정하셨던 걸로 이해하고 있어요.`;
  }
  return "그 부분을 걱정하셨던 걸로 이해하고 있어요.";
}

function isClaimAmountQuestion(q = "") {
  return (
    /(?:얼마|몇\s*(?:만|원|천)).{0,12}(?:받|지급|나)/.test(q) ||
    /(?:받|지급|보험금).{0,12}(?:얼마|몇\s*(?:만|원))/.test(q)
  );
}

function isClaimTimingQuestion(q = "") {
  return (
    /언제.{0,12}(?:받|지급|들어|나)/.test(q) ||
    /(?:받|지급).{0,12}언제/.test(q) ||
    /며칠.{0,8}(?:걸|걸려|소요)/.test(q)
  );
}

function formatCoverageAmount(raw) {
  const n = Number(String(raw ?? "").replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${n.toLocaleString("ko-KR")}원`;
}

function resolveConfirmedCoverageAmountsFromBundle(factBundle = {}, topic = {}) {
  const keywords = (topic.policyKeywords ?? topic.keywords ?? []).map((kw) =>
    String(kw).toLowerCase(),
  );
  const entries = [];

  for (const policy of factBundle.policies ?? []) {
    const riders = policy.coverage_summary?.riders;
    if (!Array.isArray(riders)) continue;
    for (const item of riders) {
      const label = extractCoverageRiderLabel(item);
      if (!label) continue;
      const amountRaw =
        item && typeof item === "object"
          ? (item.amount ?? item.coverage_amount ?? item.coverageAmount)
          : null;
      const amount = formatCoverageAmount(amountRaw);
      if (!amount) continue;
      if (topic.topicKey && keywords.length > 0) {
        const labelLower = label.toLowerCase();
        if (!keywords.some((kw) => labelLower.includes(kw))) continue;
      }
      entries.push({ label, amount });
    }
  }

  return entries;
}

function buildClaimAmountJudgment({ factBundle = {}, question = "" } = {}) {
  const q = normalizeQuestion(question || factBundle.question || "");
  const topic = detectClaimTopic(q);
  const policies = factBundle.policies ?? [];
  const count = resolvePolicyCountFromBundle(factBundle);
  const entries = resolveConfirmedCoverageAmountsFromBundle(factBundle, topic);

  if (count === 0 && policies.length === 0) {
    return "지금은 등록된 가입 보험 정보를 찾지 못했어요.";
  }

  if (entries.length === 1) {
    return `확인된 ${entries[0].label} 가입금액은 ${entries[0].amount}이에요. 실제 지급액은 약관·심사에 따라 달라집니다.`;
  }
  if (entries.length > 1) {
    const phrase = entries.map((entry) => `${entry.label} ${entry.amount}`).join(", ");
    return `확인된 가입금액은 ${phrase}입니다. 실제 지급액은 약관·심사에 따라 달라집니다.`;
  }

  return "지금 자료만으로는 받을 수 있는 금액을 단정하기 어려워요.";
}

function buildClaimTimingJudgment({ factBundle = {}, question = "" } = {}) {
  const q = normalizeQuestion(question || factBundle.question || "");
  const topic = detectClaimTopic(q);
  const policies = factBundle.policies ?? [];
  const count = resolvePolicyCountFromBundle(factBundle);

  if (count === 0 && policies.length === 0) {
    return "지금은 등록된 가입 보험 정보를 찾지 못했어요.";
  }

  if (topic.topicKey) {
    return `${topic.label} 관련 지급 시점은 서류 제출과 보험사 심사 일정에 따라 달라집니다. 지금 자료만으로는 구체적인 날짜를 단정하기 어려워요.`;
  }

  return "보험금 지급 시점은 서류 제출과 보험사 심사 일정에 따라 달라집니다. 지금 자료만으로는 구체적인 날짜를 단정하기 어려워요.";
}

function buildUnderwritingBoundJudgment({ question = "", factBundle = {} } = {}) {
  const q = normalizeQuestion(question);
  const topicPatterns = [
    { pattern: /고혈압|혈압/, label: "고혈압" },
    { pattern: /당뇨/, label: "당뇨" },
    { pattern: /건강\s*상태/, label: "건강 상태" },
    { pattern: /암/, label: "암" },
    { pattern: /실손/, label: "실손" },
    { pattern: /운전자/, label: "운전자" },
  ];

  let topic = null;
  for (const { pattern, label } of topicPatterns) {
    if (pattern.test(q)) {
      topic = label;
      break;
    }
  }
  if (!topic) {
    topic =
      (factBundle.underwriting_review_flags ?? [])[0] ??
      (factBundle.underwriting_health_topics ?? [])[0] ??
      null;
  }

  const hasStored =
    factBundle.underwriting_used === true || factBundle.has_stored_underwriting_analysis === true;

  if (hasStored) {
    if (topic) {
      return `가입 가능 여부는 단정할 수 없고, 저장된 분석 기준으로 ${topic} 관련 인수심사 확인이 필요합니다.`;
    }
    return "가입 가능 여부는 단정할 수 없고, 저장된 분석 기준으로 인수심사 확인이 필요합니다.";
  }

  return "가입 가능 여부는 단정할 수 없습니다. 건강 관련 정보와 인수 기준 확인이 먼저 필요합니다.";
}

function buildRecommendationPriorityJudgment({ question = "", factBundle = {} } = {}) {
  const labels = factBundle.recommendation_priority_labels ?? [];
  const hasStored =
    factBundle.recommendation_used === true || factBundle.has_stored_recommendation_analysis === true;

  if (hasStored && labels.length >= 2) {
    return `저장된 분석 기준으로, 지금 우선 같이 짚을 여지가 있는 축은 ${labels[0]}과 ${labels[1]}입니다. 어느 쪽부터 볼지는 같이 정하면 됩니다.`;
  }
  if (hasStored && labels.length === 1) {
    return `저장된 분석 기준으로, 지금 우선 같이 짚을 여지가 있는 축은 ${labels[0]} 쪽입니다. 어느 쪽부터 볼지는 같이 정하면 됩니다.`;
  }
  return "저장된 우선순위 분석이 아직 없어, 지금은 보장 구조부터 같이 보면 됩니다.";
}

function buildDesignPriorityJudgment({ factBundle = {} } = {}) {
  const labels = (factBundle.design_priority_coverages ?? []).filter(Boolean);
  const hasStored =
    factBundle.design_used === true || factBundle.has_stored_design_analysis === true;

  if (hasStored && labels.length >= 2) {
    return `저장된 설계 기준으로, 지금 우선 같이 짚을 축은 ${joinCoverageLabels(labels.slice(0, 2))}입니다. 어느 쪽부터 볼지는 같이 정하면 됩니다.`;
  }
  if (hasStored && labels.length === 1) {
    return `저장된 설계 기준으로, 지금 우선 같이 짚을 축은 ${labels[0]} 쪽입니다. 어느 쪽부터 볼지는 같이 정하면 됩니다.`;
  }
  if (hasStored) {
    return "저장된 설계 자료는 확인됐어요. 우선순위 축부터 같이 보면 됩니다.";
  }
  return "저장된 설계 분석이 아직 없어, 지금은 보장 구조부터 같이 보면 됩니다.";
}

function buildDesignReviewJudgment({ factBundle = {} } = {}) {
  const hasStored =
    factBundle.design_used === true || factBundle.has_stored_design_analysis === true;
  const title = factBundle.design_title ?? null;
  const summary = factBundle.design_summary ?? null;
  const keep = (factBundle.design_keep_coverages ?? []).filter(Boolean).slice(0, 2);

  if (!hasStored) {
    return "저장된 설계안이 아직 없어, 지금은 현재 보유 계약부터 같이 정리하면 됩니다.";
  }

  const parts = [];
  if (title && summary) {
    parts.push(`저장된 설계(${title}) 요약은 "${summary}"입니다.`);
  } else if (summary) {
    parts.push(`저장된 설계 요약은 "${summary}"입니다.`);
  } else if (title) {
    parts.push(`저장된 설계(${title}) 자료는 확인됐어요. 세부 구조는 같이 봐야 합니다.`);
  } else {
    parts.push("저장된 설계 자료는 확인됐어요. 요약부터 같이 보면 됩니다.");
  }

  if (keep.length > 0) {
    parts.push(`유지 축으로는 ${joinCoverageLabels(keep)} 쪽이 보입니다.`);
  }

  return parts.join(" ");
}

/** @type {Array<{ id: string, kind: "judgment_rule", scene: string, reason: string, match: (ctx: object) => boolean, buildJudgment: (ctx?: object) => string }>} */
export const KEY_JUDGMENT_RULES = [
  {
    id: "premium_burden_companion_judgment",
    kind: "judgment_rule",
    scene: "B",
    reason:
      "JC-PREMIUM-BURDEN-v1 — burden/reduction paraphrases share companion judgment, not lookup or generic consult.",
    match({ factBundle = {} } = {}) {
      return factBundle.companion_cluster === PREMIUM_BURDEN_COMPANION_CLUSTER_ID;
    },
    buildJudgment() {
      return "보험료 부담이 크게 느껴지시는 것 같아요. 어디서 부담이 큰지부터 같이 짚어보면, 줄일지 유지할지 순서가 보입니다.";
    },
  },
  {
    id: "coverage_anxiety_companion_judgment",
    kind: "judgment_rule",
    scene: "B",
    reason:
      "JC-COVERAGE-ANXIETY-v1 — insecurity paraphrases share companion judgment; gap tool loads but no inventory dump opener.",
    match({ factBundle = {} } = {}) {
      return factBundle.companion_cluster === COVERAGE_ANXIETY_COMPANION_CLUSTER_ID;
    },
    buildJudgment() {
      return "보장이 걱정되시는 마음은 이해해요. 지금 자료로 확인되는 범위부터 같이 짚어보면, 부족한지 유지할지 순서가 보입니다.";
    },
  },
  {
    id: "continuity_companion_judgment",
    kind: "judgment_rule",
    scene: "R",
    reason:
      "RC-CONTINUITY-COMPANION-v1 — continuity paraphrases bridge to Companion; memory present/absent shapes only.",
    match({ factBundle = {} } = {}) {
      return factBundle.companion_cluster === RC_CONTINUITY_COMPANION_CLUSTER_ID;
    },
    buildJudgment(ctx = {}) {
      return buildContinuityCompanionJudgment(ctx);
    },
  },
  {
    id: "memory_recall_judgment",
    kind: "judgment_rule",
    scene: "M",
    reason:
      "Customer asks if KEY remembers — confirmed memory_fact themes only, never history alone.",
    match({ question = "", classificationIntent = "" } = {}) {
      const q = normalizeQuestion(question);
      if (!q || !isMemoryRecallQuestion(q)) return false;
      if (classificationIntent === "memory_recall_lookup") return true;
      return isMemoryRecallQuestion(q);
    },
    buildJudgment(ctx = {}) {
      return buildMemoryRecallJudgment(ctx);
    },
  },
  {
    id: "claim_documents_judgment",
    kind: "judgment_rule",
    scene: "D",
    reason:
      "Customer asks which documents — KEY names confirmed document types and a clear next step, not system filler.",
    match({ question = "", classificationIntent = "" } = {}) {
      const q = normalizeQuestion(question);
      if (!q || !isClaimDocumentsQuestion(q)) return false;
      if (classificationIntent === "claim_eligibility_check") return true;
      return isClaimDocumentsQuestion(q);
    },
    buildJudgment(ctx = {}) {
      return buildClaimDocumentsJudgment(ctx);
    },
  },
  {
    id: "claim_amount_lookup_judgment",
    kind: "judgment_rule",
    scene: "D",
    reason:
      "Customer asks payout amount — KEY states confirmed coverage amounts only, never estimated payout.",
    match({ question = "", classificationIntent = "" } = {}) {
      const q = normalizeQuestion(question);
      if (!q || !isClaimAmountQuestion(q)) return false;
      if (classificationIntent === "claim_eligibility_check") return true;
      return isClaimAmountQuestion(q);
    },
    buildJudgment(ctx = {}) {
      return buildClaimAmountJudgment(ctx);
    },
  },
  {
    id: "claim_timing_lookup_judgment",
    kind: "judgment_rule",
    scene: "D",
    reason:
      "Customer asks when payout arrives — KEY explains process bounds, never invents dates.",
    match({ question = "", classificationIntent = "" } = {}) {
      const q = normalizeQuestion(question);
      if (!q || !isClaimTimingQuestion(q)) return false;
      if (classificationIntent === "claim_eligibility_check") return true;
      return isClaimTimingQuestion(q);
    },
    buildJudgment(ctx = {}) {
      return buildClaimTimingJudgment(ctx);
    },
  },
  {
    id: "claim_filing_judgment",
    kind: "judgment_rule",
    scene: "D",
    reason:
      "Customer asks if they can file a claim — KEY reassures with confirmed facts and shared review, not false approval.",
    match({ question = "", classificationIntent = "" } = {}) {
      const q = normalizeQuestion(question);
      if (!q || !isClaimFilingQuestion(q)) return false;
      if (classificationIntent === "claim_eligibility_check") return true;
      return isClaimFilingQuestion(q);
    },
    buildJudgment(ctx = {}) {
      return buildClaimFilingJudgment(ctx);
    },
  },
  {
    id: "claim_eligibility_judgment",
    kind: "judgment_rule",
    scene: "D",
    reason:
      "Customer asks about receiving money — KEY opens with claim scope, not generic system filler.",
    match({ question = "", resolvedIntent = null, classificationIntent = "" } = {}) {
      const q = normalizeQuestion(question);
      if (!q) return false;

      if (
        resolvedIntent === SALES_DIRECTOR_JUDGMENT_INTENTS.CLAIM_OPPORTUNITY ||
        resolvedIntent === SALES_DIRECTOR_JUDGMENT_INTENTS.ACCIDENT_CLAIM
      ) {
        return isClaimReceiveEligibilityQuestion(q);
      }

      if (classificationIntent === "claim_eligibility_check") {
        return isClaimReceiveEligibilityQuestion(q);
      }

      return isClaimReceiveEligibilityQuestion(q);
    },
    buildJudgment(ctx = {}) {
      return buildClaimReceiveEligibilityJudgment(ctx);
    },
  },
  {
    id: "mixed_turn_premium_judgment",
    kind: "judgment_rule",
    scene: "B",
    reason:
      "Thanks or greeting plus premium worry — insurance judgment leads, not social pattern.",
    match({ question = "", resolvedIntent = null } = {}) {
      const q = normalizeQuestion(question);
      if (!q) return false;
      if (!/(?:고마워|감사|안녕|하이|반가)/.test(q)) return false;
      if (!/(?:보험료|부담|비싸|무거(?:운|워)?)/.test(q)) return false;
      if (resolvedIntent === SALES_DIRECTOR_JUDGMENT_INTENTS.PREMIUM_INTERPRETATION) {
        return true;
      }
      return /(?:보험료|부담|비싸)/.test(q);
    },
    buildJudgment() {
      return "보험료 부담이 실제로 큰지는, 총액과 항목별 비중을 나눠 봐야 합니다.";
    },
  },
  {
    id: "premium_lookup_judgment",
    kind: "judgment_rule",
    scene: "F",
    reason:
      "Customer asks how much premium — KEY opens with lookup scope, not generic system filler.",
    match({ question = "", resolvedIntent = null, factBundle = {} } = {}) {
      const q = normalizeQuestion(question);
      if (!q) return false;
      if (factBundle.companion_cluster === PREMIUM_BURDEN_COMPANION_CLUSTER_ID) {
        return false;
      }
      if (resolvedIntent === SALES_DIRECTOR_JUDGMENT_INTENTS.PREMIUM_INTERPRETATION) {
        return false;
      }
      if (/부담|비싸|무거/.test(q) && !/(?:얼마|몇)/.test(q)) {
        return false;
      }
      const lookupSub =
        factBundle.lookup_sub_intent ?? classifyConsultationIntent(q).lookup_sub_intent ?? "";
      if (lookupSub === "premium_lookup") return true;
      return /(?:보험료|납입).{0,8}(?:얼마|몇)|(?:얼마|몇).{0,8}(?:보험료|납입)/.test(q);
    },
    buildJudgment({ factBundle = {} } = {}) {
      const stats = factBundle.premium_stats ?? {};
      const premiumKnown = (stats.premiumKnownCount ?? 0) > 0 && (stats.premiumTotal ?? 0) > 0;
      if (premiumKnown) {
        return `현재 확인 가능한 월 보험료는 ${Number(stats.premiumTotal).toLocaleString("ko-KR")}원입니다.`;
      }
      return "지금은 월 납입액이 모두 확인되지 않았어요.";
    },
  },
  {
    id: "policy_count_lookup_judgment",
    kind: "judgment_rule",
    scene: "F",
    reason:
      "Customer asks how many policies — KEY leads with confirmed count, not system filler.",
    match({ question = "" } = {}) {
      const q = normalizeQuestion(question);
      if (!q) return false;
      if (/부족|충분|괜찮|얼마|부담|보험료|받을|청구/.test(q)) return false;
      if (!/(?:보험|가입|계약)/.test(q)) return false;
      return (
        /(?:몇\s*(?:개|건)|개수|몇개)/.test(q) ||
        /(?:보험|가입|계약).{0,10}(?:몇|개수)/.test(q)
      );
    },
    buildJudgment({ factBundle = {} } = {}) {
      const count = resolvePolicyCountFromBundle(factBundle);
      if (count > 0) return `지금 확인된 가입 보험은 ${count}개예요.`;
      return "지금은 등록된 가입 보험 정보를 찾지 못했어요.";
    },
  },
  {
    id: "insurer_lookup_judgment",
    kind: "judgment_rule",
    scene: "F",
    reason:
      "Customer asks which insurers — KEY leads with confirmed insurer names, not system filler.",
    match({ question = "" } = {}) {
      const q = normalizeQuestion(question);
      if (!q) return false;
      if (/(?:몇\s*(?:개|건)|개수|몇개|얼마|부담|보험료)/.test(q)) return false;
      if (!/(?:보험사|회사)/.test(q) && !/(?:어디|어느).{0,6}(?:보험|가입)/.test(q)) {
        return false;
      }
      return /(?:가입|보험|계약)/.test(q);
    },
    buildJudgment({ factBundle = {} } = {}) {
      const insurers = resolveInsurerNamesFromBundle(factBundle);
      if (insurers.length > 0) {
        return `가입하신 보험사는 ${joinInsurerLabels(insurers)}이에요.`;
      }
      return "지금은 가입 보험사 정보를 확인하지 못했어요.";
    },
  },
  {
    id: "product_lookup_judgment",
    kind: "judgment_rule",
    scene: "F",
    reason:
      "Customer asks which products they hold — KEY leads with confirmed product names, not system filler.",
    match({ question = "" } = {}) {
      const q = normalizeQuestion(question);
      if (!q) return false;
      if (/언제|가입일|몇\s*년|날짜|년도/.test(q)) return false;
      if (/어떤\s*보장|무슨\s*보장|보장이\s*있|담보/.test(q)) return false;
      if (/(?:몇\s*(?:개|건)|개수|몇개|얼마|부담|보험료)/.test(q)) return false;
      if (/(?:보험사|회사)/.test(q) && !/(?:상품|어떤\s*보험|무슨\s*보험)/.test(q)) return false;
      if (/[가-힣]+보장\s*있|(?:실손|암|운전자).{0,6}있(?:어|나|음)?/.test(q)) return false;
      return (
        /(?:가입|들(?:었|은|어)|든).{0,12}(?:보험|상품)/.test(q) ||
        /(?:어떤|무슨|뭐).{0,8}(?:보험|상품)/.test(q) ||
        /(?:보험|상품).{0,8}(?:뭐|무엇|어떤|무슨)/.test(q)
      );
    },
    buildJudgment({ factBundle = {} } = {}) {
      const products = resolveProductNamesFromBundle(factBundle);
      if (products.length > 0) {
        return `지금 확인된 가입 상품은 ${joinInsurerLabels(products)}입니다.`;
      }
      return "지금은 가입 상품 정보를 확인하지 못했어요.";
    },
  },
  {
    id: "join_date_lookup_judgment",
    kind: "judgment_rule",
    scene: "F",
    reason:
      "Customer asks when they enrolled — KEY leads with confirmed join dates, not system filler.",
    match({ question = "" } = {}) {
      const q = normalizeQuestion(question);
      if (!q) return false;
      if (/어떤\s*보장|무슨\s*보장|보장이\s*있|담보/.test(q)) return false;
      if (/(?:몇\s*(?:개|건)|개수|얼마|부담|보험료)/.test(q)) return false;
      if (/(?:보험사|회사)/.test(q) && !/(?:언제|가입일|계약일)/.test(q)) return false;
      if (/(?:가입한|어떤|무슨)\s*보험.{0,6}(?:뭐|무엇)/.test(q)) return false;
      return (
        /(?:언제|몇\s*년).{0,12}(?:가입|들|든|계약)/.test(q) ||
        /(?:가입|계약).{0,12}(?:언제|날짜|일)/.test(q) ||
        /(?:가입일|계약일)/.test(q) ||
        (/몇\s*년\s*됐/.test(q) && /(?:보험|가입|들)/.test(q))
      );
    },
    buildJudgment({ factBundle = {} } = {}) {
      const entries = resolvePolicyJoinEntriesFromBundle(factBundle);
      if (entries.length > 0) return describePolicyJoinDates(entries);
      return "지금은 가입일 정보를 확인하지 못했어요.";
    },
  },
  {
    id: "coverage_list_lookup_judgment",
    kind: "judgment_rule",
    scene: "F",
    reason:
      "Customer asks which coverages they have — KEY leads with confirmed rider or product facts, not system filler.",
    match({ question = "" } = {}) {
      const q = normalizeQuestion(question);
      if (!q) return false;
      if (/(?:몇\s*(?:개|건)|개수|얼마|부담|보험료|언제|가입일|계약일)/.test(q)) return false;
      if (/(?:보험사|회사)/.test(q)) return false;
      if (isCoveragePresenceOnlyQuestion(q)) return false;
      return (
        /(?:어떤|무슨)\s*보장/.test(q) ||
        /보장이\s*(?:있|뭐|무엇)/.test(q) ||
        /(?:내|가입)\s*보장\s*(?:뭐|무엇|어떤)/.test(q) ||
        /(?:어떤|무슨)\s*담보/.test(q)
      );
    },
    buildJudgment({ factBundle = {} } = {}) {
      const labels = resolveCoverageLabelsFromBundle(factBundle);
      if (labels.length > 0) {
        return `지금 확인된 보장은 ${joinCoverageLabels(labels)}입니다.`;
      }
      return "지금은 보장 정보를 확인하지 못했어요.";
    },
  },
  {
    id: "mixed_turn_greeting_insurance_open",
    kind: "judgment_rule",
    scene: "A",
    reason:
      "Greeting plus insurance mention without a specific topic — KEY opens consultation, not system filler.",
    match({ question = "" } = {}) {
      const q = normalizeQuestion(question);
      if (!q) return false;
      if (!/(?:안녕|하이|반가|헬로|hello)/i.test(q)) return false;
      if (!/보험/.test(q)) return false;
      if (
        /(?:보험료|부담|비싸|암|실손|있(?:어|나|음)?|받을|청구|부족|괜찮|사고|보험금)/.test(q)
      ) {
        return false;
      }
      return true;
    },
    buildJudgment() {
      return "네, 말씀 주신 보험 이야기부터 같이 확인해 보겠습니다.";
    },
  },
  {
    id: "underwriting_bound_judgment",
    kind: "judgment_rule",
    scene: "U",
    reason:
      "Customer asks enrollment bound with health context — KEY states limitation and review need, never binding approval/decline.",
    match({ question = "", classificationIntent = "" } = {}) {
      if (classificationIntent === "underwriting_bound_check") return true;
      const q = normalizeQuestion(question);
      if (!q) return false;
      return (
        /(?:고혈압|당뇨|질병|건강(?:\s*상태)?).{0,24}(?:가입|들\s*수|거절|인수)/.test(q) ||
        (/건강\s*상태/.test(q) && /거절/.test(q))
      );
    },
    buildJudgment(ctx = {}) {
      return buildUnderwritingBoundJudgment(ctx);
    },
  },
  {
    id: "recommendation_priority_judgment",
    kind: "judgment_rule",
    scene: "R",
    reason:
      "Customer asks what to add first — KEY cites stored top2 coverage directions only, never product sales.",
    match({ classificationIntent = "" } = {}) {
      return classificationIntent === "recommendation_priority_check";
    },
    buildJudgment(ctx = {}) {
      return buildRecommendationPriorityJudgment(ctx);
    },
  },
  {
    id: "design_priority_judgment",
    kind: "judgment_rule",
    scene: "D",
    reason:
      "Customer asks stored design priority — KEY cites design_priority_coverages only, never product enrollment.",
    match({ classificationIntent = "" } = {}) {
      return classificationIntent === "design_priority_check";
    },
    buildJudgment(ctx = {}) {
      return buildDesignPriorityJudgment(ctx);
    },
  },
  {
    id: "design_review_judgment",
    kind: "judgment_rule",
    scene: "D",
    reason:
      "Customer asks to review stored design — KEY readbacks title/summary/keep only, never binding plan approval.",
    match({ classificationIntent = "" } = {}) {
      return classificationIntent === "design_review_check";
    },
    buildJudgment(ctx = {}) {
      return buildDesignReviewJudgment(ctx);
    },
  },
];

export function resolveKeyJudgmentRule(ctx = {}) {
  for (const rule of KEY_JUDGMENT_RULES) {
    if (rule.match(ctx)) return rule;
  }
  return null;
}

export function buildKeyJudgmentFromRules(ctx = {}) {
  const rule = resolveKeyJudgmentRule(ctx);
  if (!rule) return null;
  return normalizeText(rule.buildJudgment(ctx));
}

export {
  resolveMemoryConfidenceLevel,
  resolveMemoryFactsFromBundle,
  buildMemoryRecallJudgment,
  buildClaimReceiveEligibilityJudgment,
};
