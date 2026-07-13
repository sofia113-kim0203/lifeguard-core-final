/** Home chat preview rotation helpers only — no Claude bytes. */

/** API-safe: only exact 0|1|2|3; anything else → 0. */
export function normalizeQuarterTurns(turns = 0) {
  if (typeof turns === "string") {
    const t = turns.trim();
    if (t === "0" || t === "1" || t === "2" || t === "3") return Number(t);
    return 0;
  }
  if (typeof turns === "number" && Number.isInteger(turns) && turns >= 0 && turns <= 3) {
    return turns;
  }
  return 0;
}

/** UI preview buttons: wrap so left/right can cycle 0↔3. */
export function wrapQuarterTurns(turns = 0) {
  const n = Number(turns);
  if (!Number.isFinite(n)) return 0;
  return ((Math.trunc(n) % 4) + 4) % 4;
}

export function quarterTurnsToDegrees(turns = 0) {
  return normalizeQuarterTurns(turns) * 90;
}
