/**
 * Slice 3 — compose customer speak from Thinking Flow + Facts (single KEY outlet).
 */
import {
  formatInsurerName,
  formatPolicyPremium,
  formatProductName,
} from "../../src/lib/policyExplorer.js";
import {
  buildDu1InputBundle,
  composeQuestionWithEpistemicTrace,
  DU1_EPISTEMIC_TIER,
  DU1_INPUT_SOURCE,
  segmentsToCustomerText,
  validateDu1CustomerSpeech,
  validateDu1EpistemicSegments,
} from "./du1DocumentUploadFirstSpeak.js";
import {
  classifyAndResolveSpeechProfile,
  deriveSpeechHintFromGoal,
  scanSpeechForbiddenPatterns,
} from "./keySpeechTurnType.js";
import { assertSpeakFactGate } from "../keyCore/keyCustomerUnderstanding.js";
import { buildQuestionSpeakFromDecision } from "./keySpeakFromDecision.js";
import { isKeyVoiceActive } from "../keyCore/oneKeyCoreFlags.js";
import { buildKeyVoiceComposeResult } from "../keyCore/keyVoiceCompose.js";
import { recordGhostPathReached } from "../keyCore/keyVoiceSpeak.js";
import { CONVERSATION_INTENTION, isDeferOnlyText } from "../keyCore/keyThinkingFlow.js";
import { isKeySocialTurn, resolveKeySocialConversationPattern } from "../keyConversationPatterns.js";

