/**
 * PR-2 — Serialize policy riders for memory-builder facts (pure helpers, unit-tested).
 * Contract: coverage_summary.riders is string[]; rider_details holds objects.
 */

function cleanText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
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

function collectRiderNameStrings(coverageSummary) {
  const names = [];
  const seen = new Set();

  if (Array.isArray(coverageSummary.riders)) {
    for (const entry of coverageSummary.riders) {
      const label = typeof entry === "string" ? cleanText(entry) : riderLabelFromItem(entry);
      if (!label || seen.has(label)) continue;
      seen.add(label);
      names.push(label);
    }
  }

  return names;
}

function collectNamedList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => cleanText(typeof entry === "string" ? entry : riderLabelFromItem(entry))).filter(Boolean);
}

/**
 * @param {Record<string, unknown>|null|undefined} coverageSummary
 */
export function serializePolicyRiders(coverageSummary) {
  if (!coverageSummary || typeof coverageSummary !== "object" || Array.isArray(coverageSummary)) {
    return {
      names: [],
      structured: [],
      text: "",
      status: "unknown",
      hasStructuredRiders: false,
    };
  }

  const names = collectRiderNameStrings(coverageSummary);
  const structured = Array.isArray(coverageSummary.rider_details)
    ? coverageSummary.rider_details
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const rider_name = riderLabelFromItem(entry);
          if (!rider_name) return null;
          return {
            rider_name,
            coverage_amount: entry.coverage_amount ?? entry.amount ?? null,
            category: entry.category ?? null,
            source_line: entry.source_line ?? entry.notes ?? null,
            source_kind: entry.source_kind ?? "detail",
          };
        })
        .filter(Boolean)
    : names.map((rider_name) => ({ rider_name, source_kind: "string" }));

  const supplementalLabels = [
    ...collectNamedList(coverageSummary.detected_coverages),
    ...collectNamedList(coverageSummary.coverage_categories),
  ].filter(Boolean);

  const textParts = [];
  const textSeen = new Set();
  for (const label of [...names, ...supplementalLabels]) {
    const text = cleanText(label);
    if (!text || textSeen.has(text)) continue;
    textSeen.add(text);
    textParts.push(text);
  }

  const text = textParts.join(", ");
  const hasStructuredRiders = names.length > 0 || supplementalLabels.length > 0;

  return {
    names,
    structured,
    text,
    status: hasStructuredRiders ? "structured" : "unknown",
    hasStructuredRiders,
  };
}

/**
 * Build policy summary suffix and metadata extras for memory facts.
 */
export function buildPolicyRiderMemoryFields(coverageSummary) {
  const riders = serializePolicyRiders(coverageSummary);
  const suffix = riders.text ? `, 특약 ${riders.text}` : "";

  return {
    riders,
    riderSuffix: suffix,
    metadataExtra: {
      riders: riders.names,
      rider_details: Array.isArray(coverageSummary?.rider_details) ? coverageSummary.rider_details : riders.structured,
      riders_text: riders.text || null,
      riders_status: riders.status,
      has_structured_riders: riders.hasStructuredRiders,
    },
  };
}
