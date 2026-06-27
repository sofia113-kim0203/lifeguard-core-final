/**
 * KEY Judgment Rule Library
 *
 * Each entry is a judgment habit — not an ad-hoc if branch.
 * kind: judgment_rule — customer intent needs insurance judgment (not relational turn-taking).
 */
import { SALES_DIRECTOR_JUDGMENT_INTENTS } from "./salesDirectorFormatter.js";
import { classifyConsultationIntent } from "./intentGateLayer.js";

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

function resolveInsurerNamesFromBundle(factBundle = {}) {
  return Array.from(
    new Set((factBundle.policies ?? []).map((policy) => policy.insurer_name).filter(Boolean)),
  );
}

/** @type {Array<{ id: string, kind: "judgment_rule", scene: string, reason: string, match: (ctx: object) => boolean, buildJudgment: (ctx?: object) => string }>} */
export const KEY_JUDGMENT_RULES = [
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
        return true;
      }

      if (classificationIntent === "claim_eligibility_check") {
        return true;
      }

      if (/(?:받을(?:\s*수|\s*거)?|보험금|청구(?:\s*가능)?|나올)/.test(q)) {
        if (/부족|충분|괜찮/.test(q) && !/(?:받을|보험금|청구)/.test(q.replace(/부족|충분|괜찮/g, ""))) {
          return false;
        }
        return true;
      }

      return false;
    },
    buildJudgment() {
      return "지금은 어떤 사고·치료였는지에 따라 열리는 축이 달라집니다.";
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
