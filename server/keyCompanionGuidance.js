/**
 * KEY Companion Guidance — replaces generic system filler with companion voice.
 *
 * When structured compose has no judgment rule, KEY stays alongside the customer
 * instead of opening with "확인된 범위 안에서만…".
 */
import { isKeyClosingTurn, isKeySocialTurn } from "./keyConversationPatterns.js";
import {
  buildMemoryRecallJudgment,
  buildClaimReceiveEligibilityJudgment,
  resolveMemoryFactsFromBundle,
} from "./keyJudgmentRules.js";

export const KEY_GENERIC_FILLER_JUDGMENT =
  "확인된 범위 안에서만 조심스럽게 말씀드릴 수 있습니다.";

export const KEY_GENERIC_FILLER_RE = /확인된\s*범위\s*안에서만\s*조심스럽게/;

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

function pickVariant(question, variants = []) {
  if (!variants.length) return "";
  let hash = 0;
  for (const ch of normalizeQuestion(question)) {
    hash = (hash + ch.charCodeAt(0)) % variants.length;
  }
  return variants[hash];
}

function resolvePolicyCount(factBundle = {}) {
  if (typeof factBundle.policy_count === "number") return factBundle.policy_count;
  if (typeof factBundle.active_policy_count === "number") return factBundle.active_policy_count;
  if (Array.isArray(factBundle.policies)) return factBundle.policies.length;
  return 0;
}

/** QO-26 — thanks first, future claim together (Relationship → Claim bridge). */
export function isThanksFutureClaimTurn(question = "") {
  const q = normalizeQuestion(question);
  if (!q) return false;
  if (!/고마웠|고마워|감사/.test(q)) return false;
  if (!/청구/.test(q)) return false;
  if (/(?:받을|보험금|얼마|서류|지금|당장|사고)/.test(q)) return false;
  return /(?:다음|나중|그때|부탁|함께|같이)/.test(q);
}

/** QO-21 — memory acknowledgement → premium/policy → cancel advice. */
export function isMemoryPremiumCancelTurn(question = "") {
  const q = normalizeQuestion(question);
  if (!q) return false;
  if (!/기억/.test(q)) return false;
  if (!/(?:해지|끊|없애|중단)/.test(q)) return false;
  return /(?:보험료|부담|비싸|무거)/.test(q);
}

/** QO-13 — memory recall acknowledgement → confirmed policy count. */
export function isMemoryPolicyCountTurn(question = "") {
  const q = normalizeQuestion(question);
  if (!q) return false;
  if (!/기억/.test(q)) return false;
  if (!/(?:몇\s*(?:개|건)|개수|몇개)/.test(q)) return false;
  if (!/(?:보험|가입|계약)/.test(q)) return false;
  if (/(?:해지|끊|없애|중단|보험료|부담|비싸|무거)/.test(q)) return false;
  return true;
}

/** QO-15 — past continuity acknowledgement → claim eligibility. */
export function isClaimMemoryContinuityTurn(question = "") {
  const q = normalizeQuestion(question);
  if (!q) return false;
  if (!/(?:보험금|받을\s*수|나올|지급)/.test(q)) return false;
  if (!/(?:지난번|저번|전에|예전|이전)/.test(q)) return false;
  if (!/(?:비슷|얘기|이야기|말|했)/.test(q)) return false;
  if (isMemoryPolicyCountTurn(q) || isMemoryPremiumCancelTurn(q)) return false;
  return true;
}

function buildMemoryAcknowledgementLine(factBundle = {}, question = "") {
  const q = normalizeQuestion(question);
  const facts = resolveMemoryFactsFromBundle(factBundle);
  if (facts.length > 0) {
    return buildMemoryRecallJudgment({ factBundle, question: q });
  }
  return pickVariant(q, [
    "지금은 확인된 기억이 없어요. 다만 보험료 부담 말씀은 이번에 받았어요.",
    "저장된 기억은 아직 확인되지 않았어요. 보험료 부담 걱정은 지금 흐름으로 이해하고 있어요.",
  ]);
}

