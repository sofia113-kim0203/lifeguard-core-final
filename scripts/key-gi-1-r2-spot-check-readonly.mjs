/**
 * KEY-GI-1 R2 — spot-check re-measure (READ ONLY).
 * Tom: verify 0% holds on fresh GK samples + insurance health-word guard.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { classifyConsultationIntent } from "../server/intentGateLayer.js";
import { isGeneralKnowledgeEligible } from "../server/generalKnowledgeEligibility.js";
import {
  resolveHomeBrainRoute,
  isCasualHomeQuestion,
} from "../server/homeBrainRouter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(
  ROOT,
  "fixtures/key-judgment-validation-v1/key-gi-1-r2-spot-check-v1-evidence.json",
);

const INSURANCE_INTENTS = new Set([
  "design_request",
  "recommendation_request",
  "coverage_gap_check",
  "coverage_review_request",
  "claim_eligibility_check",
  "policy_detail",
  "underwriting_bound_check",
  "design_review_check",
  "design_priority_check",
  "recommendation_priority_check",
]);

const TOM_GK_SPOT = [
  { id: "SPOT-GK-01", q: "유럽 배낭여행 준비물 알려줘.", source: "tom" },
  { id: "SPOT-GK-02", q: "주식 ETF가 뭐야?", source: "tom" },
  { id: "SPOT-GK-03", q: "초등학생 공부 습관 알려줘.", source: "tom" },
  { id: "SPOT-GK-04", q: "감기랑 독감 차이가 뭐야?", source: "tom" },
  { id: "SPOT-GK-05", q: "양자컴퓨터가 뭐야?", source: "tom" },
];

const EXTENDED_GK_SPOT = [
  { id: "SPOT-GK-06", q: "제주도 렌트카 필요해?", source: "extended" },
  { id: "SPOT-GK-07", q: "파스타 면 삶는 시간", source: "extended" },
  { id: "SPOT-GK-08", q: "인공지능과 머신러닝 차이", source: "extended" },
  { id: "SPOT-GK-09", q: "조선시대 양반과 상민 차이", source: "extended" },
  { id: "SPOT-GK-10", q: "금리 인상이 대출에 미치는 영향", source: "extended" },
  { id: "SPOT-GK-11", q: "아이 스마트폰 사용 시간 줄이는 법", source: "extended" },
  { id: "SPOT-GK-12", q: "홍대 브런치 카페 추천해줘", source: "extended" },
  { id: "SPOT-GK-13", q: "목 통증 스트레칭 방법", source: "extended" },
  { id: "SPOT-GK-14", q: "비트코인 halving이 뭐야", source: "extended" },
  { id: "SPOT-GK-15", q: "장마철 빨래 냄새 없애는 법", source: "extended" },
];

const TOM_INS_SPOT = [
  { id: "SPOT-INS-01", q: "실손보험에서 다이어트 치료는 보장돼?", source: "tom", expect: "insurance" },
  { id: "SPOT-INS-02", q: "건강검진 결과가 보험 가입에 영향 있어?", source: "tom", expect: "insurance" },
  { id: "SPOT-INS-03", q: "살을 빼면 보험료가 내려가?", source: "tom", expect: "insurance" },
  { id: "SPOT-INS-04", q: "암 진단비 얼마나 필요해", source: "tom", expect: "insurance" },
  { id: "SPOT-INS-05", q: "뭐 가입해야 해", source: "tom", expect: "insurance" },
];

const EXTENDED_INS_SPOT = [
  { id: "SPOT-INS-06", q: "실손 MRI 청구 가능해?", source: "extended", expect: "insurance" },
  { id: "SPOT-INS-07", q: "보장 공백 있어?", source: "extended", expect: "insurance" },
  { id: "SPOT-INS-08", q: "당뇨 있으면 암보험 가입 돼?", source: "extended", expect: "insurance" },
  { id: "SPOT-INS-09", q: "보험료 너무 비싼가", source: "extended", expect: "insurance" },
  { id: "SPOT-INS-10", q: "건강검진 이상 소견 있으면 실손 가입", source: "extended", expect: "insurance" },
];

function probeGk(row) {
  const c = classifyConsultationIntent(row.q);
  const gkOk = c.general_knowledge === true || c.matched_rule === "general_knowledge_eligible";
  const insuranceMisroute = INSURANCE_INTENTS.has(c.intent);
  return {
    ...row,
    classification: {
      intent: c.intent,
      matched_rule: c.matched_rule,
      general_knowledge: c.general_knowledge ?? false,
    },
    home_route: resolveHomeBrainRoute(row.q, c),
    is_casual_home: isCasualHomeQuestion(row.q, c),
    gk_ok: gkOk,
    insurance_misroute: insuranceMisroute || !gkOk,
  };
}

function probeIns(row) {
  const c = classifyConsultationIntent(row.q);
  const gkLeak =
    c.general_knowledge === true ||
    c.matched_rule === "general_knowledge_eligible" ||
    isGeneralKnowledgeEligible(row.q, c);
  const casualLeak = isCasualHomeQuestion(row.q, c) && !INSURANCE_INTENTS.has(c.intent);
  return {
    ...row,
    classification: {
      intent: c.intent,
      matched_rule: c.matched_rule,
      general_knowledge: c.general_knowledge ?? false,
    },
    home_route: resolveHomeBrainRoute(row.q, c),
    is_casual_home: isCasualHomeQuestion(row.q, c),
    gk_leak: gkLeak,
    casual_home_leak: casualLeak,
    insurance_ok: !gkLeak,
  };
}

function main() {
  mkdirSync(join(ROOT, "fixtures/key-judgment-validation-v1"), { recursive: true });

  const gkRows = [...TOM_GK_SPOT, ...EXTENDED_GK_SPOT].map(probeGk);
  const insRows = [...TOM_INS_SPOT, ...EXTENDED_INS_SPOT].map(probeIns);

  const gkMis = gkRows.filter((r) => r.insurance_misroute).length;
  const insLeak = insRows.filter((r) => r.gk_leak).length;

  const evidence = {
    document: "key_gi_1_r2_spot_check_v1_evidence",
    slice: "KEY-GI-1",
    phase: "GI1-R2",
    mode: "READ ONLY · fresh spot re-measure",
    status: "measured — no PASS · R1-ready prep",
    version: "1.0.0",
    observed_at: new Date().toISOString(),
    pass_declaration: "none",
    r2_evidence_ref: "fixtures/key-judgment-validation-v1/key-gi-1-r2-v1-evidence.json",
    intent_criteria_ref: "fixtures/key-judgment-validation-v1/key-gi-1-r2-intent-criteria-v1.json",
    corpus: {
      gk_spot_total: gkRows.length,
      gk_tom_samples: TOM_GK_SPOT.length,
      gk_extended: EXTENDED_GK_SPOT.length,
      ins_spot_total: insRows.length,
      ins_tom_samples: TOM_INS_SPOT.length,
      ins_extended: EXTENDED_INS_SPOT.length,
      note: "Not limited to 100-bank — fresh Tom + extended samples",
    },
    gk_spot_summary: {
      gk_to_insurance_misroute: gkMis,
      gk_to_insurance_percent: Math.round((gkMis / gkRows.length) * 1000) / 10,
      tom_target_lte_2pct: gkMis / gkRows.length <= 0.02,
    },
    insurance_spot_summary: {
      insurance_to_gk_leaks: insLeak,
      insurance_to_gk_percent: Math.round((insLeak / insRows.length) * 1000) / 10,
      tom_target_lte_5pct: insLeak / insRows.length <= 0.05,
    },
    gk_spot_rows: gkRows,
    insurance_spot_rows: insRows,
    tom_readout: {
      fresh_gk: gkMis === 0 ? "Tom 5 + extended 10 — no GK→insurance misroute" : `${gkMis} misroutes found`,
      insurance_health_words:
        insLeak === 0
          ? "다이어트/건강검진 + 보험 linkage stays insurance — not GK"
          : `${insLeak} GK leaks found`,
      status: "R2 ready for R1 Delegation — not R2 closed",
    },
    jerry: "Tom 3 checks · spot re-measure · no R1 code",
  };

  writeFileSync(OUT, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify({
      ok: true,
      out: OUT,
      gk_mis: gkMis,
      ins_leak: insLeak,
    }),
  );
}

main();
