/**
 * L1 Mobile GA Stack coverage analysis sheet extractor — shadow only (no persist).
 */
import { normalizeOcrTextVariants } from "./documentPolicyExtractor.js";

export const COVERAGE_SHEET_EXTRACTOR_VERSION = "coverage-sheet-l1-v1";
export const PASS_CRITERIA_ID = "PASS-L1-V1";

const MIN_CARRIER_ONLY_LINES = 2;
const MIN_AMOUNT_LINES = 1;

const KNOWN_CARRIERS = [
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

const PRODUCT_TOKEN_PATTERN =
  /건강보험|실손|암|종신|운전|화재|간편|무배당|\(II\)|\d{4}|연금|저축|보험/i;

const COVERAGE_NAME_PATTERN = /진단|입원|수술|실손|암|뇌|심장|사망|연금|요양|보장/i;

function cleanValue(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/^[:\-·\s]+/, "")
    .trim();
}

export function isCoverageAnalysisSheetDocument(document = {}) {
  const documentType = String(document.document_type ?? "").trim();
  if (documentType === "coverage_analysis_sheet") return true;
  const categoryKey = String(document.metadata_json?.category_key ?? "").trim();
  if (categoryKey === "coverage_analysis_sheet") return true;
  const hintType = String(document.customer_hint_type ?? "").trim();
  return hintType === "coverage_analysis_sheet";
}

function detectCarrierOnly(line) {
  const cleaned = cleanValue(line);
  if (!cleaned) return null;
  for (const carrier of KNOWN_CARRIERS) {
    const compact = carrier.replace(/\s+/g, "");
    const lineCompact = cleaned.replace(/\s+/g, "");
    if (cleaned === carrier || lineCompact === compact) return carrier;
  }
  return null;
}

function isRowIndexLine(line) {
  return /^\(\d+\)$/.test(cleanValue(line));
}

function isUiNoiseLine(line) {
  const cleaned = cleanValue(line);
  if (!cleaned) return true;
  if (/^SUCCESS$/i.test(cleaned)) return true;
  if (/^\d{1,2}:\d{2}/.test(cleaned)) return true;
  if (/기준담보|권장금액|기본형|표준형/i.test(cleaned)) return true;
  if (/^※/.test(cleaned)) return true;
  if (/^\d{1,2}$/.test(cleaned)) return true;
  if (/^\d{4}[.\-/년]/.test(cleaned)) return true;
  return false;
}

function isLabeledProductLine(line) {
  return /^상품명\s*[:：]/i.test(cleanValue(line));
}

function isLabeledInsurerLine(line) {
  return /^보험사\s*[:：]/i.test(cleanValue(line));
}

function isMultiFieldRow(line) {
  const cleaned = cleanValue(line);
  if (!cleaned) return false;
  const carrier = KNOWN_CARRIERS.find((entry) => cleaned.includes(entry));
  if (!carrier) return false;
  if (detectCarrierOnly(cleaned)) return false;
  const hasAmount = /[0-9,]+\s*(만원|억원|억|원)/.test(cleaned);
  const hasProduct = PRODUCT_TOKEN_PATTERN.test(cleaned);
  return hasAmount && hasProduct;
}

function isProductTokenLine(line) {
  const cleaned = cleanValue(line);
  if (!cleaned) return false;
  if (detectCarrierOnly(cleaned)) return false;
  if (isRowIndexLine(cleaned)) return false;
  if (parseAmountLine(cleaned)) return false;
  if (isLabeledProductLine(cleaned) || isLabeledInsurerLine(cleaned)) return false;
  return PRODUCT_TOKEN_PATTERN.test(cleaned);
}

function isCoverageNameLine(line) {
  const cleaned = cleanValue(line);
  if (!cleaned) return false;
  if (parseAmountLine(cleaned)) return false;
  return COVERAGE_NAME_PATTERN.test(cleaned) && cleaned.length <= 40;
}

