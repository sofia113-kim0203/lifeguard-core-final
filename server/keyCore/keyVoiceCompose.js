/**
 * Slice 6 — KEY Voice Compose (Directive → Speak → Gate → Safe).
 */
import { buildDecision } from "./keyDecision.js";
import { assertDecisionFactGate } from "./assertFactTextGate.js";
import { isKeyVoiceActive, isKeyBorrowedSensesShadow } from "./oneKeyCoreFlags.js";
import { buildKeyVoiceDirective, summarizeKeyVoiceDirective } from "./keyVoiceDirective.js";
import { speakKeyVoice, buildKeyVoiceSafeUtterance } from "./keyVoiceSpeak.js";
import { gateKeyVoiceAnswer } from "./keyVoiceGate.js";
import { composeSpeakFromDecision } from "../keyBrain/keySpeakFromDecision.js";
import { buildKeyVoiceVisualBlocks } from "./keyVoiceVisualBlocks.js";
import { gateKeyVoiceVisualBlocks } from "./keyVoiceBlockGate.js";
import { runBorrowedSensesShadowProbe } from "./keyBorrowedSensesSpeak.js";

function normalizeText(text = "") {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {object} thinkingFlow
 * @param {object} options
 */
export async function buildKeyVoiceComposeResult(
  thinkingFlow,
  {
    question = "",
    evidenceBundle = null,
    env = process.env,
    previousAnswerSummary = "",
    history = [],
    shadowVisualBlocksOverride = null,
    fetchImpl = fetch,
  } = {},
) {
  let decision = thinkingFlow?.decision ?? null;
  const reflection = thinkingFlow?.reflection ?? null;
  const reality = thinkingFlow?.reality ?? null;
  const directiveQuestion = question || reflection?.customer_said || "";

  if (reflection && reality) {
    decision = buildDecision({
      reflection,
      reality,
      question: directiveQuestion,
      evidenceBundle,
    });
  }

  if (!decision?.decision_complete) {
    return null;
  }

  const factSelection = decision.fact_selection ?? { facts_spoken: [], facts_withheld: [] };
  const speakFactGate = assertDecisionFactGate({ factSelection });
  if (!speakFactGate.ok) return null;

  const s5Reference = composeSpeakFromDecision({
    decision,
    policies: thinkingFlow?.policies ?? thinkingFlow?.reality?.policies ?? [],
  });

  const directive = buildKeyVoiceDirective({
    question: directiveQuestion,
    decision,
    previousAnswerSummary,
    history,
  });

  const trace = {
    key_voice_enabled: isKeyVoiceActive(env),
    directive,
    directive_summary: summarizeKeyVoiceDirective(directive),
    voice_raw: null,
    gate_result: null,
    fallback_used: false,
    fallback_reason: null,
    provider: null,
    retry_count: 0,
    s5_reference_preview: String(s5Reference ?? "").slice(0, 200),
  };

  let voiceRaw = null;
  let provider = null;
  const speakResult = await speakKeyVoice({ directive, env, fetchImpl });
  if (speakResult.ok) {
    voiceRaw = speakResult.voice_raw;
    provider = speakResult.provider;
  }

  trace.voice_raw = voiceRaw;
  trace.provider = provider;

  let gateResult = voiceRaw
    ? gateKeyVoiceAnswer({ text: voiceRaw, directive, s5ReferenceText: s5Reference })
    : { ok: false, reasons: [speakResult.error ?? "speak_failed"] };

  if (!gateResult.ok && voiceRaw) {
    trace.retry_count = 1;
    const retryDirective = {
      ...directive,
      repetition_avoidance_instruction: `${directive.repetition_avoidance_instruction} Gate fail: ${gateResult.reasons.join("; ")}. Rewrite without violating facts/focus.`,
    };
    const retrySpeak = await speakKeyVoice({ directive: retryDirective, env, fetchImpl, temperature: 0.3 });
    if (retrySpeak.ok) {
      voiceRaw = retrySpeak.voice_raw;
      trace.voice_raw = voiceRaw;
      trace.provider = retrySpeak.provider;
      gateResult = gateKeyVoiceAnswer({ text: voiceRaw, directive, s5ReferenceText: s5Reference });
    }
  }

  let finalText = voiceRaw;
  let outputGate = gateResult;

  if (!gateResult.ok) {
    trace.fallback_used = true;
    trace.fallback_reason = voiceRaw
      ? gateResult.reasons?.join("; ")
      : speakResult.error ?? "speak_failed";
    finalText = buildKeyVoiceSafeUtterance(directive);
    outputGate = gateKeyVoiceAnswer({ text: finalText, directive, s5ReferenceText: s5Reference });
    trace.safe_gate_result = outputGate;
  }

  trace.gate_result = outputGate;

  finalText = normalizeText(finalText);
  if (!finalText) return null;

  let visualBlocks = [];
  if (outputGate.ok && !trace.fallback_used) {
    const candidates = buildKeyVoiceVisualBlocks({ directive });
    const blockGate = gateKeyVoiceVisualBlocks({
      blocks: candidates,
      text: finalText,
      directive,
    });
    visualBlocks = blockGate.accepted;
    trace.visual_blocks_candidates = candidates.map((b) => b.type);
    trace.visual_blocks_gate = blockGate;
  } else {
    trace.visual_blocks_gate = {
      ok: true,
      accepted: [],
      omitted: [],
      accepted_count: 0,
      omitted_count: 0,
      skipped: trace.fallback_used ? "fallback_used" : "text_gate_fail",
    };
  }

  if (isKeyBorrowedSensesShadow(env)) {
    const visualBlocksForShadow = shadowVisualBlocksOverride ?? visualBlocks;
    trace.borrowed_senses_shadow = await runBorrowedSensesShadowProbe({
      question: directiveQuestion,
      directive,
      decision,
      history,
      previousAnswerSummary,
      s6FinalAnswer: finalText,
      visualBlocks: visualBlocksForShadow,
      env,
      fetchImpl,
    });
  }

  return {
    text: finalText,
    visual_blocks: visualBlocks,
    segments: [],
    compose_mode: "key_s6_voice_speak",
    thinking_flow_applied: true,
    speak_mode: "key_voice_speak",
    facts_spoken: directive.facts_to_speak ?? [],
    facts_withheld: factSelection.facts_withheld ?? [],
    facts_used: (directive.facts_to_speak ?? []).map((f) => f.fact_id),
    defer_detected: false,
    fact_text_gate: outputGate.fact_text_gate ?? { ok: true },
    speak_fact_gate: speakFactGate,
    reflection_snapshot: reflection,
    decision_snapshot: decision,
    direction_type: decision.direction?.type ?? null,
    invite_allowed: decision.invite?.allowed ?? false,
    key_voice_trace: trace,
    slice5_enabled: thinkingFlow?.slice5_enabled ?? false,
    inferred_goal: decision.situation_key ?? null,
  };
}

export { isKeyVoiceActive };
