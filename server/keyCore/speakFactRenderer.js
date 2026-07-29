/**
 * Slice 5 — Fact Renderer (유일 숫자·건수·보험료·보험사·상품 문자열 생성점).
 */
import {
  formatInsurerName,
  formatPolicyPremium,
  formatProductName,
} from "../../src/lib/policyExplorer.js";

function formatPremiumFromRaw(raw) {
  if (raw == null) return null;
  const num = Number(raw);
  if (!Number.isFinite(num)) return null;
  if (num >= 10000) {
    const man = Math.floor(num / 10000);
    const cheon = Math.floor((num % 10000) / 1000);
    return cheon > 0 ? `${man}만${cheon}천 원` : `${man}만 원`;
  }
  return `${num.toLocaleString("ko-KR")}원`;
}

function factMap(factsSpoken = []) {
  const map = new Map();
  for (const row of factsSpoken) {
    if (row?.fact_id) map.set(row.fact_id, row.value);
  }
  return map;
}

/**
 * Render spoken facts to customer-facing text. Numbers come from facts_spoken only.
 * @param {Array<{ fact_id: string, value: string, source?: string }>} factsSpoken
 * @param {object[]} [policies] — display names only; counts from facts_spoken
 */
export function renderFactsSpokenBlock(factsSpoken = [], policies = []) {
  if (!factsSpoken.length) return null;

  const map = factMap(factsSpoken);
  const parts = [];

  const countRaw = map.get("policy_count");
  const count = countRaw != null ? Number(countRaw) : null;
  const insurerVal = map.get("insurer");
  const productVal = map.get("product");
  const premiumRaw = map.get("monthly_premium");

  const policy = policies[0] ?? null;
  const insurer =
    insurerVal ??
    (policy ? formatInsurerName(policy) : null);
  const product =
    productVal ??
    (policy ? formatProductName(policy) : null);
  const premium =
    premiumRaw != null
      ? formatPremiumFromRaw(premiumRaw)
      : policy
        ? (() => {
            const p = formatPolicyPremium(policy);
            return p === "확인 필요" || p === "보험료미제공" ? null : p;
          })()
        : null;

  if (count != null && Number.isFinite(count)) {
    if (count === 1) {
      parts.push("현재 확인되는 보험은 1건입니다.");
    } else if (count > 1) {
      parts.push(`등록된 계약은 ${count}건입니다.`);
    }
  }

  if (insurer && product) {
    if (count != null && count > 1 && premium) {
      parts.push(`그중 ${insurer} ${product}의 월 납입액 ${premium}이 확인돼 있어요.`);
      parts.push(`${count}건 전체 월 납입 합계는 아직 정리 중이에요.`);
    } else {
      const premiumPart = premium ? `, 월 ${premium}` : "";
      parts.push(`${insurer} ${product}${premiumPart}이 확인됩니다.`);
    }
  } else if (insurer) {
    parts.push(`${insurer} 보험이 확인됩니다.`);
  }

  if (!parts.length) return null;
  return parts.join(" ");
}

/**
 * Values that must appear in answerText for alignment gate.
 */
export function extractFactTextMarkers(factsSpoken = []) {
  const map = factMap(factsSpoken);
  const markers = [];

  const count = map.get("policy_count");
  if (count != null) {
    const n = Number(count);
    if (Number.isFinite(n)) {
      markers.push({ fact_id: "policy_count", patterns: buildCountPatterns(n) });
    }
  }

  const insurer = map.get("insurer");
  if (insurer) {
    markers.push({ fact_id: "insurer", patterns: [String(insurer)] });
  }

  const product = map.get("product");
  if (product) {
    const short = String(product).replace(/보험$/, "").trim();
    markers.push({
      fact_id: "product",
      patterns: [String(product), short].filter(Boolean),
    });
  }

  const premiumRaw = map.get("monthly_premium");
  if (premiumRaw != null) {
    const formatted = formatPremiumFromRaw(premiumRaw);
    const num = Number(premiumRaw);
    const patterns = [formatted, String(premiumRaw)];
    if (Number.isFinite(num)) {
      patterns.push(num.toLocaleString("ko-KR"));
      if (num >= 1000) patterns.push(String(Math.floor(num / 1000)));
    }
    markers.push({ fact_id: "monthly_premium", patterns: patterns.filter(Boolean) });
  }

  return markers;
}

function buildCountPatterns(n) {
  const patterns = [`${n}건`];
  if (n === 1) patterns.push("1건");
  return patterns;
}

export { formatPremiumFromRaw };
