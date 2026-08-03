/**
 * PR-C3 — map passing coverage sheet rows to profile_insurance_policies bridge rows.
 */
import {
  COVERAGE_SHEET_EXTRACTOR_ORIGIN,
  COVERAGE_SHEET_RECORD_KIND,
} from "./coverageSheetBridge.js";
import { COVERAGE_SHEET_EXTRACTOR_VERSION } from "./coverageSheetExtractor.js";
import {
  assembleRidersFromSheetRow,
  mergeCoverageSummary,
} from "./coverageRiderPopulation.js";
import { planRetiredPolicyIds } from "./documentPolicyUploadPersist.js";
import {
  hasInvalidPolicyIdentityFields,
  isPollutedPolicyIdentityField,
} from "../src/lib/policyIdentityPollution.js";

/**
 * Sheet L1 rows that are coverage fragments must not become policy contracts.
 * Keep riders/coverage in coverage_summary of real product rows only.
 */
export function shouldPersistSheetRowAsPolicyContract(row = {}) {
  const product = String(row?.product_name ?? "").trim();
  const coverage = String(row?.coverage_name ?? "").trim();
  if (hasInvalidPolicyIdentityFields({
    insurer_name: row?.insurer_name,
    product_name: product,
  })) {
    return false;
  }
  if (isPollutedPolicyIdentityField(product)) return false;
  // Coverage-only sheet line with no clean product title → not a contract.
  if (!product && coverage) return false;
  if (product && coverage && product === coverage && /(수술비|진단비|입원|통원|장해)/.test(product)) {
    return false;
  }
  return Boolean(String(row?.insurer_name ?? "").trim() && product);
}

