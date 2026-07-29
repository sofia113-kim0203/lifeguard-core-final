/**
 * KEY Conversation Pattern Library
 *
 * Each entry is a habit KEY learns — not an ad-hoc if branch.
 * Patterns name situations KEY recognizes, not sentence collections.
 * kind:
 *   - conversation_pattern — customer intent is relational / turn-taking
 *   - judgment_rule        — customer intent needs insurance judgment (see keyJudgmentRules later)
 */

const INSURANCE_TOPIC =
  /보험|보험료|보장|암|실손|담보|청구|보험금|해지|중복|유지|사고|운전자|부족|괜찮|비싸|부담|놓친/i;

const CLOSING_TURN_RE =
  /(?:잘\s*자(?:요|세|라|)|좋은\s*밤|굿나잇|good\s*night|내일\s*(?:봐|뵐|만나)|푹\s*쉬(?:어|세요|시))/i;

const CLOSING_INSURANCE_ACTION_RE =
  /(?:확인|있(?:어|나|음|습)?|부족|괜찮|청구|받을|가입|설계|점검|분석(?:해|해줘))/;

const GREETING_TURN_RE =
  /^(?:하이|안녕(?:하세요|하십니까)?|헬로|hello|hi|ㅎㅇ|반가워요?|반갑습니다)(?:[!.?\s~♡♥]*)?$/i;

const THANKS_TURN_RE =
  /^(?:고마워(?:요)?|감사(?:합니다|해요)?|thank(?:\s*you|s)?)(?:[!.?\s~♡♥]*)?$/i;

const SOCIAL_INSURANCE_MENTION_RE = /보험|보험료|보장|암|실손|담보|청구|보험금/;

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

function hasClosingSignal(q = "") {
  return CLOSING_TURN_RE.test(q) || /잘\s*게(?:요)?|잘게요|잘\s*쉬(?:어|세요|시)/.test(q);
}

/** Scene J — customer wraps up the day; insurance waits for next time, not tonight's judgment. */
function isClosingDeferInsuranceAtGoodnightSituation(q = "") {
  if (!hasClosingSignal(q)) return false;
  if (!/보험/.test(q)) return false;

  if (
    /(?:부족|충분|괜찮|얼마|받을|청구|비싸|부담)/.test(q) &&
    /(?:보험|암|실손|보장|담보)/.test(q)
  ) {
    return false;
  }

  if (
    /(?:내일|나중|다음에|오늘은\s*그만).{0,16}(?:보험|이야기)|(?:보험|이야기).{0,16}(?:내일|나중|다음에|이어)/.test(
      q,
    ) &&
    !/(?:확인|볼|보고|점검|체크|생각)/.test(q)
  ) {
    return false;
  }

  return (
    /(?:확인|볼|보고|점검|체크|생각|이야기|보자)/.test(q) ||
    /보험.{0,16}(?:하고|부터|쪽|은).{0,12}(?:잘|쉬|자|게)/.test(q)
  );
}

