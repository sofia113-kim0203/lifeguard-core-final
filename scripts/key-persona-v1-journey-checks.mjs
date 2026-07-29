/**
 * Tom Preview validation — emotional flow, not functional PASS.
 *
 * Journey dimensions: Identity · Trust · Continuity · Role Split · Friction
 * Persona First: score the feeling, find one friction point → Slice fix.
 */

export const GENERIC_FILLER_RE =
  /판단보다 이야기|다른 걱정이 하나 더|확인된 범위 안에서만|표면\s*질문\s*뒤|확인된\s*범위\s*안에서만\s*조심스럽게/;

export const INSURANCE_PUSH_ON_RELATIONSHIP_RE =
  /보험(?:을|이)?\s*(?:가입|들|추천|설계|정리|볼)|가입(?:을|하)|보험금\s*받|청구(?:할|서)/;

export const COMPANION_VOICE_RE = /이어|같이|편하|다행|반갑|쉬|볼게요|됩니다|말씀|적어|확인해/;

export const DEAD_END_RE = /^(?:모르겠습니다|알\s*수\s*없습니다)[.!?]?$/;

export const STRUCTURED_KEY_VOICE_RE =
  /(?:입니다|예요|됩니다|어렵|밖입니다|같이|이어|말씀|확인|볼\s*수|볼게요|정리)/;

// Overconfident guarantee / payment certainty only.
// Do not treat educational "무조건 ~가 아니다/해지보다" as false_promise.
export const TRUST_BREAK_RE =
  /무조건\s*(?:100%\s*)?(?:안전|지급|보장됩니다|보장해요|보장입니다)|100%\s*안전|반드시\s*(?:받|가능|지급)|절대\s*문제\s*없|받을\s*수\s*있습니다|지급됩니다/;

export const FRICTION_CATALOG = [
  { id: "generic_filler", pattern: GENERIC_FILLER_RE, why: "시스템 filler — KEY가 아닌 말" },
  { id: "meta_frame", pattern: /표면\s*질문|가장\s*큰\s*(?:위험|기회)\s*:/, why: "메타 프레임 노출" },
  { id: "abrupt_insurance_pivot", pattern: /보험\s*얘기\s*전에/, why: "관계 순간에 보험으로 끌고 감" },
  { id: "worry_misread", pattern: /다른\s*걱정이\s*하나\s*더/, why: "고객 말을 잘못 읽음" },
  { id: "self_credit", pattern: /제가\s*도와|해결해\s*드렸|제\s*덕분/, why: "공로를 가져감" },
  { id: "engine_leak", pattern: /Brain|Layer|엔진|오케스트레이터|factory/i, why: "공장 노출" },
  { id: "inventory_dump", pattern: /^현재\s*\d+\s*건의\s*보험/, why: "inventory dump" },
  { id: "false_promise", pattern: TRUST_BREAK_RE, why: "약속 과잉" },
  {
    id: "relationship_insurance_push",
    pattern: INSURANCE_PUSH_ON_RELATIONSHIP_RE,
    relationshipOnly: true,
    why: "Relationship에서 보험 판단",
  },
];

function clampScore(value, max = 5) {
  return Math.max(0, Math.min(max, Math.round(value)));
}

export function detectFrictions(text = "", step = {}) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  const hits = [];
  for (const rule of FRICTION_CATALOG) {
    if (rule.relationshipOnly && !step.relationshipStep) continue;
    if (rule.pattern.test(normalized)) {
      hits.push({
        id: rule.id,
        why: rule.why,
        excerpt: normalized.slice(0, 120),
      });
    }
  }
  return hits;
}

