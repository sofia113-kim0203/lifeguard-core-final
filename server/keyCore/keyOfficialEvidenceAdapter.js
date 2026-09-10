/**
 * Thin Official Evidence Adapter.
 * Door: request_key_fact slot=official_evidence
 *   → existing lookupProduct / lookupLocators / originalPath
 *   → range reader
 * Not a catalog, RAG, or search engine. Does not rewrite factory lookup.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readOfficialOriginalRange } from "./keyOfficialRangeReader.js";
import {
  filterProductCandidates,
  lookupTermsLocators,
  pdfObjectKey,
  productObjectKey,
} from "./keyTermsLibrary.js";
import { defaultTermsGetObject } from "./keyTermsS3.js";

export const OFFICIAL_EVIDENCE_SLOT = "official_evidence";
export const MAX_OFFICIAL_LOCATORS = 4;

function asText(value) {
  return String(value ?? "").trim();
}

function compact(value) {
  return asText(value)
    .normalize("NFC")
    .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
    .replace(/\s+/g, "");
}

function digits(value) {
  return asText(value).replace(/\D/g, "");
}

export function resolveOfficialLibraryRoot() {
  return asText(process.env.LIFEGUARD_LIBRARY_ROOT);
}

function unavailable(reason, extra = {}) {
  return {
    status: "EVIDENCE_UNAVAILABLE",
    slot: OFFICIAL_EVIDENCE_SLOT,
    value: null,
    facts: [],
    note: "EVIDENCE_UNAVAILABLE — do not invent official wording",
    reason,
    provenance: {
      library_root_configured: Boolean(resolveOfficialLibraryRoot()),
      original_source: extra.original_source || null,
      preview_library_e2e: extra.preview_library_e2e || "BLOCKED_BY_RUNTIME_SOURCE",
    },
    ...extra,
  };
}

function locatorMatchesTopic(locator, topic) {
  const want = compact(topic);
  if (!want) return false;
  const hay = [
    locator.article_number_exact,
    locator.article_title_exact,
    locator.section_title_exact,
    locator.heading_evidence_exact,
  ]
    .map(compact)
    .filter(Boolean);
  return hay.some((part) => part.includes(want));
}

export function resolveOfficialContractIdentity({
  store = null,
  customerId = null,
  contractId = null,
} = {}) {
  const cid = asText(customerId);
  const want = asText(contractId);
  const rows = Array.isArray(store?.contracts) ? store.contracts : [];
  const owned = rows.filter((row) => {
    if (!row || typeof row !== "object") return false;
    const rowCid = asText(row.customer_id);
    return !rowCid || !cid || rowCid === cid;
  });
  const scoped = want
    ? owned.filter((row) => asText(row.contract_id) === want)
    : owned;
  if (scoped.length === 0) {
    return { ok: false, reason: "NO_CONTRACT_IDENTITY" };
  }
  if (scoped.length > 1 && !want) {
    return { ok: false, reason: "AMBIGUOUS_CONTRACT" };
  }
  const row = scoped[0];
  const insurer = asText(row.insurer || row.insurer_name);
  const product_name = asText(row.product_name);
  const date = digits(row.contract_date || row.effective_from);
  if (!insurer || !product_name) {
    return { ok: false, reason: "NO_CONTRACT_IDENTITY" };
  }
  if (!date) {
    return { ok: false, reason: "NO_DATE" };
  }
  return {
    ok: true,
    insurer,
    product_name,
    date,
    contract_id: asText(row.contract_id) || null,
  };
}

async function loadFactoryLookup() {
  const root = resolveOfficialLibraryRoot();
  if (!root) return { ok: false, reason: "NO_LIBRARY_ROOT" };
  try {
    const lookupMod = await import(
      pathToFileURL(path.join(root, "direct-find-lookup.mjs")).href
    );
    const completeMod = await import(
      pathToFileURL(path.join(root, "completion-20260908-lib.mjs")).href
    );
    if (
      typeof lookupMod.lookupProduct !== "function" ||
      typeof lookupMod.lookupLocators !== "function" ||
      typeof completeMod.originalPath !== "function"
    ) {
      return { ok: false, reason: "NO_LIBRARY_ROOT" };
    }
    return {
      ok: true,
      lookupProduct: lookupMod.lookupProduct,
      lookupLocators: lookupMod.lookupLocators,
      originalPath: completeMod.originalPath,
    };
  } catch {
    return { ok: false, reason: "NO_LIBRARY_ROOT" };
  }
}

function preferAwsSource() {
  return asText(process.env.LIFEGUARD_OFFICIAL_SOURCE).toLowerCase() === "aws";
}

function sliceFacts({ extracted, found, identity }) {
  return extracted.locators.map((locator) => {
    const pages = extracted.pages.filter(
      (page) =>
        page.page_number >= locator.pdf_start_page &&
        page.page_number <= locator.pdf_end_page,
    );
    return {
      kind: "official_evidence_slice",
      contract_id: identity.contract_id,
      insurer: identity.insurer,
      product_exact: found.relation.product_exact || identity.product_name,
      version: found.relation.version || identity.date,
      sale_start: found.relation.sale_start || null,
      article_number_exact: locator.article_number_exact,
      section_title_exact: locator.section_title_exact,
      occurrence_class: locator.occurrence_class,
      locator_id: locator.locator_id,
      pdf_start_page: locator.pdf_start_page,
      pdf_end_page: locator.pdf_end_page,
      text: pages.map((page) => page.text).join("\n"),
    };
  });
}

function hitResult({ facts, sha, extracted, originalSource }) {
  return {
    status: "hit",
    slot: OFFICIAL_EVIDENCE_SLOT,
    value: facts.length === 1 ? facts[0].text : null,
    facts,
    note: null,
    reason: null,
    provenance: {
      sha,
      lookup_status: "EXACT",
      locator_count: facts.length,
      page_count: extracted.page_count,
      char_count: extracted.char_count,
      source_page_count: extracted.source_page_count,
      original_source: originalSource,
      preview_library_e2e:
        originalSource === "aws" ? "READY_TO_TEST" : "BLOCKED_BY_RUNTIME_SOURCE",
    },
  };
}

async function executeLocalOfficialEvidence({ identity, wantTopic, factory }) {
  const found = factory.lookupProduct({
    insurer: identity.insurer,
    product_name: identity.product_name,
    date: identity.date,
  });
  if (found?.status !== "EXACT" || !found.relation?.sha) {
    return { ok: false, reason: "RELATION_NOT_EXACT", lookup_status: found?.status || null };
  }
  const uniqueShas = [
    ...new Set(
      (Array.isArray(found.candidates) ? found.candidates : [])
        .map((row) => asText(row?.sha).toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (uniqueShas.length !== 1) {
    return { ok: false, reason: "RELATION_NOT_EXACT", lookup_status: found.status };
  }
  const sha = String(found.relation.sha).toLowerCase();
  const loc = factory.lookupLocators(sha);
  const matched = (Array.isArray(loc?.locators) ? loc.locators : []).filter(
    (row) => locatorMatchesTopic(row, wantTopic),
  );
  if (!matched.length) return { ok: false, reason: "NO_LOCATOR", sha };
  if (matched.length > MAX_OFFICIAL_LOCATORS) {
    return { ok: false, reason: "RANGE_TOO_LARGE", sha };
  }
  const original = factory.originalPath(sha, identity.insurer);
  if (!original) return { ok: false, reason: "ORIGINAL_UNREADABLE", sha };
  const extracted = await readOfficialOriginalRange({
    originalFilePath: original,
    locators: matched,
  });
  if (extracted.status !== "hit") {
    return { ok: false, reason: extracted.reason || "ORIGINAL_UNREADABLE", sha };
  }
  return {
    ok: true,
    result: hitResult({
      facts: sliceFacts({ extracted, found, identity }),
      sha,
      extracted,
      originalSource: "local",
    }),
  };
}

async function executeAwsOfficialEvidence({ identity, wantTopic }) {
  const productKey = productObjectKey(identity.insurer, identity.product_name);
  const productGot = await defaultTermsGetObject(productKey);
  if (!productGot?.found) {
    return unavailable("RELATION_NOT_EXACT", {
      lookup_status: productGot?.reason || "NO_PRODUCT_FILE",
      original_source: "aws",
    });
  }
  let productFile;
  try {
    productFile = JSON.parse(Buffer.from(productGot.bytes).toString("utf8"));
  } catch {
    return unavailable("RELATION_NOT_EXACT", {
      lookup_status: "PRODUCT_UNREADABLE",
      original_source: "aws",
    });
  }
  const cands = filterProductCandidates(productFile, { date: identity.date });
  const uniqueShas = [
    ...new Set(cands.map((row) => asText(row?.sha).toLowerCase()).filter(Boolean)),
  ];
  const uniqueRelations = [
    ...new Set(
      cands.map(
        (row) =>
          `${row.product_exact || ""}|${row.version || ""}|${row.sale_start || ""}|${row.sha || ""}`,
      ),
    ),
  ];
  if (!cands.length || uniqueShas.length !== 1 || uniqueRelations.length !== 1) {
    return unavailable("RELATION_NOT_EXACT", {
      lookup_status: cands.length ? "AMBIGUOUS" : "NOT_FOUND",
      original_source: "aws",
    });
  }
  const found = { status: "EXACT", relation: cands[0], candidates: cands };
  const sha = String(found.relation.sha).toLowerCase();
  const loc = await lookupTermsLocators(
    { sha, topic: wantTopic },
    { getObject: defaultTermsGetObject },
  );
  const matched = (Array.isArray(loc?.locators) ? loc.locators : []).filter(
    (row) => locatorMatchesTopic(row, wantTopic),
  );
  if (!matched.length) return unavailable("NO_LOCATOR", { sha, original_source: "aws" });
  if (matched.length > MAX_OFFICIAL_LOCATORS) {
    return unavailable("RANGE_TOO_LARGE", { sha, original_source: "aws" });
  }
  const pdf = await defaultTermsGetObject(pdfObjectKey(sha));
  if (!pdf?.found || !pdf.bytes?.length) {
    return unavailable("ORIGINAL_UNREADABLE", { sha, original_source: "aws" });
  }
  const extracted = await readOfficialOriginalRange({
    originalBytes: Buffer.from(pdf.bytes),
    locators: matched,
  });
  if (extracted.status !== "hit") {
    return unavailable(extracted.reason || "ORIGINAL_UNREADABLE", {
      sha,
      original_source: "aws",
    });
  }
  return hitResult({
    facts: sliceFacts({ extracted, found, identity }),
    sha,
    extracted,
    originalSource: "aws",
  });
}

export async function executeOfficialEvidenceRequest({
  customerId = null,
  contractId = null,
  topic = "",
  store = null,
} = {}) {
  const identity = resolveOfficialContractIdentity({
    store,
    customerId,
    contractId,
  });
  if (!identity.ok) return unavailable(identity.reason);

  const wantTopic = asText(topic);
  if (!wantTopic) return unavailable("NO_TOPIC");

  if (!preferAwsSource()) {
    const factory = await loadFactoryLookup();
    if (factory.ok) {
      const local = await executeLocalOfficialEvidence({
        identity,
        wantTopic,
        factory,
      });
      if (local.ok) return local.result;
    }
  }

  return executeAwsOfficialEvidence({ identity, wantTopic });
}
