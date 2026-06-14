/**
 * Phase 29-A — Intent Gate for customer conversational QA.
 * Routes questions to pipeline manifests; factual_lookup answers from policy list before Gap.
 * Phase 31-C-P1 — policy_detail uses Policy Explorer helpers for per-contract chat answers.
 */
import { resolveUnifiedPolicyView } from "./customerConversationalTone.js";
import {
  computePolicyExplorerStats,
  formatInsurerName,
  formatPolicyPremium,
  formatPolicySource,
  formatPolicyStatus,
  formatPolicyType,
  formatProductName,
  formatRiderLines,
  hasStructuredRiders,
  mergePolicyRecords,
} from "../src/lib/policyExplorer.js";

export const POLICY_DETAIL_RIDER_UNAVAILABLE_MESSAGE =
  "특약 정보는 아직 구조화되지 않았습니다.";

export const ANALYSIS_PIPELINE_STAGE_ORDER = [
  "coverage_gap",
  "underwriting_risk",
  "recommendation",
  "insurance_design",
  "result_claude",
];

export const CONSULTATION_INTENTS = [
  "casual_chat",
  "claim_eligibility_check",
  "factual_lookup",
  "policy_detail",
  "coverage_gap_check",
  "coverage_review_request",
  "recommendation_request",
  "design_request",
  "general_consultation",
];

const INSURANCE_TOPIC_SIGNAL =
  /보험|보험료|보장|암보험|암\s*보험|실손|담보|특약|가입|청구|인수|심사|설계|추천|분석|줄이|절감|부담|공백|갭|운전자|의료비|보험금|해지|변경|예산|플랜|포트폴리오|리밸런싱|보완|부족|괜찮|가입해야|들어야/i;

const CASUAL_GREETING_RE =
  /^(?:하이|안녕(?:하세요|하십니까)?|헬로|hello|hi|ㅎㅇ|반가워요?|반갑습니다)(?:[!.?\s~♡♥]*)?$/i;
const CASUAL_THANKS_RE =
  /^(?:고마워요?|고맙습니다|감사합니다|감사해요|땡큐|thanks)(?:[!.?\s~♡♥]*)?$/i;
const CASUAL_SMALL_TALK_RE =
  /^(?:뭐\s*해|뭐해|잘\s*지내|잘\s*지냈|오랜만이야|심심해)(?:[?.!\s~]*)?$/i;
const CASUAL_EMOTION_RE = /(?:오늘\s*)?(?:좀\s*)?(?:힘드|힘들|피곤|지쳤|지쳐|우울|외로|슬퍼|스트레스)/;

export const LOOKUP_CATEGORIES = {
  driver: {
    label: "운전자",
    keywords: ["운전자", "driver", "교통사고", "자동차보험특약"],
  },
  medical_expense: {
    label: "실손",
    keywords: ["실손", "medical expense", "indemnity", "실손의료비", "의료비보험", "의료비"],
  },
  cancer: {
    label: "암",
    keywords: ["암", "cancer", "진단비", "암보험", "암진단"],
  },
  brain: {
    label: "뇌",
    keywords: ["뇌", "brain", "뇌혈관", "뇌졸중"],
  },
  heart: {
    label: "심장",
    keywords: ["심장", "heart", "허혈", "급성심근경색", "심혈관"],
  },
};

const GAP_SIGNAL = /부족|부족해|모자라|없어|없나|괜찮|충분|충분해|충분한가|괜찮아|괜찮은가|어디가\s*부족|공백|갭/i;
const RECOMMEND_SIGNAL =
  /뭘\s*가입|무엇을\s*가입|뭐\s*가입|가입해야|들어야|추천|추천해|뭐가\s*부족|어떤\s*보험|어떤\s*보장|보완|보완해야|필요한\s*보험|필요한\s*보장/;