function buildPremiumPolicyLine(factBundle = {}) {
  const policyCount = resolvePolicyCount(factBundle);
  const stats = factBundle.premium_stats ?? {};
  const premiumKnown = (stats.premiumKnownCount ?? 0) > 0 && (stats.premiumTotal ?? 0) > 0;

  if (policyCount === 0) {
    return "등록된 가입 보험이 아직 없어요.";
  }
  if (premiumKnown) {
    return `가입 보험은 확인돼요. 현재 확인 가능한 월 보험료는 ${Number(stats.premiumTotal).toLocaleString("ko-KR")}원입니다.`;
  }
  return "가입된 보험이 있는 것은 확인돼요. 다만 총 보험료는 현재 검증이 필요합니다.";
}

function buildCancelAdviceLine(question = "") {
  return pickVariant(normalizeQuestion(question), [
    "하나만 해지해도 될지는, 가장 무거운 계약부터 순서를 정리해 보면 보입니다.",
    "해지 여부는 지금 단정하기보다, 무거운 계약부터 같이 짚어 보면 됩니다.",
  ]);
}

function buildPolicyCountLine(factBundle = {}) {
  const policyCount = resolvePolicyCount(factBundle);
  if (policyCount > 0) return `지금 확인된 가입 보험은 ${policyCount}개예요.`;
  return "지금은 등록된 가입 보험 정보를 찾지 못했어요.";
}

function buildClaimMemoryContinuityLine(factBundle = {}, question = "") {
  const q = normalizeQuestion(question);
  const facts = resolveMemoryFactsFromBundle(factBundle);
  if (facts.length > 0) {
    return pickVariant(q, [
      "지난번 말씀하신 흐름은 저장된 맥락으로 이어서 이해하고 있어요.",
      "비슷한 이야기 주신 적은 저장된 맥락으로 확인돼요.",
    ]);
  }
  return pickVariant(q, [
    "지난번 이야기는 저장된 기억으로는 아직 확인되지 않았어요. 다만 비슷한 걱정 흐름은 이어서 이해하고 있어요.",
    "구체적인 지난번 표현까지는 확인되지 않았지만, 비슷한 이야기로 이어서 보면 됩니다.",
  ]);
}

/** Situations that previously fell through to generic filler (Tom CV v1 Q16·Q24·Q25·Q29·Q30). */
export function isKeyCompanionGuidanceSituation(question = "") {
  const q = normalizeQuestion(question);
  if (!q) return false;

  if (isThanksFutureClaimTurn(q)) {
    return true;
  }

  if (isMemoryPremiumCancelTurn(q)) {
    return true;
  }

  if (isMemoryPolicyCountTurn(q)) {
    return true;
  }

  if (isClaimMemoryContinuityTurn(q)) {
    return true;
  }

  if (
    /고마웠(?:어|요)/.test(q) &&
    /보험/.test(q) &&
    !/(?:보험료|부담|받을|청구|몇|얼마|부족|해지|암|실손)/.test(q)
  ) {
    return true;
  }

  if (/오랜만/.test(q) && /(?:이어|점검|지난번)/.test(q) && /보험/.test(q)) {
    return true;
  }

  if (
    /(?:너무\s*많|같이\s*정리|정리해)/.test(q) &&
    /(?:기억|저번|전에|지난)/.test(q) &&
    /(?:보험|가입)/.test(q)
  ) {
    return true;
  }

  if (/(?:어려|쉽게\s*말|쉬운\s*말)/.test(q) && /보험/.test(q)) {
    return true;
  }

  if (
    /(?:알아서|제일\s*필요|나한테\s*제일)/.test(q) &&
    /(?:같이|봐|보자|봐줘)/.test(q)
  ) {
    return true;
  }

  return false;
}

