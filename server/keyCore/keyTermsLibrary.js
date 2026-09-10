/**
 * Shared terms-library paths + direct lookup.
 * Existing bucket only. No corpus scan. No similar-name exact.
 */

import { createHash } from "node:crypto";

export const TERMS_LIBRARY_BUCKET = "lifeguard-terms-library-apne2";
export const TERMS_LIBRARY_REGION = "ap-northeast-2";
export const TERMS_LIBRARY_PREFIX = "master/v1";
export const TERMS_PROOF_SHA =
  "ea35fd7f853fcebc5fd01146f526e3d81c9f22816b4d86879db61953e90e2f35";

const MAX_LOCATORS = 8;

export function compactIdentity(value) {
  return String(value || "")
    .normalize("NFC")
    .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
    .replace(/\s+/g, "");
}

export function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

export function normProductName(value) {
  return compactIdentity(value).replace(/무배당/g, "").replace(/[()（）]/g, "");
}

export function safeInsurerSegment(insurer) {
  return String(insurer || "UNKNOWN").replace(/[<>:"/\\|?*]/g, "_");
}

export function productLookupHash(insurer, productName) {
  return createHash("sha256")
    .update(`${String(insurer || "")}\n${normProductName(productName)}`)
    .digest("hex");
}

export function productObjectKey(insurer, productName) {
  const hash = productLookupHash(insurer, productName);
  return `${TERMS_LIBRARY_PREFIX}/products/${safeInsurerSegment(insurer)}/${hash.slice(0, 2)}/${hash}.json`;
}

export function locatorObjectKey(sha) {
  const id = String(sha || "").toLowerCase();
  return `${TERMS_LIBRARY_PREFIX}/locators/${id.slice(0, 2)}/${id}.jsonl`;
}

export function pdfObjectKey(sha) {
  const id = String(sha || "").toLowerCase();
  return `${TERMS_LIBRARY_PREFIX}/pdfs/${id.slice(0, 2)}/${id}.pdf`;
}

export function currentObjectKey() {
  return `${TERMS_LIBRARY_PREFIX}/current.json`;
}

export function inSaleWindow(candidate, dateDigits) {
  if (!dateDigits) return true;
  const start = digitsOnly(candidate?.sale_start);
  const end = digitsOnly(candidate?.sale_end);
  const version = digitsOnly(candidate?.version);
  if (version && version === dateDigits) return true;
  if (start && dateDigits < start) return false;
  if (end && dateDigits > end) return false;
  if (!start && !end && !version) return false;
  return true;
}

export function filterProductCandidates(
  productFile,
  { date = "", product_code = "", kind = "" } = {},
) {
  const rows = Array.isArray(productFile?.candidates) ? productFile.candidates.slice() : [];
  const dateDigits = digitsOnly(date);
  let candidates = rows;
  if (dateDigits) {
    const versionHits = candidates.filter((row) => digitsOnly(row.version) === dateDigits);
    candidates = versionHits.length
      ? versionHits
      : candidates.filter((row) => inSaleWindow(row, dateDigits));
  }
  if (product_code) {
    candidates = candidates.filter((row) => row.product_code === product_code);
  }
  if (kind) {
    candidates = candidates.filter((row) => row.kind === kind);
  }
  return candidates;
}

export function decideTermsMatch(candidates = []) {
  const rows = Array.isArray(candidates) ? candidates : [];
  if (!rows.length) {
    return { status: "insufficient", reason: "NO_CANDIDATE", candidates: [] };
  }
  if (rows.some((row) => row.conflict === true)) {
    return { status: "conflict", reason: "RELATION_CONFLICT", candidates: rows };
  }
  const uniqueRelations = [
    ...new Set(
      rows.map(
        (row) =>
          `${row.relation_id || ""}|${row.sha || ""}|${row.product_exact || ""}|${row.version || ""}|${row.sale_start || ""}`,
      ),
    ),
  ];
  if (uniqueRelations.length !== 1) {
    return { status: "ambiguous", reason: "MULTI_RELATION", candidates: rows };
  }
  const hit = rows[0];
  if (hit.identity_status && hit.identity_status !== "IDENTITY_CLEAN") {
    return { status: "insufficient", reason: hit.identity_status, candidates: rows };
  }
  if (hit.usable === false) {
    return { status: "insufficient", reason: hit.unusable_reason || "TECHNICAL_UNUSABLE", candidates: rows };
  }
  return { status: "exact", reason: "ONE_USABLE_RELATION", candidates: rows, relation: hit };
}

export function publicLocatorFact(row, contract) {
  return {
    contract_id: contract?.contract_id || null,
    insurer: contract?.insurer || null,
    product_name: contract?.product_name || null,
    article_title: row.article_title_exact || row.section_title_exact || null,
    article_number: row.article_number_exact || null,
    pdf_start_page: row.pdf_start_page ?? null,
    pdf_end_page: row.pdf_end_page ?? row.pdf_start_page ?? null,
  };
}

export function filterLocatorsByTopic(lines, topic) {
  const want = String(topic || "").trim().toLowerCase();
  const locators = [];
  for (const line of String(lines || "").split("\n")) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row?.row_kind !== "locator") continue;
    if (want) {
      const hay = [
        row.section_title_exact,
        row.article_title_exact,
        row.article_number_exact,
        row.heading_evidence_exact,
        row.rider_name_exact,
      ]
        .map((value) => String(value || "").toLowerCase())
        .join(" ");
      if (!hay.includes(want)) continue;
    }
    locators.push(row);
    if (locators.length >= MAX_LOCATORS) break;
  }
  return locators;
}

