/**
 * Slice 6 — KEY Voice Compose (Directive → Speak → Gate → Safe).
 */
import { buildDecision } from "./keyDecision.js";
import { assertDecisionFactGate } from "./assertFactTextGate.js";
import {
  isKeyVoiceActive,
  isKeyBorrowedSensesProbeEnabled,
  isKeyBorrowedSensesStage2Partial,
  isKeyBorrowedSensesStage3Active,
} from "./oneKeyCoreFlags.js";
import { buildKeyVoiceDirective, summarizeKeyVoiceDirective } from "./keyVoiceDirective.js";
import { speakKeyVoice, buildKeyVoiceSafeUtterance } from "./keyVoiceSpeak.js";
import { gateKeyVoiceAnswer } from "./keyVoiceGate.js";
import { composeSpeakFromDecision } from "../keyBrain/keySpeakFromDecision.js";
import { buildKeyVoiceVisualBlocks } from "./keyVoiceVisualBlocks.js";
import { gateKeyVoiceVisualBlocks } from "./keyVoiceBlockGate.js";
import { runBorrowedSensesShadowProbe } from "./keyBorrowedSensesSpeak.js";
import { applyStage2PromotionToCompose } from "./keyBorrowedSensesStage2.js";
import { applyStage3PromotionToCompose } from "./keyBorrowedSensesStage3.js";

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

  if (isKeyBorrowedSensesProbeEnabled(env)) {
    const overrideBlocks = Array.isArray(shadowVisualBlocksOverride)
      ? shadowVisualBlocksOverride
      : null;
    const visualBlocksForShadow = overrideBlocks?.length ? overrideBlocks : visualBlocks;
    trace.shadow_visual_blocks_override_used = Boolean(overrideBlocks?.length);
    trace.shadow_visual_blocks_override_count = overrideBlocks?.length ?? 0;
    // Customer-facing visual_blocks stay `visualBlocks` — override is shadow-only.
    const s6FinalAnswer = finalText;
    const shadow = await runBorrowedSensesShadowProbe({
      question: directiveQuestion,
      directive,
      decision,
      history,
      previousAnswerSummary,
      s6FinalAnswer,
      visualBlocks: visualBlocksForShadow,
      env,
      fetchImpl,
    });
    trace.borrowed_senses_shadow = shadow;

    // Stage 2 / Stage 3 promotion are mutually exclusive (default remains S6).
    // active_partial → Stage 2 only; active → Stage 3 only; shadow → no promote.
    if (isKeyBorrowedSensesStage2Partial(env) && !isKeyBorrowedSensesStage3Active(env)) {
      const stage2 = applyStage2PromotionToCompose({
        question: directiveQuestion,
        s6FinalAnswer,
        shadow,
        env,
      });
      trace.stage2_partial = stage2.stage2_partial;
      if (shadow && typeof shadow === "object") {
        shadow.customer_text_changed = stage2.customer_text_changed;
        shadow.final_answer_source = stage2.final_answer_source;
        shadow.s6_final_answer = s6FinalAnswer;
        shadow.stage2_partial = stage2.stage2_partial;
      }
      if (stage2.customer_text_changed === true && stage2.final_answer_source === "s7") {
        finalText = String(stage2.finalText ?? "").trim() || s6FinalAnswer;
      }
    } else if (isKeyBorrowedSensesStage3Active(env) && !isKeyBorrowedSensesStage2Partial(env)) {
      const stage3 = applyStage3PromotionToCompose({
        question: directiveQuestion,
        s6FinalAnswer,
        shadow,
        env,
      });
      trace.stage3_active = stage3.stage3_active;
      if (shadow && typeof shadow === "object") {
        shadow.customer_text_changed = stage3.customer_text_changed;
        shadow.final_answer_source = stage3.final_answer_source;
        shadow.s6_final_answer = s6FinalAnswer;
        shadow.stage3_active = stage3.stage3_active;
      }
      if (stage3.customer_text_changed === true && stage3.final_answer_source === "s7") {
        finalText = String(stage3.finalText ?? "").trim() || s6FinalAnswer;
      }
    } else if (shadow && typeof shadow === "object") {
      shadow.customer_text_changed = false;
      shadow.final_answer_source = "s6";
      shadow.s6_final_answer = s6FinalAnswer;
    }
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
