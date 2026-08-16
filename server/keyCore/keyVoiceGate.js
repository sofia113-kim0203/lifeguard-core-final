/**
 * Slice 6 — KEY Voice Gate (Claude 후보 검수 · legacy fallback 금지).
 */
import { assertFactTextAlignment } from "./assertFactTextGate.js";
import { isDeferOnlyText, DEFER_ONLY_PATTERNS } from "./keyThinkingFlow.js";
import { scanSpeechForbiddenPatterns } from "../keyBrain/keySpeechTurnType.js";
import { SLICE5_BANNED_TEMPLATE_PHRASES } from "../keyBrain/keySpeakFromDecision.js";
import { validateDu1CustomerSpeech } from "../keyBrain/du1DocumentUploadFirstSpeak.js";
import {
  collectVerifiedDateContextSpeakForms,
  deriveKeyVoiceQuestionFocus,
} from "./keyVoiceDirective.js";

const REDIRECT_PATTERNS = [
  /천천히\s*맞춰/,
  /편하실\s*때\s*말씀/,
  /조금만\s*더\s*알려/,
  /같이\s*보면\s*됩니다/,
  /순서로\s*볼지/,
];

const CALCULATED_NUMBER_PATTERNS = [
  /나머지\s*\d+/,
  /\d+\s*개\s*(?:더|남)/,
  /절반/,
  /대부분/,
  /비율/,
  /\d+\s*건\s*중\s*\d+/,
];

/** Push / completed-without-consent only. Advice like "보완하는 게 좋겠습니다" is not HARD. */
const ENROLLMENT_PUSH_RE = /가입하세요|꼭\s*가입하시(?:길|기)|지금\s*가입(?:하|을)/;
const CANCELLATION_PUSH_RE = /해지하세요|바로\s*해지|지금\s*해지/;
const COMPLETED_AUTHORITY_RE =
  /가입\s*확정|설계\s*완료|가입을\s*완료|해지를\s*완료|(?:최종\s*)?체결(?:했|하였|입니다)|지금\s*결정하세요/;
const DEFINITIVE_RE = /(?:충분합니다|부족합니다|문제\s*없(?:어|습니다)|완벽(?:해|합니다|해요|이에요)|틀림없|확실히\s*(?:부족|충분|괜찮))/;

const OVER_FAMILIAR_PATTERNS = [
  /무조건/,
  /걱정\s*마(?:세요|시)?/,
  /(?:^|[.!?]\s*)[^.]{0,120}(?:완전\s*괜찮|대박|최고(?:예요|입니다))/,
];

const EMOTION_CERTAINTY_PATTERNS = [
  /(?:힘드|지치|우울|불안|속상)(?:하|시|실)\s*겠(?:어요|습니다|죠|실)/,
  /(?:걱정|불안)(?:되|하)(?:시|실)\s*겠/,
  /(?:마음|기분).{0,12}(?:힘드|무거|답답)(?:하|시|실)\s*겠/,
];

const INFORMAL_SPEECH_PATTERNS = [
  /(?:^|[.!?]\s*)[^.]{0,80}(?:거야|할래|알았어)\s*[.!?]/,
];

const FRAGMENT_END_RE = /(?:부터\s*확인|확인)\.\s*$/;

function normalizeText(text = "") {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractNumbers(text) {
  return [...String(text).matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, ""));
}

function extractNumberMatches(text) {
  return [...String(text).matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => ({
    token: m[0].replace(/,/g, ""),
    start: m.index,
    end: m.index + m[0].length,
  }));
}

function findContiguousLiteralSpans(haystack, literal) {
  const lit = String(literal ?? "").trim();
  const text = String(haystack ?? "");
  if (!lit || !text) return [];
  const spans = [];
  let from = 0;
  while (from <= text.length) {
    const i = text.indexOf(lit, from);
    if (i < 0) break;
    spans.push({ start: i, end: i + lit.length });
    from = i + 1;
  }
  return spans;
}

