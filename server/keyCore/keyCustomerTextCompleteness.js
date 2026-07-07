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

function normalizeText(text = "") {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
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

export function guardKeyCustomerTextCompleteness(customerText = "") {
  const text = normalizeText(customerText);
  const detection = detectKeyCustomerTextIncomplete(text);
  if (!detection.incomplete) {
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
      reason: detection.reason,
      before_preview: text.slice(0, 200),
    },
  };
}
