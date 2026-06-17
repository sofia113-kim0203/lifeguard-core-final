/** Phase 31-C-P0 — Policy Explorer display helpers (no inference). */

import { resolvePolicyPremium } from "./resolvePolicyPremium.js";

export const RIDER_UNAVAILABLE_MESSAGE =
  "아직 특약 정보가 구조화되지 않았습니다.\n보장내역서 또는 증권을 업로드하면 세부 특약까지 분석할 수 있습니다.";

const POLICY_SOURCE_LABELS = {
  signup: "가입 입력",
  upload_extract: "문서 추출(OCR)",
  manual: "직접 입력",
  import: "데이터 가져오기",
};

const OCR_CONFIDENCE_KEYS = ["ocr_confidence", "extraction_confidence", "confidence"];

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function formatPolicySource(source) {
  const key = normalizeText(source);
  if (!key) return "확인 필요";
  return POLICY_SOURCE_LABELS[key] ?? key;
}

export function formatPolicyStatus(policy) {
  if (policy?.is_active === false) return "해지";
  const status = normalizeText(policy?.policy_status);
  if (status) return status;
  if (policy?.is_active === true) return "유지";
  return "확인 필요";
}

export function formatPolicyType(policy) {
  const type = normalizeText(policy?.policy_type);
  return type || "확인 필요";
}

export function formatPolicyPremium(policy) {
  const premium = resolvePolicyPremium(policy);
  if (premium == null) return "확인 필요";
  return `${premium.toLocaleString("ko-KR")}원`;
}

export function formatOcrConfidence(policy) {
  const summary = policy?.coverage_summary;
  if (summary && typeof summary === "object" && !Array.isArray(summary)) {
    for (const key of OCR_CONFIDENCE_KEYS) {
      const value = summary[key];
      if (value == null || value === "") continue;
      if (typeof value === "number") {
        if (value <= 1) return `${Math.round(value * 100)}%`;
        return `${value}%`;
      }
      const text = normalizeText(value);
      if (text) return text;
    }
  }
  return "확인 필요";
}

function isStructuredRiderItem(item) {
  if (item == null) return false;
  if (typeof item === "string") return Boolean(normalizeText(item));
  if (typeof item === "object") {
    const label =
      item.normalized_name ??
      item.name ??
      item.rider_name ??
      item.label ??
      item.coverage_line;
    return Boolean(normalizeText(label));
  }
  return false;
}

export function hasStructuredRiders(policy) {
  const riders = policy?.coverage_summary?.riders;
  if (!Array.isArray(riders) || riders.length === 0) return false;
  return riders.some(isStructuredRiderItem);
}

export function formatRiderLines(policy) {
  if (!hasStructuredRiders(policy)) return [];
  return policy.coverage_summary.riders
    .map((item) => {
      if (typeof item === "string") {
        const text = normalizeText(item);
        return text ? { label: text, detail: null } : null;
      }
      if (item && typeof item === "object") {
        const label = normalizeText(
          item.normalized_name ?? item.name ?? item.rider_name ?? item.label ?? item.coverage_line,
        );
        if (!label) return null;
        const amount = item.amount != null ? normalizeText(item.amount) : "";
        const detail = amount ? `가입금액 ${amount}` : null;
        return { label, detail };
      }
      return null;
    })
    .filter(Boolean);
}

export function mergePolicyRecords(dashboardPolicies = [], unifiedPolicies = []) {
  const byId = new Map();

  for (const policy of unifiedPolicies ?? []) {
    if (!policy?.id) continue;
    byId.set(policy.id, { ...policy });
  }

  for (const policy of dashboardPolicies ?? []) {
    if (!policy?.id) continue;
    const existing = byId.get(policy.id) ?? {};
    byId.set(policy.id, { ...existing, ...policy });
  }

  return Array.from(byId.values());
}

export function computePolicyExplorerStats(policies = []) {
  const list = policies ?? [];
  const totalCount = list.length;
  let premiumKnownCount = 0;
  let riderStructuredCount = 0;
  let premiumTotal = 0;
  let premiumUnknownCount = 0;

  for (const policy of list) {
    const premium = resolvePolicyPremium(policy);
    if (premium != null) {
      premiumKnownCount += 1;
      premiumTotal += premium;
    } else {
      premiumUnknownCount += 1;
    }
    if (hasStructuredRiders(policy)) {
      riderStructuredCount += 1;
    }
  }

  return {
    totalCount,
    premiumKnownCount,
    premiumUnknownCount,
    riderStructuredCount,
    premiumTotal,
  };
}

export function formatInsurerName(policy) {
  return normalizeText(policy?.insurer_name) || "확인 필요";
}

export function formatProductName(policy) {
  return normalizeText(policy?.product_name) || "확인 필요";
}