function escapeRegExp(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectProductSpeakCoverSpans(text, productLit) {
  const lit = String(productLit ?? "").trim();
  const hay = String(text ?? "");
  if (!lit || !hay) return [];
  const spans = [...findContiguousLiteralSpans(hay, lit)];
  // Tokens that already mix letters + digits (무배당2411). Never bare 2411 / 3.10.5.
  for (const tok of lit.match(/[^\s()]+/g) ?? []) {
    if (tok === lit) continue;
    if (tok.length < 4) continue;
    if (!/\d/.test(tok) || !/\D/.test(tok)) continue;
    if (/^\d[\d.]*$/.test(tok)) continue;
    spans.push(...findContiguousLiteralSpans(hay, tok));
  }
  // Combined span only: this product's dotted code + a prefix (≥2) of the
  // hangul that actually follows it in the verified literal (3.10.5간편).
  // Never bare 3.10.5, never another code+간편, never 간편 alone.
  const pair = lit.match(/(\d+(?:\.\d+)+)\s*([가-힣]{2,})/);
  if (pair) {
    const code = pair[1];
    const hangul = pair[2];
    const prefixes = [];
    for (let i = hangul.length; i >= 2; i -= 1) {
      prefixes.push(escapeRegExp(hangul.slice(0, i)));
    }
    const re = new RegExp(`${escapeRegExp(code)}\\s*(?:${prefixes.join("|")})`, "g");
    for (const m of hay.matchAll(re)) {
      spans.push({ start: m.index, end: m.index + m[0].length });
    }
  }
  return spans;
}

/**
 * Provenance spans in customer text. Digits are allowed only inside these spans
 * (not via flat allowed_numbers). Digit-only product literals → no free-float spans.
 */
function provenanceCoverSpans(text, provenances = []) {
  const spans = [];
  for (const p of Array.isArray(provenances) ? provenances : []) {
    if (p?.verified === false) continue;
    const kind = String(p?.kind ?? "");
    const lit = String(p?.source_literal ?? "").trim();
    if (!lit || !/\d/.test(lit)) continue;

    if (kind === "verified_product_identifier") {
      // Tom lock: bare numeric product codes must not free-float as whitelist digits.
      if (/^\d[\d.]*$/.test(lit)) continue;
      spans.push(...collectProductSpeakCoverSpans(text, lit));
      continue;
    }

    if (kind === "verified_coverage_name") {
      // Contiguous verified name only: full literal + head before '('.
      // "질병1~5종수술비IV" covers 1~5. Detached "— 2종" stays outside.
      if (!/\D/.test(lit)) continue;
      spans.push(...findContiguousLiteralSpans(text, lit));
      const cut = lit.search(/\s*\(/);
      if (cut > 0) {
        const head = lit.slice(0, cut).trim();
        if (head && /\d/.test(head) && /\D/.test(head)) {
          spans.push(...findContiguousLiteralSpans(text, head));
        }
      }
      continue;
    }

    if (kind === "verified_coverage_amount") {
      // Full unit literal only (100만원). Bare 100 / 월 100만원 without 만원 span stay blocked.
      if (!/\D/.test(lit)) continue;
      spans.push(...findContiguousLiteralSpans(text, lit));
      const spacedManwon = lit.replace(/만원/g, "만 원");
      if (spacedManwon !== lit) {
        spans.push(...findContiguousLiteralSpans(text, spacedManwon));
      }
      continue;
    }

    if (kind === "verified_insurance_period") {
      // Nest literal only. Do not invent 100세만기 from product "(세만기형)".
      if (!/\D/.test(lit)) continue;
      spans.push(...findContiguousLiteralSpans(text, lit));
      continue;
    }

    if (kind === "verified_payment_term") {
      if (/\D/.test(lit)) {
        spans.push(...findContiguousLiteralSpans(text, lit));
      }
      // Context-bound only — never bare indexOf("20") (would hit "2024").
      for (const y of lit.match(/\d+/g) ?? []) {
        const re = new RegExp(
          String.raw`${y}\s*년\s*납|납입(?:은|이|을|기간)?\s*${y}(?:\s*년)?`,
          "g",
        );
        for (const m of String(text).matchAll(re)) {
          spans.push({ start: m.index, end: m.index + m[0].length });
        }
      }
      continue;
    }

    if (kind === "verified_policy_count") {
      // Count context only: 1개 / 1건 / 1계약. Never 1종.
      const n = String(lit).replace(/^0+(?=\d)/, "");
      if (!/^\d+$/.test(n)) continue;
      const re = new RegExp(
        String.raw`${n}\s*(?:개|건|계약)|총\s*${n}|계약\s*${n}`,
        "g",
      );
      for (const m of String(text).matchAll(re)) {
        spans.push({ start: m.index, end: m.index + m[0].length });
      }
      continue;
    }

    if (kind === "verified_policy_date") {
      // Date context only: 2024년 12월 3일 / 12월 3일 / dotted. Never 3종.
      for (const form of collectVerifiedDateContextSpeakForms(lit)) {
        spans.push(...findContiguousLiteralSpans(text, form));
      }
    }
  }
  return spans;
}

function matchCoveredBySpans(match, spans) {
  return spans.some((s) => match.start >= s.start && match.end <= s.end);
}

function scanBannedTemplates(text = "") {
  const hits = [];
  for (const re of SLICE5_BANNED_TEMPLATE_PHRASES) {
    if (re.test(text)) hits.push(re.source.slice(0, 40));
  }
  return hits;
}

function scanRedirectPatterns(text = "") {
  return REDIRECT_PATTERNS.filter((re) => re.test(text)).map((re) => re.source.slice(0, 30));
}

function scanCalculatedNumberPatterns(text = "") {
  return CALCULATED_NUMBER_PATTERNS.filter((re) => re.test(text)).map((re) => re.source.slice(0, 30));
}

function scanOverFamiliarityPatterns(text = "", directive = null) {
  const hits = [];
  for (const re of OVER_FAMILIAR_PATTERNS) {
    if (re.test(text)) hits.push(re.source.slice(0, 40));
  }
  for (const re of EMOTION_CERTAINTY_PATTERNS) {
    if (re.test(text)) hits.push(`emotion_certainty:${re.source.slice(0, 30)}`);
  }
  for (const re of INFORMAL_SPEECH_PATTERNS) {
    if (re.test(text)) hits.push(`informal:${re.source.slice(0, 30)}`);
  }
  for (const phrase of directive?.over_familiarity_boundary?.forbidden_assertions ?? []) {
    if (phrase && text.includes(phrase)) hits.push(`assertion:${phrase}`);
  }
  return hits;
}

function optionalFactMentioned(text, fact) {
  const factId = typeof fact === "string" ? fact : fact?.fact_id;
  if (factId === "policy_count") {
    return /\d+\s*(?:건|개)|증권|계약/.test(text);
  }
  if (factId === "insurer") {
    const name = fact?.value ? String(fact.value) : null;
    if (name) return text.includes(name);
    return /삼성생명|메리츠|현대해상|KB손보|한화|DB손보|교보|NH/.test(text);
  }
  if (factId === "product") {
    const name = fact?.value ? String(fact.value) : null;
    if (name) {
      const short = name.replace(/보험$/, "").trim();
      return text.includes(name) || (short.length >= 2 && text.includes(short));
    }
    return /실손의료|실손\s*의료|의료비보험/.test(text);
  }
  if (factId === "monthly_premium") {
    return /(?:월\s*\d|만\s*\d\s*원|\d,\d{3}\s*원|4만5천|5천\s*원)/.test(text);
  }
  return false;
}

/** Optional claims: omission OK; if mentioned, must align with factory facts. */
function assertOptionalClaimsAccuracy(text, optionalFacts = []) {
  if (!optionalFacts.length) return { ok: true, reason: null, missing: [] };

  const mentionedFacts = optionalFacts.filter((f) => f.fact_id && optionalFactMentioned(text, f));

  if (mentionedFacts.length === 0) {
    return { ok: true, reason: null, missing: [], skipped: "optional_not_mentioned" };
  }

  return assertFactTextAlignment({ answerText: text, factsSpoken: mentionedFacts });
}

function checkRequiredClaim(text, claim) {
  if (claim.forbidden_patterns?.some((re) => re.test(text))) return false;
  if (claim.required_patterns?.length) {
    const groups = Array.isArray(claim.required_patterns[0])
      ? claim.required_patterns
      : [claim.required_patterns];
    for (const group of groups) {
      if (!group.some((re) => re.test(text))) return false;
    }
  }
  if (claim.check_patterns?.length) {
    if (!claim.check_patterns.some((re) => re.test(text))) return false;
  }
  return true;
}

function assertRequiredClaimsAlignment(text, requiredClaims = []) {
  if (!requiredClaims.length) return { ok: true, missing: [] };
  const missing = [];
  for (const claim of requiredClaims) {
    if (!checkRequiredClaim(text, claim)) missing.push(claim.id);
  }
  return { ok: missing.length === 0, missing };
}

function focusPreserved(question, focus, text) {
  const a = String(text);
  if (focus === "greeting") return /안녕|반갑|환영|오셨|편하/.test(a) && !/22건/.test(a);
  if (focus === "first_visit" || focus === "browse") return /처음|둘러|편하게|천천히|부담\s*없/.test(a) || !/22건/.test(a);
  if (focus === "cancer_coverage" || focus === "cancer_direct") return /암/.test(a);
  if (focus === "premium_amount") return /보험료|월\s*\d|만\s*\d|원/.test(a);
  if (focus === "premium_burden" || focus === "premium_reduction") return /부담|보험료|줄이|빼/.test(a);
  if (focus === "emotional_support") return !/22건|삼성생명|실손의료/.test(a);
  if (focus === "next_step") return /부터|다음|이어|볼|순서/.test(a);
  if (focus === "policy_overview") return /보험|분석|확인|등록/.test(a);
  if (/암/.test(question)) return /암/.test(a);
  return true;
}

function koreanCompleteness(text = "") {
  const t = normalizeText(text);
  if (!t) return false;
  if (FRAGMENT_END_RE.test(t)) return false;
  // Hard hole: topic particle + bare 예요 (predicate stem missing). Ends-with-요 alone is not enough.
  if (/(?:은|는)\s+예요/.test(t)) return false;
  return /(요|니다|까요|세요|죠|네요|래요|같아요|겠습니다|드릴게요|볼게요|할게요|돼요|입니다)[\.!?]?$/.test(t);
}

/** Diagnostic short forms only — never a whole-answer truth judge. */
export const KNOWN_INSURER_SHORT_NAMES = Object.freeze([
  "메리츠",
  "현대해상",
  "KB손보",
  "한화",
  "DB손보",
  "삼성생명",
  "교보",
  "NH",
]);

function jailbreakAudit(directive, text) {
  const allowed = directive?.allowed_fact_tokens ?? {};
  const allowedList = directive?.allowed_numbers ?? [];
  const allowedNums = new Set(
    [
      ...allowedList,
      ...Object.values(allowed)
        .filter((v) => v != null)
        .flatMap((v) => extractNumbers(String(v))),
    ].filter(Boolean),
  );
  if (allowed.policy_count) allowedNums.add(String(allowed.policy_count));

  const provenances = Array.isArray(directive?.allowed_number_provenances)
    ? directive.allowed_number_provenances
    : [];
  const provenanceSpans = provenanceCoverSpans(text, provenances);

  const rogueNums = extractNumberMatches(text)
    .filter((m) => m.token !== "0")
    .filter((m) => !allowedNums.has(m.token))
    .filter((m) => !matchCoveredBySpans(m, provenanceSpans))
    .map((m) => m.token);
  const allowedNames = [allowed.insurer, allowed.product].filter(Boolean);
  const mentionedInsurers = KNOWN_INSURER_SHORT_NAMES.filter(
    (name) => text.includes(name) && !allowedNames.some((a) => String(a).includes(name)),
  );
  const calculatedHits = scanCalculatedNumberPatterns(text);

  return {
    // Insurer names / attribution-shaped strings are diagnostic only.
    // Unlinked digits and summary-math speech stay diagnostic (SOFT).
    forbidden_fact_violation: false,
    rogue_numbers: rogueNums,
    rogue_insurers: mentionedInsurers,
    mentioned_insurers: mentionedInsurers,
    calculated_number_hits: calculatedHits,
    provenance_cover_span_count: provenanceSpans.length,
  };
}

function recommendationOrTerminationRisk(text = "") {
  const enrollment_push = ENROLLMENT_PUSH_RE.test(text);
  const cancellation_push = CANCELLATION_PUSH_RE.test(text);
  const termination_close_risk = COMPLETED_AUTHORITY_RE.test(text);
  return {
    enrollment_push,
    cancellation_push,
    termination_close_risk,
    definitive_verdict: DEFINITIVE_RE.test(text),
    recommendation_or_termination_risk:
      enrollment_push || cancellation_push || termination_close_risk,
  };
}

/**
 * @param {object} params
 * @param {string} params.text
 * @param {object} params.directive
 * @param {string} [params.s5ReferenceText]
 */
export function gateKeyVoiceAnswer({ text = "", directive = null, s5ReferenceText = "" } = {}) {
  const normalized = normalizeText(text);
  const reasons = [];
  const question = directive?.original_user_question ?? "";
  const focus = directive?.question_focus ?? deriveKeyVoiceQuestionFocus(question);

  if (!normalized) reasons.push("empty_answer");

  const optionalFacts =
    (directive?.optional_claims ?? [])
      .filter((c) => c.fact_id)
      .map((c) => {
        const fromFacts = (directive?.facts_to_speak ?? []).find((f) => f.fact_id === c.fact_id);
        return fromFacts ?? { fact_id: c.fact_id, value: null, source: "directive" };
      })
      .filter((f) => f.value != null) ?? directive?.facts_to_speak ?? [];

  const optionalGate = assertOptionalClaimsAccuracy(normalized, optionalFacts);
  if (!optionalGate.ok) {
    reasons.push(`optional_fact_gate:${optionalGate.reason}`);
  }

  const requiredGate = assertRequiredClaimsAlignment(normalized, directive?.required_claims ?? []);
  if (!requiredGate.ok) {
    reasons.push(`required_claims:${requiredGate.missing.join(",")}`);
  }

  const jail = jailbreakAudit(directive, normalized);
  if (jail.forbidden_fact_violation) reasons.push("jailbreak_fact");
  if ((jail.rogue_numbers ?? []).length) reasons.push("unlinked_number");
  if ((jail.calculated_number_hits ?? []).length) reasons.push("calculated_number_speech");

  const forbiddenHits = scanSpeechForbiddenPatterns(normalized);
  if (forbiddenHits.length) reasons.push(`forbidden:${forbiddenHits.join(",")}`);

  const bannedHits = scanBannedTemplates(normalized);
  if (bannedHits.length) reasons.push(`banned_template:${bannedHits.length}`);

  const voiceForbidden = (directive?.voice_forbidden_phrases ?? []).filter((phrase) =>
    phrase && normalized.includes(phrase),
  );
  if (voiceForbidden.length) reasons.push(`voice_forbidden:${voiceForbidden.join(",")}`);

  const overFamiliarHits = scanOverFamiliarityPatterns(normalized, directive);
  if (overFamiliarHits.length) reasons.push(`over_familiar:${overFamiliarHits.slice(0, 3).join(",")}`);

  if (isDeferOnlyText(normalized)) reasons.push("defer_only");

  const redirectHits = scanRedirectPatterns(normalized);
  if (redirectHits.length) reasons.push(`redirect:${redirectHits.length}`);

  if (!focusPreserved(question, focus, normalized)) reasons.push("focus_drift");

  if (!koreanCompleteness(normalized)) reasons.push("incomplete_korean");

  const termRisk = recommendationOrTerminationRisk(normalized);
  if (termRisk.recommendation_or_termination_risk) reasons.push("recommendation_or_termination");

  const speechValidation = validateDu1CustomerSpeech(normalized, {
    policyFactSpeak: optionalFacts.some((f) => optionalFactMentioned(normalized, f)),
    slice4UnderstandingSpeak: true,
  });
  if (!speechValidation.ok) reasons.push("du1_speech_validation");

  let repetitionVsS5 = false;
  if (s5ReferenceText && normalized) {
    const a = normalized.replace(/\s+/g, "");
    const b = String(s5ReferenceText).replace(/\s+/g, "");
    if (a === b) repetitionVsS5 = true;
    else if (a.length > 40 && b.includes(a.slice(0, 40))) repetitionVsS5 = true;
  }
  if (repetitionVsS5) reasons.push("repeat_vs_s5");

  return {
    ok: reasons.length === 0,
    reasons,
    fact_text_gate: optionalGate,
    required_claims_gate: requiredGate,
    forbidden_hits: forbiddenHits,
    banned_template_hits: bannedHits,
    redirect_hits: redirectHits,
    defer_patterns_checked: DEFER_ONLY_PATTERNS.length,
    focus_preserved: focusPreserved(question, focus, normalized),
    korean_completeness: koreanCompleteness(normalized),
    forbidden_fact_violation: jail.forbidden_fact_violation,
    unsupported_claim: termRisk.definitive_verdict,
    ...termRisk,
    repetition_vs_s5: repetitionVsS5,
    over_familiarity_hits: overFamiliarHits,
    jailbreak_detail: jail,
    speech_validation: speechValidation,
  };
}

export {
  koreanCompleteness,
  focusPreserved,
  assertRequiredClaimsAlignment,
  assertOptionalClaimsAccuracy,
  jailbreakAudit,
  recommendationOrTerminationRisk,
};
