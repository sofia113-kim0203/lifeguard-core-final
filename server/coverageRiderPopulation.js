/**
 * PR rider population — riders string[] contract + rider_details object[] sidecar.
 */

const KNOWN_INSURERS = [
  "삼성생명",
  "한화생명",
  "교보생명",
  "KB라이프생명",
  "KB생명",
  "신한라이프",
  "신한생명",
  "미래에셋생명",
  "NH농협생명",
  "삼성화재",
  "현대해상",
  "DB손해보험",
  "DB손보",
  "KB손해보험",
  "메리츠화재",
  "한화손해보험",
  "NH농협손해보험",
  "흥국화재",
  "롯데손해보험",
  "MG손해보험",
  "AIG손해보험",
  "라이나생명",
  "푸본현대생명",
  "동양생명",
  "IM라이프",
];

const RIDER_ELIGIBILITY_PATTERN =
  /진단|입원|수술|실손|암|뇌|심장|사망|요양|보장|장해|치아|운전|간병|치매|허혈|뇌졸중|뇌혈관|급성심근|의료비|일당|후유|상해|배상|화상|골절/i;

const PRODUCT_OR_PLAN_PATTERN =
  /건강보험\s*(\(II\))?\s*\d*|종신|연금|저축|간편|무배당|\(II\)\s*\d{3,4}|\d{4}\s*형/i;

function cleanText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(value) {
  return cleanText(value).replace(/\s+/g, "").toLowerCase();
}

function isKnownInsurerName(name) {
  const cleaned = cleanText(name);
  if (!cleaned) return false;
  const compact = normalizeKey(cleaned);
  return KNOWN_INSURERS.some((insurer) => {
    const insurerCompact = normalizeKey(insurer);
    return cleaned === insurer || compact === insurerCompact || compact.includes(insurerCompact);
  });
}

function matchesContextLabel(name, context = {}) {
  const compact = normalizeKey(name);
  if (!compact) return false;
  for (const field of ["insurer_name", "product_name", "plan_name"]) {
    const contextValue = cleanText(context[field]);
    if (!contextValue) continue;
    if (compact === normalizeKey(contextValue)) return true;
  }
  return false;
}

function looksLikeProductOrPlanName(name) {
  const cleaned = cleanText(name);
  if (!cleaned) return false;
  if (PRODUCT_OR_PLAN_PATTERN.test(cleaned)) return true;
  if (/보험$/.test(cleaned) && !RIDER_ELIGIBILITY_PATTERN.test(cleaned)) return true;
  if (/화재$|생명$|손해$|손보$/.test(cleaned) && !RIDER_ELIGIBILITY_PATTERN.test(cleaned)) return true;
  return false;
}

function looksLikeCompoundOcrLine(name) {
  if (name.length > 50) return true;
  const amountTokens = name.match(/[0-9,]+\s*(만원|억원|원)/g);
  return (amountTokens?.length ?? 0) >= 2;
}

function looksLikeCategoryTokenOnly(name) {
  if (name.length >= 5) return false;
  return !/진단|의료비|수술|입원|일당|보장/.test(name);
}

/**
 * @param {string} name
 * @param {{ insurer_name?: string|null, product_name?: string|null, plan_name?: string|null }} [context]
 */
export function isEligibleRiderLabel(name, context = {}) {
  const cleaned = cleanText(name);
  if (!cleaned || cleaned.length < 2) return false;
  if (isKnownInsurerName(cleaned)) return false;
  if (matchesContextLabel(cleaned, context)) return false;
  if (looksLikeProductOrPlanName(cleaned)) return false;
  if (looksLikeCompoundOcrLine(cleaned)) return false;
  if (looksLikeCategoryTokenOnly(cleaned)) return false;
  return RIDER_ELIGIBILITY_PATTERN.test(cleaned);
}

