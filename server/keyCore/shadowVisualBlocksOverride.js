/**
 * S7 shadow-only visual_blocks override (Preview observe / local probe).
 * Never used for customer-facing visual_blocks or S6 final_answer.
 */
import { isKeyBorrowedSensesShadow } from "./oneKeyCoreFlags.js";

const MAX_BLOCKS = 4;
const MAX_ROWS = 12;
const MAX_CELL_LEN = 120;

function sanitizeCell(value) {
  const s = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  return s.slice(0, MAX_CELL_LEN);
}

/**
 * @param {unknown} raw
 * @returns {Array<object>|null}
 */
export function sanitizeShadowVisualBlocksOverride(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out = [];
  for (const block of raw.slice(0, MAX_BLOCKS)) {
    if (!block || typeof block !== "object") continue;
    const type = sanitizeCell(block.type);
    if (!type) continue;
    const rows = [];
    for (const row of Array.isArray(block.rows) ? block.rows.slice(0, MAX_ROWS) : []) {
      if (Array.isArray(row)) {
        rows.push(row.map(sanitizeCell).filter(Boolean));
      } else if (row != null) {
        const cell = sanitizeCell(row);
        if (cell) rows.push([cell]);
      }
    }
    out.push({
      type,
      title: sanitizeCell(block.title) || null,
      subtitle: sanitizeCell(block.subtitle) || null,
      columns: Array.isArray(block.columns)
        ? block.columns.map(sanitizeCell).filter(Boolean).slice(0, 8)
        : undefined,
      rows,
    });
  }
  return out.length ? out : null;
}

/**
 * Accept override only when KEY_BORROWED_SENSES=shadow.
 * Active / off → always null (customer path cannot inject).
 */
export function resolveShadowVisualBlocksOverride(raw, env = process.env) {
  if (!isKeyBorrowedSensesShadow(env)) return null;
  return sanitizeShadowVisualBlocksOverride(raw);
}
