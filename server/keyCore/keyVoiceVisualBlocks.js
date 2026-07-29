/**
 * Slice 6 — KEY Voice Visual Blocks (directive-only · no new facts).
 */
const BLOCK_MAPPING = {
  premium_amount: ["premium_summary_table"],
  premium_burden: ["premium_summary_table", "next_steps_card"],
  premium_reduction: ["premium_summary_table", "next_steps_card"],
  policy_overview: ["policy_count_summary"],
  cancer_coverage: ["coverage_gap_table", "next_steps_card"],
  cancer_direct: ["coverage_gap_table", "next_steps_card"],
  next_step: ["next_steps_card"],
  greeting: [],
  first_visit: [],
  browse: [],
  emotional_support: [],
};

function tokens(directive) {
  return directive?.allowed_fact_tokens ?? {};
}

function representativeContractNote(t) {
  if (t.insurer && t.product) {
    return `${t.insurer} ${t.product} · 대표 계약 기준`;
  }
  return "대표 확인 계약 기준";
}

function totalPremiumPendingNote(t) {
  if (t.policy_count != null && Number(t.policy_count) > 1) {
    return `${t.policy_count}건 합산 · 확인 전`;
  }
  return "등록 계약 전체 · 확인 전";
}

function appendTotalPremiumPendingRow(rows, t) {
  if (t.policy_count == null || Number(t.policy_count) <= 1) return;
  rows.push(["전체 월 납입 합계", "아직 정리 중", totalPremiumPendingNote(t)]);
}

function buildPremiumSummaryTable(directive) {
  const t = tokens(directive);
  const rows = [];
  if (t.policy_count != null) {
    rows.push(["등록 계약 수", `${t.policy_count}건`, "전체 등록 기준"]);
  }
  if (t.monthly_premium_display) {
    rows.push(["대표 확인 계약 납입", `월 ${t.monthly_premium_display}`, representativeContractNote(t)]);
  }
  appendTotalPremiumPendingRow(rows, t);
  if (!rows.length) return null;
  return {
    type: "premium_summary_table",
    title: "확인된 납입 요약",
    columns: ["구분", "확인값", "비고"],
    rows,
  };
}

function buildPolicyCountSummary(directive) {
  const t = tokens(directive);
  const rows = [];
  if (t.policy_count != null) rows.push(["등록 계약 수", `${t.policy_count}건`, "전체 등록 기준"]);
  if (t.insurer) rows.push(["확인 보험사", t.insurer, "대표 계약"]);
  if (t.product) rows.push(["확인 상품", t.product, "대표 계약"]);
  if (t.monthly_premium_display) {
    rows.push(["대표 확인 계약 납입", `월 ${t.monthly_premium_display}`, "대표 계약 기준"]);
  }
  appendTotalPremiumPendingRow(rows, t);
  if (!rows.length) return null;
  return {
    type: "policy_count_summary",
    title: "계약 확인 요약",
    columns: ["항목", "확인값", "비고"],
    rows,
  };
}

function buildCoverageGapTable(directive) {
  const t = tokens(directive);
  const target =
    t.insurer && t.product ? `${t.insurer} ${t.product}` : t.insurer || t.product || "대표 확인 계약";
  const scopeNote =
    t.policy_count != null && Number(t.policy_count) > 1
      ? `${t.policy_count}건 중 대표 계약부터`
      : "대표 계약부터";

  return {
    type: "coverage_gap_table",
    title: "암 보장 점검표",
    subtitle: `아직 담보별 금액 확인 전 · ${scopeNote}`,
    columns: ["보장 항목", "확인 상태", "다음 확인"],
    rows: [
      ["암 진단비", "미확인", `${target} · 진단비 담보 확인`],
      ["암 수술비", "미확인", `${target} · 수술비 담보 확인`],
      ["암 치료비", "미확인", `${target} · 치료비 담보 확인`],
    ],
  };
}

function buildNextStepsCard(directive) {
  const focus = directive?.question_focus ?? "general";
  const steps = [];

  if (focus === "cancer_coverage" || focus === "cancer_direct") {
    steps.push(
      { order: 1, label: "암 진단비 확인", move: "제가 암 진단비 항목부터 짚어볼게요" },
      { order: 2, label: "암 수술비 확인", move: "이어서 수술비 담보를 확인합니다" },
      { order: 3, label: "암 치료비 확인", move: "마지막으로 치료비 보장을 확인합니다" },
    );
  } else if (focus === "premium_burden" || focus === "premium_reduction") {
    const count = tokens(directive).policy_count;
    steps.push({
      order: 1,
      label: "전체 월 보험료 확인",
      move: count ? `제가 ${count}건 전체 월 보험료부터 정리해드릴게요` : "제가 전체 월 보험료부터 정리해드릴게요",
    });
    steps.push({
      order: 2,
      label: "납입액 대비 활용도",
      move: "납입액 대비 실제 활용도를 함께 짚어볼게요",
    });
  } else if (focus === "premium_amount") {
    steps.push({
      order: 1,
      label: "확인된 납입액 정리",
      move: "제가 확인된 월 납입액부터 정리해드릴게요",
    });
    steps.push({
      order: 2,
      label: "전체 계약 납입 확인",
      move: "등록된 계약 전체 납입 규모를 이어서 확인합니다",
    });
  } else if (focus === "policy_overview") {
    steps.push({
      order: 1,
      label: "실손 보장 확인",
      move: "제가 실손 보장 내용부터 순서대로 짚어볼게요",
    });
    steps.push({
      order: 2,
      label: "계약 구성 연결",
      move: "다른 보장과 어떻게 맞물리는지 정리합니다",
    });
  } else if (focus === "next_step") {
    steps.push({
      order: 1,
      label: "실손의료비보험 확인",
      move: "제가 실손의료비보험부터 짚어볼게요",
    });
    steps.push({
      order: 2,
      label: "중복 여부 점검",
      move: "실손 중복 여부를 먼저 확인합니다",
    });
  }

  if (!steps.length) return null;
  return {
    type: "next_steps_card",
    title: "다음 확인 순서",
    steps: steps.slice(0, 3),
  };
}

const BUILDERS = {
  premium_summary_table: buildPremiumSummaryTable,
  policy_count_summary: buildPolicyCountSummary,
  coverage_gap_table: buildCoverageGapTable,
  next_steps_card: buildNextStepsCard,
};

/**
 * @param {object} params
 * @param {object} params.directive
 */
export function buildKeyVoiceVisualBlocks({ directive = null } = {}) {
  if (!directive) return [];

  const focus = directive.question_focus ?? "general";
  const types = BLOCK_MAPPING[focus] ?? [];
  const blocks = [];

  for (const type of types) {
    const builder = BUILDERS[type];
    if (!builder) continue;
    const block = builder(directive);
    if (block) blocks.push(block);
  }

  return blocks;
}

export { BLOCK_MAPPING };