function normalizeText(text = "") {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatPremiumConversational(policy) {
  const raw = formatPolicyPremium(policy);
  if (raw === "확인 필요" || raw === "보험료미제공") return null;
  return raw;
}

export function buildPolicyFactSpeakText(policies = [], ghostLedger = null) {
  recordGhostPathReached("buildPolicyFactSpeakText", {}, ghostLedger);
  if (!policies.length) return null;

  const parts = [];
  if (policies.length === 1) {
    const policy = policies[0];
    const insurer = formatInsurerName(policy);
    const product = formatProductName(policy);
    const premium = formatPremiumConversational(policy);
    const premiumPart = premium ? `, 월 ${premium}` : "";
    parts.push(`1건 확인돼요. ${insurer} ${product}${premiumPart}.`);
  } else {
    parts.push(`등록된 보험이 ${policies.length}건이에요.`);
    policies.slice(0, 3).forEach((policy, index) => {
      const insurer = formatInsurerName(policy);
      const product = formatProductName(policy);
      const premium = formatPremiumConversational(policy);
      const premiumPart = premium ? `, 월 ${premium}` : "";
      parts.push(`${index + 1}. ${insurer} ${product}${premiumPart}`);
    });
  }
  parts.push("더 자세히 볼 부분이 있으면 말씀해 주세요.");
  return parts.join(" ");
}

export function buildGapAssessmentSpeakText({
  policies = [],
  coverageGapTopConcerns = [],
  coverageGapScore = null,
} = {}) {
  const hasPolicies = policies.length > 0;
  const topConcern = coverageGapTopConcerns?.[0] ?? null;

  if (topConcern) {
    const concernLabel =
      typeof topConcern === "string"
        ? topConcern
        : topConcern?.label ?? topConcern?.category ?? "일부 축";
    return `등록된 보험은 확인됐어요. ${concernLabel} 쪽 신호가 있어서 그게 마음 쓰이실 수 있어요. 그 부분부터 볼까요?`;
  }

  if (hasPolicies) {
    return "등록된 보험은 확인됐어요. 전체적으로 큰 공백이 있는지부터 같이 짚어볼게요. 어떤 축이 더 걸리세요?";
  }

  return "가입 정보가 있으면 그걸 기준으로 상태를 같이 볼 수 있어요. 등록된 보험이 있으신가요?";
}

function buildDailySpeakText(question = "", conversationIntention = null, ghostLedger = null) {
  recordGhostPathReached("buildDailySpeakText", {}, ghostLedger);
  const q = normalizeText(question);
  if (/맛집|식당|음식/.test(q)) {
    return "분당이면 판교·정자 쪽 선택지가 많아요. 한식·일식 다 괜찮은 곳이 있어요. 어디 쪽이세요?";
  }
  if (/날씨|덥|춥/.test(q)) {
    return "요즘 날씨가 많이 힘드시죠. 오늘은 무리하지 않으셔도 돼요.";
  }
  if (conversationIntention === CONVERSATION_INTENTION.COMFORT) {
    return "많이 버티셨네요. 오늘은 가볍게만 해도 돼요. 잠깐 쉬실 여유는 있으세요?";
  }
  return null;
}

function buildFactFirstSegments(thinkingFlow = {}, evidenceBundle = null) {
  const segments = [];
  const policies = thinkingFlow.policies ?? [];
  const need = thinkingFlow.customer_need_detected;
  const intention = thinkingFlow.conversation_intention;

  if (need === "enrolled_policy_list" && policies.length > 0) {
    const text = buildPolicyFactSpeakText(policies);
    if (text) {
      segments.push({
        source: DU1_INPUT_SOURCE.POLICIES,
        tier: DU1_EPISTEMIC_TIER.CERTAIN,
        text,
        basis: "key_thinking_flow_s3",
      });
      return segments;
    }
  }

  if (need === "coverage_assessment") {
    const gapText = buildGapAssessmentSpeakText({
      policies,
      coverageGapTopConcerns: evidenceBundle?.coverage_gap?.top_concerns ?? [],
      coverageGapScore: evidenceBundle?.coverage_gap?.score ?? null,
    });
    segments.push({
      source: DU1_INPUT_SOURCE.JUDGMENT,
      tier: DU1_EPISTEMIC_TIER.INFERENCE,
      text: gapText,
      basis: "key_thinking_flow_s3_gap",
    });
    if (intention === CONVERSATION_INTENTION.REASSURE_WITH_TRUTH && policies.length > 0) {
      const policyHint = buildPolicyFactSpeakText(policies.slice(0, 1));
      if (policyHint) {
        segments.push({
          source: DU1_INPUT_SOURCE.POLICIES,
          tier: DU1_EPISTEMIC_TIER.CERTAIN,
          text: policyHint.split(".")[0] + ".",
          basis: "key_thinking_flow_s3_policy_hint",
        });
      }
    }
    return segments;
  }

  if (thinkingFlow.domain === "daily") {
    const dailyText = buildDailySpeakText(thinkingFlow.question ?? "", intention);
    if (dailyText) {
      segments.push({
        source: DU1_INPUT_SOURCE.JUDGMENT,
        tier: DU1_EPISTEMIC_TIER.INFERENCE,
        text: dailyText,
        basis: "key_thinking_flow_s3_daily",
      });
      return segments;
    }
  }

  if (thinkingFlow.domain === "emotion" || intention === CONVERSATION_INTENTION.COMFORT) {
    const comfortText = buildDailySpeakText(thinkingFlow.question ?? "", intention);
    if (comfortText) {
      segments.push({
        source: DU1_INPUT_SOURCE.JUDGMENT,
        tier: DU1_EPISTEMIC_TIER.INFERENCE,
        text: comfortText,
        basis: "key_thinking_flow_s3_comfort",
      });
      return segments;
    }
  }

  return segments;
}

function policySpeakFacts(policies = []) {
  if (!policies.length) return null;
  const policy = policies[0];
  const insurer = formatInsurerName(policy);
  const product = formatProductName(policy);
  const premium = formatPremiumConversational(policy);
  const premiumPart = premium ? `, 월 ${premium}` : "";
  const countPart = policies.length === 1 ? "1건" : `${policies.length}건`;
  return { countPart, insurer, product, premiumPart, premium, policy };
}

function buildS4GoalSpeakText({
  customerGoal = null,
  policies = [],
  question = "",
  evidenceBundle = null,
} = {}) {
  const facts = policySpeakFacts(policies);
  const insurerProduct =
    facts ? `${facts.insurer} ${facts.product}${facts.premiumPart}` : null;

  switch (customerGoal) {
    case "premium_burden":
      if (!facts) {
        return "등록된 보험 정보가 아직 없어서 보험료 숫자는 확인이 어려워요. 가입 정보가 있으시면 그걸 기준으로 같이 볼 수 있어요.";
      }
      return `등록된 보험 확인했어요. ${facts.insurer} ${facts.product}${facts.premiumPart}이시네요. 부담이시라고 하셨으니, 지금 확인된 매달 나가는 금액은 ${facts.premium ? facts.premium.replace("월 ", "") : "확인된 금액"}이 맞아요. 등록 목록에는 이 한 건만 보여요—다른 보험이 더 있는지는 여기서는 모르겠어요. 오늘은 줄이고 싶은지, 이 정도가 맞는지부터 정리하는 게 좋겠어요. 보험료 숫자부터 같이 보면 되고, 필요하시면 이 보험이 꼭 유지해야 하는 구조인지도 이어서 짚을 수 있어요. 편하실 때 말씀해 주세요.`;

    case "enrolled_policy_list":
      if (!facts) {
        return "등록된 보험 정보가 아직 없어서 목록을 말씀드리기 어려워요. 가입 정보가 있으시면 그걸 기준으로 같이 볼 수 있어요.";
      }
      if (/가르쳐|알려|설명/.test(question)) {
        return `등록된 보험 ${facts.countPart} 확인됐어요. ${insurerProduct}이에요. 가르쳐달라고 하셨으니 확인된 내용부터 말씀드렸어요. 실손은 병원비를 실비로 돌려받는 쪽이에요—세부 보장표 전체는 이 대화만으로 다 말씀드리기 어려워요. 다음엔 보험료가 걸리는지, 어떤 상황에 쓰이는지 중에서 골라 깊게 볼 수 있어요.`;
      }
      return `지금 등록된 보험은 ${insurerProduct} ${facts.countPart}이에요. 여기까지가 지금 확인된 목록이에요. 다른 건이 더 있는지는 이 목록만으로는 알 수 없어요. 더 보고 싶으시면 이름·보험료 말고 어떤 부분이 궁금한지 알려주시면 그다음 이어갈게요.`;

    case "coverage_assessment_whole":
      if (!facts) {
        return "가입 정보가 있으면 그걸 기준으로 전체 상태를 같이 볼 수 있어요. 등록된 보험이 있으신가요?";
      }
      return `등록된 보험 확인했어요. ${facts.insurer} 실손 ${facts.countPart}${facts.premiumPart}이시네요. "괜찮아?"는 전체를 보시는 거죠. 지금 확인된 건 실손 가입과 보험료까지예요. 암·운전자 같은 다른 축은 이 목록만으로는 단정하기 어려워요. 전체를 보려면 어느 축부터 볼지 정하면 돼요—실손만으로 만족하시는지, 다른 보장이 더 있는지부터 짚을 수 있어요.`;

    case "coverage_assessment_cancer_axis": {
      const topConcern = evidenceBundle?.coverage_gap?.top_concerns?.[0] ?? null;
      const signalLabel =
        typeof topConcern === "string"
          ? topConcern
          : topConcern?.label ?? topConcern?.category ?? null;
      if (!facts) {
        return "가입 정보가 있으면 암보장 축부터 같이 볼 수 있어요.";
      }
      if (signalLabel && /암/.test(String(signalLabel))) {
        return `등록된 보험 확인했어요. 실손은 있으세요. 분석에서 ${signalLabel} 축을 확인할 필요가 있다는 신호가 있어요—판정이 아니라 신호예요. 암 쪽부터 짚어볼 수도 있고, 전체를 같이 볼 수도 있어요. 편한 쪽부터 이어가면 됩니다.`;
      }
      return `등록된 보험 확인했어요. ${insurerProduct}이에요. 암보험이라고 하셨는데, 지금 등록 정보에는 실손만 보여요. 암 담보를 따로 들고 계신지는 이 목록만으로 확답하기 어려워요. 암 쪽이 걱정이시면, 실손 말고 암보험을 따로 드신 적이 있는지부터 같이 보면 돼요. 있으시면 그걸 기준으로, 없으시면 그다음에 볼 방향을 짧게 정리해 드릴게요.`;
    }

    case "direction_choice":
      if (!facts) {
        return "추천 방향을 잡으려면 지금 들고 계신 보험부터 확인하는 게 좋아요. 등록된 보험이 있으신가요?";
      }
      return `보험 확인했어요. ${insurerProduct}이에요. "그냥 추천"이시면 보통 두 갈래예요—지금 보험료를 줄이고 싶으신 건지, 빠진 보장을 채우고 싶으신 건지. 특정 상품 이름은 지금 단계에선 말씀드리기 어려워요. 보험료 쪽이 먼저면 지금 실손 한 건 기준으로 볼 여지부터, 보장 쪽이 먼저면 어느 축이 비어 있는지부터 짚는 게 맞아요. 어느 쪽이 더 끌리시는지 알려주시면 그다음 방향을 짧게 정리해 드릴게요.`;

    case "emotional_space":
      return "오늘 정말 많이 버티셨네요. 보험 이야기는 잠깐 내려놓을게요. 힘들 때는 길게 설명할 필요도 없어요. 일이 많았는지, 사람 때문에 지치셨는지, 아니면 그냥 몸이 안 따라주는 날인지—가볍게만 골라 말해 주셔도 돼요. 한 줄이어도 괜찮고, 오늘은 여기서 가볍게 쉬셔도 괜찮아요. 듣고 싶으실 때 이어주세요.";

    case "daily_recommendation":
      return "분당이면 정자역 일대 일식이 무난해요—혼밥이면 정자동 골목 쪽 작은 스시·돈카츠 집이 많고, 같이 가시면 서현역 근처 한식 코스나 상가 쪽도 괜찮아요. 오늘 한식이 편하시면 서현 쪽, 가볍게 혼밥이면 정자 쪽부터 보시면 돼요. 더 좁히고 싶으시면 말씀해 주세요.";

    case "respect_close":
      return "네, 오늘은 여기까지 해도 돼요. 고마워요. 다음에 이어서 보고 싶으실 때 편하게 오세요.";

    case "social_presence":
      return "그냥 와 주셔도 돼요. 심심하실 때 가볍게 이야기만 해도 괜찮아요. 오늘은 보험 얘기 없이 편하게만 해도 됩니다.";

    default:
      return null;
  }
}

function buildS4ComposeResult(thinkingFlow, { question = "", evidenceBundle = null, ghostLedger = null } = {}) {
  recordGhostPathReached("buildS4ComposeResult", {}, ghostLedger);
  const cu = thinkingFlow.customer_understanding ?? {};
  const customerGoal = cu.customer_goal ?? cu.selected_goal;
  const factSelection = thinkingFlow.fact_selection ?? { facts_spoken: [], facts_withheld: [] };
  const speakMode = cu.confirmation_required ? "confirmation_turn" : "fact_speak";

  const gate = assertSpeakFactGate({
    understanding_ok: cu.understanding_ok,
    factSelection,
    speak_mode: speakMode,
  });

  if (!gate.ok && speakMode !== "confirmation_turn") return null;

  const text = buildS4GoalSpeakText({
    customerGoal,
    policies: thinkingFlow.policies ?? [],
    question,
    evidenceBundle,
  });
  if (!text || isDeferOnlyText(text)) return null;

  const speechHint = deriveSpeechHintFromGoal(customerGoal);
  const forbiddenHits = scanSpeechForbiddenPatterns(text, { turnType: speechHint.turnType });

  if (forbiddenHits.length > 0) return null;

  return {
    text,
    segments: [],
    compose_mode: "key_s4_understanding_goal",
    thinking_flow_applied: true,
    speak_mode: speakMode,
    conversation_intention: thinkingFlow.conversation_intention,
    conversation_elements_used: thinkingFlow.conversation_elements_selected,
    facts_spoken: factSelection.facts_spoken ?? [],
    facts_withheld: factSelection.facts_withheld ?? [],
    facts_used: (factSelection.facts_spoken ?? []).map((f) => f.fact_id),
    defer_detected: false,
    element_count: thinkingFlow.conversation_elements_selected?.length ?? 0,
    thinking_density: thinkingFlow.thinking_density,
    speech_turn_type: speechHint.turnType,
    confidence: cu.confidence ?? cu.goal_confidence ?? null,
    selected_goal: cu.selected_goal ?? customerGoal ?? null,
    rejected_hypotheses: cu.rejected_hypotheses ?? [],
    confirmation_required: cu.confirmation_required ?? false,
    understanding_ok: cu.understanding_ok ?? null,
  };
}

/**
 * Slice 4 question speak — Customer Goal SSOT drives composition.
 * Stein A corrective: async customer path uses Claude/KEY Voice only — never S3/S4/S5 retreat.
 */
export async function buildQuestionSpeakFromUnderstandingAsync(
  keyFirstJudgment,
  {
    question = "",
    contextSnapshot = null,
    loadedContext = null,
    consultationIntent = null,
    thinkingFlow = null,
    evidenceBundle = null,
    env = process.env,
    history = [],
    previousAnswerSummary = "",
    shadowVisualBlocksOverride = null,
    ghostLedger = null,
    fetchImpl = fetch,
    startedAt = Date.now(),
  } = {},
) {
  if (thinkingFlow?.slice5_enabled && (thinkingFlow.decision || thinkingFlow.reflection)) {
    const voice = await buildKeyVoiceComposeResult(thinkingFlow, {
      question,
      evidenceBundle,
      env,
      history,
      previousAnswerSummary,
      shadowVisualBlocksOverride,
      ghostLedger,
      fetchImpl,
      startedAt,
    });
    if (voice) return voice;
    return null;
  }

  // Never fall through to S3/S4/S5 compose for customerText.
  return null;
}

/**
 * Sync legacy compose — must not produce customerText (Stein A corrective).
 * If legacy branches are reached, ghost is recorded on the turn ledger; text is discarded.
 */
export function buildQuestionSpeakFromUnderstanding(
  keyFirstJudgment,
  {
    question = "",
    contextSnapshot = null,
    loadedContext = null,
    consultationIntent = null,
    thinkingFlow = null,
    evidenceBundle = null,
    env = process.env,
    ghostLedger = null,
  } = {},
) {
  // Intentional: sync path is blocked from returning legacy customerText.
  // Callers must use async Claude compose; empty → failureMode.
  if (
    isKeySocialTurn(question) &&
    !thinkingFlow?.customer_understanding?.customer_goal
  ) {
    recordGhostPathReached("s4_social_speak_selection", { blocked_customer_text: true }, ghostLedger);
    return null;
  }

  if (!keyFirstJudgment || !thinkingFlow) return null;

  if (thinkingFlow.slice5_enabled && (thinkingFlow.decision || thinkingFlow.reflection)) {
    // Do not return S5 text — record if Decision compose would have run.
    recordGhostPathReached(
      "composeSpeakFromDecision",
      { blocked_customer_text: true, via: "sync_buildQuestionSpeakFromUnderstanding" },
      ghostLedger,
    );
    return null;
  }

  if (thinkingFlow.customer_understanding) {
    recordGhostPathReached("buildS4ComposeResult", { blocked_customer_text: true }, ghostLedger);
    return null;
  }

  recordGhostPathReached("s3_legacy_compose", { blocked_customer_text: true }, ghostLedger);
  return null;
}

/** Slice 3 legacy compose path. */
function buildQuestionSpeakFromThinkingLegacy(
  keyFirstJudgment,
  {
    question = "",
    contextSnapshot = null,
    loadedContext = null,
    consultationIntent = null,
    thinkingFlow = null,
    evidenceBundle = null,
  } = {},
) {
  if (isKeySocialTurn(question)) {
    recordGhostPathReached("s3_social_speak_selection");
    const social = resolveKeySocialConversationPattern(question);
    const text = normalizeText(social?.text ?? "반갑습니다. 천천히 맞춰가면 됩니다.");
    const speechValidation = validateDu1CustomerSpeech(text);
    return speechValidation.ok
      ? { text, segments: [], compose_mode: "key_s3_social", thinking_flow_applied: true }
      : null;
  }

  if (!keyFirstJudgment || !thinkingFlow) return null;

  const enrichedThinking = { ...thinkingFlow, question };
  const factSegments = buildFactFirstSegments(enrichedThinking, evidenceBundle);

  if (factSegments.length > 0) {
    const text = segmentsToCustomerText(factSegments);
    const speechValidation = validateDu1CustomerSpeech(text, { policyFactSpeak: true });
    const segmentValidation = validateDu1EpistemicSegments(factSegments);
    const forbiddenHits = scanSpeechForbiddenPatterns(text, {
      turnType: classifyAndResolveSpeechProfile(question, { consultationIntent }).turnType,
    });
    const deferDetected = isDeferOnlyText(text);

    if (
      speechValidation.ok &&
      segmentValidation.ok &&
      forbiddenHits.length === 0 &&
      !deferDetected
    ) {
      return {
        text,
        segments: factSegments,
        compose_mode: "key_s3_thinking_fact_first",
        thinking_flow_applied: true,
        conversation_intention: thinkingFlow.conversation_intention,
        conversation_elements_used: thinkingFlow.conversation_elements_selected,
        facts_used: thinkingFlow.facts_used_planned,
        defer_detected: false,
        element_count: thinkingFlow.conversation_elements_selected?.length ?? 0,
        thinking_density: thinkingFlow.thinking_density,
      };
    }
  }

  const bundle = buildDu1InputBundle({
    document: { id: null, event_type: "question" },
    contextSnapshot,
    loadedContext,
    keyFirstJudgment,
  });

  const { turnType, profile } = classifyAndResolveSpeechProfile(question, {
    conversation: bundle.conversation,
    consultationIntent,
  });

  const dailyProfile =
    thinkingFlow.domain === "daily"
      ? { ...profile, skipInsuranceStack: true, insuranceTopic: false }
      : profile;

  const composed = composeQuestionWithEpistemicTrace(bundle, {
    question,
    consultationIntent,
    speechProfile: dailyProfile,
    turnType,
  });

  let text = composed.text;
  let segments = composed.segments;

  if (thinkingFlow.defer_blocked && isDeferOnlyText(text)) {
    if (thinkingFlow.domain === "daily") {
      const dailyText = buildDailySpeakText(question, thinkingFlow.conversation_intention);
      if (dailyText) {
        text = dailyText;
        segments = [
          {
            source: DU1_INPUT_SOURCE.JUDGMENT,
            tier: DU1_EPISTEMIC_TIER.INFERENCE,
            text: dailyText,
            basis: "key_s3_defer_blocked_daily",
          },
        ];
      }
    }
  }

  const speechValidation = validateDu1CustomerSpeech(text);
  const segmentValidation = validateDu1EpistemicSegments(segments);
  if (!speechValidation.ok || !segmentValidation.ok) return null;

  const deferDetected = isDeferOnlyText(text);

  return {
    text,
    segments,
    compose_mode: deferDetected ? "key_s3_legacy_defer" : "key_s3_thinking_compose",
    thinking_flow_applied: true,
    conversation_intention: thinkingFlow.conversation_intention,
    conversation_elements_used: thinkingFlow.conversation_elements_selected,
    facts_used: thinkingFlow.facts_used_planned,
    defer_detected: deferDetected,
    element_count: thinkingFlow.conversation_elements_selected?.length ?? 0,
    thinking_density: thinkingFlow.thinking_density,
    speech_turn_type: turnType,
    speech_profile: dailyProfile,
  };
}

export function buildQuestionSpeakFromThinking(...args) {
  return buildQuestionSpeakFromUnderstanding(...args);
}

export { isDeferOnlyText } from "../keyCore/keyThinkingFlow.js";
