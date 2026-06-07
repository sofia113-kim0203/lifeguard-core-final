import type { ClassifiedDocumentType, DocumentRecord } from "./lib/types.ts";

function normalizeHint(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function metadataCategoryKey(metadata: Record<string, unknown> | null): string {
  const key = metadata?.category_key;
  return typeof key === "string" ? normalizeHint(key) : "";
}

export function classifyDocumentType(document: DocumentRecord): ClassifiedDocumentType | string {
  const hint = normalizeHint(document.customer_hint_type);
  const categoryKey = metadataCategoryKey(document.metadata_json);
  const existingType = normalizeHint(document.document_type);

  if (
    hint === "coverage_analysis_sheet" ||
    categoryKey === "coverage_analysis_sheet"
  ) {
    return "coverage_analysis_sheet";
  }

  if (hint === "terms" || categoryKey === "terms") {
    return "insurance_terms";
  }

  if (hint === "insurance_policy" || categoryKey === "insurance_policy") {
    return "insurance_certificate";
  }

  if (existingType) {
    return document.document_type as string;
  }

  return "unknown";
}