/** @type {Array<{ id: string, kind: "conversation_pattern", scene: string, reason: string, compose_mode: string, match: (q: string) => boolean, buildResponse: (q: string) => string }>} */
export const KEY_CONVERSATION_PATTERNS = [
  {
    id: "greeting_welcome",
    kind: "conversation_pattern",
    scene: "A",
    reason: "Customer opens the day — KEY welcomes without insurance.",
    compose_mode: "key_social",
    match(q) {
      if (SOCIAL_INSURANCE_MENTION_RE.test(q)) return false;
      return GREETING_TURN_RE.test(q);
    },
    buildResponse(q) {
      return normalizeText(
        pickVariant(q, [
          "안녕하세요. 편하실 때 이어가도 됩니다.",
          "반갑습니다. 천천히 맞춰가면 됩니다.",
        ]),
      );
    },
  },
  {
    id: "relationship_thanks_past",
    kind: "conversation_pattern",
    scene: "Relationship",
    reason: "Customer thanks for what already happened — KEY stays alongside, no insurance turn.",
    compose_mode: "key_social",
    match(q) {
      if (SOCIAL_INSURANCE_MENTION_RE.test(q)) return false;
      return /^(?:고마웠(?:어(?:요)?)?)(?:[!.?\s~♡♥]*)?$/i.test(q);
    },
    buildResponse(q) {
      return normalizeText(
        pickVariant(q, [
          "도움이 됐다니 다행이에요. 편하실 때 이어가면 됩니다.",
          "네, 언제든 이어가도 됩니다.",
        ]),
      );
    },
  },
  {
    id: "relationship_credit_shared",
    kind: "conversation_pattern",
    scene: "Relationship",
    reason:
      "Customer credits shared outcome — KEY receives warmly without claiming credit or pushing insurance.",
    compose_mode: "key_social",
    match(q) {
      if (SOCIAL_INSURANCE_MENTION_RE.test(q)) return false;
      return /^덕분(?:이(?:었|)?(?:어(?:요)?|에요|입니다|야)?)?(?:[!.?\s~♡♥]*)?$/i.test(q);
    },
    buildResponse(q) {
      return normalizeText(
        pickVariant(q, [
          "조금이라도 도움이 됐다면 다행이에요. 필요하실 때 계속 같이 볼게요.",
          "다행이에요. 필요하실 때 이어가면 됩니다.",
        ]),
      );
    },
  },
  {
    id: "relationship_worry_eased",
    kind: "conversation_pattern",
    scene: "Relationship",
    reason:
      "Customer signals eased worry — KEY receives stability first, no insurance turn or credit claim.",
    compose_mode: "key_social",
    match(q) {
      if (SOCIAL_INSURANCE_MENTION_RE.test(q)) return false;
      return /^걱정(?:이)?(?:\s*좀)?\s*줄(?:어(?:요)?|었(?:어(?:요)?)?)(?:[!.?\s~♡♥]*)?$/i.test(q);
    },
    buildResponse(q) {
      return normalizeText(
        pickVariant(q, [
          "조금이라도 마음이 가벼워지셨다면 다행이에요. 필요하실 때 천천히 이어가도 됩니다.",
          "마음이 조금 가벼워지셨다면 다행이에요. 편하실 때 이어가도 됩니다.",
        ]),
      );
    },
  },
  {
    id: "relationship_reunion",
    kind: "conversation_pattern",
    scene: "Relationship",
    reason: "Customer returns after time apart — KEY welcomes reunion, no insurance or memory claim.",
    compose_mode: "key_social",
    match(q) {
      if (SOCIAL_INSURANCE_MENTION_RE.test(q)) return false;
      return /^오랜만(?:이(?:에|)?(?:요|야|)?|(?:이야|입니다)?)(?:[!.?\s~♡♥]*)?$/i.test(q);
    },
    buildResponse(q) {
      return normalizeText(
        pickVariant(q, [
          "오랜만이에요. 편하실 때 천천히 이어가도 됩니다.",
          "반갑습니다. 필요하실 때 이어가면 됩니다.",
        ]),
      );
    },
  },
  {
    id: "casual_visit_boredom",
    kind: "conversation_pattern",
    scene: "Relationship",
    reason: "Customer visits without agenda — KEY stays alongside, no insurance turn.",
    compose_mode: "key_social",
    match(q) {
      if (SOCIAL_INSURANCE_MENTION_RE.test(q)) return false;
      return /심심해서?\s*왔|그냥\s*왔|그냥\s*들렀/.test(q);
    },
    buildResponse(q) {
      return normalizeText(
        pickVariant(q, [
          "그래도 와 주셔서 반가워요. 편하게 이야기해도 됩니다.",
          "오셨군요. 오늘은 어떤 이야기든 괜찮아요.",
        ]),
      );
    },
  },
  {
    id: "thanks_acknowledgment",
    kind: "conversation_pattern",
    scene: "A",
    reason: "Customer says thanks — KEY acknowledges, no insurance push.",
    compose_mode: "key_social",
    match(q) {
      if (SOCIAL_INSURANCE_MENTION_RE.test(q)) return false;
      return THANKS_TURN_RE.test(q);
    },
    buildResponse(q) {
      return normalizeText(
        pickVariant(q, [
          "천만에요. 편하실 때 이어가면 됩니다.",
          "네, 천천히 같이 보면 됩니다.",
        ]),
      );
    },
  },
  {
    id: "closing_defer_insurance_to_later",
    kind: "conversation_pattern",
    scene: "J",
    reason: "Customer defers insurance to later and closes — intent is exit, not judgment.",
    compose_mode: "key_closing",
    match(q) {
      if (!hasClosingSignal(q)) return false;
      if (
        !/(?:내일|나중|다음에|오늘은\s*그만).{0,16}(?:보험|이야기)|(?:보험|이야기).{0,16}(?:내일|나중|다음에|이어)/.test(
          q,
        )
      ) {
        return false;
      }
      if (CLOSING_INSURANCE_ACTION_RE.test(q)) return false;
      return true;
    },
    buildResponse(q) {
      return normalizeText(
        pickVariant(q, [
          "네, 보험 얘기는 내일 이어가요. 편히 쉬세요.",
          "네, 내일 이어가도 됩니다. 오늘은 편히 쉬세요.",
        ]),
      );
    },
  },
  {
    id: "closing_insurance_check_goodnight",
    kind: "conversation_pattern",
    scene: "J",
    reason:
      "Customer wraps up the day — insurance stays for next time, not tonight's judgment.",
    compose_mode: "key_closing",
    match(q) {
      return isClosingDeferInsuranceAtGoodnightSituation(q);
    },
    buildResponse(q) {
      return normalizeText(
        pickVariant(q, [
          "네, 보험 쪽은 편할 때 이어가도 됩니다. 오늘은 편히 쉬세요.",
          "네, 보험 이야기는 내일 이어가도 됩니다. 편안한 밤 보내세요.",
        ]),
      );
    },
  },
  {
    id: "closing_goodnight",
    kind: "conversation_pattern",
    scene: "J",
    reason: "Customer ends the day — KEY stays warm; no insurance judgment.",
    compose_mode: "key_closing",
    match(q) {
      if (INSURANCE_TOPIC.test(q)) return false;
      return CLOSING_TURN_RE.test(q);
    },
    buildResponse(q) {
      if (/잘\s*자|좋은\s*밤|굿나잇|good\s*night|푹\s*쉬/.test(q)) {
        return normalizeText(
          pickVariant(q, [
            "편히 쉬세요. 내일 이어가도 됩니다.",
            "오늘은 여기까지 해도 됩니다. 편안한 밤 보내세요.",
          ]),
        );
      }
      if (/내일\s*(?:봐|뵐|만나)/.test(q)) {
        return normalizeText(
          pickVariant(q, ["네, 내일 이어가요.", "네, 내일 뵙겠습니다."]),
        );
      }
      return normalizeText("편안한 밤 보내세요.");
    },
  },
];

