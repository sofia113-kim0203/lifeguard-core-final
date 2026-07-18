/**
 * KEY insurance screen facts — customer card + current KEY turn only.
 * No separate API / Claude / recommender.
 * Also hosts read-only industry coverage baseline comparison (display only).
 */
import { resolvePolicyPremium } from "./resolvePolicyPremium.js";
import {
  KEY_INDUSTRY_COVERAGE_BASELINE_ITEMS,
  KEY_INDUSTRY_COVERAGE_BASELINE_VERSION,
  KEY_INDUSTRY_COVERAGE_BASELINE_AS_OF,
} from "./keyIndustryCoverageBaselineTable.js";

export const KEY_TURN_MIRROR_EMPTY = "\uC544\uC9C1 \uC774 \uB300\uD654\uC5D0\uC11C \uD655\uC778\uB41C \uB0B4\uC6A9\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.";

/** Left-rail honesty: auto-lookup is not ready; upload only (no fake auth CTA). */
export const KEY_INSURANCE_UPLOAD_GUIDANCE_SHORT =
  "현재는 KEY가 보험계약을 자동으로 불러오는 연결이 아직 준비되지 않았습니다.\n" +
  "보험자료를 올려주시면 KEY가 전체 계약을 정리해 드립니다.";

export const KEY_INSURANCE_UPLOAD_GUIDANCE_DETAIL =
  "현재는 KEY가 보험계약을 자동으로 불러오는 연결이 아직 준비되지 않았습니다.\n" +
  "보험증권·보장내역서 또는 내보험다보여 조회자료를 올려주시면, KEY가 전체 계약을 정리하고 부족하거나 겹치는 보장을 확인해 드릴게요.\n" +
  "자동조회 연동이 준비되면 본인인증과 동의만으로 KEY가 직접 보험계약을 불러오게 됩니다.";

/** Full guidance (regression / prompt honesty). */
export const KEY_INSURANCE_UPLOAD_GUIDANCE = KEY_INSURANCE_UPLOAD_GUIDANCE_DETAIL;

export function sumConfirmedMonthlyPremium(policies = []) {
  let sum = 0;
  let has = false;
  for (const row of Array.isArray(policies) ? policies : []) {
    if (row?.status !== "\uD655\uC778\uB428") continue;
    const numeric = Number(row?.monthly_premium);
    if (!Number.isFinite(numeric) || numeric <= 0) continue;
    sum += numeric;
    has = true;
  }
  return has ? sum : null;
}

const INSURANCE_TURN_RE =
  /\uBCF4\uD5D8|\uACC4\uC57D|\uBCF4\uC7A5|\uBCF4\uD5D8\uB8CC|\uC9C4\uB2E8\uBE44|\uC2E4\uC190|\uC554|\uB0A9\uC785|\uC99D\uAD8C|\uD2B9\uC57D|\uBCF4\uD5D8\uC0AC|\uC0C1\uD488\uBA85|\uD655\uC778\uB428|\uBBF8\uD655\uC778|\uD655\uC778\\s*\uD544\uC694/;

export function isRetiredPolicyRow(policy = null) {
  if (!policy || typeof policy !== "object") return true;
  const summary =
    policy.coverage_summary && typeof policy.coverage_summary === "object"
      ? policy.coverage_summary
      : {};
  const retiredReason = String(summary.retired_reason ?? policy.retired_reason ?? "").trim();
  if (retiredReason) return true;
  if (policy.deleted_at != null && policy.deleted_at !== "") return true;
  if (policy.is_active === false && String(policy.policy_status ?? "").includes("retired")) {
    return true;
  }
  return false;
}

export function buildMyInsuranceStatus(policies = []) {
  const rows = Array.isArray(policies) ? policies : [];
  const visible = [];
  for (const policy of rows) {
    if (isRetiredPolicyRow(policy)) continue;
    const insurer = String(policy.insurer_name ?? "").trim() || null;
    const product = String(policy.product_name ?? "").trim() || null;
    const premium = resolvePolicyPremium(policy);
    const hasCore = Boolean(insurer || product);
    if (!hasCore && premium == null) continue;
    const confirmed = Boolean(insurer && (product || premium != null));
    visible.push({
      id: String(policy.id ?? ""),
      insurer_name: insurer,
      product_name: product,
      monthly_premium: premium,
      status: confirmed ? "\uD655\uC778\uB428" : "\uD655\uC778 \uD544\uC694",
    });
  }
  const confirmedCount = visible.filter((r) => r.status === "\uD655\uC778\uB428").length;
  const needsCount = visible.filter((r) => r.status === "\uD655\uC778 \uD544\uC694").length;
  return {
    policies: visible,
    confirmedCount,
    needsCount,
    totalCount: visible.length,
  };
}