const DESIGN_SIGNAL =
  /설계안|설계\s*해|설계해|보험설계|플랜\s*짜|구성해|월\s*보험료|보험료\s*맞|예산.{0,6}(맞|기준|으로)|포트폴리오|리밸런싱|재구성/;
const CLAIM_ELIGIBILITY_SIGNAL =
  /(보험금|청구|지급|클레임).{0,20}(가능|받을\s*수|나올|될까|되나|돼요|되나요|돼\?)/;
const CLAIM_RECEIPT_SIGNAL =
  /(받을\s*수|나올까|지급될|청구돼|청구되|나오나|나올까).{0,16}(있나|있어|될까|되나|돼|나오)/;
const CLAIM_TOPIC_PAYMENT_SIGNAL =
  /(골절|수술|입원|암|진단|실손).{0,24}(받을\s*수|보험금|청구|지급|나올|나오)/;
const CLAIM_TOPIC_EVENT_SIGNAL =
  /(골절|수술|입원|암|진단).{0,16}(받았|했|받은|했는데|인데).{0,24}(보험금|청구|지급|나올|받을)/;
const CLAIM_TERMS_SIGNAL = /약관.{0,16}(지급|보장).{0,16}(되나|될까|가능)/;
const CLAIM_DIRECT_SIGNAL = /청구\s*가능/;
const COVERAGE_REVIEW_SIGNAL =
  /보장\s*(분석|점검|확인|검토|상태|현황)|보장분석|내보험\s*보장|내\s*보장\s*(봐|봐줘|알려|확인)|내\s*보험\s*분석|보장\s*봐/;
const POLICY_DETAIL_SIGNAL =
  /내\s*보험\s*(?:알려|목록|확인)|내가\s*(?:가입한\s*보험(?:은)?|든\s*보험)|보험\s*보여\s*줘|가입\s*보험\s*확인|내가\s*든\s*보험\s*알려/i;

function normalizeQuestion(question = "") {
  return String(question).replace(/\s+/g, " ").trim();
}

export function hasInsuranceTopicSignal(text = "") {
  return INSURANCE_TOPIC_SIGNAL.test(normalizeQuestion(text));
}

export function detectCasualChatIntent(question = "") {
  const text = normalizeQuestion(question);
  if (!text || hasInsuranceTopicSignal(text)) return null;

  if (CASUAL_GREETING_RE.test(text)) return { matched_rule: "casual_greeting" };
  if (CASUAL_THANKS_RE.test(text)) return { matched_rule: "casual_thanks" };
  if (CASUAL_SMALL_TALK_RE.test(text)) return { matched_rule: "casual_small_talk" };
  if (text.length <= 40 && CASUAL_EMOTION_RE.test(text)) {
    return { matched_rule: "casual_emotion_check" };
  }
  return null;
}

