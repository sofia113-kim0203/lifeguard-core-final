/**
 * Slice 6 — KEY Voice Visual Block Gate (allowed facts · text consistency · neutral coverage table).
 */
import { jailbreakAudit, recommendationOrTerminationRisk } from "./keyVoiceGate.js";

const COVERAGE_GAP_FORBIDDEN = [
  /부족/,
  /위험/,
  /공백/,
  /취약/,
  /심각/,
  /[\u{1F300}-\u{1FAFF}]/u,
  /🚨/,
  /❌/,
];

const COVERAGE_GAP_ALLOWED_STATUS =
  /^(?:확인됨|확인\s*필요|자료\s*필요|미확인|다음\s*확인(?:\s*항목)?|점검\s*필요)$/;

const PREMIUM_ALT_FORMAT_RE = /\d{1,3}(?:,\d{3})+\s*원|\d{5,}\s*원/;

function serializeBlock(block) {
  return JSON.stringify(block ?? {});
}

function extractCellText(block) {
  const parts = [];
  if (block.rows) {
    for (const row of block.rows) {
      for (const cell of row) parts.push(String(cell ?? ""));
    }
  }
  if (block.steps) {
    for (const step of block.steps) {
      parts.push(String(step.label ?? ""));
      parts.push(String(step.move ?? ""));
    }
  }
  parts.push(String(block.title ?? ""));
  return parts.join(" ");
}

function normalizeDigits(text = "") {
  return String(text).replace(/[^\d]/g, "");
}

function canonicalPremiumDisplay(directive) {
  const display = directive?.allowed_fact_tokens?.monthly_premium_display;
  if (!display) return null;
  return display.startsWith("월 ") ? display : `월 ${display}`;
}

function blockUsesCanonicalPremium(block, canonical) {
  const blob = extractCellText(block);
  const compact = blob.replace(/\s/g, "");
  const canonCompact = canonical.replace(/\s/g, "");
  return compact.includes(canonCompact) || compact.includes(canonCompact.replace(/^월/, ""));
}

function assertTextBlockPremiumConsistency(text, block, directive) {
  const canonical = canonicalPremiumDisplay(directive);
  if (!canonical) return { ok: true, reason: null };

  const cellText = extractCellText(block);
  if (
    (block.type === "premium_summary_table" || block.type === "policy_count_summary") &&
    PREMIUM_ALT_FORMAT_RE.test(cellText) &&
    !blockUsesCanonicalPremium(block, canonical)
  ) {
    return { ok: false, reason: "premium_non_canonical_format" };
  }

  const raw = directive?.allowed_fact_tokens?.monthly_premium_raw;
  const textMentionsPremium =
    text.includes(canonical.replace(/\s/g, "")) ||
    (raw && text.includes(String(raw))) ||
    /4만5천|월\s*\d|만\s*\d\s*원/.test(text);

  const blockMentionsPremium = blockUsesCanonicalPremium(block, canonical);
  const blockAltFormat = PREMIUM_ALT_FORMAT_RE.test(extractCellText(block));

  if (blockMentionsPremium && blockAltFormat && !blockUsesCanonicalPremium(block, canonical)) {
    return { ok: false, reason: "premium_format_cross_mismatch" };
  }

  if (textMentionsPremium && blockMentionsPremium) {
    if (!blockUsesCanonicalPremium(block, canonical)) {
      return { ok: false, reason: "premium_display_mismatch" };
    }
    const textDigits = normalizeDigits(text);
    const blockDigits = normalizeDigits(extractCellText(block));
    if (raw && textDigits.includes(String(raw)) && blockDigits && !blockDigits.includes(String(raw))) {
      if (blockAltFormat && !blockUsesCanonicalPremium(block, canonical)) {
        return { ok: false, reason: "premium_numeric_cross_mismatch" };
      }
    }
  }

  return { ok: true, reason: null };
}

function assertTextBlockPolicyCountConsistency(text, block, directive) {
  const count = directive?.allowed_fact_tokens?.policy_count;
  if (count == null) return { ok: true, reason: null };

  const canonical = `${count}건`;
  const blob = extractCellText(block);
  const textHas = text.includes(canonical) || text.includes(`${count}건`);
  const blockHas = blob.includes(canonical);

  if (textHas && blockHas && !blob.includes(canonical)) {
    return { ok: false, reason: "policy_count_mismatch" };
  }

  if (blockHas && textHas) {
    const altInBlock = /\d+\s*개/.test(blob) && !blob.includes("건");
    if (altInBlock) return { ok: false, reason: "policy_count_unit_mismatch" };
  }

  return { ok: true, reason: null };
}

