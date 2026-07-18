/**
 * KEY insurance screen facts — customer card + current KEY turn only.
 * No separate API / Claude / recommender.
 */
import { resolvePolicyPremium } from "./resolvePolicyPremium.js";

export const KEY_TURN_MIRROR_EMPTY = "\uC544\uC9C1 \uC774 \uB300\uD654\uC5D0\uC11C \uD655\uC778\uB41C \uB0B4\uC6A9\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.";

/** Left-rail honesty: auto-lookup is not ready; upload only (no fake auth CTA). */
export const KEY_INSURANCE_UPLOAD_GUIDANCE =
  "현재는 KEY가 보험계약을 자동으로 불러오는 연결이 아직 준비되지 않았습니다.\n" +
  "보험증권·보장내역서 또는 내보험다보여 조회자료를 올려주시면, KEY가 전체 계약을 정리하고 부족하거나 겹치는 보장을 확인해 드릴게요.\n" +
  "자동조회 연동이 준비되면 본인인증과 동의만으로 KEY가 직접 보험계약을 불러오게 됩니다.";

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