function joinLabels(labels) {
  const list = (labels ?? []).filter(Boolean);
  if (list.length === 0) return "";
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]}과 ${list[1]}`;
  return `${list.slice(0, -1).join(", ")}과 ${list[list.length - 1]}`;
}

const PREMIUM_LOOKUP_SIGNAL =
  /보험료|월\s*납입?|월납|월\s*보험료|납입\s*보험료|보험료\s*합계/;

function isPremiumLookupQuestion(text = "") {
  return PREMIUM_LOOKUP_SIGNAL.test(normalizeQuestion(text));
}

function detectLookupSubIntent(text) {
  if (isPremiumLookupQuestion(text)) {
    return { subIntent: "premium_lookup", lookupCategory: null };
  }
  if (/보험\s*(총\s*)?건수|몇\s*건|가입\s*보험\s*수|보유\s*보험|내\s*보험(?!\s*(?:료|에))/.test(text)) {
    return { subIntent: "policy_count", lookupCategory: null };
  }
  if (/가입한\s*보험사|어느\s*보험사|보험사는/.test(text)) {
    return { subIntent: "insurer", lookupCategory: null };
  }

  for (const [category, config] of Object.entries(LOOKUP_CATEGORIES)) {
    const categoryPattern = new RegExp(
      config.keywords
        .map((keyword) => keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("|"),
      "i",
    );
    if (categoryPattern.test(text)) {
      return { subIntent: "coverage_presence", lookupCategory: category };
    }
  }

  if (/(가입|보유|들어).{0,8}(돼|되어|되나|되나요|있나|있나요|있어|있어요)/.test(text)) {
    return { subIntent: "coverage_presence", lookupCategory: null };
  }

  return { subIntent: null, lookupCategory: null };
}

function isCoverageGapCheck(text) {
  if (GAP_SIGNAL.test(text) && RECOMMEND_SIGNAL.test(text)) return false;
  if (
    /(암|뇌|심장|심혈관|실손|운전자|입원|수술|치아|치매|간병).{0,12}(부족|부족해|모자라|없어|없나|괜찮|충분|충분해|충분한가|괜찮아|괜찮은가)/.test(
      text,
    )
  ) {
    return true;
  }
  if (/보장.{0,8}(부족|충분|괜찮|어때|어떤가|상태)/.test(text)) return true;
  if (/어디가\s*부족|공백|갭/i.test(text)) return true;
  return false;
}

function isCoverageReviewRequest(text) {
  if (RECOMMEND_SIGNAL.test(text) || DESIGN_SIGNAL.test(text)) return false;
  if (
    GAP_SIGNAL.test(text) &&
    /(암|뇌|심장|심혈관|실손|운전자|입원|수술|치아|치매|간병).{0,12}(부족|부족해|모자라|없어|없나|괜찮|충분|충분해|충분한가|괜찮아|괜찮은가)/.test(
      text,
    )
  ) {
    return false;
  }
  if (/보장.{0,8}(부족|충분|괜찮|어때|어떤가|상태)/.test(text) && GAP_SIGNAL.test(text)) {
    return false;
  }
  if (isClaimEligibilityCheck(text)) return false;
  return COVERAGE_REVIEW_SIGNAL.test(text);
}

function isClaimEligibilityCheck(text) {
  if (GAP_SIGNAL.test(text) && !/(보험금|청구|지급|받을\s*수|나올)/.test(text)) {
    return false;
  }
  if (CLAIM_DIRECT_SIGNAL.test(text)) return true;
  if (CLAIM_TERMS_SIGNAL.test(text)) return true;
  if (CLAIM_ELIGIBILITY_SIGNAL.test(text)) return true;
  if (CLAIM_RECEIPT_SIGNAL.test(text)) return true;
  if (CLAIM_TOPIC_PAYMENT_SIGNAL.test(text)) return true;
  if (CLAIM_TOPIC_EVENT_SIGNAL.test(text)) return true;
  return false;
}

function isPolicyDetailRequest(text) {
  if (GAP_SIGNAL.test(text) || RECOMMEND_SIGNAL.test(text) || DESIGN_SIGNAL.test(text)) {
    return false;
  }
  if (isClaimEligibilityCheck(text)) return false;
  if (isCoverageReviewRequest(text)) return false;
  if (/보험\s*(?:총\s*)?건수|몇\s*건|가입\s*보험\s*수/.test(text)) return false;
  return POLICY_DETAIL_SIGNAL.test(text);
}

function isFactualLookup(text) {
  if (GAP_SIGNAL.test(text) || RECOMMEND_SIGNAL.test(text) || DESIGN_SIGNAL.test(text)) {
    return false;
  }
  if (isClaimEligibilityCheck(text)) return false;
  if (isPolicyDetailRequest(text)) return false;

  const { subIntent } = detectLookupSubIntent(text);
  if (subIntent) return true;

  if (/(운전자|운전자보험|교통사고).{0,8}(있|가입|들어|보유|가지)/.test(text)) return true;
  if (/(실손|실손의료|의료비보험).{0,8}(있|가입|들어|보유|가지)/.test(text)) return true;
  if (/(암보험|암진단|암\s*보험).{0,8}(있|가입|들어|보유|가지|돼|되어)/.test(text)) return true;

  return false;
}

export function classifyConsultationIntent(question = "") {
  const text = normalizeQuestion(question);
  if (!text) {
    return {
      intent: "general_consultation",
      confidence: "low",
      matched_rule: "empty_question",
      lookup_sub_intent: null,
      lookup_category: null,
      question_focus: text,
    };
  }

  if (isPremiumLookupQuestion(text)) {
    return {
      intent: "factual_lookup",
      confidence: "high",
      matched_rule: "premium_lookup",
      lookup_sub_intent: "premium_lookup",
      lookup_category: null,
      question_focus: text,
    };
  }

  if (DESIGN_SIGNAL.test(text)) {
    return {
      intent: "design_request",
      confidence: "high",
      matched_rule: "design_request",
      lookup_sub_intent: null,
      lookup_category: null,
      question_focus: text,
    };
  }

  if (RECOMMEND_SIGNAL.test(text)) {
    return {
      intent: "recommendation_request",
      confidence: "high",
      matched_rule: "recommendation_request",
      lookup_sub_intent: null,
      lookup_category: null,
      question_focus: text,
    };
  }

  if (isCoverageReviewRequest(text)) {
    return {
      intent: "coverage_review_request",
      confidence: "high",
      matched_rule: "coverage_review_request",
      lookup_sub_intent: null,
      lookup_category: null,
      question_focus: text,
    };
  }

  if (isCoverageGapCheck(text)) {
    return {
      intent: "coverage_gap_check",
      confidence: "high",
      matched_rule: "coverage_gap_check",
      lookup_sub_intent: null,
      lookup_category: null,
      question_focus: text,
    };
  }

  if (isClaimEligibilityCheck(text)) {
    return {
      intent: "claim_eligibility_check",
      confidence: "high",
      matched_rule: "claim_eligibility_check",
      lookup_sub_intent: null,
      lookup_category: null,
      question_focus: text,
    };
  }

  if (isPolicyDetailRequest(text)) {
    return {
      intent: "policy_detail",
      confidence: "high",
      matched_rule: "policy_detail_list",
      lookup_sub_intent: null,
      lookup_category: null,
      question_focus: text,
    };
  }

  if (isFactualLookup(text)) {
    const lookup = detectLookupSubIntent(text);
    return {
      intent: "factual_lookup",
      confidence: lookup.subIntent ? "high" : "medium",
      matched_rule: lookup.subIntent ?? "factual_lookup_generic",
      lookup_sub_intent: lookup.subIntent,
      lookup_category: lookup.lookupCategory,
      question_focus: text,
    };
  }

  const casualChat = detectCasualChatIntent(text);
  if (casualChat) {
    return {
      intent: "casual_chat",
      confidence: "high",
      matched_rule: casualChat.matched_rule,
      lookup_sub_intent: null,
      lookup_category: null,
      question_focus: text,
    };
  }

  return {
    intent: "general_consultation",
    confidence: "medium",
    matched_rule: "general_consultation_fallback",
    lookup_sub_intent: null,
    lookup_category: null,
    question_focus: text,
  };
}

export function resolvePipelineManifest(intent) {
  switch (intent) {
    case "casual_chat":
      return [];
    case "claim_eligibility_check":
      return ["result_claude"];
    case "factual_lookup":
      return ["result_claude"];
    case "policy_detail":
      return ["result_claude"];
    case "coverage_gap_check":
      return ["coverage_gap", "result_claude"];
    case "coverage_review_request":
      return ["coverage_gap", "result_claude"];
    case "recommendation_request":
      return ["coverage_gap", "recommendation", "result_claude"];
    case "design_request":
      return [...ANALYSIS_PIPELINE_STAGE_ORDER];
    case "general_consultation":
    default:
      return ["coverage_gap", "result_claude"];
  }
}

export function resolveSkippedStages(pipelineManifest) {
  return ANALYSIS_PIPELINE_STAGE_ORDER.filter((stage) => !pipelineManifest.includes(stage));
}

export function buildIntentGatePayload(classification, pipelineManifest) {
  return {
    intent: classification.intent,
    confidence: classification.confidence,
    matched_rule: classification.matched_rule,
    lookup_sub_intent: classification.lookup_sub_intent,
    lookup_category: classification.lookup_category,
    question_focus: classification.question_focus,
    pipeline_manifest: pipelineManifest,
    skipped_stages: resolveSkippedStages(pipelineManifest),
    result_mode:
      classification.intent === "casual_chat"
        ? "casual_light"
        : classification.intent === "factual_lookup" || classification.intent === "policy_detail"
          ? "light"
          : classification.intent === "claim_eligibility_check"
            ? "claim_light"
            : classification.intent === "coverage_review_request"
              ? "coverage_review_light"
              : "standard",
  };
}

export function getJobPipelineManifest(job) {
  const manifest = job?.result_json?.intent_gate?.pipeline_manifest;
  if (Array.isArray(manifest) && manifest.length > 0) return manifest;
  return [...ANALYSIS_PIPELINE_STAGE_ORDER];
}

export function getJobSkippedStages(job) {
  const skipped = job?.result_json?.intent_gate?.skipped_stages;
  if (Array.isArray(skipped)) return skipped;
  return resolveSkippedStages(getJobPipelineManifest(job));
}

function policySearchText(policy) {
  return [
    policy?.insurer,
    policy?.insurer_name,
    policy?.product,
    policy?.product_name,
    policy?.policy_type,
    policy?.coverage_summary,
  ]
    .map((value) => String(value ?? "").toLowerCase())
    .join(" ");
}

export function matchPolicyToCategory(policies = [], lookupCategory = null) {
  if (!lookupCategory || !LOOKUP_CATEGORIES[lookupCategory]) {
    return { found: false, confidence: "low", matched_policies: [] };
  }

  const config = LOOKUP_CATEGORIES[lookupCategory];
  const matched = [];

  for (const policy of policies ?? []) {
    const text = policySearchText(policy);
    const hits = config.keywords.filter((keyword) => text.includes(String(keyword).toLowerCase()));
    if (!hits.length) continue;

    const productName = String(policy?.product_name ?? policy?.product ?? "").toLowerCase();
    const confidence = hits.some((keyword) => productName.includes(String(keyword).toLowerCase()))
      ? "high"
      : "medium";

    matched.push({
      insurer: policy?.insurer_name ?? policy?.insurer ?? "",
      product: policy?.product_name ?? policy?.product ?? "",
      policy_type: policy?.policy_type ?? "",
      confidence,
      matched_keywords: hits,
    });
  }

  if (!matched.length) {
    return { found: false, confidence: "low", matched_policies: [] };
  }

  const overallConfidence = matched.some((item) => item.confidence === "high") ? "high" : "medium";
  return {
    found: true,
    confidence: overallConfidence,
    matched_policies: matched,
  };
}

function resolvePositivePremium(policy) {
  const raw = policy?.monthly_premium ?? policy?.premium_amount ?? null;
  if (raw == null || raw === "") return null;
  const premium = Number(raw);
  if (!Number.isFinite(premium) || premium <= 0) return null;
  return premium;
}

function computePremiumLookupStats(policies = []) {
  const list = policies ?? [];
  let premiumKnownCount = 0;
  let premiumTotal = 0;
  let premiumUnknownCount = 0;

  for (const policy of list) {
    const premium = resolvePositivePremium(policy);
    if (premium != null) {
      premiumKnownCount += 1;
      premiumTotal += premium;
    } else {
      premiumUnknownCount += 1;
    }
  }

  return {
    totalCount: list.length,
    premiumKnownCount,
    premiumTotal,
    premiumUnknownCount,
  };
}

function resolvePolicyExplorerPolicies(workingContext = {}) {
  const sourceContext = workingContext.sourceContext ?? {};
  const sourceSummary = workingContext.sourceSummary ?? {};
  const fullPolicies = Array.isArray(sourceContext.policies) ? sourceContext.policies : [];
  const summaryInsurance = Array.isArray(sourceSummary.insurance) ? sourceSummary.insurance : [];

  if (fullPolicies.length > 0) {
    return mergePolicyRecords(fullPolicies, []);
  }
  if (summaryInsurance.length > 0) {
    return mergePolicyRecords(summaryInsurance, []);
  }
  return [];
}

function formatPolicyDetailRiderLine(policy) {
  if (!hasStructuredRiders(policy)) {
    return POLICY_DETAIL_RIDER_UNAVAILABLE_MESSAGE;
  }
  return formatRiderLines(policy)
    .map((rider) => (rider.detail ? `${rider.label} (${rider.detail})` : rider.label))
    .join(", ");
}

function buildCustomerLabel(workingContext = {}) {
  const snapshot = workingContext.snapshot ?? {};
  const facts = snapshot.facts ?? [];
  const sourceSummary = workingContext.sourceSummary ?? {};
  const name =
    facts.find((fact) => fact.fact_key === "profile.name")?.fact_value?.trim() ||
    snapshot.profile?.display_name ||
    sourceSummary.profile?.name ||
    null;
  return name ? `${name}님` : "고객님";
}

function formatPolicyLine(policy) {
  const insurer = policy.insurer_name ?? policy.insurer ?? "";
  const product = policy.product_name ?? policy.product ?? "";
  return `${insurer} ${product}`.trim();
}

function certaintyDisclaimer(categoryLabel = "해당") {
  return `다만 상품명만으로는 ${categoryLabel} 담보 범위를 확정하기 어려우니, 보장내역서 기준으로 한 번 더 확인이 필요합니다.`;
}

export function buildCoverageReviewFastAnswer(question, workingContext = {}) {
  const customerLabel = buildCustomerLabel(workingContext);
  const { policyCount, policyDescriptions } = resolveUnifiedPolicyView(workingContext);
  const lines = [
    `${customerLabel}, 현재 가입 보험을 기준으로 보장 상태를 분석해 보겠습니다.`,
  ];

  if (policyDescriptions.length) {
    lines.push(`등록된 ${policyDescriptions.join(", ")} 등 ${policyCount || policyDescriptions.length}건을 먼저 확인했습니다.`);
  } else if (policyCount > 0) {
    lines.push(`등록된 가입 보험 ${policyCount}건을 먼저 확인했습니다.`);
  }

  lines.push("잠시 후 질문에 맞는 안내를 이어서 드리겠습니다.");
  return lines.join("\n\n");
}

export function buildFactualLookupAnswer(question, workingContext = {}, intentGate = {}) {
  const customerLabel = buildCustomerLabel(workingContext);
  const { policies, policyCount, policyDescriptions } = resolveUnifiedPolicyView(workingContext);
  const subIntent = intentGate.lookup_sub_intent ?? null;
  const lookupCategory = intentGate.lookup_category ?? null;

  if (subIntent === "premium_lookup") {
    const explorerPolicies = resolvePolicyExplorerPolicies(workingContext);
    const stats = computePremiumLookupStats(explorerPolicies);

    if (stats.totalCount === 0) {
      return `${customerLabel}, 현재 시스템에 등록된 가입 보험 정보를 찾지 못했습니다. 고객 분석 화면에서 보험 정보를 저장해 주시면 정확히 안내해 드리겠습니다.`;
    }

    if (stats.premiumKnownCount > 0) {
      const lines = [
        `${customerLabel}, 현재 등록된 보험은 총 ${stats.totalCount}건이며, 월 보험료가 확인되는 계약은 ${stats.premiumKnownCount}건입니다.`,
        `확인된 월 보험료 합계는 ${stats.premiumTotal.toLocaleString("ko-KR")}원입니다.`,
      ];
      explorerPolicies.forEach((policy, index) => {
        const premium = resolvePositivePremium(policy);
        if (premium == null) return;
        const insurer = formatInsurerName(policy);
        const product = formatProductName(policy);
        lines.push(`${index + 1}. ${insurer} / ${product} — 월 보험료 ${premium.toLocaleString("ko-KR")}원`);
      });
      if (stats.premiumUnknownCount > 0) {
        lines.push(`그 외 보험료 미확인 ${stats.premiumUnknownCount}건입니다.`);
      }
      return lines.join("\n");
    }

    return `${customerLabel}, 현재 등록된 보험 ${stats.totalCount}건 중 월 보험료가 확인된 계약은 0건입니다. 보험료는 아직 증권/OCR에서 정규화되지 않았습니다.`;
  }

  if (subIntent === "policy_count") {
    if (policyCount > 0 && policyDescriptions.length) {
      return `${customerLabel}, 현재 등록된 가입 보험은 ${policyDescriptions.join(", ")} 포함 총 ${policyCount}건입니다.`;
    }
    if (policyCount > 0) {
      return `${customerLabel}, 현재 등록된 가입 보험은 총 ${policyCount}건입니다.`;
    }
    return `${customerLabel}, 현재 시스템에 등록된 가입 보험 정보를 찾지 못했습니다. 고객 분석 화면에서 보험 정보를 저장해 주시면 정확히 안내해 드리겠습니다.`;
  }

  if (subIntent === "insurer") {
    if (!policies.length) {
      return `${customerLabel}, 현재 등록된 보험사 정보를 확인하지 못했습니다. 고객 분석 화면의 보험 정보를 확인해 주시면 바로 안내해 드리겠습니다.`;
    }
    const insurers = Array.from(
      new Set(policies.map((policy) => policy.insurer_name ?? policy.insurer).filter(Boolean)),
    );
    const productSummary = policyDescriptions.length ? ` 보유 상품은 ${policyDescriptions.join(", ")}입니다.` : "";
    return `${customerLabel}, 현재 가입하신 보험사는 ${joinLabels(insurers)}입니다.${productSummary}`;
  }

  if (subIntent === "coverage_presence" && lookupCategory) {
    const config = LOOKUP_CATEGORIES[lookupCategory];
    const match = matchPolicyToCategory(policies, lookupCategory);

    if (!policies.length) {
      return `${customerLabel}, 현재 등록된 보험 목록이 없어 ${config.label} 보험 보유 여부를 확인하지 못했습니다. 보험 정보를 저장해 주시면 다시 안내해 드리겠습니다.`;
    }

    if (!match.found) {
      return `${customerLabel}, 현재 등록된 보험 목록에서는 ${config.label}보험으로 확인되는 계약이 없습니다. 실제 가입 여부는 증권·보장내역서 기준으로 한 번 더 확인하시는 것이 좋습니다.`;
    }

    const lines = [];
    const productLines = match.matched_policies.map((item) => `${item.insurer} ${item.product}`.trim()).filter(Boolean);
    if (match.confidence === "high") {
      lines.push(
        `${customerLabel}, 현재 등록된 보험 중 ${config.label} 관련으로 보이는 계약이 확인됩니다.`,
      );
    } else {
      lines.push(
        `${customerLabel}, 현재 등록된 보험 중 ${config.label} 관련으로 보이는 계약이 있을 수 있습니다.`,
      );
    }
    if (productLines.length) {
      lines.push(`(${productLines.join(", ")})`);
    }
    lines.push(certaintyDisclaimer(config.label));
    return lines.join("\n\n");
  }

  return null;
}

export function buildPolicyDetailAnswer(question, workingContext = {}) {
  const customerLabel = buildCustomerLabel(workingContext);
  const policies = resolvePolicyExplorerPolicies(workingContext);
  const stats = computePolicyExplorerStats(policies);

  if (!policies.length) {
    return `${customerLabel}, 현재 시스템에 등록된 가입 보험 정보를 찾지 못했습니다. 고객 분석 화면에서 보험 정보를 저장해 주시면 계약별로 안내해 드리겠습니다.`;
  }

  const lines = [
    `${customerLabel}, 현재 등록된 보험은 총 ${stats.totalCount}건입니다.`,
    `월 보험료가 확인되는 계약은 ${stats.premiumKnownCount}건이며, 확인된 월 보험료 합계는 ${stats.premiumTotal.toLocaleString("ko-KR")}원입니다.`,
  ];

  if (stats.premiumUnknownCount > 0) {
    lines.push(`보험료 미확인 ${stats.premiumUnknownCount}건입니다.`);
  }

  policies.forEach((policy, index) => {
    const insurer = formatInsurerName(policy);
    const product = formatProductName(policy);
    lines.push(`${index + 1}. ${insurer} / ${product}`);
    lines.push(`- 월 보험료: ${formatPolicyPremium(policy)}`);
    lines.push(`- 상태: ${formatPolicyStatus(policy)}`);
    lines.push(`- 유형: ${formatPolicyType(policy)}`);
    lines.push(`- 출처: ${formatPolicySource(policy.source)}`);
    lines.push(`- 특약: ${formatPolicyDetailRiderLine(policy)}`);
  });

  return lines.join("\n");
}

export function buildPolicyDetailResultText(question, workingContext = {}) {
  const answer =
    workingContext.policy_detail_answer ?? buildPolicyDetailAnswer(question, workingContext);
  return answer.slice(0, 8000);
}

export function buildFactualLookupResultText(question, workingContext = {}, intentGate = {}) {
  const factual =
    workingContext.factual_lookup_answer ??
    buildFactualLookupAnswer(question, workingContext, intentGate);
  if (factual) return factual.slice(0, 800);
  return `${buildCustomerLabel(workingContext)}, 질문해 주신 내용을 등록된 보험 정보 기준으로 확인해 드리겠습니다.`;
}

export function answerDirectlyAddressesQuestion(question, answer, intentGate = {}) {
  const text = String(answer ?? "").trim();
  const q = normalizeQuestion(question);
  if (!text || !q) return false;

  const firstSentence = text.split(/(?<=[.!?])\s+/)[0] ?? text;

  if (intentGate.intent === "policy_detail") {
    return /등록된\s*보험|가입\s*보험|총\s*\d+건/.test(firstSentence);
  }

  if (intentGate.intent === "factual_lookup") {
    if (intentGate.lookup_sub_intent === "policy_count") {
      return /건|보험/.test(firstSentence);
    }
    if (intentGate.lookup_sub_intent === "insurer") {
      return /보험사/.test(firstSentence);
    }
    if (intentGate.lookup_category === "driver") {
      return /운전자/.test(firstSentence) && /확인|없|없습니다|없어|없습니다/.test(firstSentence);
    }
    if (intentGate.lookup_category === "medical_expense") {
      return /실손/.test(firstSentence);
    }
    if (intentGate.lookup_category === "cancer") {
      return /암/.test(firstSentence);
    }
  }

  if (intentGate.intent === "claim_eligibility_check") {
    return /청구|지급|보험금|약관|서류|현재\s*자료/.test(firstSentence);
  }

  if (intentGate.intent === "coverage_review_request") {
    return /보장|가입\s*보험|분석|확인/.test(firstSentence);
  }

  if (intentGate.intent === "coverage_gap_check") {
    return /보장|부족|충분|괜찮|확인/.test(firstSentence);
  }
  if (intentGate.intent === "recommendation_request") {
    return /추천|가입|보완|검토/.test(firstSentence);
  }
  if (intentGate.intent === "design_request") {
    return /설계|구성|준비/.test(firstSentence);
  }

  return firstSentence.length >= 8;
}
