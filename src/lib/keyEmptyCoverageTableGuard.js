/**
 * U2-C1-EMPTY-TABLE-GUARD — structural fail-closed only.
 * Removes header-only coverage tables (0 data rows) and the adjacent
 * "pointing" intro that exists solely to present that empty table.
 * No new sentences · no fact fill · no 2nd LLM.
 */

const TSV_HEADER_RE = /^담보\s*\t\s*가입금액\s*$/;
const MD_HEADER_RE =
  /^\|\s*담보\s*\|\s*가입금액\s*\|(?:\s*[^|\n]+\|)*\s*$/;
const MD_SEP_RE = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;

/** Intro that only exists to present the table immediately below. */
const POINTING_INTRO_RE =
  /확인된\s*담보만\s*보면\s*이렇게|담보만\s*보면\s*이렇게\s*돼|아래\s*담보|다음과\s*같(?:이|은)|아래와\s*같(?:이|은)/;

function isBlankLine(line) {
  return !String(line ?? "").trim();
}

function isTsvHeader(line) {
  return TSV_HEADER_RE.test(String(line ?? "").trim());
}

function isMdHeader(line) {
  return MD_HEADER_RE.test(String(line ?? "").trim());
}

function isMdSep(line) {
  return MD_SEP_RE.test(String(line ?? "").trim());
}

function isTsvDataRow(line) {
  const t = String(line ?? "");
  if (!t.includes("\t")) return false;
  if (isTsvHeader(t)) return false;
  const parts = t.split("\t").map((p) => p.trim());
  return parts.length >= 2 && parts.some((p) => p.length > 0);
}

function isMdDataRow(line) {
  const t = String(line ?? "").trim();
  if (!t.startsWith("|") || isMdHeader(t) || isMdSep(t)) return false;
  const cells = t
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
  return cells.length >= 2 && cells.some((c) => c.length > 0);
}

/**
 * @returns {{ text: string, removed: boolean, removed_pointing_intro: boolean }}
 */
export function stripEmptyCoverageTableBlocks(text = "") {
  const raw = String(text ?? "");
  if (!raw.trim()) {
    return { text: raw, removed: false, removed_pointing_intro: false };
  }

  const lines = raw.split("\n");
  const out = [];
  let removed = false;
  let removedPointingIntro = false;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // TSV: 담보\t가입금액 then optional blank / no data rows until prose or EOF
    if (isTsvHeader(line)) {
      let j = i + 1;
      let dataRows = 0;
      while (j < lines.length) {
        const L = lines[j];
        if (isBlankLine(L)) {
          // blank after header with no data yet — still empty table; stop before next prose block
          const next = lines[j + 1];
          if (next == null || isBlankLine(next) || !isTsvDataRow(next)) {
            j += 1;
            break;
          }
          j += 1;
          continue;
        }
        if (isTsvDataRow(L)) {
          dataRows += 1;
          j += 1;
          continue;
        }
        break;
      }
      if (dataRows === 0) {
        removed = true;
        // Drop pointing intro paragraph immediately above (skip trailing blanks already in out).
        while (out.length && isBlankLine(out[out.length - 1])) out.pop();
        if (out.length) {
          const prev = out[out.length - 1];
          if (POINTING_INTRO_RE.test(prev)) {
            out.pop();
            removedPointingIntro = true;
            while (out.length && isBlankLine(out[out.length - 1])) out.pop();
          }
        }
        i = j;
        if (out.length && i < lines.length && !isBlankLine(lines[i])) {
          out.push("");
        }
        continue;
      }
      // Keep non-empty table as-is (fall through to copy header).
    }

    // Markdown pipe table with 담보|가입금액 header and zero data rows
    if (isMdHeader(line)) {
      let j = i + 1;
      if (j < lines.length && isMdSep(lines[j])) j += 1;
      let dataRows = 0;
      while (j < lines.length) {
        const L = lines[j];
        if (isBlankLine(L)) {
          j += 1;
          break;
        }
        if (isMdDataRow(L)) {
          dataRows += 1;
          j += 1;
          continue;
        }
        break;
      }
      if (dataRows === 0) {
        removed = true;
        while (out.length && isBlankLine(out[out.length - 1])) out.pop();
        if (out.length && POINTING_INTRO_RE.test(out[out.length - 1])) {
          out.pop();
          removedPointingIntro = true;
          while (out.length && isBlankLine(out[out.length - 1])) out.pop();
        }
        i = j;
        if (out.length && i < lines.length && !isBlankLine(lines[i])) {
          out.push("");
        }
        continue;
      }
    }

    out.push(line);
    i += 1;
  }

  let textOut = out.join("\n");
  textOut = textOut.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  // Trim only edges when we removed something — avoid changing unrelated spacing otherwise.
  if (removed) textOut = textOut.replace(/^\n+/, "").replace(/\n+$/, "");
  return {
    text: removed ? textOut : raw,
    removed,
    removed_pointing_intro: removedPointingIntro,
  };
}

export function applyEmptyCoverageTableGuard(text = "") {
  return stripEmptyCoverageTableBlocks(text).text;
}
