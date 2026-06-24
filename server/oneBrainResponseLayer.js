/**
 * One Brain Response Layer — single customer-facing output boundary.
 */
import { hasInsuranceTopicSignal } from "./intentGateLayer.js";
import {
  buildGuidanceResponse,
  resolveGuidanceIntent,
  GUIDANCE_INTENTS,
} from "./guidanceLayer/guidanceBuilder.js";
import { LIFEGUARD_CHAT_FALLBACK } from "./lifeguardChatCore.js";
import {
  finalizeSalesDirectorResponse,
  resolveSalesDirectorJudgmentIntent,
  shouldApplySalesDirectorFormatter,
} from "./salesDirectorFormatter.js";

export const ONE_BRAIN_SURFACES = {
  CONSULTATION: "consultation",
  HOME: "home",
};

const VERIFIED_PASSTHROUGH_INTENTS = new Set([
  "factual_lookup",
  "claim_eligibility_check",
  "policy_detail",
]);

const HOME_VERIFIED_INTENTS = new Set([
  "premium_lookup",
  "policy_count",
  "insurer_lookup",
  "premium_unknown_lookup",
  "memory_recall_lookup",
]);

const REDIRECT_PATTERNS = [
  /AI\s*상담실/i,
  /다른\s*메뉴/i,
  /이동(?:해|하)/i,
  /redirect/i,
];

const STANDALONE_IGNORANCE_PATTERNS = [
  /^모르겠습니다[.!]?$/,
  /^알\s*수\s*없습니다[.!]?$/,
  /^확인할\s*수\s*없습니다[.!]?$/,
];

const JUDGMENT_ASSERTION_PATTERNS = [
  /반드시\s*부족/,
  /확실히\s*부족/,
  /부족합니다/,
  /없습니다/,
  /충분합니다/,
  /괜찮습니다/,
  /가입해야\s*합니다/,
];

function normalizeQuestion(question = "") {
  return String(question ?? "").replace(/\s+/g, " ").trim();
}

function hasPremiumEvidence(factBundle = {}) {
  return Boolean(factBundle?.premium_stats?.premiumKnownCount > 0);
}

function hasCoverageEvidence(factBundle = {}) {
  return Boolean(
    factBundle?.has_stored_coverage_analysis ||
      (factBundle?.policy_count ?? 0) > 0 ||
      (factBundle?.policies?.length ?? 0) > 0,
  );
}

export function sanitizeOneBrainCustomerText(text, factBundle = {}) {
  let sanitized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!sanitized) return sanitized;

  for (const pattern of REDIRECT_PATTERNS) {
    sanitized = sanitized.replace(pattern, "");
  }

  for (const pattern of STANDALONE_IGNORANCE_PATTERNS) {
    if (pattern.test(sanitized)) {
      sanitized = "";
      break;
    }
  }

  sanitized = sanitized.replace(/\s{2,}/g, " ").trim();

  if (!hasPremiumEvidence(factBundle)) {
    sanitized = sanitized.replace(/월\s*보험료\s*[:：]?\s*[\d,]+원?/gi, "월 보험료: 미확인");
    sanitized = sanitized.replace(/보험료(?:\s*합계)?(?:는)?\s*[\d,]+원?/gi, "보험료: 미확인");
  }

  if (!hasCoverageEvidence(factBundle)) {
    sanitized = sanitized.replace(/(미보유|없습니다|가입되어\s*있지)/g, "미확인");
  }

  return sanitized.trim();
}

function requiresGuidanceResponse(classificationIntent, question, { homeBrainIntent = null, surface = null } = {}) {
  const guidanceIntent = resolveGuidanceIntent(classificationIntent, question);
  if (guidanceIntent) return guidanceIntent;

  if (surface === ONE_BRAIN_SURFACES.HOME && homeBrainIntent === "unsupported") {
    return resolveGuidanceIntent(classificationIntent, question) ?? GUIDANCE_INTENTS.GENERAL_JUDGMENT;
  }

  return null;
}

function isVerifiedPassthrough(classificationIntent, { homeBrainIntent = null, surface = null } = {}) {
  if (surface === ONE_BRAIN_SURFACES.HOME) {
    return HOME_VERIFIED_INTENTS.has(homeBrainIntent);
  }
  return VERIFIED_PASSTHROUGH_INTENTS.has(classificationIntent);
}

function casualNeedsGuidance(question, text) {
  const normalizedQuestion = normalizeQuestion(question);
  if (resolveGuidanceIntent("general_consultation", normalizedQuestion)) return true;
  if (resolveGuidanceIntent("coverage_gap_check", normalizedQuestion)) return true;
  if (hasInsuranceTopicSignal(normalizedQuestion) && JUDGMENT_ASSERTION_PATTERNS.some((p) => p.test(text))) {
    return true;
  }
  return false;
}