function assertTextBlockEntityConsistency(text, block, directive) {
  const t = directive?.allowed_fact_tokens ?? {};
  const blob = extractCellText(block);

  for (const [key, label] of [
    ["insurer", "insurer"],
    ["product", "product"],
  ]) {
    const value = t[key];
    if (!value) continue;
    const inBlock = blob.includes(value);
    const inText = text.includes(value);
    if (inBlock && inText && !blob.includes(value)) {
      return { ok: false, reason: `${label}_mismatch` };
    }
  }

  return { ok: true, reason: null };
}

function coverageGapTableCellStrings(block) {
  const cells = [];
  if (block.type === "coverage_gap_table") {
    for (const row of block.rows ?? []) {
      cells.push(String(row[1] ?? "").trim(), String(row[2] ?? "").trim());
    }
  } else if (block.type === "next_steps_card") {
    for (const step of block.steps ?? []) {
      cells.push(String(step.label ?? "").trim(), String(step.move ?? "").trim());
    }
  }
  return cells.filter(Boolean);
}

/** Coverage-neutral vocabulary applies to visual block table/card cells only — never answerText. */
function assertCoverageGapNeutral(block) {
  if (block.type !== "coverage_gap_table" && block.type !== "next_steps_card") {
    return { ok: true, reason: null };
  }

  for (const cell of coverageGapTableCellStrings(block)) {
    for (const re of COVERAGE_GAP_FORBIDDEN) {
      if (re.test(cell)) return { ok: false, reason: `coverage_gap_forbidden:${re.source.slice(0, 20)}` };
    }
  }

  if (block.type === "coverage_gap_table") {
    for (const row of block.rows ?? []) {
      const status = String(row[1] ?? "").trim();
      const next = String(row[2] ?? "").trim();
      if (status && !COVERAGE_GAP_ALLOWED_STATUS.test(status)) {
        return { ok: false, reason: `coverage_gap_status_not_allowed:${status}` };
      }
      if (next && /부족|위험|공백|취약|심각/.test(next)) {
        return { ok: false, reason: "coverage_gap_next_forbidden" };
      }
    }
  }

  return { ok: true, reason: null };
}

function gateSingleBlock(block, directive, text) {
  const reasons = [];
  const serialized = serializeBlock(block);
  const cellText = extractCellText(block);

  const canonical = canonicalPremiumDisplay(directive);
  if (
    canonical &&
    (block.type === "premium_summary_table" || block.type === "policy_count_summary") &&
    PREMIUM_ALT_FORMAT_RE.test(cellText) &&
    !blockUsesCanonicalPremium(block, canonical)
  ) {
    reasons.push("premium_non_canonical_format");
  }

  const jail = jailbreakAudit(directive, cellText);
  if (jail.forbidden_fact_violation) reasons.push("jailbreak_fact");

  const termRisk = recommendationOrTerminationRisk(cellText);
  if (termRisk.recommendation_or_termination_risk) reasons.push("recommendation_or_termination");

  const neutral = assertCoverageGapNeutral(block);
  if (!neutral.ok) reasons.push(neutral.reason);

  const premiumConsistency = assertTextBlockPremiumConsistency(text, block, directive);
  if (!premiumConsistency.ok) reasons.push(premiumConsistency.reason);

  const countConsistency = assertTextBlockPolicyCountConsistency(text, block, directive);
  if (!countConsistency.ok) reasons.push(countConsistency.reason);

  const entityConsistency = assertTextBlockEntityConsistency(text, block, directive);
  if (!entityConsistency.ok) reasons.push(entityConsistency.reason);

  return {
    ok: reasons.length === 0,
    reasons,
    block_type: block.type,
  };
}

/**
 * @param {object} params
 * @param {object[]} params.blocks
 * @param {string} params.text
 * @param {object} params.directive
 */
export function gateKeyVoiceVisualBlocks({ blocks = [], text = "", directive = null } = {}) {
  const accepted = [];
  const omitted = [];

  for (const block of blocks) {
    const result = gateSingleBlock(block, directive, text);
    if (result.ok) {
      accepted.push(block);
    } else {
      omitted.push({
        type: block.type,
        reasons: result.reasons,
      });
    }
  }

  return {
    ok: true,
    accepted,
    omitted,
    accepted_count: accepted.length,
    omitted_count: omitted.length,
  };
}

export {
  assertCoverageGapNeutral,
  assertTextBlockPremiumConsistency,
  gateSingleBlock,
};
