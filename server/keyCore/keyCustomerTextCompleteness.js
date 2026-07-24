/**
 * KEY Customer Text Completeness — 1.5 guard: KEY가 시작한 말은 끝까지 닫힌다.
 */
import { KEY_CARE_PLAN_BRIDGE } from "../keySpeechContinuation.js";

const BRIDGE_ONLY_RE =
  /(?:다만\s+)?제가\s+하나씩\s+같이\s+챙겨드리고\s+싶은\s+게\s+있어요\.?$/;

const MID_CARE_PLAN_CONJUNCTIVE_RE = /보면\s+좋겠고\.?$/;

const DEFAULT_BRIDGE_COMPLETION =
  "우선 이번 달에는 가입 정보를 함께 저장하고, 저장 후에는 납입과 보장 구조를 함께 확인해 보면 좋겠습니다.";

const DEFAULT_MID_CARE_PLAN_COMPLETION =
  "저장 후에는 보장 구조 순서대로 점검해 보면 좋겠습니다.";

/** General bare topic+예요 hole (detection only — do not meaning-guess). */
const BARE_TOPIC_YEYO_RE = /(은|는)\s+예요/;

/**
 * Claim-zero phrase only (HG evidence):
 * "진행 중인 청구 건**은 예요" / "진행 중인 청구 건은 예요"
 */
const IN_PROGRESS_CLAIM_ZERO_BARE_YEYO_RE =
  /(진행\s*중(?:인)?[\s\S]{0,24}?청구\s*건\*{0,2})(은|는)\s+예요/g;

function normalizeText(text = "") {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when bare topic+예요 hard hole is present (any phrase). */
export function hasBareTopicYeyoHardIncompleteness(customerText = "") {
  return BARE_TOPIC_YEYO_RE.test(String(customerText ?? ""));
}

/** True when the in-progress claim-zero bare-yeyo phrase is present. */
export function hasInProgressClaimZeroBareYeyoPhrase(customerText = "") {
  IN_PROGRESS_CLAIM_ZERO_BARE_YEYO_RE.lastIndex = 0;
  return IN_PROGRESS_CLAIM_ZERO_BARE_YEYO_RE.test(String(customerText ?? ""));
}

/**
 * In-place repair ONLY for verified in-progress claim count === 0
 * AND the claim-zero bare phrase. Never maps "정답은 예요" → "없어요".
 */
export function repairInProgressClaimZeroBareYeyo(
  customerText = "",
  { verifiedInProgressClaimCount = null } = {},
) {
  const raw = String(customerText ?? "");
  if (!raw) {
    return {
      customerText: raw,
      completeness_guard: { applied: false, reason: null },
    };
  }

  const barePresent = hasBareTopicYeyoHardIncompleteness(raw);
  const claimZeroPhrase = hasInProgressClaimZeroBareYeyoPhrase(raw);
  const countOk =
    verifiedInProgressClaimCount === 0 || verifiedInProgressClaimCount === "0";

  if (barePresent && claimZeroPhrase && countOk) {
    IN_PROGRESS_CLAIM_ZERO_BARE_YEYO_RE.lastIndex = 0;
    const customerTextRepaired = raw.replace(
      IN_PROGRESS_CLAIM_ZERO_BARE_YEYO_RE,
      (_, head, particle) => `${head}${particle} 없어요`,
    );
    return {
      customerText: customerTextRepaired,
      completeness_guard: {
        applied: true,
        reason: "in_progress_claim_zero_bare_yeyo",
        before_preview: raw.slice(0, 200),
        verified_in_progress_claim_count: 0,
      },
    };
  }

  if (barePresent) {
    // Hard incomplete — do not invent 없어요.
    return {
      customerText: raw,
      completeness_guard: {
        applied: false,
        reason: "bare_topic_yeyo_hard_incomplete",
        repair_blocked: true,
        claim_zero_phrase: claimZeroPhrase,
        verified_in_progress_claim_count:
          verifiedInProgressClaimCount == null
            ? null
            : Number(verifiedInProgressClaimCount),
      },
    };
  }

  return {
    customerText: raw,
    completeness_guard: { applied: false, reason: null },
  };
}

/** @deprecated Use repairInProgressClaimZeroBareYeyo — broad 없어요 mapping removed. */
export function repairBareTopicYeyoHardIncompleteness(customerText = "") {
  return repairInProgressClaimZeroBareYeyo(customerText, {
    verifiedInProgressClaimCount: null,
  });
}

export function detectKeyCustomerTextIncomplete(customerText = "") {
  const text = normalizeText(customerText);
  if (!text) {
    return { incomplete: true, reason: "empty_customer_text" };
  }
  if (BRIDGE_ONLY_RE.test(text)) {
    return { incomplete: true, reason: "care_plan_bridge_only" };
  }
  if (MID_CARE_PLAN_CONJUNCTIVE_RE.test(text)) {
    return { incomplete: true, reason: "care_plan_mid_conjunctive" };
  }
  if (text.includes(KEY_CARE_PLAN_BRIDGE) && !/[①②③④]|보면\s+좋겠|확인해\s+보면|점검해\s+보면|진행하겠습니다|저장하겠습니다/.test(text)) {
    return { incomplete: true, reason: "care_plan_bridge_without_action" };
  }
  return { incomplete: false, reason: null };
}

export function guardKeyCustomerTextCompleteness(
  customerText = "",
  { verifiedInProgressClaimCount = null } = {},
) {
  const bare = repairInProgressClaimZeroBareYeyo(customerText, {
    verifiedInProgressClaimCount,
  });
  const text = normalizeText(bare.customerText);
  const detection = detectKeyCustomerTextIncomplete(text);
  if (!detection.incomplete) {
    if (bare.completeness_guard.applied) {
      return {
        customerText: bare.customerText,
        completeness_guard: bare.completeness_guard,
      };
    }
    if (bare.completeness_guard.reason === "bare_topic_yeyo_hard_incomplete") {
      return {
        customerText: bare.customerText,
        completeness_guard: bare.completeness_guard,
      };
    }
    return {
      customerText: text,
      completeness_guard: { applied: false, reason: null },
    };
  }

  let repaired = text;
  if (detection.reason === "care_plan_bridge_only" || detection.reason === "care_plan_bridge_without_action") {
    const bridge = text.includes(KEY_CARE_PLAN_BRIDGE)
      ? KEY_CARE_PLAN_BRIDGE
      : text.replace(BRIDGE_ONLY_RE, "").trim();
    repaired = normalizeText(`${bridge} ${DEFAULT_BRIDGE_COMPLETION}`);
  } else if (detection.reason === "care_plan_mid_conjunctive") {
    repaired = normalizeText(
      `${text.replace(MID_CARE_PLAN_CONJUNCTIVE_RE, "보면 좋겠고")}, ${DEFAULT_MID_CARE_PLAN_COMPLETION}`,
    );
  } else {
    repaired = text || DEFAULT_BRIDGE_COMPLETION;
  }

  return {
    customerText: repaired,
    completeness_guard: {
      applied: true,
      reason: bare.completeness_guard.applied
        ? `${bare.completeness_guard.reason}+${detection.reason}`
        : detection.reason,
      before_preview: (bare.completeness_guard.before_preview || text).slice(0, 200),
    },
  };
}
