/**
 * Slice 5 — Speak from Decision only (Goal/Need/Intent/Trace 입력 금지).
 */
import { buildDecision } from "../keyCore/keyDecision.js";
import { renderFactsSpokenBlock } from "../keyCore/speakFactRenderer.js";
import {
  assertDecisionFactGate,
  assertFactTextAlignment,
} from "../keyCore/assertFactTextGate.js";
import { isDeferOnlyText } from "../keyCore/keyThinkingFlow.js";
import { validateDu1CustomerSpeech } from "./du1DocumentUploadFirstSpeak.js";
import { scanSpeechForbiddenPatterns } from "./keySpeechTurnType.js";
import { recordGhostPathReached } from "../keyCore/keyVoiceSpeak.js";

export const SLICE5_BANNED_TEMPLATE_PHRASES = [
  /부담이시라고\s*하셨으니/,
  /가르쳐달라고\s*하셨으니/,
  /확인된\s*보험은\.\.\./,
  /암\s*축/,
  /보장\s*축/,
  /순서가\s*보입니다/,
  /같이\s*보면\s*됩니다/,
  /편하실\s*때\s*말씀/,
  /이\s*한\s*건만/,
  /한\s*건만\s*보여/,
  /실손\s*한\s*건\s*기준/,
  /조금만\s*더\s*알려주시면/,
];

function normalizeText(text = "") {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function scanBannedTemplatePhrases(text = "") {
  const hits = [];
  for (const re of SLICE5_BANNED_TEMPLATE_PHRASES) {
    if (re.test(text)) hits.push(re.source);
  }
  return hits;
}

/**
 * Compose: 질문 답 → Fact → 판단 → 방향 → (optional) 초대
 */
export function composeSpeakFromDecision({
  decision = null,
  policies = [],
  ghostLedger = null,
} = {}) {
  recordGhostPathReached("composeSpeakFromDecision", {}, ghostLedger);
  if (!decision?.decision_complete) return null;

  const parts = [];
  const hint = decision.direct_answer_hint;
  if (hint) parts.push(hint);

  const factSelection = decision.fact_selection ?? {};
  const factsSpoken = factSelection.facts_spoken ?? [];
  const factBlock = renderFactsSpokenBlock(factsSpoken, policies);
  if (factBlock) parts.push(factBlock);

  if (decision.key_judgment) parts.push(decision.key_judgment);

  const move = decision.direction?.move;
  if (move) {
    parts.push(`제가 보기에는 ${move.endsWith(".") ? move.slice(0, -1) : move}.`);
  }

  const invite = decision.invite;
  if (invite?.allowed && invite.prompt && decision.direction?.type) {
    parts.push(invite.prompt);
  }

  return normalizeText(parts.filter(Boolean).join(" "));
}

export function buildS5ComposeResult(thinkingFlow, { question = "", evidenceBundle = null } = {}) {
  let decision = thinkingFlow.decision ?? null;
  const reflection = thinkingFlow.reflection ?? null;
  const reality = thinkingFlow.reality ?? null;

  if (reflection && reality) {
    decision = buildDecision({
      reflection,
      reality,
      question: question || reflection.customer_said,
      evidenceBundle,
    });
  }

  if (!decision) return null;

  const factSelection = decision.fact_selection ?? { facts_spoken: [], facts_withheld: [] };
  const factGate = assertDecisionFactGate({ factSelection });
  if (!factGate.ok) return null;

  const text = composeSpeakFromDecision({
    decision,
    policies: thinkingFlow.policies ?? thinkingFlow.reality?.policies ?? [],
  });

  if (!text || isDeferOnlyText(text)) return null;

  const bannedHits = scanBannedTemplatePhrases(text);
  if (bannedHits.length > 0) return null;

  const forbiddenHits = scanSpeechForbiddenPatterns(text);
  if (forbiddenHits.length > 0) return null;

  const factTextGate = assertFactTextAlignment({
    answerText: text,
    factsSpoken: factSelection.facts_spoken ?? [],
  });
  if (!factTextGate.ok && (factSelection.facts_spoken?.length ?? 0) > 0) return null;

  const speechValidation = validateDu1CustomerSpeech(text, {
    policyFactSpeak: true,
    slice4UnderstandingSpeak: true,
  });
  if (!speechValidation.ok) return null;

  return {
    text,
    segments: [],
    compose_mode: "key_s5_decision_speak",
    thinking_flow_applied: true,
    speak_mode: "decision_speak",
    facts_spoken: factSelection.facts_spoken ?? [],
    facts_withheld: factSelection.facts_withheld ?? [],
    facts_used: (factSelection.facts_spoken ?? []).map((f) => f.fact_id),
    defer_detected: false,
    fact_text_gate: factTextGate,
    speak_fact_gate: factGate,
    reflection_snapshot: reflection,
    decision_snapshot: decision,
    direction_type: decision.direction?.type ?? null,
    invite_allowed: decision.invite?.allowed ?? false,
    banned_template_hits: [],
  };
}

export function buildQuestionSpeakFromDecision(
  keyFirstJudgment,
  {
    question = "",
    thinkingFlow = null,
    evidenceBundle = null,
  } = {},
) {
  if (!keyFirstJudgment || !thinkingFlow?.slice5_enabled) return null;
  if (!thinkingFlow.decision && !thinkingFlow.reflection) return null;
  return buildS5ComposeResult(thinkingFlow, { question, evidenceBundle });
}
