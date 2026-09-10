/**
 * Official original range reader.
 * Reads only pages named by a validated locator. Not a second KEY.
 * Does not choose articles, substitute documents, or invent pages.
 */
import fs from "node:fs";

export const MAX_OFFICIAL_SLICE_PAGES = 8;
export const MAX_OFFICIAL_SLICE_CHARS = 14000;

function asInt(value) {
  const n = Number(value);
  return Number.isInteger(n) ? n : NaN;
}

export function locatorPageRange(locator) {
  if (!locator || typeof locator !== "object") {
    return { ok: false, reason: "NO_LOCATOR" };
  }
  if (locator.row_kind !== "locator") {
    return { ok: false, reason: "NO_LOCATOR" };
  }
  if (locator.locator_status !== "MACHINE_VALIDATED_LOCATOR") {
    return { ok: false, reason: "NO_LOCATOR" };
  }
  const start = asInt(locator.pdf_start_page);
  if (!Number.isInteger(start) || start < 1) {
    return { ok: false, reason: "NO_LOCATOR" };
  }
  const rawEnd = locator.pdf_end_page;
  const end = rawEnd == null || rawEnd === "" ? start : asInt(rawEnd);
  if (!Number.isInteger(end) || end < start) {
    return { ok: false, reason: "NO_LOCATOR" };
  }
  const pages = end - start + 1;
  if (pages > MAX_OFFICIAL_SLICE_PAGES) {
    return { ok: false, reason: "RANGE_TOO_LARGE" };
  }
  return { ok: true, start, end, pages };
}

export async function readOfficialOriginalRange({
  originalFilePath,
  originalBytes = null,
  locators = [],
} = {}) {
  let data = originalBytes && Buffer.isBuffer(originalBytes) ? originalBytes : null;
  const file = String(originalFilePath || "").trim();
  if (!data) {
    if (!file) {
      return { status: "EVIDENCE_UNAVAILABLE", reason: "ORIGINAL_UNREADABLE", pages: [] };
    }
    if (!/\.pdf$/i.test(file)) {
      return { status: "EVIDENCE_UNAVAILABLE", reason: "ORIGINAL_UNREADABLE", pages: [] };
    }
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      return { status: "EVIDENCE_UNAVAILABLE", reason: "ORIGINAL_UNREADABLE", pages: [] };
    }
    if (!stat.isFile() || stat.size <= 0) {
      return { status: "EVIDENCE_UNAVAILABLE", reason: "ORIGINAL_UNREADABLE", pages: [] };
    }
    data = fs.readFileSync(file);
  }
  if (!data.length) {
    return { status: "EVIDENCE_UNAVAILABLE", reason: "ORIGINAL_UNREADABLE", pages: [] };
  }

  const wanted = new Set();
  const kept = [];
  for (const locator of Array.isArray(locators) ? locators : []) {
    const range = locatorPageRange(locator);
    if (!range.ok) {
      return { status: "EVIDENCE_UNAVAILABLE", reason: range.reason, pages: [] };
    }
    for (let page = range.start; page <= range.end; page += 1) {
      wanted.add(page);
    }
    kept.push({
      locator_id: locator.locator_id || null,
      article_number_exact: locator.article_number_exact || null,
      section_title_exact: locator.section_title_exact || null,
      occurrence_class: locator.occurrence_class || null,
      pdf_start_page: range.start,
      pdf_end_page: range.end,
    });
  }
  if (wanted.size === 0) {
    return { status: "EVIDENCE_UNAVAILABLE", reason: "NO_LOCATOR", pages: [] };
  }
  if (wanted.size > MAX_OFFICIAL_SLICE_PAGES) {
    return { status: "EVIDENCE_UNAVAILABLE", reason: "RANGE_TOO_LARGE", pages: [] };
  }

  let parsed;
  try {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data });
    try {
      parsed = await parser.getText();
    } finally {
      await parser.destroy();
    }
  } catch {
    return { status: "EVIDENCE_UNAVAILABLE", reason: "ORIGINAL_UNREADABLE", pages: [] };
  }

  const pages = [];
  let charCount = 0;
  for (const page of Array.isArray(parsed?.pages) ? parsed.pages : []) {
    const num = asInt(page?.num);
    if (!wanted.has(num)) continue;
    const text = String(page?.text ?? "").trim();
    charCount += text.length;
    pages.push({ page_number: num, text });
  }
  if (pages.length === 0) {
    return { status: "EVIDENCE_UNAVAILABLE", reason: "ORIGINAL_UNREADABLE", pages: [] };
  }
  if (charCount > MAX_OFFICIAL_SLICE_CHARS) {
    return { status: "EVIDENCE_UNAVAILABLE", reason: "RANGE_TOO_LARGE", pages: [] };
  }
  const missing = [...wanted].filter((n) => !pages.some((p) => p.page_number === n));
  if (missing.length) {
    return { status: "EVIDENCE_UNAVAILABLE", reason: "ORIGINAL_UNREADABLE", pages: [] };
  }

  return {
    status: "hit",
    reason: null,
    pages,
    locators: kept,
    page_count: pages.length,
    char_count: charCount,
    source_page_count: Number(parsed?.total) || null,
  };
}
