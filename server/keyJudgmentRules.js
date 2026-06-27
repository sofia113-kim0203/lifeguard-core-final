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
    buildJudgment() {
      return "보험료는 계약마다 달라서, 확인된 납입액부터 차례로 짚어보겠습니다.";
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