export function parseAmountLine(line) {
  const cleaned = cleanValue(line);
  if (!cleaned) return null;

  if (/실손/.test(cleaned) && !/[0-9,]+/.test(cleaned)) {
    return {
      amount_text: cleaned,
      amount_value: null,
      amount_unit: "indemnity",
    };
  }

  const labeledFixed = cleaned.match(/^(?:정액|일시금)\s*[:：]?\s*([0-9,]+)\s*(만원|억원|억|원)?$/i);
  if (labeledFixed) {
    const unit = normalizeAmountUnit(labeledFixed[2] ?? "원", true);
    const value = normalizeAmountValue(labeledFixed[1], unit.unit);
    return {
      amount_text: cleaned,
      amount_value: value,
      amount_unit: unit.unit === "unknown" ? "fixed_benefit" : "fixed_benefit",
    };
  }

  const amountMatch = cleaned.match(/^([0-9,]+)\s*(만원|억원|억|원)?$/);
  if (!amountMatch) return null;

  const unit = normalizeAmountUnit(amountMatch[2] ?? "", false);
  const value = normalizeAmountValue(amountMatch[1], unit.unit);
  return {
    amount_text: cleaned,
    amount_value: value,
    amount_unit: unit.unit,
  };
}

function normalizeAmountUnit(rawUnit, hasDigits) {
  const unit = String(rawUnit ?? "").trim();
  if (/억/.test(unit)) return { unit: "eok" };
  if (/만/.test(unit)) return { unit: "manwon" };
  if (/원/.test(unit) || (hasDigits && !unit)) return { unit: "won" };
  if (!unit && hasDigits) return { unit: "unknown" };
  return { unit: "unknown" };
}

function normalizeAmountValue(rawDigits, unit) {
  const digits = String(rawDigits ?? "").replace(/,/g, "").trim();
  if (!digits || !/^\d+$/.test(digits)) return null;
  let amount = Number(digits);
  if (!Number.isFinite(amount)) return null;
  if (unit === "manwon") amount *= 10_000;
  else if (unit === "eok") amount *= 100_000_000;
  if (unit === "unknown" || unit === "indemnity") return null;
  return amount;
}

export function analyzeLayoutFeatures(lines = []) {
  let carrierOnlyLines = 0;
  let amountLines = 0;
  let labeledProductLines = 0;
  let multiFieldRows = 0;

  for (const line of lines) {
    const cleaned = cleanValue(line);
    if (!cleaned) continue;
    if (detectCarrierOnly(cleaned)) carrierOnlyLines += 1;
    if (parseAmountLine(cleaned)) amountLines += 1;
    if (isLabeledProductLine(cleaned)) labeledProductLines += 1;
    if (isMultiFieldRow(cleaned)) multiFieldRows += 1;
  }

  return {
    carrier_only_lines: carrierOnlyLines,
    amount_lines: amountLines,
    labeled_product_lines: labeledProductLines,
    multi_field_rows: multiFieldRows,
  };
}

export function detectL1Layout(features = {}) {
  return (
    features.carrier_only_lines >= MIN_CARRIER_ONLY_LINES &&
    features.amount_lines >= MIN_AMOUNT_LINES &&
    features.labeled_product_lines === 0 &&
    features.multi_field_rows === 0
  );
}

function computeRowConfidence(row) {
  let score = 0.5;
  if (row.insurer_name) score += 0.2;
  if (row.amount_value != null && row.amount_unit && row.amount_unit !== "unknown") score += 0.2;
  if (row.product_name) score += 0.05;
  if (row.coverage_name) score += 0.05;
  return Number(Math.min(1, score).toFixed(3));
}