export function assessPersonaStep({
  step = {},
  answerText = "",
  composeMode = null,
  patternId = null,
  ruleId = null,
} = {}) {
  const text = String(answerText ?? "").replace(/\s+/g, " ").trim();
  const isRelationship = Boolean(step.relationshipStep);
  const frictions = detectFrictions(text, step);
  const checks = {
    identity: false,
    trust: false,
    continuity: false,
    role_split: false,
    no_friction: frictions.length === 0,
  };
  const notes = [];

  checks.identity = isRelationship
    ? COMPANION_VOICE_RE.test(text) && text.length >= 12
    : STRUCTURED_KEY_VOICE_RE.test(text) && text.length >= 15;
  if (!checks.identity) notes.push("identity_weak");

  checks.trust = !TRUST_BREAK_RE.test(text) && !GENERIC_FILLER_RE.test(text);
  if (!checks.trust) notes.push("trust_risk");

  checks.continuity = isRelationship
    ? COMPANION_VOICE_RE.test(text) && !DEAD_END_RE.test(text)
    : (COMPANION_VOICE_RE.test(text) || /밖입니다|확인해|말씀|정리|볼\s*수|같이/.test(text)) &&
      !DEAD_END_RE.test(text);
  if (!checks.continuity) notes.push("continuity_weak");

  if (step.relationshipStep) {
    checks.role_split = !INSURANCE_PUSH_ON_RELATIONSHIP_RE.test(text);
    if (step.expectCompose && composeMode !== step.expectCompose) {
      checks.role_split = false;
      notes.push(`role_compose_${composeMode}`);
    }
    if (step.expectPattern && patternId !== step.expectPattern) {
      checks.role_split = false;
      notes.push(`role_pattern_${patternId}`);
    }
  } else {
    checks.role_split =
      composeMode === step.expectCompose && (!step.expectRule || ruleId === step.expectRule);
    if (step.expectRule && ruleId !== step.expectRule) notes.push(`role_rule_${ruleId}`);
    if (step.expectCompose && composeMode !== step.expectCompose) notes.push(`role_compose_${composeMode}`);
  }

  if (frictions.length > 0) {
    notes.push(...frictions.map((f) => `friction_${f.id}`));
  }

  if (step.textHint && !text.includes(step.textHint)) {
    notes.push(`hint_miss_${step.textHint}`);
  }

  const pass =
    checks.identity &&
    checks.trust &&
    checks.continuity &&
    checks.role_split &&
    checks.no_friction;

  return { pass, checks, frictions, notes };
}

/** @deprecated use scoreTomJourney for Preview */
export function assessPersonaJourney(steps = []) {
  const scored = scoreTomJourney(steps);
  return {
    all_steps_pass: steps.every((s) => s.persona?.pass === true),
    journey_voice_pass: scored.scores.same_key !== "0/5",
    pass: scored.scores.friction === "0건" && Number(scored.scores.same_key[0]) >= 4,
    tom_scores: scored.scores,
  };
}

export function scoreTomJourney(steps = []) {
  const rows = steps.filter((s) => s.answerText || s.probe_ok !== false);
  const allFrictions = [];

  let identityHits = 0;
  let trustHits = 0;
  let continuityHits = 0;
  let roleHits = 0;

  for (const row of rows) {
    const stepDef = row.step ?? row;
    const persona =
      row.persona ??
      assessPersonaStep({
        step: stepDef,
        answerText: row.answerText ?? "",
        composeMode: row.composeMode ?? null,
        patternId: row.patternId ?? null,
        ruleId: row.ruleId ?? null,
      });

    if (persona.checks?.identity) identityHits += 1;
    if (persona.checks?.trust) trustHits += 1;
    if (persona.checks?.continuity) continuityHits += 1;
    if (persona.checks?.role_split) roleHits += 1;

    for (const friction of persona.frictions ?? []) {
      allFrictions.push({
        step_id: stepDef.id ?? row.id,
        label: stepDef.label ?? row.label,
        question: stepDef.question ?? row.question,
        ...friction,
      });
    }
  }

  const n = Math.max(rows.length, 1);
  const ratioToFive = (hits) => clampScore((hits / n) * 5);

  const scores = {
    same_key: `${ratioToFive(identityHits)}/5`,
    trust: `${ratioToFive(trustHits)}/5`,
    continuity: `${ratioToFive(continuityHits)}/5`,
    role_split: `${ratioToFive(roleHits)}/5`,
    friction: `${allFrictions.length}건`,
  };

  return {
    scores,
    dimensions: {
      identity: { question: "처음부터 끝까지 같은 KEY였는가?", score: scores.same_key },
      trust: { question: "한 번이라도 거짓말했는가?", score: scores.trust },
      continuity: { question: "대화가 자연스럽게 이어졌는가?", score: scores.continuity },
      role_split: { question: "Family가 서로 침범했는가?", score: scores.role_split },
      friction: {
        question: '고객이 "왜 저런 말을 하지?"라고 느끼는 순간이 있었는가?',
        count: scores.friction,
      },
    },
    frictions: allFrictions,
    step_count: rows.length,
  };
}