function normalizeKeyPart(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function parsePositivePremium(raw) {
  if (raw == null || raw === "") return null;
  const premium = Number(raw);
  if (!Number.isFinite(premium) || premium <= 0) return null;
  return premium;
}

/**
 * Resolve monthly_premium from explicit premium fields on a sheet row.
 * amount_value is coverage amount — never mapped to premium.
 */
export function resolveSheetRowMonthlyPremium(row = {}) {
  const extracted = row.extracted && typeof row.extracted === "object" ? row.extracted : {};
  const candidates = [
    extracted.monthly_premium,
    extracted.premium_amount,
    extracted.total_premium,
    row.monthly_premium,
    row.premium_amount,
    row.total_premium,
  ];

  for (const raw of candidates) {
    const premium = parsePositivePremium(raw);
    if (premium != null) return premium;
  }
  return null;
}

export function buildSheetUploadExtractKey(documentId, row = {}) {
  const parts = [
    String(documentId ?? "").trim(),
    "sheet",
    row.row_index != null ? String(row.row_index) : "",
    normalizeKeyPart(row.insurer_name),
    row.amount_value != null ? String(row.amount_value) : "",
  ];
  return parts.join("|");
}

export function buildCoverageSummaryFromSheetRow(documentId, row = {}, existingSummary = null) {
  const uploadExtractKey = buildSheetUploadExtractKey(documentId, row);
  const riders = assembleRidersFromSheetRow(row);
  const context = {
    insurer_name: row.insurer_name ?? null,
    product_name: row.product_name ?? null,
    plan_name: row.plan_name ?? row.product_name ?? null,
  };

  return mergeCoverageSummary(
    existingSummary,
    {
      source_document_id: documentId,
      upload_extract_key: uploadExtractKey,
      extractor_origin: COVERAGE_SHEET_EXTRACTOR_ORIGIN,
      record_kind: COVERAGE_SHEET_RECORD_KIND,
      sheet_row_index: row.row_index ?? null,
      extractor_version: COVERAGE_SHEET_EXTRACTOR_VERSION,
      amount_value: row.amount_value ?? null,
      amount_unit: row.amount_unit ?? null,
      amount_text: row.amount_text ?? null,
      coverage_name: row.coverage_name ?? null,
      product_name: row.product_name ?? null,
      warnings: Array.isArray(row.warnings) ? row.warnings : [],
      extracted_at: new Date().toISOString(),
    },
    riders,
    context,
  );
}

export function buildPolicyRowFromSheetRow(customerId, documentId, row = {}, existingCoverageSummary = null) {
  const coverageSummary = buildCoverageSummaryFromSheetRow(documentId, row, existingCoverageSummary);

  return {
    customer_id: customerId,
    insurer_name: row.insurer_name,
    product_name: row.product_name ?? null,
    policy_type: null,
    monthly_premium: resolveSheetRowMonthlyPremium(row),
    effective_from: null,
    coverage_summary: coverageSummary,
    source: "upload_extract",
    is_active: true,
    updated_at: new Date().toISOString(),
  };
}

export function resolveExistingSheetPolicyForRow(existingRows, documentId, row = {}, rowCount = 1) {
  const uploadExtractKey = buildSheetUploadExtractKey(documentId, row);
  const activeRows = (existingRows ?? []).filter((entry) => entry.is_active !== false);

  const byKey = activeRows.find((entry) => entry.coverage_summary?.upload_extract_key === uploadExtractKey);
  if (byKey) return { row: byKey, upload_extract_key: uploadExtractKey };

  const legacyRows = activeRows.filter((entry) => entry.coverage_summary?.source_document_id === documentId);
  if (legacyRows.length === 1 && rowCount === 1 && !legacyRows[0].coverage_summary?.upload_extract_key) {
    return { row: legacyRows[0], upload_extract_key: uploadExtractKey };
  }

  return { row: null, upload_extract_key: uploadExtractKey };
}

async function loadUploadExtractPoliciesForDocument(admin, customerId, documentId) {
  const { data, error } = await admin
    .from("profile_insurance_policies")
    .select("id, coverage_summary, is_active")
    .eq("customer_id", customerId)
    .eq("source", "upload_extract")
    .is("deleted_at", null);

  if (error) throw new Error(`policy_lookup_failed: ${error.message}`);
  return (data ?? []).filter((row) => row.coverage_summary?.source_document_id === documentId);
}

async function retireUploadExtractPolicies(admin, customerId, policyIds) {
  const retired = [];
  for (const policyId of policyIds) {
    const { data: existing, error: readError } = await admin
      .from("profile_insurance_policies")
      .select("id, coverage_summary")
      .eq("id", policyId)
      .eq("customer_id", customerId)
      .maybeSingle();
    if (readError) throw new Error(`policy_retire_read_failed: ${readError.message}`);
    if (!existing) continue;

    const coverageSummary = {
      ...(existing.coverage_summary ?? {}),
      retired_at: new Date().toISOString(),
      retired_reason: "superseded_by_reextract",
    };

    const { error } = await admin
      .from("profile_insurance_policies")
      .update({
        is_active: false,
        coverage_summary: coverageSummary,
        updated_at: new Date().toISOString(),
      })
      .eq("id", policyId)
      .eq("customer_id", customerId);
    if (error) throw new Error(`policy_retire_failed: ${error.message}`);
    retired.push(policyId);
  }
  return retired;
}

export async function persistCoverageSheetRows(admin, customerId, documentId, passingRows = []) {
  const existingRows = await loadUploadExtractPoliciesForDocument(admin, customerId, documentId);
  const actions = [];
  const activeKeys = [];
  const rowCount = passingRows.length;

  for (const row of passingRows) {
    const { row: existing, upload_extract_key: uploadExtractKey } = resolveExistingSheetPolicyForRow(
      existingRows,
      documentId,
      row,
      rowCount,
    );
    if (!shouldPersistSheetRowAsPolicyContract(row)) {
      actions.push({
        action: "skipped_non_contract_sheet_row",
        upload_extract_key: uploadExtractKey,
        sheet_row_index: row.row_index ?? null,
        reason: "coverage_fragment_or_polluted_product_name",
      });
      continue;
    }
    const policyRow = buildPolicyRowFromSheetRow(customerId, documentId, row, existing?.coverage_summary);
    activeKeys.push(uploadExtractKey);

    if (existing?.id) {
      const { data, error } = await admin
        .from("profile_insurance_policies")
        .update(policyRow)
        .eq("id", existing.id)
        .eq("customer_id", customerId)
        .select("id")
        .single();
      if (error) throw new Error(`policy_update_failed: ${error.message}`);
      actions.push({
        policy_id: data.id,
        action: "updated",
        upload_extract_key: uploadExtractKey,
        sheet_row_index: row.row_index ?? null,
      });
      continue;
    }

    const { data, error } = await admin
      .from("profile_insurance_policies")
      .insert(policyRow)
      .select("id")
      .single();
    if (error) throw new Error(`policy_insert_failed: ${error.message}`);
    actions.push({
      policy_id: data.id,
      action: "inserted",
      upload_extract_key: uploadExtractKey,
      sheet_row_index: row.row_index ?? null,
    });
  }

  const retireIds = planRetiredPolicyIds(existingRows, documentId, activeKeys);
  const retiredPolicyIds = await retireUploadExtractPolicies(admin, customerId, retireIds);

  return {
    policy_ids: actions.map((entry) => entry.policy_id),
    policy_count: actions.length,
    policy_actions: actions,
    retired_policy_ids: retiredPolicyIds,
    passing_row_count: rowCount,
  };
}