export function shouldUseKeyCompanionGuidanceCompose({
  question = "",
  factBundle = {},
  humanFrame = {},
  fixedSlice = null,
} = {}) {
  const q = normalizeQuestion(question || humanFrame.surface_question || factBundle.question || "");
  if (!q) return false;

  if (isThanksFutureClaimTurn(q) || isMemoryPremiumCancelTurn(q) || isMemoryPolicyCountTurn(q) || isClaimMemoryContinuityTurn(q)) {
    if (isAnalysisStatusQuestion(q) || isKeySocialTurn(q) || isKeyClosingTurn(q)) {
      return false;
    }
    return true;
  }

  if (fixedSlice) return false;

  if (isAnalysisStatusQuestion(q) || isKeySocialTurn(q) || isKeyClosingTurn(q)) {
    return false;
  }

  if (humanFrame.is_trust_human_question && !COMPANION_INSURANCE_TOPIC.test(q)) {
    return false;
  }

  return isKeyCompanionGuidanceSituation(q);
}

const COMPANION_INSURANCE_TOPIC =
  /보험|보험료|보장|암|실손|담보|청구|보험금|해지|중복|유지|사고|운전자|부족|괜찮|비싸|부담|놓친/i;

function isAnalysisStatusQuestion(question = "") {
  const q = normalizeQuestion(question);
  if (!q || !/분석/.test(q)) return false;
  if (/(?:분석(?:해|해줘|해주|좀|하)|(?:해줘|해주).{0,8}분석|분석\s*(?:해|요청|부탁))/.test(q)) {
    return false;
  }
  return /(?:분석.{0,12}(?:끝|완료|됐|나|되|중|진행|상태|결과|언제|아직)|(?:끝|완료|다\s*됐).{0,12}분석|분석\s*끝)/.test(
    q,
  );
}

export function buildKeyCompanionGuidanceResponse({
  question = "",
  factBundle = {},
  humanFrame = {},
} = {}) {
  const q = normalizeQuestion(question || humanFrame.surface_question || factBundle.question || "");
  const policyCount = resolvePolicyCount(factBundle);
  const hasPolicies = policyCount > 0;

  if (isThanksFutureClaimTurn(q)) {
    const thanks = pickVariant(q, [
      "도움이 됐다니 다행이에요.",
      "네, 편히 이어가셔도 됩니다.",
    ]);
    const bridge = pickVariant(q, [
      "다음에 청구하실 때 같이 보면 됩니다. 그때 어떤 사고·치료였는지만 정리해 두셔도 돼요.",
      "청구하실 때는 그때 상황부터 같이 짚어도 됩니다. 미리 걸리는 부분만 적어 두셔도 돼요.",
    ]);
    return normalizeText(`${thanks} ${bridge}`);
  }

  if (isMemoryPremiumCancelTurn(q)) {
    const memory = buildMemoryAcknowledgementLine(factBundle, q);
    const premium = buildPremiumPolicyLine(factBundle);
    const cancel = buildCancelAdviceLine(q);
    return normalizeText(`${memory} ${premium} ${cancel}`);
  }

  if (isMemoryPolicyCountTurn(q)) {
    const memory = buildMemoryRecallJudgment({ factBundle, question: q });
    const policyCount = buildPolicyCountLine(factBundle);
    return normalizeText(`${memory} ${policyCount}`);
  }

  if (isClaimMemoryContinuityTurn(q)) {
    const continuity = buildClaimMemoryContinuityLine(factBundle, q);
    const claim = buildClaimReceiveEligibilityJudgment({ factBundle, question: q });
    return normalizeText(`${continuity} ${claim}`);
  }

  if (
    /고마웠(?:어|요)/.test(q) &&
    /보험/.test(q) &&
    !/(?:보험료|부담|받을|청구|몇|얼마|부족|해지|암|실손)/.test(q)
  ) {
    return normalizeText(
      pickVariant(q, [
        "도움이 됐다니 다행이에요. 편하게 물어보셔도 됩니다. 말씀 주신 보험부터 같이 확인해 보겠습니다.",
        "네, 언제든 이어가도 됩니다. 보험 쪽은 편히 물어보셔도 돼요.",
      ]),
    );
  }

  if (/오랜만/.test(q) && /(?:이어|점검|지난번)/.test(q)) {
    const open = pickVariant(q, ["오랜만이에요.", "반갑습니다."]);
    const check = hasPolicies
      ? `지금 확인된 가입 보험 ${policyCount}개부터 차례로 점검해 보면 됩니다.`
      : "보험 정보를 저장해 주시면 같이 점검해 볼게요.";
    return normalizeText(`${open} ${check}`);
  }

  if (
    /(?:너무\s*많|같이\s*정리|정리해)/.test(q) &&
    /(?:기억|저번|전에|지난)/.test(q)
  ) {
    if (hasPolicies) {
      return normalizeText(
        `지금 확인된 가입 보험은 ${policyCount}개예요. 기억하신 것과 맞춰 하나씩 정리해 드릴게요.`,
      );
    }
    return normalizeText(
      "지금은 확인된 기억이 없어요. 걱정되는 계약부터 적어 주시면, 그 기준으로 같이 정리해 드릴게요.",
    );
  }

  if (/(?:어려|쉽게\s*말|쉬운\s*말)/.test(q) && /보험/.test(q)) {
    const lead = pickVariant(q, [
      "어렵게 느껴지는 게 정상이에요. 한 번에 다 보려 해서 그래요.",
      "보험 용어가 많아서 헷갈리는 게 당연해요.",
    ]);
    const follow = hasPolicies
      ? "지금 확인된 가입 보험부터 쉬운 말로 짚어 보면 됩니다."
      : "지금 걸리는 부분부터 쉬운 말로 하나씩 짚어 보면 됩니다.";
    return normalizeText(`${lead} ${follow}`);
  }

  if (/(?:알아서|제일\s*필요|나한테\s*제일)/.test(q)) {
    if (hasPolicies) {
      return normalizeText(
        `지금 확인된 가입 보험 ${policyCount}개부터, 제일 걸리는 축부터 같이 보면 됩니다.`,
      );
    }
    return normalizeText(
      "지금 제일 걸리는 것 하나만 잡아도 됩니다. 편히 말씀해 주시면 그 축부터 같이 볼게요.",
    );
  }

  return normalizeText(
    hasPolicies
      ? "지금 확인된 범위부터 같이 보면 됩니다. 걱정되는 축부터 차례로 짚어 보면 됩니다."
      : "지금 걸리는 부분부터 같이 보면 됩니다. 확인해 보고 다시 말씀드리겠습니다.",
  );
}

