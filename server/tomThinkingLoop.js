/**
 * Tom 2-A — Thinking loop owns intent/evidence/judgment; LLM translates only.
 */
import { generateTomRegulatedChatResponse } from "./casualChatResponseCore.js";
import { ONE_BRAIN_SURFACES } from "./oneBrainResponseLayer.js";
import {
  buildGapEvidenceAudit,
  formatTomRegulatedEvidenceBlock,
  EVIDENCE_STATUS,
} from "./tomEvidenceLens.js";

export const TOM_THINKING_STEPS = [
  "intent",
  "required_information",
  "audit_known_unknown",
  "hold_or_answer",
  "request_missing_material",
  "continue_conversation",
];

function normalizeQuestion(question = "") {
  return String(question ?? "").replace(/\s+/g, " ").trim();
}

export function runTomThinkingPlan({ question = "", intent = "", factBundle = {} } = {}) {
  const normalizedQuestion = normalizeQuestion(question);
  const audit = buildGapEvidenceAudit(
    { ...factBundle, question: normalizedQuestion },
    normalizedQuestion,
  );

  const stepIntent =
    intent === "coverage_gap_check"
      ? `coverage_adequacy_question:${audit.topic ?? "gap"}`
      : "general_insurance_question";

  const requiredEvidence = audit.fields
    .filter((field) => /diagnosis_benefit|similar_benefit|surgery_benefit|_contract/.test(field.id))
    .map((field) => field.id);

  const holdJudgment = !audit.judgment_ready;

  return {
    steps: TOM_THINKING_STEPS,
    intent: stepIntent,
    required_evidence: requiredEvidence,
    audit,
    hold_judgment: holdJudgment,
    next_action: holdJudgment ? "request_more_document" : "explain_known_evidence",
  };
}

export function composeTomThinkingDecision(plan) {
  const audit = plan.audit;
  const label = audit.topicLabel ?? "해당 보장";
  const knownLabels = audit.fields
    .filter((field) => field.status === EVIDENCE_STATUS.KNOWN)
    .map((field) => field.label);
  const unknownLabels = audit.missing_labels ?? [];

  if (plan.hold_judgment) {
    return [
      "[Tom decision — translate ONLY; do not add facts, numbers, or judgments]",
      `question: ${audit.question}`,
      `topic: ${label}`,
      `step1_intent: ${plan.intent}`,
      `step2_required_before_answer: ${audit.missing_summary}`,
      `step3_audit_known: ${knownLabels.length > 0 ? knownLabels.join(", ") : "none"}`,
      `step3_audit_unknown: ${unknownLabels.join(", ")}`,
      `step4_judgment: HOLD — sufficient/insufficient must NOT be stated`,
      `step5_next_material: 보장내역서 추가 페이지`,
      `step6_continue: invite customer to send the document and continue the conversation`,
      `voice_order: (1) one-sentence direct response to the question (hold is allowed), (2) state what is needed before judgment, (3) request the next document`,
    ].join("\n");
  }

  return [
    "[Tom decision — translate ONLY; do not add facts, numbers, or judgments]",
    `question: ${audit.question}`,
    `topic: ${label}`,
    `step4_judgment: ANSWER using known fields only`,
    `step3_audit_known: ${knownLabels.join(", ")}`,
    `step6_continue: keep conversation open for follow-up`,
  ].join("\n");
}

export function composeTomGapHoldFallback(plan) {
  const audit = plan.audit;
  const label = audit.topicLabel ?? "해당 보장";
  return `${label} 보장이 부족한지 확인하려면 먼저 ${audit.missing_summary} 확인이 필요합니다. 지금 자료에서는 아직 보이지 않아 판단을 보류합니다. 보장내역서 추가 페이지를 주시면 바로 이어서 확인해 드릴게요.`;
}

const INVENTORY_DUMP_PATTERNS = [
  /현재\s*\d+\s*건의\s*보험/,
  /월\s*보험료/,
  /318,683|31만8천/,
  /등록된\s*서류\s*\d+\s*건/,
  /등록된\s*고객\s*정보\s*\d+\s*건/,
  /문서\s*\d+\s*건/,
  /AI\s*상담실/,
];