function parseL1Rows(lines) {
  const carriers = [];
  const amounts = [];
  const products = [];
  const coverages = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const cleaned = cleanValue(line);
    if (!cleaned || isUiNoiseLine(cleaned)) continue;

    const carrier = detectCarrierOnly(cleaned);
    if (carrier) {
      let rowIndex = null;
      for (let back = index - 1; back >= Math.max(0, index - 3); back -= 1) {
        if (isRowIndexLine(lines[back])) {
          rowIndex = Number(lines[back].replace(/[()]/g, ""));
          break;
        }
      }
      carriers.push({
        row_index: rowIndex,
        insurer_name: carrier,
        source_text: cleaned,
        line_index: index,
      });
      continue;
    }

    const amount = parseAmountLine(cleaned);
    if (amount) {
      amounts.push({ ...amount, source_text: cleaned, line_index: index });
      continue;
    }

    if (isProductTokenLine(cleaned)) {
      products.push({ product_name: cleaned, line_index: index });
      continue;
    }

    if (isCoverageNameLine(cleaned)) {
      coverages.push({ coverage_name: cleaned, line_index: index });
    }
  }

  const rows = [];
  for (let index = 0; index < carriers.length; index += 1) {
    const carrier = carriers[index];
    const nextLineIndex = carriers[index + 1]?.line_index ?? lines.length;
    const amount = amounts[index] ?? null;
    const product =
      products.find((entry) => entry.line_index > carrier.line_index && entry.line_index < nextLineIndex) ?? null;
    const coverage =
      coverages.find((entry) => entry.line_index > carrier.line_index && entry.line_index < nextLineIndex) ?? null;

    const warnings = [];
    if (!amount) warnings.push("AMOUNT_MISSING");
    if (amount?.amount_unit === "unknown") warnings.push("UNKNOWN_AMOUNT_UNIT");
    if (amount?.amount_unit === "unknown") warnings.push("MANUAL_REVIEW_CANDIDATE");

    rows.push({
      row_index: carrier.row_index ?? index,
      insurer_name: carrier.insurer_name,
      product_name: product?.product_name ?? null,
      coverage_name: coverage?.coverage_name ?? null,
      policy_number: null,
      renewal_type: null,
      amount_text: amount?.amount_text ?? null,
      amount_value: amount?.amount_value ?? null,
      amount_unit: amount?.amount_unit ?? null,
      source_text: carrier.source_text,
      confidence: 0,
      warnings,
    });
    rows[rows.length - 1].confidence = computeRowConfidence(rows[rows.length - 1]);
  }

  return rows;
}

export function evaluatePassL1V1(rows = []) {
  const passingRows = rows.filter(
    (row) =>
      row.insurer_name &&
      row.amount_value != null &&
      row.amount_unit &&
      row.amount_unit !== "unknown",
  );
  return {
    pass: rows.length >= 1 && passingRows.length >= 1,
    passing_row_count: passingRows.length,
    criteria: PASS_CRITERIA_ID,
  };
}

export function extractCoverageSheetFromOcrText(ocrText) {
  const variants = normalizeOcrTextVariants(ocrText);
  const lines = variants.lines;
  const features = analyzeLayoutFeatures(lines);
  const layout = detectL1Layout(features) ? "L1_mobile_ga_stack" : "non_l1";
  const warnings = [];

  if (!detectL1Layout(features)) {
    warnings.push("NON_L1_LAYOUT");
    return {
      extractor_version: COVERAGE_SHEET_EXTRACTOR_VERSION,
      layout,
      layout_features: features,
      confidence: "low",
      pass_l1_v1: false,
      pass_criteria: PASS_CRITERIA_ID,
      row_count: 0,
      rows: [],
      warnings,
      ocr_text_length: variants.raw.length,
      shadow_only: true,
    };
  }

  const rows = parseL1Rows(lines);
  const passState = evaluatePassL1V1(rows);
  if (rows.some((row) => row.warnings.includes("UNKNOWN_AMOUNT_UNIT"))) {
    warnings.push("UNKNOWN_AMOUNT_UNIT_PRESENT");
  }
  if (rows.some((row) => row.warnings.includes("MANUAL_REVIEW_CANDIDATE"))) {
    warnings.push("MANUAL_REVIEW_CANDIDATE");
  }
  if (!passState.pass) warnings.push("PASS_L1_V1_FAILED");

  return {
    extractor_version: COVERAGE_SHEET_EXTRACTOR_VERSION,
    layout,
    layout_features: features,
    confidence: passState.pass ? "high" : "low",
    pass_l1_v1: passState.pass,
    pass_criteria: PASS_CRITERIA_ID,
    passing_row_count: passState.passing_row_count,
    row_count: rows.length,
    rows,
    warnings,
    ocr_text_length: variants.raw.length,
    shadow_only: true,
  };
}