function riderLabelFromItem(item) {
  if (item == null) return "";
  if (typeof item === "string") return cleanText(item);
  if (typeof item === "object") {
    return cleanText(
      item.rider_name ??
        item.normalized_name ??
        item.name ??
        item.label ??
        item.coverage_line ??
        item.coverage_name ??
        "",
    );
  }
  return "";
}

function buildRiderDetail({ rider_name, coverage_amount = null, source_kind, source_line = null, category = null }) {
  const label = cleanText(rider_name);
  if (!label) return null;
  return {
    rider_name: label,
    coverage_amount: coverage_amount ?? null,
    category,
    source_kind: source_kind ?? "extracted",
    source_line: source_line ?? null,
  };
}

function normalizeRiderDetail(item) {
  if (!item || typeof item !== "object") return null;
  return buildRiderDetail({
    rider_name: riderLabelFromItem(item),
    coverage_amount: item.coverage_amount ?? item.amount ?? null,
    source_kind: item.source_kind ?? "merged",
    source_line: item.source_line ?? item.notes ?? null,
    category: item.category ?? null,
  });
}

function pushUniqueRiderName(target, seen, name, context = {}) {
  const label = cleanText(name);
  if (!label || !isEligibleRiderLabel(label, context)) return;
  const key = normalizeKey(label);
  if (seen.has(key)) return;
  seen.add(key);
  target.push(label);
}

function pushUniqueRiderDetail(target, seen, detail, context = {}) {
  const normalized = normalizeRiderDetail(detail);
  if (!normalized) return;
  if (!isEligibleRiderLabel(normalized.rider_name, context)) return;
  const key = `${normalizeKey(normalized.rider_name)}::${normalized.coverage_amount ?? ""}`;
  if (seen.has(key)) return;
  seen.add(key);
  target.push(normalized);
}

function extractStoredRiderNames(existing = {}, context = {}) {
  const names = [];
  const seen = new Set();

  if (Array.isArray(existing.riders)) {
    for (const item of existing.riders) {
      pushUniqueRiderName(names, seen, typeof item === "string" ? item : riderLabelFromItem(item), context);
    }
  }

  if (Array.isArray(existing.rider_details)) {
    for (const item of existing.rider_details) {
      pushUniqueRiderName(names, seen, riderLabelFromItem(item), context);
    }
  }

  return names;
}

function extractStoredRiderDetails(existing = {}) {
  const details = [];
  const seen = new Set();

  if (Array.isArray(existing.rider_details)) {
    for (const item of existing.rider_details) {
      pushUniqueRiderDetail(details, seen, item, {});
    }
  }

  if (Array.isArray(existing.riders)) {
    for (const item of existing.riders) {
      if (typeof item === "object" && item != null) {
        pushUniqueRiderDetail(details, seen, item, {});
      }
    }
  }

  return details;
}

/**
 * @param {string[]} existing
 * @param {string[]} incoming
 */
export function mergeRiderNameStrings(existing = [], incoming = [], context = {}) {
  const merged = [];
  const seen = new Set();
  for (const name of [...existing, ...incoming]) {
    pushUniqueRiderName(merged, seen, name, context);
  }
  return merged;
}

/**
 * @param {Array<Record<string, unknown>>} existing
 * @param {Array<Record<string, unknown>>} incoming
 */
export function mergeRiderDetailObjects(existing = [], incoming = [], context = {}) {
  const merged = [];
  const seen = new Set();
  for (const item of [...existing, ...incoming]) {
    pushUniqueRiderDetail(merged, seen, item, context);
  }
  return merged;
}

/**
 * @param {Record<string, unknown>|null|undefined} existingSummary
 * @param {Record<string, unknown>} nextScalars
 * @param {{ riderNames?: string[], riderDetails?: Array<Record<string, unknown>> }} riderPayload
 */
