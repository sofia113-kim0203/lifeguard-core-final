import {
  assembleRidersFromCandidate,
  mergeCoverageSummary,
} from "./coverageRiderPopulation.js";

const EXTRACTOR_VERSION = "step4-ocr-policy-v3-multi";

function normalizeKeyPart(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function buildUploadExtractKey(documentId, fields = {}) {
  const parts = [
    String(documentId ?? "").trim(),
    normalizeKeyPart(fields.insurer_name),
    normalizeKeyPart(fields.product_name),
    normalizeKeyPart(fields.policy_number),
    fields.monthly_premium != null && fields.monthly_premium !== ""
      ? String(fields.monthly_premium)
      : "",
  ];
  return parts.join("|");
}

export function buildCoverageSummaryFromCandidate(documentId, candidate, existingSummary = null) {
  const fields = candidate.fields ?? {};
  const uploadExtractKey = buildUploadExtractKey(documentId, fields);
  const riders = assembleRidersFromCandidate(candidate);
  const context = {
    insurer_name: fields.insurer_name ?? null,
    product_name: fields.product_name ?? null,
    plan_name: fields.plan_name ?? fields.product_name ?? null,
  };

  return mergeCoverageSummary(
    existingSummary,
    {
      source_document_id: documentId,
      upload_extract_key: uploadExtractKey,
      extractor_version: EXTRACTOR_VERSION,
      extraction_confidence: candidate.confidence ?? null,
      extraction_tier: candidate.tier ?? "full",
      candidate_tier: candidate.candidate_tier ?? null,
      block_index: candidate.block_index ?? null,
      policyholder: fields.policyholder,
      insured: fields.insured,
      payment_period: fields.payment_period,
      insurance_period: fields.insurance_period,
      coverage_name: fields.coverage_name,
      rider_name: fields.rider_name,
      coverage_amount: fields.coverage_amount,
      coverage_categories: fields.coverage_categories ?? [],
      detected_coverages: fields.detected_coverages ?? fields.coverage_categories ?? [],
      effective_from: fields.effective_from,
      policy_number: fields.policy_number ?? null,
      extracted_at: new Date().toISOString(),
      extraction_json: fields,
    },
    riders,
    context,
  );
}

export function buildPolicyRowFromCandidate(customerId, documentId, candidate, existingCoverageSummary = null) {
  const fields = candidate.fields ?? {};
  const coverageSummary = buildCoverageSummaryFromCandidate(documentId, candidate, existingCoverageSummary);

  return {
    customer_id: customerId,
    insurer_name: fields.insurer_name,
    product_name: fields.product_name,
    policy_type: fields.policy_type,
    monthly_premium: fields.monthly_premium,
    effective_from: fields.effective_from ?? null,
    coverage_summary: coverageSummary,
    source: "upload_extract",
    is_active: true,
    updated_at: new Date().toISOString(),
  };
}

export function resolveExistingPolicyForCandidate(existingRows, documentId, candidate, candidateCount) {
  const fields = candidate.fields ?? {};
  const uploadExtractKey = buildUploadExtractKey(documentId, fields);
  const activeRows = (existingRows ?? []).filter((row) => row.is_active !== false);

  const byKey = activeRows.find((row) => row.coverage_summary?.upload_extract_key === uploadExtractKey);
  if (byKey) return { row: byKey, upload_extract_key: uploadExtractKey };

  const legacyRows = activeRows.filter((row) => row.coverage_summary?.source_document_id === documentId);
  if (legacyRows.length === 1 && candidateCount === 1 && !legacyRows[0].coverage_summary?.upload_extract_key) {
    return { row: legacyRows[0], upload_extract_key: uploadExtractKey };
  }

  return { row: null, upload_extract_key: uploadExtractKey };
}

export function planRetiredPolicyIds(existingRows, documentId, activeKeys) {
  const keySet = new Set(activeKeys);
  return (existingRows ?? [])
    .filter((row) => row.is_active !== false)
    .filter((row) => row.coverage_summary?.source_document_id === documentId)
    .filter((row) => {
      const key = row.coverage_summary?.upload_extract_key;
      if (!key) return true;
      return !keySet.has(key);
    })
    .map((row) => row.id);
}

export { EXTRACTOR_VERSION };