export function resolveKeyCompanionGuidancePattern(question = "") {
  const q = normalizeQuestion(question);
  if (!isKeyCompanionGuidanceSituation(q)) return null;
  const patternId = isThanksFutureClaimTurn(q)
    ? "thanks_future_claim"
    : isMemoryPremiumCancelTurn(q)
      ? "memory_premium_cancel"
      : isMemoryPolicyCountTurn(q)
        ? "mixed_turn_memory_policy_count"
        : isClaimMemoryContinuityTurn(q)
          ? "mixed_turn_claim_memory_continuity"
          : "companion_guidance";
  return {
    pattern_id: patternId,
    kind: "companion_guidance",
    scene: isThanksFutureClaimTurn(q)
      ? "Relationship+Claim"
      : isMemoryPremiumCancelTurn(q)
        ? "Memory+Policy"
        : isMemoryPolicyCountTurn(q)
          ? "Memory+Policy"
          : isClaimMemoryContinuityTurn(q)
            ? "Claim+Memory"
            : "Companion",
    reason: isThanksFutureClaimTurn(q)
      ? "Thanks received first — future claim bridged without procedure dump."
      : isMemoryPremiumCancelTurn(q)
        ? "Memory acknowledged first — premium context and cancel advice follow."
        : isMemoryPolicyCountTurn(q)
          ? "Memory acknowledged first — confirmed policy count follows."
          : isClaimMemoryContinuityTurn(q)
            ? "Past continuity acknowledged first — claim eligibility follows."
            : "No judgment rule — KEY guides alongside instead of generic filler.",
    compose_mode: "key_companion_guidance",
    text: buildKeyCompanionGuidanceResponse({ question: q }),
  };
}