export function mergeCoverageSummary(existingSummary, nextScalars, riderPayload = {}, context = {}) {
  const existing =
    existingSummary && typeof existingSummary === "object" && !Array.isArray(existingSummary)
      ? existingSummary
      : {};

  const { riderNames = [], riderDetails = [] } = riderPayload;

  const mergedNames = mergeRiderNameStrings(extractStoredRiderNames(existing, context), riderNames, context);
  const mergedDetails = mergeRiderDetailObjects(
    extractStoredRiderDetails(existing),
    riderDetails,
    context,
  );

  // OCR/factory merge must never wipe KEY(Claude)-confirmed source facts.
  const preservedKeyConfirmed = Array.isArray(existing.key_confirmed_source_facts)
    ? existing.key_confirmed_source_facts
    : undefined;

  const merged = {
    ...existing,
    ...nextScalars,
    riders: mergedNames,
    rider_details: mergedDetails,
  };
  if (preservedKeyConfirmed) {
    merged.key_confirmed_source_facts = preservedKeyConfirmed;
  }
  return merged;
}

function collectRiderPayload(entries, context = {}) {
  const riderNames = [];
  const riderDetails = [];
  const nameSeen = new Set();
  const detailSeen = new Set();

  for (const entry of entries) {
    pushUniqueRiderDetail(riderDetails, detailSeen, entry, context);
  }

  for (const detail of riderDetails) {
    pushUniqueRiderName(riderNames, nameSeen, detail.rider_name, context);
  }

  return { riderNames, riderDetails };
}

/**
 * Sheet row → riders string[] + rider_details when coverage_name is eligible.
 */
export function assembleRidersFromSheetRow(row = {}) {
  const context = {
    insurer_name: row.insurer_name ?? null,
    product_name: row.product_name ?? null,
    plan_name: row.plan_name ?? row.product_name ?? null,
  };
  const entries = [];

  if (isEligibleRiderLabel(row.coverage_name, context)) {
    entries.push(
      buildRiderDetail({
        rider_name: row.coverage_name,
        coverage_amount: row.amount_value ?? null,
        source_kind: "sheet_coverage_name",
        source_line: row.amount_text ?? row.source_text ?? null,
      }),
    );
  }

  return collectRiderPayload(entries, context);
}

/**
 * OCR policy candidate → riders string[] + rider_details.
 */
export function assembleRidersFromCandidate(candidate = {}) {
  const fields = candidate.fields ?? {};
  const context = {
    insurer_name: fields.insurer_name ?? null,
    product_name: fields.product_name ?? null,
    plan_name: fields.plan_name ?? fields.product_name ?? null,
  };
  const entries = [];

  const rawRiders = Array.isArray(candidate.riders) ? candidate.riders : [];
  for (const item of rawRiders) {
    const label = riderLabelFromItem(item);
    const amount =
      typeof item === "object" && item != null
        ? item.coverage_amount ?? item.amount ?? fields.coverage_amount ?? null
        : null;
    entries.push(
      buildRiderDetail({
        rider_name: label,
        coverage_amount: amount,
        source_kind: "ocr_rider",
        source_line: typeof item === "object" && item != null ? item.source_line ?? item.notes ?? null : null,
        category: typeof item === "object" && item != null ? item.category ?? null : null,
      }),
    );
  }

  for (const label of [fields.rider_name, fields.coverage_name]) {
    entries.push(
      buildRiderDetail({
        rider_name: label,
        coverage_amount: fields.coverage_amount ?? null,
        source_kind: "ocr_field",
      }),
    );
  }

  const detected = fields.detected_coverages ?? fields.coverage_categories ?? [];
  if (Array.isArray(detected)) {
    for (const entry of detected) {
      const label = typeof entry === "string" ? entry : riderLabelFromItem(entry);
      entries.push(
        buildRiderDetail({
          rider_name: label,
          source_kind: "detected_coverage",
        }),
      );
    }
  }

  return collectRiderPayload(entries, context);
}

/**
 * @param {Array<unknown>} riders
 */
export function assertRidersStringArray(riders) {
  return (
    Array.isArray(riders) &&
    riders.every((entry) => typeof entry === "string" && cleanText(entry).length > 0)
  );
}