async function defaultGetObject(key) {
  const { defaultTermsGetObject } = await import("./keyTermsS3.js");
  return defaultTermsGetObject(key);
}

export async function getTermsObject(key, { getObject = null } = {}) {
  const reader = typeof getObject === "function" ? getObject : defaultGetObject;
  return reader(key);
}

export async function lookupTermsProduct(
  { insurer, product_name, date = "", product_code = "", kind = "" } = {},
  { getObject = null } = {},
) {
  if (!insurer || !product_name) {
    return {
      status: "insufficient",
      reason: "MISSING_IDENTITY",
      files_read: 0,
      candidates: [],
    };
  }
  const key = productObjectKey(insurer, product_name);
  const got = await getTermsObject(key, { getObject });
  if (!got?.found) {
    return {
      status: "insufficient",
      reason: got?.reason || "NO_PRODUCT_FILE",
      files_read: 1,
      candidates: [],
    };
  }
  const productFile = JSON.parse(Buffer.from(got.bytes).toString("utf8"));
  const candidates = filterProductCandidates(productFile, {
    date,
    product_code,
    kind,
  });
  return {
    ...decideTermsMatch(candidates),
    files_read: 1,
    key,
  };
}

export async function lookupTermsLocators(
  { sha, topic = "" } = {},
  { getObject = null } = {},
) {
  if (!sha) return { found: false, locators: [], files_read: 0 };
  const key = locatorObjectKey(sha);
  const got = await getTermsObject(key, { getObject });
  if (!got?.found) {
    return { found: false, locators: [], files_read: 1, reason: got?.reason || "NO_LOCATOR" };
  }
  return {
    found: true,
    locators: filterLocatorsByTopic(Buffer.from(got.bytes).toString("utf8"), topic),
    files_read: 1,
    key,
  };
}

export async function proveTermsLibraryRead({ getObject = null } = {}) {
  const current = await getTermsObject(currentObjectKey(), { getObject });
  if (!current?.found) {
    return {
      ok: false,
      current_found: false,
      proof_found: false,
      reason: current?.reason || "CURRENT_MISSING",
    };
  }
  let meta = {};
  try {
    meta = JSON.parse(Buffer.from(current.bytes).toString("utf8"));
  } catch {
    meta = {};
  }
  const proofKey = meta.proof_locator_key || locatorObjectKey(meta.proof_sha || TERMS_PROOF_SHA);
  const proof = await getTermsObject(proofKey, { getObject });
  return {
    ok: Boolean(proof?.found),
    current_found: true,
    proof_found: Boolean(proof?.found),
    proof_bytes: proof?.found ? proof.bytes.length : 0,
    files_read: 2,
    reason: proof?.found ? "READ_OK" : proof?.reason || "PROOF_MISSING",
  };
}