export function violatesTomGapVoiceChecks(text, audit) {
  const normalized = String(text ?? "").trim();
  if (!normalized) return "empty";

  for (const pattern of INVENTORY_DUMP_PATTERNS) {
    if (pattern.test(normalized)) return "inventory_or_redirect";
  }

  if (/부족합니다|충분합니다|없습니다|반드시\s*부족|확실히\s*부족/.test(normalized)) {
    return "judgment_assertion";
  }

  const unknownAmountFields = (audit?.fields ?? []).filter(
    (field) =>
      /diagnosis_benefit|similar_benefit|surgery_benefit/.test(field.id) &&
      field.status !== EVIDENCE_STATUS.KNOWN,
  );
  if (unknownAmountFields.length > 0 && /[\d,]+원/.test(normalized)) {
    return "fabricated_amount";
  }

  return null;
}

export async function runTomThinkingTurn({
  question = "",
  intent = "",
  factBundle = {},
  history = [],
  fetchImpl = fetch,
  env = process.env,
} = {}) {
  const normalizedQuestion = normalizeQuestion(question);
  const plan = runTomThinkingPlan({ question: normalizedQuestion, intent, factBundle });
  const regulatedEvidence = formatTomRegulatedEvidenceBlock(plan.audit);
  const thinkingDecision = composeTomThinkingDecision(plan);

  const llm = await generateTomRegulatedChatResponse({
    question: normalizedQuestion,
    regulatedEvidence,
    thinkingDecision,
    holdJudgment: plan.hold_judgment,
    topicLabel: plan.audit.topicLabel,
    history,
    fetchImpl,
    env,
  });

  let text = llm.ok ? llm.text : composeTomGapHoldFallback(plan);
  const violation = violatesTomGapVoiceChecks(text, plan.audit);
  if (violation) {
    text = composeTomGapHoldFallback(plan);
  }

  return {
    ok: true,
    text,
    thinking: plan,
    thinking_decision: thinkingDecision,
    response_source: violation ? "tom_fallback" : llm.ok ? llm.response_source : "tom_fallback",
    llm_ok: llm.ok === true,
    violation,
  };
}

export function passesSteinTomGapVoiceChecks(text, audit, { question = "" } = {}) {
  const normalized = String(text ?? "").trim();
  if (!normalized) return { ok: false, check: "empty" };

  const violation = violatesTomGapVoiceChecks(normalized, audit);
  if (violation) return { ok: false, check: violation };

  const q = normalizeQuestion(question);
  const firstSentence = normalized.split(/[.!?]/)[0] ?? normalized;
  if (q.includes("부족") && !/부족|판단|확인|보이|보여|알|모르|어렵|아직|필요|보류/.test(firstSentence)) {
    return { ok: false, check: "direct_answer" };
  }

  for (const pattern of INVENTORY_DUMP_PATTERNS) {
    if (pattern.test(normalized)) return { ok: false, check: "relevant_facts_only" };
  }

  if (!audit?.judgment_ready && !/보이|확인|자료|내역|페이지|주시|알려|모르|어렵|필요|보류/.test(normalized)) {
    return { ok: false, check: "unknown_honesty" };
  }

  return { ok: true, check: null };
}

export function isTom2AGapVoiceEnabled(env = process.env) {
  const flag = String(env?.TOM_2A_GAP_VOICE ?? "true").trim().toLowerCase();
  return flag !== "false" && flag !== "0";
}

export function shouldRunTom2AGapVoice(
  intentClassification,
  question = "",
  surface = ONE_BRAIN_SURFACES.CONSULTATION,
  env = process.env,
) {
  if (!isTom2AGapVoiceEnabled(env)) return false;
  if (surface !== ONE_BRAIN_SURFACES.CONSULTATION) return false;
  const intent =
    typeof intentClassification === "string" ? intentClassification : intentClassification?.intent ?? null;
  return intent === "coverage_gap_check";
}
