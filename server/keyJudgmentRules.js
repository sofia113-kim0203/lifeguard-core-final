/**
 * KEY Judgment Rule Library
 *
 * Each entry is a judgment habit — not an ad-hoc if branch.
 * kind: judgment_rule — customer intent needs insurance judgment (not relational turn-taking).
 */
import { SALES_DIRECTOR_JUDGMENT_INTENTS } from "./salesDirectorFormatter.js";

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
