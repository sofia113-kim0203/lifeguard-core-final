/**
 * This-thread public citations only. Not a warehouse. Not customer contract facts.
 * Next-turn user payload — system cache prefix stays unchanged by this block.
 */

const MAX_ROWS = 8;
const MAX_CITED = 400;

export function compactThreadPublicCitations(rows = []) {
  const out = [];
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") continue;
    const url = row.url != null ? String(row.url).trim() : "";
    const title = row.title != null ? String(row.title).trim() : "";
    if (!url && !title) continue;
    const key = `${url}|${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const citedRaw = row.cited_text != null ? String(row.cited_text).trim() : "";
    out.push({
      title: title || null,
      url: url || null,
      published_at:
        row.published_at != null
          ? String(row.published_at)
          : row.page_age != null
            ? String(row.page_age)
            : null,
      cited_text: citedRaw ? citedRaw.slice(0, MAX_CITED) : null,
    });
    if (out.length >= MAX_ROWS) break;
  }
  return out;
}

export function mergeThreadPublicCitations(prior = [], incoming = []) {
  return compactThreadPublicCitations([
    ...(Array.isArray(prior) ? prior : []),
    ...(Array.isArray(incoming) ? incoming : []),
  ]);
}

/** Read citations from the raw first argument — never a free identifier. */
export function readThreadPublicCitationsFromArgs(args) {
  if (!args || typeof args !== "object") return [];
  return compactThreadPublicCitations(args.threadPublicCitations);
}

export function buildThreadPublicEvidenceUserText(rows = []) {
  const compact = compactThreadPublicCitations(rows);
  if (!compact.length) return "";
  return [
    "[KEY_THREAD_PUBLIC_EVIDENCE]",
    JSON.stringify({
      kind: "this_thread_public_sources",
      sources: compact,
    }),
  ].join("\n");
}
