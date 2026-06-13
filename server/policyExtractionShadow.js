/**
 * Shadow-mode validator hook — records policy_validation metadata only (no persist gating).
 */
import { COVERAGE_SHEET_EXTRACTOR_VERSION } from "./coverageSheetExtractor.js";
import { segmentOcrIntoPolicyBlocks } from "./documentPolicyExtractor.js";
import { normalizeDocClass, validatePolicyExtraction, VALIDATOR_VERSION } from "./policyExtractionValidator.js";

export const SHADOW_MODE = true;

export const CUSTOMER_DOCUMENT_SELECT_FIELDS =
  "id, customer_id, ingest_status, original_filename, document_type, customer_hint_type, metadata_json";

export function buildValidatorDocumentMeta(document = {}) {
  const metadata = document.metadata_json ?? {};
  const documentMeta = {};

  if (Object.prototype.hasOwnProperty.call(document, "document_type") && document.document_type) {
    documentMeta.doc_class = document.document_type;
    return documentMeta;
  }

  if (metadata.category_key) documentMeta.category_key = metadata.category_key;
  if (document.customer_hint_type) documentMeta.customer_hint_type = document.customer_hint_type;
  return documentMeta;
}

export function buildDocProfile(document = {}, documentMeta = {}) {
  const metadata = document.metadata_json ?? {};
  return {
    document_type: Object.prototype.hasOwnProperty.call(document, "document_type") ? document.document_type ?? null : null,
    category_key: metadata.category_key ?? null,
    customer_hint_type: document.customer_hint_type ?? null,
    validator_doc_class: documentMeta.doc_class ?? null,
    normalized_doc_class: documentMeta.doc_class ? normalizeDocClass(documentMeta.doc_class) : null,
  };
}

export function runShadowPolicyValidation({ ocrText, multiExtraction, document, segmentation = null }) {
  const documentMeta = buildValidatorDocumentMeta(document);
  const resolvedSegmentation = segmentation ?? segmentOcrIntoPolicyBlocks(ocrText);
  const validation = validatePolicyExtraction({
    ocrText,
    multiExtraction,
    segmentation: resolvedSegmentation,
    documentMeta,
  });

  return {
    ok: true,
    validation,
    doc_profile: buildDocProfile(document, documentMeta),
  };
}

export function runShadowPolicyValidationSafe(args) {
  try {
    return runShadowPolicyValidation(args);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      validator_version: VALIDATOR_VERSION,
      shadow_mode: SHADOW_MODE,
    };
  }
}

export function buildCoverageSheetShadowMetadata(sheetExtraction, document = {}, documentMeta = {}) {
  if (!sheetExtraction || typeof sheetExtraction !== "object") return null;

  return {
    extractor_version: sheetExtraction.extractor_version ?? COVERAGE_SHEET_EXTRACTOR_VERSION,
    shadow_mode: SHADOW_MODE,
    layout: sheetExtraction.layout ?? null,
    layout_features: sheetExtraction.layout_features ?? null,
    confidence: sheetExtraction.confidence ?? "low",
    pass_l1_v1: Boolean(sheetExtraction.pass_l1_v1),
    pass_criteria: sheetExtraction.pass_criteria ?? null,
    passing_row_count: sheetExtraction.passing_row_count ?? 0,
    row_count: sheetExtraction.row_count ?? 0,
    rows: sheetExtraction.rows ?? [],
    warnings: sheetExtraction.warnings ?? [],
    document_flags: sheetExtraction.warnings?.includes("NON_L1_LAYOUT") ? ["NON_L1_LAYOUT"] : [],
    doc_profile: buildDocProfile(document, documentMeta),
    ocr_text_length: sheetExtraction.ocr_text_length ?? 0,
    shadow_only: true,
  };
}

export function runShadowCoverageSheet({ sheetExtraction, document }) {
  const documentMeta = buildValidatorDocumentMeta(document);
  return {
    ok: true,
    coverage_sheet_shadow: buildCoverageSheetShadowMetadata(sheetExtraction, document, documentMeta),
    doc_profile: buildDocProfile(document, documentMeta),
  };
}

export function runShadowCoverageSheetSafe(args) {
  try {
    return runShadowCoverageSheet(args);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      extractor_version: COVERAGE_SHEET_EXTRACTOR_VERSION,
      shadow_mode: SHADOW_MODE,
    };
  }
}

export function buildPolicyValidationMetadata(shadowState, persistResult = null) {
  if (!shadowState?.ok || !shadowState.validation) return null;

  const validation = shadowState.validation;
  const policyCandidates = (validation.candidates ?? []).filter((item) => item.source !== "review_block");

  return {
    validator_version: validation.validator_version ?? VALIDATOR_VERSION,
    shadow_mode: SHADOW_MODE,
    document_route: validation.document_route,
    document_score: validation.document_score,
    doc_profile: shadowState.doc_profile ?? {},
    document_flags: validation.flags ?? [],
    summary: validation.summary ?? {},
    candidates: validation.candidates ?? [],
    would_auto_save_count: policyCandidates.filter((item) => item.route === "auto_save").length,
    actually_persisted_count: persistResult?.policy_count ?? 0,
  };
}

export function buildMetadataPatchWithShadow(basePatch, shadowState, persistResult = null) {
  try {
    const patch = { ...basePatch };
    if (shadowState?.coverage_sheet_shadow) {
      patch.coverage_sheet_shadow = shadowState.coverage_sheet_shadow;
      return patch;
    }
    const policyValidation = buildPolicyValidationMetadata(shadowState, persistResult);
    if (!policyValidation) return patch;
    return { ...patch, policy_validation: policyValidation };
  } catch {
    return basePatch;
  }
}

export async function updateDocumentMetadataWithShadow(admin, updateFn, customerId, documentId, basePatch, shadowState, persistResult = null) {
  const patchWithShadow = buildMetadataPatchWithShadow(basePatch, shadowState, persistResult);
  try {
    return await updateFn(admin, customerId, documentId, patchWithShadow);
  } catch (_error) {
    if (!patchWithShadow.policy_validation && !patchWithShadow.coverage_sheet_shadow) throw _error;
    return await updateFn(admin, customerId, documentId, basePatch);
  }
}
