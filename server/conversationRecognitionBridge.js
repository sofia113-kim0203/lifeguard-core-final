/**
 * RC-RECOGNITION-COMPANION-v1 — Return Visit Recognition Bridge.
 * Recognition → Companion welcome → Conversation open (no Memory read).
 */
import { RC_RECOGNITION_COMPANION_CLUSTER_ID } from "./intentGateLayer.js";

export { RC_RECOGNITION_COMPANION_CLUSTER_ID };

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

export function buildRecognitionCompanionJudgment(ctx = {}) {
  return buildRecognitionCompanionResponse(ctx);
}

export function buildRecognitionCompanionResponse({ question = "" } = {}) {
  const q = normalizeQuestion(question);

  if (/^오랜만/.test(q)) {
    return normalizeText(
      pickVariant(q, [
        "오랜만이에요. 편하실 때 천천히 이어가도 됩니다.",
        "반갑습니다. 필요하실 때 이어가면 됩니다.",
      ]),
    );
  }
  if (/^다시\s*왔/.test(q)) {
    return normalizeText(
      pickVariant(q, [
        "다시 오셨네요. 편하실 때 이어가도 됩니다.",
        "반갑습니다. 천천히 맞춰가면 됩니다.",
      ]),
    );
  }
  if (/^또\s*왔/.test(q)) {
    return normalizeText(
      pickVariant(q, [
        "네, 또 뵙네요. 편하실 때 이어가도 됩니다.",
        "반갑습니다. 천천히 맞춰가면 됩니다.",
      ]),
    );
  }
  if (/^오늘도\s*왔/.test(q)) {
    return normalizeText(
      pickVariant(q, [
        "네, 오늘도 오셨네요. 편하실 때 이어가도 됩니다.",
        "반갑습니다. 천천히 맞춰가면 됩니다.",
      ]),
    );
  }
  if (/^또\s*보네/.test(q)) {
    return normalizeText(
      pickVariant(q, [
        "네, 또 뵙네요. 천천히 맞춰가면 됩니다.",
        "반갑습니다. 편하실 때 이어가도 됩니다.",
      ]),
    );
  }
  if (/^왔(?:어|네)?$/.test(q)) {
    return normalizeText(
      pickVariant(q, [
        "반갑습니다. 편하실 때 이어가도 됩니다.",
        "네, 편하실 때 천천히 이어가도 됩니다.",
      ]),
    );
  }

  return normalizeText(
    pickVariant(q, ["반갑습니다. 편하실 때 이어가도 됩니다.", "네, 천천히 맞춰가면 됩니다."]),
  );
}

export function shouldUseRecognitionCompanionCompose({
  question = "",
  factBundle = {},
  humanFrame = {},
} = {}) {
  const q = normalizeQuestion(question || humanFrame.surface_question || factBundle.question || "");
  const cluster =
    factBundle.companion_cluster ??
    (q && factBundle.classification?.companion_cluster) ??
    null;
  return cluster === RC_RECOGNITION_COMPANION_CLUSTER_ID;
}

export function recognitionCompanionResponseShape(text = "") {
  const normalized = normalizeText(text);
  if (!normalized) return "empty";
  if (/담보|한도|확인된\s*범위|걱정되는\s*축|저장(?:해|된)|확인된\s*기억/.test(normalized)) {
    return "forbidden_leak";
  }
  if (/반갑|오랜만|다시\s*오|또\s*뵙|편하실\s*때/.test(normalized)) return "recognition_welcome";
  return "other";
}