export function formatWonMonthly(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return `\uC6D4 ${Math.round(numeric).toLocaleString("ko-KR")}\uC6D0`;
}

function summarizeKeyJudgment(answerText = "") {
  const text = String(answerText ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const parts = text.split(/(?<=[.。!?？])\s+/).filter(Boolean);
  const summary = parts.slice(0, 2).join(" ").trim();
  if (!summary) return null;
  return summary.length > 220 ? `${summary.slice(0, 217)}\u2026` : summary;
}

function extractLinesByPattern(answerText, pattern) {
  const text = String(answerText ?? "");
  if (!text.trim()) return [];
  const lines = text
    .split(/\n+/)
    .map((line) => line.replace(/^[-*\u2022]\s*/, "").trim())
    .filter(Boolean);
  const out = [];
  for (const line of lines) {
    if (pattern.test(line) && !out.includes(line)) out.push(line);
  }
  return out.slice(0, 8);
}

function factsFromVisualBlocks(visualBlocks = []) {
  const confirmed = [];
  const needs = [];
  const blocks = Array.isArray(visualBlocks) ? visualBlocks : [];
  for (const block of blocks) {
    const title = String(block?.title ?? block?.block_title ?? "").trim();
    const rows = Array.isArray(block?.rows) ? block.rows : [];
    for (const row of rows) {
      const label = String(row?.label ?? row?.[0] ?? "").trim();
      const value = String(row?.value ?? row?.[1] ?? row?.status ?? "").trim();
      const cell = [label, value].filter(Boolean).join(": ");
      if (!cell) continue;
      if (/\uBBF8\uD655\uC778|\uD655\uC778\s*\uD544\uC694|\uC544\uC9C1/.test(cell) || value === "\u2014" || value === "-") {
        if (!needs.includes(cell)) needs.push(cell);
      } else if (value) {
        const item = title ? `${title} \u00B7 ${cell}` : cell;
        if (!confirmed.includes(item)) confirmed.push(item);
      }
    }
    const cells = Array.isArray(block?.cells) ? block.cells : [];
    for (const cell of cells) {
      const t = String(cell?.text ?? cell?.value ?? "").trim();
      if (!t) continue;
      if (/\uBBF8\uD655\uC778|\uD655\uC778\s*\uD544\uC694|\uC544\uC9C1/.test(t)) {
        if (!needs.includes(t)) needs.push(t);
      } else if (!confirmed.includes(t)) {
        confirmed.push(t);
      }
    }
  }
  return { confirmed: confirmed.slice(0, 8), needs: needs.slice(0, 8) };
}

function cardFactsMentionedInAnswer(answerText, insuranceStatus) {
  const text = String(answerText ?? "");
  const confirmed = [];
  const needs = [];
  for (const row of insuranceStatus.policies ?? []) {
    const insurer = row.insurer_name ?? "";
    const product = row.product_name ?? "";
    const mentioned =
      (insurer && text.includes(insurer)) || (product && text.includes(product));
    if (!mentioned) continue;
    const premiumLabel = formatWonMonthly(row.monthly_premium);
    const label = [insurer, product, premiumLabel].filter(Boolean).join(" \u00B7 ");
    if (!label) continue;
    if (row.status === "\uD655\uC778\uB428") confirmed.push(label);
    else needs.push(label);
  }
  return { confirmed, needs };
}

export function buildKeyTurnMirror({
  answerText = "",
  visualBlocks = [],
  policies = [],
} = {}) {
  const text = String(answerText ?? "").trim();
  const blocks = Array.isArray(visualBlocks) ? visualBlocks : [];
  const insuranceStatus = buildMyInsuranceStatus(policies);
  const insuranceTurn =
    blocks.length > 0 || (text && INSURANCE_TURN_RE.test(text));

  if (!insuranceTurn || !text) {
    return {
      empty: true,
      emptyMessage: KEY_TURN_MIRROR_EMPTY,
      judgment: null,
      confirmed: [],
      needsConfirmation: [],
    };
  }

  const fromBlocks = factsFromVisualBlocks(blocks);
  const fromAnswerConfirmed = extractLinesByPattern(
    text,
    /\uD655\uC778\uB428|\uD655\uC778\uD55C|\uC11C\uB958\uC5D0\uC11C|\uC6D4\s*[\d,]+\uC6D0|\uC9C4\uB2E8\uBE44/,
  ).filter((line) => !/\uBBF8\uD655\uC778|\uD655\uC778\s*\uD544\uC694|\uC544\uC9C1\s*\uD655\uC778/.test(line));
  const fromAnswerNeeds = extractLinesByPattern(
    text,
    /\uBBF8\uD655\uC778|\uD655\uC778\s*\uD544\uC694|\uC544\uC9C1\s*\uD655\uC778|\uD568\uAED8\s*\uBCF4\uBA74|\uB354\s*\uD544\uC694/,
  );
  const fromCard = cardFactsMentionedInAnswer(text, insuranceStatus);

  const confirmed = [
    ...fromBlocks.confirmed,
    ...fromCard.confirmed,
    ...fromAnswerConfirmed,
  ].filter((item, index, arr) => arr.indexOf(item) === index).slice(0, 8);

  const needsConfirmation = [
    ...fromBlocks.needs,
    ...fromCard.needs,
    ...fromAnswerNeeds,
  ].filter((item, index, arr) => arr.indexOf(item) === index).slice(0, 8);

  const judgment = summarizeKeyJudgment(text);
  const empty = !judgment && confirmed.length === 0 && needsConfirmation.length === 0;

  return {
    empty,
    emptyMessage: KEY_TURN_MIRROR_EMPTY,
    judgment,
    confirmed,
    needsConfirmation,
  };
}

/** Baseline status tokens — display only; never rewrite KEY answers. */
export const BASELINE_STATUS = {
  MET: "충족",
  SHORT: "미달",
  NEED: "확인 필요",
  OVERLAP: "중복 점검",
  TABLE_PENDING: "기준 확인 중",
};

export const BASELINE_STATUS_COLOR = {
  [BASELINE_STATUS.MET]: "#167C6A",
  [BASELINE_STATUS.SHORT]: "#C87516",
  [BASELINE_STATUS.NEED]: "#64748B",
  [BASELINE_STATUS.OVERLAP]: "#7656C8",
  [BASELINE_STATUS.TABLE_PENDING]: "#64748B",
};

export const BASELINE_STATUS_BG = {
  [BASELINE_STATUS.MET]: "#EAF7F3",
  [BASELINE_STATUS.SHORT]: "#FFF4E5",
  [BASELINE_STATUS.NEED]: "#F1F5F9",
  [BASELINE_STATUS.OVERLAP]: "#F1EDFF",
  [BASELINE_STATUS.TABLE_PENDING]: "#F1F5F9",
};

function normalizeCoverageName(name = "") {
  return String(name ?? "")
    .replace(/\s+/g, "")
    .replace(/[()[\]【】]/g, "")
    .toLowerCase();
}

function parseCoverageAmount(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  const raw = String(value).replace(/,/g, "").trim();
  if (!raw) return null;
  const man = raw.match(/^(\d+(?:\.\d+)?)\s*만\s*원?$/);
  if (man) return Math.round(Number(man[1]) * 10000);
  const cheon = raw.match(/^(\d+(?:\.\d+)?)\s*천\s*만\s*원?$/);
  if (cheon) return Math.round(Number(cheon[1]) * 10000000);
  const digits = raw.replace(/[^\d.]/g, "");
  const n = Number(digits);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * Map a verified rider/coverage name to a baseline item.
 * Narrow benefits must not map into wider disease families.
 * @returns {string|null} baseline item id or null
 */
export function classifyCoverageToBaselineItem(coverageName = "") {
  const n = normalizeCoverageName(coverageName);
  if (!n) return null;

  // Exclude micro/similar cancer from general cancer total.
  if (/유사암|소액암|경계성|제자리암|상피내/.test(n) && !/일반암/.test(n)) {
    return null;
  }
  if (/일반암|암진단/.test(n) || (/암/.test(n) && /진단/.test(n) && !/유사|소액|경계|제자리|상피내/.test(n))) {
    return "cancer_diagnosis";
  }

  // Brain: only broad 뇌혈관질환 — not 뇌출혈 / 뇌졸중 alone.
  if (/뇌출혈|뇌경색|뇌졸중/.test(n) && !/뇌혈관/.test(n)) {
    return null;
  }
  if (/뇌혈관/.test(n) && /진단|담보|보험금|급여/.test(n)) {
    return "cerebrovascular_diagnosis";
  }
  if (n === "뇌혈관질환" || n === "뇌혈관질환진단비" || /^뇌혈관질환진단/.test(n)) {
    return "cerebrovascular_diagnosis";
  }

  // Heart: only broad 허혈성심장질환 — not 급성심근경색 alone.
  if (/급성심근|심근경색/.test(n) && !/허혈성심장/.test(n)) {
    return null;
  }
  if (/허혈성심장/.test(n)) {
    return "ischemic_heart_diagnosis";
  }

  if (/간병|간호간병|요양간병/.test(n)) return "caregiving";
  if (/입원일당|입원급여|질병입원|상해입원/.test(n) || (/입원/.test(n) && /일당|하루|1일/.test(n))) {
    return "hospital_daily";
  }
  if (/수술/.test(n)) return "surgery";
  if (/항암|방사선|표적|면역항암|로봇수술|주요치료/.test(n)) return "major_treatment";

  return null;
}

function collectRiderRowsFromPolicy(policy) {
  const summary =
    policy?.coverage_summary && typeof policy.coverage_summary === "object"
      ? policy.coverage_summary
      : {};
  const rows = [];
  if (Array.isArray(summary.rider_details)) {
    for (const detail of summary.rider_details) {
      if (detail && typeof detail === "object") rows.push(detail);
    }
  }
  if (Array.isArray(summary.riders)) {
    for (const rider of summary.riders) {
      if (rider && typeof rider === "object") rows.push(rider);
    }
  }
  if (summary.coverage_name != null || summary.coverage_amount != null) {
    rows.push({
      coverage_name: summary.coverage_name,
      rider_name: summary.rider_name,
      coverage_amount: summary.coverage_amount,
    });
  }
  return rows;
}

/**
 * Collect verified coverage rows from active (non-retired) policies.
 * Dedupes same policy + alias + amount once.
 */
export function collectVerifiedCoverageRows(policies = []) {
  const out = [];
  const seen = new Set();
  for (const policy of Array.isArray(policies) ? policies : []) {
    if (isRetiredPolicyRow(policy)) continue;
    const policyId = String(policy.id ?? "");
    const insurer = String(policy.insurer_name ?? "").trim();
    const product = String(policy.product_name ?? "").trim();
    for (const row of collectRiderRowsFromPolicy(policy)) {
      const name = String(row.coverage_name ?? row.rider_name ?? row.name ?? "").trim();
      if (!name) continue;
      const amount = parseCoverageAmount(row.coverage_amount ?? row.amount);
      const itemId = classifyCoverageToBaselineItem(name);
      const dedupeKey = `${policyId}::${normalizeCoverageName(name)}::${amount ?? "na"}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      out.push({
        policy_id: policyId,
        insurer_name: insurer || null,
        product_name: product || null,
        coverage_name: name,
        coverage_amount: amount,
        baseline_item_id: itemId,
        has_amount: amount != null,
      });
    }
  }
  return out;
}

function formatWonAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}

/** Customer-facing manwon label (e.g. 8,000만원). Falls back to 원. */
export function formatManwonAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n % 10000 === 0) {
    return `${Math.round(n / 10000).toLocaleString("ko-KR")}만원`;
  }
  return formatWonAmount(n);
}

function formatIndustryRange(item) {
  if (item.industry_range_low == null || item.industry_range_high == null) {
    return "기준 확인 중";
  }
  return `${formatManwonAmount(item.industry_range_low)}~${formatManwonAmount(item.industry_range_high)}`;
}

/** True when industry range/limit numbers are present — only then may UI show bars. */
export function isIndustryBaselineTableReady(item = null) {
  if (!item || typeof item !== "object") return false;
  return (
    item.industry_range_low != null &&
    item.industry_range_high != null &&
    Number.isFinite(Number(item.industry_range_low)) &&
    Number.isFinite(Number(item.industry_range_high))
  );
}

/** Pure lump-sum compare — used by UI builder and unit tests. */
export function evaluateLumpSumBaselineStatus(sumAmount, low, high) {
  if (low == null || high == null || !Number.isFinite(Number(low)) || !Number.isFinite(Number(high))) {
    return BASELINE_STATUS.TABLE_PENDING;
  }
  if (sumAmount == null || !Number.isFinite(Number(sumAmount))) {
    return BASELINE_STATUS.NEED;
  }
  const n = Number(sumAmount);
  const lo = Number(low);
  const hi = Number(high);
  if (n < lo) return BASELINE_STATUS.SHORT;
  if (n > hi) return BASELINE_STATUS.OVERLAP;
  return BASELINE_STATUS.MET;
}

function decideBaselineStatus({ item, matchedRows, sumAmount, compareMode }) {
  const tableReady =
    item.industry_range_low != null &&
    item.industry_range_high != null &&
    Number.isFinite(Number(item.industry_range_low)) &&
    Number.isFinite(Number(item.industry_range_high));

  if (!tableReady) {
    return {
      status: BASELINE_STATUS.TABLE_PENDING,
      reason: "업계 누적/일반 구간 기준자료가 아직 확보되지 않았습니다. 공개 상품 가입금액을 한도로 쓰지 않습니다.",
    };
  }

  if (compareMode !== "lump_sum") {
    if (!matchedRows.length) {
      return {
        status: BASELINE_STATUS.NEED,
        reason: "해당 담보의 일당·일수·범위·조건이 충분히 확인되지 않았습니다. 미확인을 미달로 보지 않습니다.",
      };
    }
    const structuredReady = matchedRows.every((r) => r.has_amount);
    if (!structuredReady) {
      return {
        status: BASELINE_STATUS.NEED,
        reason: "금액·일수·범위 중 확인되지 않은 조건이 있어 확인 필요입니다.",
      };
    }
    return {
      status: BASELINE_STATUS.NEED,
      reason: "구조화 비교에 필요한 일수·면책·범위 조건이 기준표와 함께 더 확인되어야 합니다.",
    };
  }

  if (!matchedRows.length) {
    return {
      status: BASELINE_STATUS.NEED,
      reason: "해당 담보 금액이 verified로 확인되지 않았습니다. 미확인은 0원·미가입·미달이 아닙니다.",
    };
  }

  const unclear = matchedRows.some((r) => !r.has_amount);
  if (unclear || sumAmount == null) {
    return {
      status: BASELINE_STATUS.NEED,
      reason: "포함된 특약 중 금액이 확인되지 않은 항목이 있습니다.",
    };
  }

  const low = Number(item.industry_range_low);
  const high = Number(item.industry_range_high);
  const status = evaluateLumpSumBaselineStatus(sumAmount, low, high);
  if (status === BASELINE_STATUS.SHORT) {
    return {
      status,
      reason: `확인된 합산 ${formatWonAmount(sumAmount)}이 업계 일반 구간 하단(${formatWonAmount(low)}) 미만입니다.`,
    };
  }
  if (status === BASELINE_STATUS.OVERLAP) {
    return {
      status,
      reason: `확인된 합산 ${formatWonAmount(sumAmount)}이 업계 일반 구간 상단(${formatWonAmount(high)})을 초과해 중복 점검이 필요합니다.`,
    };
  }
  return {
    status: BASELINE_STATUS.MET,
    reason: `확인된 합산 ${formatWonAmount(sumAmount)}이 업계 일반 구간 안에 있습니다.`,
  };
}
/**
 * Build read-only industry baseline comparison for the right rail.
 * Never invents industry numbers; never treats unknown as shortfall.
 */
export function buildIndustryCoverageBaseline(policies = []) {
  const verifiedRows = collectVerifiedCoverageRows(policies);
  const items = KEY_INDUSTRY_COVERAGE_BASELINE_ITEMS.map((item) => {
    const matched = verifiedRows.filter((r) => r.baseline_item_id === item.id);
    let sumAmount = null;
    if (item.compareMode === "lump_sum") {
      let sum = 0;
      let has = false;
      for (const row of matched) {
        if (row.coverage_amount == null) continue;
        sum += row.coverage_amount;
        has = true;
      }
      sumAmount = has ? sum : null;
    }

    const decision = decideBaselineStatus({
      item,
      matchedRows: matched,
      sumAmount,
      compareMode: item.compareMode,
    });

    let currentDisplay = "확인 필요";
    if (item.compareMode === "lump_sum") {
      currentDisplay = sumAmount != null ? formatManwonAmount(sumAmount) : "확인 필요";
    } else if (matched.length) {
      currentDisplay = item.compareMode === "daily_structured" ? "일당·일수 확인 필요" : "범위·조건 확인 필요";
    }

    const tableReady = isIndustryBaselineTableReady(item);

    return {
      id: item.id,
      label: item.label,
      shortLabel: item.shortLabel,
      definition: item.definition,
      unit: item.unit,
      compareMode: item.compareMode,
      currentAmount: sumAmount,
      currentDisplay,
      industryRangeDisplay: formatIndustryRange(item),
      industry_range_low: item.industry_range_low,
      industry_range_high: item.industry_range_high,
      industry_cumulative_limit: item.industry_cumulative_limit,
      apply_conditions: item.apply_conditions,
      source: item.source,
      source_kind: item.source_kind,
      sourceDisplay: item.source_kind === "none" ? "미확보" : item.source,
      as_of: item.as_of,
      version: item.version,
      status: decision.status,
      statusColor: BASELINE_STATUS_COLOR[decision.status] || BASELINE_STATUS_COLOR[BASELINE_STATUS.NEED],
      statusBg: BASELINE_STATUS_BG[decision.status] || BASELINE_STATUS_BG[BASELINE_STATUS.NEED],
      tableReady,
      /** Progress bars only when industry numbers exist. */
      showCompareBar: tableReady,
      reason: decision.reason,
      includedCoverages: matched.map((row) => ({
        ...row,
        coverage_amount_display:
          row.coverage_amount != null ? formatManwonAmount(row.coverage_amount) : null,
      })),
      unclearParts: matched.filter((r) => !r.has_amount).map((r) => r.coverage_name),
    };
  });

  const counts = {
    met: 0,
    short: 0,
    need: 0,
    overlap: 0,
    tablePending: 0,
  };
  for (const row of items) {
    if (row.status === BASELINE_STATUS.MET) counts.met += 1;
    else if (row.status === BASELINE_STATUS.SHORT) counts.short += 1;
    else if (row.status === BASELINE_STATUS.OVERLAP) counts.overlap += 1;
    else if (row.status === BASELINE_STATUS.TABLE_PENDING) counts.tablePending += 1;
    else counts.need += 1;
  }

  return {
    title: "KEY 업계누적 보장 기준선",
    version: KEY_INDUSTRY_COVERAGE_BASELINE_VERSION,
    as_of: KEY_INDUSTRY_COVERAGE_BASELINE_AS_OF,
    counts,
    items,
  };
}

export function buildPolicyDetailForDrawer(policy = null) {
  if (!policy || typeof policy !== "object") return null;
  if (isRetiredPolicyRow(policy)) return null;
  const premium = resolvePolicyPremium(policy);
  const coverages = collectVerifiedCoverageRows([policy]);
  return {
    kind: "policy",
    title: String(policy.insurer_name ?? "보험사 미확인"),
    subtitle: String(policy.product_name ?? "상품명 확인 필요"),
    monthly_premium: premium,
    monthly_premium_display: formatWonMonthly(premium) || "월 보험료 확인 필요",
    coverages,
    note: "삭제·retired 계약은 표시하지 않습니다.",
  };
}

export function buildBaselineDetailForDrawer(baselineItem = null) {
  if (!baselineItem || typeof baselineItem !== "object") return null;
  return {
    kind: "baseline",
    title: baselineItem.label,
    subtitle: baselineItem.status,
    ...baselineItem,
  };
}
