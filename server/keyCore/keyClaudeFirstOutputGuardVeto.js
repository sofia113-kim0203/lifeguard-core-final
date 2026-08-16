/**
 * Q2 — real internal leak only. Insurance counseling words are not leaks.
 * Sentence leak → drop that sentence. Whole-answer dump → monopoly.
 * No rewrite AI / no 2nd LLM.
 */
import {
  violatesDeflectionPhrase,
  violatesEngineTermLeak,
  violatesHomeInventoryDump,
  stripOutputGuardLeakSentences,
} from "../lifeguardOutputGuard.js";

export const Q2_OUTPUT_GUARD_LEAK_REASON = "q2_output_guard_leak";

/** True when existing Guard matchers fire (inspect only — never mutates text). */
export function violatesClaudeFirstOutputGuardMatchers(text = "") {
  const t = String(text ?? "");
  if (!t.trim()) return false;
  return (
    violatesHomeInventoryDump(t) ||
    violatesEngineTermLeak(t) ||
    violatesDeflectionPhrase(t)
  );
}

function remainingAfterLeakStrip(text = "") {
  return String(stripOutputGuardLeakSentences(text) ?? "").trim();
}

/**
 * Pre-emit decision for one commit slice.
 * Default: drop the leaking sentence and keep going.
 * Monopoly only when this slice is the whole answer and nothing customer-facing remains.
 */
export function decideQ2PreEmitVeto({
  slice = "",
  committedSoFar = "",
} = {}) {
  const unit = String(slice ?? "");
  if (!unit) return { veto: false, monopoly: false, reason: null };
  const committed = String(committedSoFar ?? "");
  const cumulative = `${committed}${unit}`;
  const unitHit = violatesClaudeFirstOutputGuardMatchers(unit);
  const cumulativeHit = violatesClaudeFirstOutputGuardMatchers(cumulative);
  if (!unitHit && !cumulativeHit) {
    return { veto: false, monopoly: false, reason: null };
  }
  const keptCommitted = remainingAfterLeakStrip(committed);
  const monopoly = !keptCommitted && !remainingAfterLeakStrip(unit);
  return {
    veto: true,
    monopoly,
    reason: Q2_OUTPUT_GUARD_LEAK_REASON,
  };
}

/** Pre-seal: strip leak sentences; monopoly only if nothing remains. */
export function decideQ2PreSealVeto(text = "") {
  const src = String(text ?? "");
  if (!violatesClaudeFirstOutputGuardMatchers(src)) {
    return { veto: false, monopoly: false, reason: null, cleaned: src };
  }
  const cleaned = stripOutputGuardLeakSentences(src);
  const monopoly = !String(cleaned ?? "").trim();
  return {
    veto: monopoly,
    monopoly,
    reason: monopoly ? Q2_OUTPUT_GUARD_LEAK_REASON : null,
    cleaned,
  };
}