function applySalesDirectorFormatterLayer(
  text,
  { intent, question, surface, factBundle, homeBrainIntent, homeRoute },
) {
  if (
    !shouldApplySalesDirectorFormatter(intent, question, {
      surface,
      homeBrainIntent,
      homeRoute,
      homeVerifiedIntents: HOME_VERIFIED_INTENTS,
    })
  ) {
    return text;
  }
  return finalizeSalesDirectorResponse({
    rawText: text,
    intent: resolveSalesDirectorJudgmentIntent(intent, question),
    classificationIntent: intent,
    surface,
    factBundle,
    homeBrainIntent,
    homeRoute,
    homeVerifiedIntents: HOME_VERIFIED_INTENTS,
  }).text;
}

export function finalizeOneBrainResponse({
  text = "",
  question = "",
  intent = "",
  surface = ONE_BRAIN_SURFACES.CONSULTATION,
  factBundle = {},
  homeBrainIntent = null,
  homeRoute = null,
  tomGapVoiceHandled = false,
} = {}) {
  const normalizedQuestion = normalizeQuestion(question);
  const bundle = {
    ...factBundle,
    question: normalizedQuestion,
  };
  const isHomeSurface = surface === ONE_BRAIN_SURFACES.HOME;

  const formatterContext = {
    intent,
    question: normalizedQuestion,
    surface,
    factBundle: bundle,
    homeBrainIntent,
    homeRoute,
  };

  if (intent === "casual_chat") {
    if (
      shouldApplySalesDirectorFormatter(intent, normalizedQuestion, {
        surface,
        homeBrainIntent,
        homeRoute,
        homeVerifiedIntents: HOME_VERIFIED_INTENTS,
      })
    ) {
      return applySalesDirectorFormatterLayer(text || normalizedQuestion, formatterContext);
    }
    if (!isHomeSurface && casualNeedsGuidance(normalizedQuestion, text)) {
      const guidanceIntent =
        resolveGuidanceIntent("coverage_gap_check", normalizedQuestion) ??
        resolveGuidanceIntent("general_consultation", normalizedQuestion) ??
        GUIDANCE_INTENTS.GENERAL_JUDGMENT;
      return applySalesDirectorFormatterLayer(
        buildGuidanceResponse(guidanceIntent, bundle, { question: normalizedQuestion }),
        formatterContext,
      );
    }
    const sanitized = sanitizeOneBrainCustomerText(text, bundle);
    return sanitized || LIFEGUARD_CHAT_FALLBACK;
  }

  if (intent === "coverage_gap_check" && tomGapVoiceHandled) {
    const sanitized = sanitizeOneBrainCustomerText(text, bundle);
    if (sanitized) {
      return sanitized;
    }
    return "아직 암 보장 금액이 보이지 않아요. 보장내역서 추가 페이지를 주시면 바로 확인해 드릴게요.";
  }

  if (isHomeSurface) {
    if (homeRoute === "high_stakes_defer") {
      return sanitizeOneBrainCustomerText(text, bundle) || text;
    }
    if (isVerifiedPassthrough(intent, { homeBrainIntent, surface })) {
      const sanitized = sanitizeOneBrainCustomerText(text, bundle);
      if (sanitized) return sanitized;
    }
    const fallbackSanitized = sanitizeOneBrainCustomerText(text, bundle);
    if (fallbackSanitized) {
      return applySalesDirectorFormatterLayer(fallbackSanitized, formatterContext);
    }
    return LIFEGUARD_CHAT_FALLBACK;
  }

  const guidanceIntent = requiresGuidanceResponse(intent, normalizedQuestion, {
    homeBrainIntent,
    surface,
  });
  if (guidanceIntent) {
    return applySalesDirectorFormatterLayer(
      buildGuidanceResponse(guidanceIntent, bundle, { question: normalizedQuestion }),
      formatterContext,
    );
  }

  if (isVerifiedPassthrough(intent, { homeBrainIntent, surface })) {
    const sanitized = sanitizeOneBrainCustomerText(text, bundle);
    if (!sanitized) {
      return applySalesDirectorFormatterLayer(
        buildGuidanceResponse(GUIDANCE_INTENTS.GENERAL_JUDGMENT, bundle, {
          question: normalizedQuestion,
        }),
        formatterContext,
      );
    }
    return sanitized;
  }

  const fallbackSanitized = sanitizeOneBrainCustomerText(text, bundle);
  if (
    !fallbackSanitized ||
    REDIRECT_PATTERNS.some((pattern) => pattern.test(text)) ||
    STANDALONE_IGNORANCE_PATTERNS.some((pattern) => pattern.test(fallbackSanitized))
  ) {
    return applySalesDirectorFormatterLayer(
      buildGuidanceResponse(GUIDANCE_INTENTS.GENERAL_JUDGMENT, bundle, {
        question: normalizedQuestion,
      }),
      formatterContext,
    );
  }

  return applySalesDirectorFormatterLayer(fallbackSanitized, formatterContext);
}

export function shouldDeferLegacyLlmForOneBrain(intentGate = null, question = "") {
  const intent = intentGate?.intent ?? null;
  if (!intent) return false;
  if (intent === "coverage_gap_check") return true;
  return Boolean(resolveGuidanceIntent(intent, question));
}