export function matchKeyConversationPattern(question = "", { composeMode = null } = {}) {
  const q = normalizeQuestion(question);
  if (!q) return null;

  for (const pattern of KEY_CONVERSATION_PATTERNS) {
    if (composeMode && pattern.compose_mode !== composeMode) continue;
    if (pattern.match(q)) return pattern;
  }
  return null;
}

export function isKeyClosingTurn(question = "") {
  return Boolean(matchKeyConversationPattern(question, { composeMode: "key_closing" }));
}

export function isKeySocialTurn(question = "") {
  return Boolean(matchKeyConversationPattern(question, { composeMode: "key_social" }));
}

export function buildKeyClosingResponse(question = "") {
  const pattern = matchKeyConversationPattern(question, { composeMode: "key_closing" });
  if (!pattern) return normalizeText("편안한 밤 보내세요.");
  return pattern.buildResponse(normalizeQuestion(question));
}

export function resolveKeyClosingConversationPattern(question = "") {
  const pattern = matchKeyConversationPattern(question, { composeMode: "key_closing" });
  if (!pattern) return null;
  const q = normalizeQuestion(question);
  return {
    pattern_id: pattern.id,
    kind: pattern.kind,
    scene: pattern.scene,
    reason: pattern.reason,
    compose_mode: pattern.compose_mode,
    text: pattern.buildResponse(q),
  };
}

export function resolveKeySocialConversationPattern(question = "") {
  const pattern = matchKeyConversationPattern(question, { composeMode: "key_social" });
  if (!pattern) return null;
  const q = normalizeQuestion(question);
  return {
    pattern_id: pattern.id,
    kind: pattern.kind,
    scene: pattern.scene,
    reason: pattern.reason,
    compose_mode: pattern.compose_mode,
    text: pattern.buildResponse(q),
  };
}
